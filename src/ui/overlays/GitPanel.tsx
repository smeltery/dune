import { TextAttributes, type KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';

import type { ChangeRow } from '../../core/changeTree';
import {
	ancestorDirs,
	changeRows,
	changesFromEntries,
	commitRows,
	foldKey,
	rowArea,
	rowRel,
} from '../../core/changeTree';
import type { FileStatus, StatusEntry, UpstreamCommit } from '../../core/git';
import { upstreamCommits } from '../../core/git';
import { fuzzyScore } from '../../core/search';
import { ui } from '../../themes';
import { MARKS, statusColor } from '../FileTree';
import { TextInput } from '../TextInput';
import { ALT, effectiveShortcut } from '../keys';
import { useTooltip } from '../tooltip';

const stageGlyph = (row: ChangeRow) => (rowArea(row) === 'staged' ? '−' : '+');

const isFoldRow = (
	row: ChangeRow,
): row is Extract<ChangeRow, { kind: 'dir' | 'section' | 'commitSection' }> =>
	row.kind === 'dir' || row.kind === 'section' || row.kind === 'commitSection';

export function GitPanel(props: {
	rootDir: string;
	branch: string | null;
	base: string | null;
	upstream: { ahead: number; behind: number; name: string | null } | null;
	view: 'tree' | 'list';
	width: number;
	focused: boolean;
	statusEntries: Map<string, StatusEntry>;
	keybindings: Record<string, string>;
	onFocus: () => void;
	onDiff: (path: string) => void;
	/** Enter on a file while the all-changes page is up — close it and open the file. */
	onOpenFile: (path: string) => void;
	onOpenCommit: (oid: string) => void;
	onDiscard: (path: string, status: FileStatus) => void;
	onToggleStage: (row: ChangeRow) => void;
	onCommit: () => void;
	onFocusMessage: () => void;
	commitMessage: string;
	messageEditing: boolean;
	hasMessageHistory: boolean;
	onMessageInput: (value: string) => void;
	onWalkHistory: (delta: number) => void;
	onCancelMessage: () => void;
	onPush: () => void;
	onSync: () => void;
	onBranchAction: (action: 'switch' | 'compare' | 'commits') => void;
	reviewCount: number;
	onReview: () => void;
	onCycleView: () => void;
	/** The stacked all-changes page is up, so `a` closes it and Esc does too. */
	changesOpen: boolean;
	onShowChanges: () => void;
	onCloseChanges: () => void;
	/** Where the cursor is, so the open page can scroll to the same file. */
	onCursorRow: (row: ChangeRow | undefined) => void;
	/** Tab hands the keyboard to the editor slot — the page's own scroll keys. */
	onLeave: () => void;
	onToggleDiffLayout: () => void;
}) {
	const [index, setIndex] = createSignal(0);
	const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
	const [filtering, setFiltering] = createSignal(false);
	const [filter, setFilter] = createSignal('');
	const reviewTip = useTooltip(() =>
		effectiveShortcut(props.keybindings, 'view.review', `Ctrl+${ALT}+R`),
	);
	const staging = () => props.base === null;
	const syncCommits = createMemo(() => {
		void props.upstream;
		void props.statusEntries;
		if (!staging() || !props.upstream?.name) {
			return { incoming: [] as UpstreamCommit[], outgoing: [] as UpstreamCommit[] };
		}
		return {
			incoming: upstreamCommits(props.rootDir, 'incoming'),
			outgoing: upstreamCommits(props.rootDir, 'outgoing'),
		};
	});
	const changes = createMemo(() => {
		const all = changesFromEntries(props.rootDir, props.statusEntries);
		const query = filter().trim();
		if (query.length === 0) return all;
		return all.filter((change) => fuzzyScore(change.rel, query) !== null);
	});
	const rows = createMemo(() => {
		const change = changeRows(changes(), props.view, collapsed(), staging());
		if (!staging()) return change;
		const sync = syncCommits();
		return [...change, ...commitRows(sync.incoming, sync.outgoing, collapsed())];
	});
	const selected = () => Math.min(index(), Math.max(0, rows().length - 1));
	const selectedRow = createMemo(() => rows()[selected()]);
	// Keyed on what the row *is*, not on the object: a git refresh rebuilds `rows`
	// with the cursor still on the same file, and reporting that as a move would
	// yank the page's scroll back to the top of that file.
	const cursorKey = createMemo(() => {
		const row = selectedRow();
		return row ? `${row.kind}:${rowArea(row)}:${rowRel(row)}` : '';
	});
	createEffect(on(cursorKey, () => props.onCursorRow(selectedRow())));
	const headline = () => {
		const parts = [props.branch ?? 'git'];
		const upstream = props.upstream;
		if (upstream?.ahead) parts.push(`↑${upstream.ahead}`);
		if (upstream?.behind) parts.push(`↓${upstream.behind}`);
		return parts.join(' ');
	};
	const syncLabel = () => {
		const upstream = props.upstream;
		if (!upstream) return null;
		if (!upstream.name) return 'publish';
		if (upstream.ahead || upstream.behind) return 'sync';
		return null;
	};
	const toggleFold = (row: Extract<ChangeRow, { kind: 'dir' | 'section' | 'commitSection' }>) =>
		setCollapsed((prev) => {
			const key =
				row.kind === 'dir'
					? foldKey(row.area, row.rel)
					: row.kind === 'commitSection'
						? foldKey(row.group, '')
						: foldKey(row.area, '');
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	const canCollapseAll = () =>
		props.view === 'tree' && rows().some((row) => row.kind === 'dir' && !row.collapsed);
	const collapseAll = () => {
		const keys = changes().flatMap((change) =>
			ancestorDirs(change.rel).map((dir) => foldKey(change.area, dir)),
		);
		setCollapsed(new Set(keys));
		setIndex(0);
	};
	const setFilterValue = (value: string) => {
		setFilter(value);
		setIndex(0);
	};
	const activate = (row: ChangeRow | undefined) => {
		if (!row) return;
		if (isFoldRow(row)) toggleFold(row);
		else if (row.kind === 'commit') props.onOpenCommit(row.oid);
		else if (row.kind === 'file') {
			if (props.changesOpen) props.onOpenFile(row.change.path);
			else props.onDiff(row.change.path);
		}
	};

	useKeyboard((key: KeyEvent) => {
		if (!props.focused) return;
		if (props.messageEditing) {
			if (key.name === 'return' || key.name === 'enter') props.onCommit();
			else if (key.name === 'up') props.onWalkHistory(1);
			else if (key.name === 'down') props.onWalkHistory(-1);
			else if (key.name === 'escape') props.onCancelMessage();
			else return;
			key.preventDefault();
			return;
		}
		const count = Math.max(1, rows().length);
		const plain = !key.ctrl && !key.meta && !key.option && key.sequence?.length === 1;
		const row = () => rows()[selected()];
		const printable =
			key.sequence?.length === 1 &&
			key.sequence >= ' ' &&
			key.sequence !== '\u007F' &&
			!key.ctrl &&
			!key.meta &&
			!key.option;
		// Shift+Tab walks the tab strip above the sidebar even while filtering: it
		// is not a keystroke the filter field has any use for.
		if (key.name === 'tab' && key.shift) props.onCycleView();
		else if (filtering()) {
			if (key.name === 'escape') {
				if (filter()) setFilterValue('');
				else setFiltering(false);
			} else if (key.name === 'backspace') setFilterValue(filter().slice(0, -1));
			else if (printable) setFilterValue(`${filter()}${key.sequence}`);
			else return;
		} else if (key.name === 'up') setIndex((at) => (at - 1 + count) % count);
		else if (key.name === 'down') setIndex((at) => (at + 1) % count);
		else if (key.name === 'return' || key.name === 'enter') activate(row());
		else if (key.name === 'left') {
			const current = row();
			if (current && isFoldRow(current) && !current.collapsed) toggleFold(current);
		} else if (key.name === 'right') {
			const current = row();
			if (current && isFoldRow(current) && current.collapsed) toggleFold(current);
		} else if (key.name === 'tab' && props.changesOpen) props.onLeave();
		else if (key.name === 'escape' && props.changesOpen) props.onCloseChanges();
		else if (plain && key.name === ' ' && staging()) {
			const current = row();
			if (
				current &&
				(current.kind === 'file' || current.kind === 'dir' || current.kind === 'section')
			)
				props.onToggleStage(current);
		} else if (plain && key.name === 'a' && !key.shift) {
			if (props.changesOpen) props.onCloseChanges();
			else props.onShowChanges();
		} else if (plain && ((key.name === 's' && key.shift) || key.name === 'S')) {
			props.onToggleDiffLayout();
		} else if (plain && key.name === 'c') {
			if (props.base) props.onBranchAction('commits');
			else props.onFocusMessage();
		} else if (plain && key.name === 'd' && !props.base) {
			const current = row();
			if (current?.kind === 'file') props.onDiscard(current.change.path, current.change.status);
		} else if (plain && key.name === 's' && !key.shift) props.onSync();
		else if (plain && key.name === 'p') props.onPush();
		else if (plain && key.name === 'b' && !key.shift) props.onBranchAction('switch');
		else if (plain && ((key.name === 'b' && key.shift) || key.name === 'B'))
			props.onBranchAction('compare');
		else if (plain && key.sequence === '/' && props.base) {
			setFiltering(true);
			setFilterValue('');
		} else return;
		key.preventDefault();
	});

	const footerHints = () => {
		if (props.changesOpen) return 'a close · tab page · S layout · ↑↓ file · space stage';
		const fold = props.view === 'tree' ? ' · ←→ fold' : '';
		const sync = syncLabel() ? ' · s sync' : '';
		if (props.base)
			return `b branch · B compare · c commits · / filter · p push${sync} · a all${fold}`;
		const stage = staging() ? 'space stage · ' : '';
		return `b branch · B compare · c message · d discard · ${stage}p push${sync} · a all${fold}`;
	};

	return (
		<box
			width={props.width}
			flexDirection="column"
			backgroundColor={ui.panelBg}
			flexShrink={0}
			flexGrow={1}
			flexBasis={0}
			onMouseDown={props.onFocus}
		>
			<box height={2} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
				<box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
					<text fg={props.focused ? ui.text : ui.dim} bg={ui.panelBg} content={headline()} />
					<Show when={syncLabel()}>
						{(label: () => string) => (
							<text
								fg={ui.accent}
								bg={ui.panelBg}
								content={` · ${label()}`}
								onMouseDown={props.onSync}
							/>
						)}
					</Show>
				</box>
				<box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
					<text
						ref={reviewTip.ref}
						fg={props.base ? ui.dirty : props.reviewCount > 0 ? ui.accent : ui.faint}
						bg={ui.panelBg}
						content={
							filtering() || filter()
								? `filter ${filter()}`
								: props.base
									? `vs ${props.base}`
									: props.reviewCount > 0
										? `review ${props.reviewCount}`
										: 'review'
						}
						onMouseDown={props.onReview}
						onMouseOver={reviewTip.enter}
						onMouseOut={reviewTip.leave}
					/>
					<Show when={canCollapseAll()}>
						<text fg={ui.faint} bg={ui.panelBg} content=" · collapse" onMouseDown={collapseAll} />
					</Show>
				</box>
			</box>
			<Show when={staging()}>
				<box
					height={1}
					flexDirection="row"
					backgroundColor={ui.panelBg}
					paddingLeft={1}
					onMouseDown={props.onFocusMessage}
				>
					<text fg={ui.faint} bg={ui.panelBg} flexShrink={0} content="✎ " />
					<box flexGrow={1} backgroundColor={ui.panelBg}>
						<Show
							when={props.messageEditing}
							fallback={
								<text
									fg={props.commitMessage ? ui.text : ui.faint}
									bg={ui.panelBg}
									wrapMode="none"
									content={props.commitMessage || 'Message (c to edit)'}
								/>
							}
						>
							<TextInput
								value={props.commitMessage}
								placeholder={
									props.hasMessageHistory ? 'Commit message (↑ history)' : 'Commit message'
								}
								onInput={props.onMessageInput}
							/>
						</Show>
					</box>
				</box>
				<box height={1} flexDirection="row" backgroundColor={ui.panelBg} paddingLeft={1}>
					<text
						fg={ui.accent}
						bg={ui.panelBg}
						content="✓ Commit"
						attributes={TextAttributes.BOLD}
						onMouseDown={props.onCommit}
					/>
					<box flexGrow={1} backgroundColor={ui.panelBg} />
					<Show when={props.branch}>
						<text
							fg={ui.dim}
							bg={ui.panelBg}
							wrapMode="none"
							content={
								props.upstream?.name
									? `⇅ sync${props.upstream.ahead ? ` ↑${props.upstream.ahead}` : ''}${props.upstream.behind ? ` ↓${props.upstream.behind}` : ''} `
									: '⇡ publish '
							}
							onMouseDown={props.onSync}
						/>
					</Show>
				</box>
			</Show>
			<Show
				when={rows().length > 0}
				fallback={
					<box flexGrow={1} backgroundColor={ui.panelBg} paddingLeft={2}>
						<text fg={ui.faint} bg={ui.panelBg} content={filter() ? 'no matches' : 'no changes'} />
					</box>
				}
			>
				<box flexGrow={1} flexDirection="column" backgroundColor={ui.panelBg}>
					<For each={rows()}>
						{(row, at) => {
							const active = () => at() === selected();
							const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg);
							const stageTip = useTooltip(() => (staging() ? 'Space' : ''));
							return (
								<box
									height={1}
									flexDirection="row"
									backgroundColor={bg()}
									onMouseDown={() => activate(row)}
								>
									<text
										fg={ui.faint}
										bg={bg()}
										flexShrink={0}
										content={` ${'  '.repeat(row.depth)}`}
									/>
									<Show when={isFoldRow(row)}>
										{() =>
											isFoldRow(row) && (
												<text
													fg={ui.dim}
													bg={bg()}
													flexShrink={0}
													content={row.collapsed ? '▸ ' : '▾ '}
												/>
											)
										}
									</Show>
									<box flexGrow={1} backgroundColor={bg()}>
										<text
											fg={
												row.kind === 'section' || row.kind === 'commitSection'
													? ui.text
													: row.kind === 'dir'
														? ui.folder
														: row.kind === 'commit'
															? row.group === 'incoming'
																? ui.gitAdded
																: ui.accent
															: active()
																? ui.text
																: ui.dim
											}
											bg={bg()}
											content={
												row.kind === 'dir' || row.kind === 'section' || row.kind === 'commitSection'
													? row.label
													: ` ${row.label}`
											}
										/>
									</box>
									<Show when={row.kind === 'dir' || row.kind === 'section'}>
										{() =>
											(row.kind === 'dir' || row.kind === 'section') && (
												<text
													fg={ui.faint}
													bg={bg()}
													flexShrink={0}
													content={row.collapsed ? `${row.files} ` : ' '}
												/>
											)
										}
									</Show>
									<Show when={row.kind === 'commitSection'}>
										{() =>
											row.kind === 'commitSection' && (
												<text
													fg={ui.faint}
													bg={bg()}
													flexShrink={0}
													content={row.collapsed ? `${row.count} ` : ' '}
												/>
											)
										}
									</Show>
									<Show
										when={
											staging() &&
											(row.kind === 'file' || row.kind === 'dir' || row.kind === 'section')
										}
									>
										{() =>
											(row.kind === 'file' || row.kind === 'dir' || row.kind === 'section') && (
												<text
													ref={stageTip.ref}
													fg={ui.accent}
													bg={bg()}
													flexShrink={0}
													content={`${stageGlyph(row)} `}
													onMouseDown={(event) => {
														event.stopPropagation();
														props.onToggleStage(row);
													}}
													onMouseOver={stageTip.enter}
													onMouseOut={stageTip.leave}
												/>
											)
										}
									</Show>
									<Show when={row.kind === 'file'}>
										{() =>
											row.kind === 'file' && (
												<text
													fg={statusColor(row.change.status)}
													bg={bg()}
													flexShrink={0}
													content={`${MARKS[row.change.status]} `}
												/>
											)
										}
									</Show>
								</box>
							);
						}}
					</For>
				</box>
			</Show>
			<box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
				<text fg={ui.faint} bg={ui.panelBg} content={footerHints()} />
			</box>
		</box>
	);
}
