import type { KeyEvent, MouseEvent, ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import type { Accessor } from 'solid-js';

import type { ChangeSection, ChangesMeta } from '../core/changeSections';
import { DIFF_MAX_LINES } from '../core/changeSections';
import type { FileStatus } from '../core/git';
import { ui } from '../themes';
import {
	changesSummary,
	cutPath,
	SECTION_HEADER_ROWS,
	sectionHeaderMeta,
	sectionPath,
	stickyHeader,
} from './changesLayout';
import { diffRows } from './diffRows';
import type { DiffMode } from './diffRows';
import { MARKS, statusColor } from './FileTree';

export interface ChangesViewProps {
	sections: ChangeSection[];
	meta: ChangesMeta;
	/** Git panel cursor's section, or null on a heading — the page scrolls to it. */
	focusKey: string | null;
	/** `Uncommitted`, or the branch the list is measured against. */
	title: string;
	/** Inline or side-by-side, for every section at once — `diffView`. */
	mode: DiffMode;
	width: number;
	focused: boolean;
	blocked: boolean;
	/** False against a comparison base, where there is no index to stage into. */
	staging: boolean;
	onFocus: () => void;
	onToggleMode: () => void;
	/** Stage or unstage one file — its `+`/`-`, and Space on its header. */
	onToggleStage: (key: string) => void;
	onClose: () => void;
}

/** A laid-out renderable, as much of one as the page reads back. */
interface LaidOut {
	y: number;
	height: number;
}

/** Left column the selection mark occupies. */
const HEADER_MARK = 1;

/** Frames the first reveal waits for the stack to lay out — half a second. */
const REVEAL_TRIES = 30;

/**
 * Frames a re-anchor keeps re-applying itself after the layout flips. The
 * scrollbox clamps an offset against the height it still has, and the sections'
 * new heights land a layout pass later — one shot at it either overshoots or
 * falls short, and the reader watches the page jump and come back.
 */
const HOLD_FRAMES = 6;

/**
 * One frame. Renderable positions are written by the layout pass, which has not
 * run when the macrotask after a state change fires — re-reading them any sooner
 * hands back the geometry from before the change.
 */
const LAYOUT_FRAME = 16;

const STATUS_WORD: Partial<Record<FileStatus, string>> = {
	untracked: 'new',
	added: 'new',
	deleted: 'gone',
	renamed: 'renamed',
};

/**
 * The scrollbox emits no scroll event, so the sticky overlay is refreshed from
 * the renderable's own mouse hook — the same override the sidebar lists use.
 */
function watchScroll(el: ScrollBoxRenderable, moved: (top: number) => void) {
	const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void };
	const handle = host.onMouseEvent.bind(host);
	host.onMouseEvent = (event: MouseEvent) => {
		handle(event);
		moved(el.scrollTop);
	};
}

interface FileHeaderProps {
	section: ChangeSection;
	width: number;
	collapsed: boolean;
	/** `meta` is the counts row alone — what is left while the next header pushes. */
	part: 'full' | 'meta';
	selected: boolean;
	staging: boolean;
	onToggle: () => void;
	onStage: () => void;
}

function FileHeader(props: FileHeaderProps) {
	const bg = () => (props.selected ? ui.treeSelectedBg : ui.barBg);
	const mark = () => (props.selected ? ui.accent : bg());
	const word = () => STATUS_WORD[props.section.status] ?? '';
	const color = () => statusColor(props.section.status);
	const chevron = () => (props.collapsed ? '▸' : '▾');
	const textWidth = () => Math.max(8, props.width - HEADER_MARK);
	const path = () => {
		const right = word() ? ` ${word()} ` : '';
		const prefix = ` ${chevron()} ${MARKS[props.section.status]} `;
		// The stage button's two columns are held whether or not it is drawn: the
		// path would otherwise grow and shrink as the selection walked past.
		const button = props.staging ? 2 : 0;
		const room = Math.max(8, textWidth() - prefix.length - right.length - button);
		return cutPath(sectionPath(props.section), room);
	};
	const meta = () => sectionHeaderMeta(props.section).slice(0, textWidth());

	return (
		<box flexShrink={0} flexDirection="column" backgroundColor={bg()}>
			<Show when={props.part === 'full'}>
				<box
					height={1}
					flexDirection="row"
					flexShrink={0}
					backgroundColor={bg()}
					onMouseDown={() => props.onToggle()}
				>
					<text wrapMode="none" fg={mark()} bg={mark()} flexShrink={0} content=" " />
					<text wrapMode="none" fg={ui.dim} bg={bg()} flexShrink={0} content={` ${chevron()} `} />
					<text
						wrapMode="none"
						fg={color()}
						bg={bg()}
						flexShrink={0}
						content={`${MARKS[props.section.status]} `}
					/>
					<text wrapMode="none" fg={ui.text} bg={bg()} flexShrink={0} content={path()} />
					<box flexGrow={1} backgroundColor={bg()} />
					<Show when={word()}>
						<text wrapMode="none" fg={color()} bg={bg()} flexShrink={0} content={` ${word()} `} />
					</Show>
					{/* Staged files unstage, everything else stages — the panel's `+`/`-`, on
					    the file being read. Drawn on the selected header alone, as the panel
					    draws it on the cursor's row alone: a terminal has no hover to hide a
					    button behind. Its own handler, and it stops the event: pressing `+`
					    is not pressing the row, which would fold the file away. */}
					<Show when={props.staging && props.selected}>
						<text
							wrapMode="none"
							fg={ui.accent}
							bg={bg()}
							flexShrink={0}
							content={`${props.section.area === 'staged' ? '-' : '+'} `}
							onMouseDown={(event: MouseEvent) => {
								event.stopPropagation();
								props.onStage();
							}}
						/>
					</Show>
				</box>
			</Show>
			<box
				height={1}
				flexDirection="row"
				flexShrink={0}
				backgroundColor={bg()}
				onMouseDown={() => props.onToggle()}
			>
				<text wrapMode="none" fg={mark()} bg={mark()} flexShrink={0} content=" " />
				<text wrapMode="none" fg={ui.faint} bg={bg()} flexShrink={0} content={meta()} />
				<box flexGrow={1} backgroundColor={bg()} />
			</box>
		</box>
	);
}

/**
 * Every changed file stacked in one scroll over the editor slot. The
 * source-control panel keeps the list and the commit; this is the reading
 * surface, and the panel's cursor is what pages through it.
 */
export function ChangesView(props: ChangesViewProps) {
	const dimensions = useTerminalDimensions();
	const [folded, setFolded] = createSignal<Set<string>>(new Set());
	const [scrollTop, setScrollTop] = createSignal(0);
	const [pickedKey, setPickedKey] = createSignal<string | null>(null);

	// Bumped when the stack's geometry moved for a reason `scrollTop` cannot
	// report. `equals: false` so a bump always notifies.
	const [layout, bumpLayout] = createSignal(0, { equals: false });

	let box: ScrollBoxRenderable | undefined;
	const anchors = new Map<string, LaidOut>();
	const headers = new Map<string, LaidOut>();
	let revealTimer: ReturnType<typeof setTimeout> | undefined;
	let layoutTimer: ReturnType<typeof setTimeout> | undefined;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		clearTimeout(revealTimer);
		clearTimeout(layoutTimer);
		clearTimeout(holdTimer);
	});

	const syncScroll = () => {
		if (box) setScrollTop(box.scrollTop);
	};

	/**
	 * Folding moves every header below it, and can shorten the stack enough that
	 * the scrollbox clamps its own `scrollTop`. Both are read straight off the
	 * renderables and neither is a signal, so without this the pinned header keeps
	 * the position it had before the fold and is painted a second time over the one
	 * now back in flow.
	 */
	const remeasure = () => {
		clearTimeout(layoutTimer);
		layoutTimer = setTimeout(() => {
			syncScroll();
			bumpLayout(0);
		}, LAYOUT_FRAME);
	};

	const inner = () => Math.max(1, props.width - 1);
	const isFolded = (key: string) => folded().has(key);
	const setFold = (key: string, collapse: boolean) => {
		let changed = false;
		setFolded((cur) => {
			if (cur.has(key) === collapse) return cur;
			changed = true;
			const next = new Set(cur);
			if (collapse) next.add(key);
			else next.delete(key);
			return next;
		});
		if (changed) remeasure();
	};
	const toggleFold = (key: string) => setFold(key, !isFolded(key));

	const scroll = (delta: number) => {
		// A hold re-applies its offset for a few frames; a reader scrolling inside
		// that window has to win, or the page would pull itself back under them.
		clearTimeout(holdTimer);
		if (box) box.scrollTop = Math.max(0, box.scrollTop + delta);
		syncScroll();
	};
	const scrollTo = (row: number) => {
		clearTimeout(holdTimer);
		if (box) box.scrollTop = Math.max(0, row);
		syncScroll();
	};

	/**
	 * Put a file at the top of the page. Always, even when it is already on screen:
	 * moving onto a change and having the page hold still reads as a key that did
	 * nothing, and where a change *starts* is what was being asked for.
	 */
	const reveal = (key: string) => {
		const host = box;
		const el = anchors.get(key);
		if (!host || !el) return;
		host.scrollTop = el.y - host.y + host.scrollTop;
		syncScroll();
	};

	const headerYs = (): number[] => {
		layout();
		const host = box;
		if (!host) return [];
		return props.sections.map((section) => {
			const el = headers.get(section.key);
			if (!el || el.height <= 0) return Number.NaN;
			return el.y - host.y + host.scrollTop;
		});
	};

	const sticky = createMemo(() => {
		const pin = stickyHeader(scrollTop(), headerYs());
		if (!pin) return null;
		const section = props.sections[pin.index];
		if (!section) return null;
		return { section, clipped: pin.clipped };
	});

	const currentIndex = () => {
		const ys = headerYs();
		const pin = stickyHeader(scrollTop(), ys);
		if (pin) return pin.index;
		for (let i = 0; i < ys.length; i++) {
			if (Number.isFinite(ys[i]) && ys[i]! >= scrollTop()) return i;
		}
		const at = props.sections.findIndex((section) => section.key === props.focusKey);
		return at >= 0 ? at : 0;
	};

	/**
	 * Which header Tab and the fold keys talk about. Nothing is marked while the
	 * panel still has the keyboard — Tab into the page is what lights one. A memo,
	 * not a plain call: every header row asks, and each answer walks the sections.
	 */
	const selectedKey = createMemo(() => {
		if (!props.focused) return null;
		const keys = props.sections.map((section) => section.key);
		const picked = pickedKey();
		if (picked && keys.includes(picked)) return picked;
		return keys[currentIndex()] ?? null;
	});

	/** The file being read: the header Tab lit, else the panel cursor's. */
	const anchorKey = () => {
		const keys = props.sections.map((section) => section.key);
		const picked = pickedKey();
		if (picked && keys.includes(picked)) return picked;
		if (props.focusKey && keys.includes(props.focusKey)) return props.focusKey;
		return keys[currentIndex()] ?? null;
	};

	/**
	 * Hold a file at the top of the page across a relayout. Applied at once and
	 * again over the next few frames: the first attempt runs before the new heights
	 * exist and is clamped to the old ones, and only a later one lands — re-applying
	 * an offset that is already right costs nothing, and is what keeps the wrong
	 * frame from being one the reader sees.
	 */
	const holdAt = (key: string) => {
		clearTimeout(holdTimer);
		let tries = HOLD_FRAMES;
		const apply = () => {
			reveal(key);
			remeasure();
			if (--tries <= 0) return;
			// The first retry is a macrotask, not a frame: when the reconciler has
			// already applied the new heights there is nothing to wait for.
			holdTimer = setTimeout(apply, tries === HOLD_FRAMES - 1 ? 0 : LAYOUT_FRAME / 2);
		};
		apply();
	};

	/**
	 * Split pairs each change block row for row and pads the shorter side, so every
	 * section changes height when the layout flips — a scroll offset kept across
	 * that lands on a different file.
	 */
	createEffect(
		on(
			() => props.mode,
			() => {
				const key = anchorKey();
				if (key) holdAt(key);
			},
			{ defer: true },
		),
	);

	const moveSelection = (delta: number) => {
		const keys = props.sections.map((section) => section.key);
		if (keys.length === 0) return;
		const at = Math.max(0, keys.indexOf(selectedKey() ?? keys[0]!));
		const next = keys[(at + delta + keys.length) % keys.length]!;
		setPickedKey(next);
		reveal(next);
	};

	createEffect(
		on(
			// Membership, not identity: a refresh that reuses the same keys must not
			// yank the scroll back. First open still fires — `focusKey` is set before
			// the section refs exist, and a tick that misses has to try again.
			() => `${props.focusKey ?? ''}\n${props.sections.map((s) => s.key).join('\n')}`,
			() => {
				const key = props.focusKey;
				if (!key || !props.sections.some((s) => s.key === key)) return;
				clearTimeout(revealTimer);
				// Capped: a section that never lays out would otherwise hold a timer for
				// as long as the page is open.
				let tries = REVEAL_TRIES;
				const tryReveal = () => {
					const el = anchors.get(key);
					const first = props.sections[0]?.key === key;
					// y stays 0 until layout, and treating that as ready scrolls a later
					// file to the top on first open. Not `y > 0`: a section scrolled off
					// the top has a negative y, and waiting for it to turn positive is
					// waiting forever — which is a click on a file above the one on
					// screen scrolling nowhere.
					if (el && box && el.height > 0 && (first || el.y !== 0)) {
						reveal(key);
						return;
					}
					if (--tries <= 0) return;
					revealTimer = setTimeout(tryReveal, LAYOUT_FRAME);
				};
				tryReveal();
			},
		),
	);

	const page = () => Math.max(1, dimensions().height - 3);

	useKeyboard((key: KeyEvent) => {
		if (props.blocked || !props.focused || key.defaultPrevented) return;
		const k = key.name;
		const selected = () => selectedKey();
		if (k === 'up' || k === 'k') scroll(-1);
		else if (k === 'down' || k === 'j') scroll(1);
		else if (k === 'pageup' || (key.ctrl && k === 'u')) scroll(-page());
		else if (k === 'pagedown' || (key.ctrl && k === 'd')) scroll(page());
		else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER);
		else if (k === 'home' || k === 'g') scrollTo(0);
		else if (k === 'left' || k === 'h') {
			const at = selected();
			if (at) setFold(at, true);
		} else if (k === 'right' || k === 'l') {
			const at = selected();
			if (at) setFold(at, false);
		} else if (k === 'tab') moveSelection(key.shift ? -1 : 1);
		// Space is the panel's stage key and it means the same here rather than
		// paging: PgDn and Ctrl+D already page, and nothing else on this side of Tab
		// could stage the file being read.
		else if (k === 'space' || key.sequence === ' ') {
			const at = selected();
			if (at && props.staging) props.onToggleStage(at);
		} else if (k === 's' || k === 'd') props.onToggleMode();
		else if (k === 'escape' || k === 'q') props.onClose();
		else return;
		key.preventDefault();
	});

	const hints = () => {
		const layoutName = props.mode === 'inline' ? 'inline' : 'side-by-side';
		// The page answers to `s`; the panel, which holds the keyboard until Tab is
		// pressed, answers to `S`. Naming the key that works from where the keyboard
		// actually is, is the whole point of a hint.
		const key = props.focused ? 's' : 'S';
		const stage = props.staging ? ' · space stage' : '';
		const full = ` ${layoutName} · ${key} layout${stage} · ↑↓ scroll · Tab file · ← fold · Esc close `;
		if (full.length + 28 <= props.width) return full;
		const short = ` ${layoutName} · ${key} · Tab · ← fold · Esc close `;
		return short.length + 28 <= props.width ? short : ' Tab · ← fold · Esc close ';
	};

	const header = () => {
		const room = Math.max(8, props.width - hints().length - 1);
		return ` ${changesSummary(props.title, props.sections.length, props.meta).slice(0, room)}`;
	};

	const rule = () => '─'.repeat(inner());

	return (
		<box
			width="100%"
			height="100%"
			flexDirection="column"
			backgroundColor={ui.bg}
			onMouseDown={() => props.onFocus()}
		>
			<box flexDirection="row" flexShrink={0} backgroundColor={ui.barBg}>
				<text wrapMode="none" fg={ui.text} bg={ui.barBg} flexShrink={0} content={header()} />
				<box flexGrow={1} backgroundColor={ui.barBg} />
				<text wrapMode="none" fg={ui.dim} bg={ui.barBg} flexShrink={0} content={hints()} />
			</box>
			<Show
				when={props.sections.length > 0}
				fallback={
					<box flexGrow={1} backgroundColor={ui.bg} paddingLeft={2} paddingTop={1}>
						<text fg={ui.dim} bg={ui.bg} content="No file changes." />
					</box>
				}
			>
				<box flexGrow={1}>
					<scrollbox
						ref={(el: ScrollBoxRenderable) => {
							box = el;
							watchScroll(el, (top) => {
								if (top !== scrollTop()) setScrollTop(top);
							});
						}}
						flexGrow={1}
						backgroundColor={ui.bg}
						stickyScroll={false}
						scrollbarOptions={{
							trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.bg },
						}}
					>
						<For each={props.sections}>
							{(section) => {
								onCleanup(() => {
									anchors.delete(section.key);
									headers.delete(section.key);
								});
								const rows = createMemo(() =>
									section.file
										? diffRows(section.file, props.mode, inner(), DIFF_MAX_LINES)
										: [{ kind: 'meta' as const, text: '  Binary file: no textual diff.' }],
								);
								return (
									<box
										ref={(el: LaidOut) => {
											if (el) anchors.set(section.key, el);
										}}
										width="100%"
										flexShrink={0}
										flexDirection="column"
									>
										{/* A blank row on `bg` is invisible — it reads as an empty line
										    of the diff. The rule is what separates one file from the next. */}
										<text
											wrapMode="none"
											fg={ui.scrollbar}
											bg={ui.bg}
											flexShrink={0}
											content={rule()}
										/>
										<box
											ref={(el: LaidOut) => {
												if (el) headers.set(section.key, el);
											}}
											flexShrink={0}
										>
											<FileHeader
												section={section}
												width={inner()}
												collapsed={isFolded(section.key)}
												part="full"
												selected={selectedKey() === section.key}
												staging={props.staging}
												onStage={() => {
													setPickedKey(section.key);
													props.onToggleStage(section.key);
												}}
												onToggle={() => {
													setPickedKey(section.key);
													toggleFold(section.key);
												}}
											/>
										</box>
										<Show when={!isFolded(section.key)}>
											<For each={rows()}>
												{(row) => (
													<text
														wrapMode="none"
														flexShrink={0}
														fg={
															row.kind === 'add'
																? ui.gitAdded
																: row.kind === 'del'
																	? ui.gitDeleted
																	: row.kind === 'meta'
																		? ui.faint
																		: ui.dim
														}
														bg={ui.bg}
														content={` ${row.text}`.slice(0, inner())}
													/>
												)}
											</For>
										</Show>
									</box>
								);
							}}
						</For>
					</scrollbox>
					<Show when={sticky()}>
						{(pin: Accessor<NonNullable<ReturnType<typeof sticky>>>) => (
							<box
								position="absolute"
								top={0}
								left={0}
								width={inner()}
								height={SECTION_HEADER_ROWS - pin().clipped}
								zIndex={2}
								flexShrink={0}
							>
								<FileHeader
									section={pin().section}
									width={inner()}
									collapsed={isFolded(pin().section.key)}
									part={pin().clipped > 0 ? 'meta' : 'full'}
									selected={selectedKey() === pin().section.key}
									staging={props.staging}
									onStage={() => {
										setPickedKey(pin().section.key);
										props.onToggleStage(pin().section.key);
									}}
									onToggle={() => {
										setPickedKey(pin().section.key);
										toggleFold(pin().section.key);
									}}
								/>
							</box>
						)}
					</Show>
				</box>
			</Show>
		</box>
	);
}
