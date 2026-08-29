import { TextAttributes } from '@opentui/core';
import type { MouseEvent } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { createMemo, For, Show } from 'solid-js';

import type { IconThemeName } from '../core/config';
import type { IconTheme } from '../core/iconThemes';
import { ui } from '../themes';
import { builtinGlyph, themedGlyph } from './FileTree';
import { ALT, effectiveShortcut } from './keys';
import { problemColor, problemGlyph } from './problemMarks';
import { useTooltip } from './tooltip';

/** Worst diagnostic a tab's file carries. Info and hints are not a tab's business. */
export type TabSeverity = 'error' | 'warning';

export interface TabInfo {
	path: string;
	name: string;
	dirty: boolean;
	preview: boolean;
	/** Worst diagnostic of the file, or null when it has none. */
	severity: TabSeverity | null;
}

export interface TabsProps {
	tabs: TabInfo[];
	activePath: string | null;
	canBack: boolean;
	canForward: boolean;
	onSelect: (path: string) => void;
	onClose: (path: string) => void;
	onBack: () => void;
	onForward: () => void;
	/** Clicking an overflow counter asks for the full list of open tabs. */
	onOverflow: () => void;
	keybindings: Record<string, string>;
	/** Show each file's type icon beside its label, the tree's icon theme applied. */
	tabIcons: boolean;
	iconTheme: IconThemeName;
	iconThemes: readonly IconTheme[];
}

const MAX_LABEL = 18;
/** Padding, the dirty/close glyph and the separator around a label. */
const CHROME = 5;
/** The glyph slot before a label, and the space after it. */
const SLOT = 2;
const NAV_CHROME = 6;

const shorten = (name: string) =>
	name.length <= MAX_LABEL ? name : `${name.slice(0, MAX_LABEL - 1)}…`;

/** The path's own file name, ignoring a rendered-markdown tab's `¶ ` label prefix. */
const fileNameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * One glyph before the label, or null for none: a diagnostic outranks the file
 * icon rather than sitting beside it. Both are one cell, so a file that starts
 * erroring while icons are on moves nothing — and where icons are off, which is
 * the default, the mark is the only thing the slot is ever spent on.
 */
const glyphOf = (
	tab: TabInfo,
	icon: { glyph: string; color?: string } | null,
): { glyph: string; color?: string } | null =>
	tab.severity ? { glyph: problemGlyph(tab.severity), color: problemColor(tab.severity) } : icon;

export function Tabs(props: TabsProps) {
	const dimensions = useTerminalDimensions();
	const shortcut = (id: string, fallback: string) =>
		effectiveShortcut(props.keybindings, id, fallback);
	const switchChord = () => shortcut('tabs.switch', 'Ctrl+T');
	// Two targets, not one: with tabs overflowing on both ends, "‹N" and "N›"
	// are on screen at once, and sharing a target would let the later of the
	// two mounts steal the earlier one's box.
	const overflowBeforeTip = useTooltip(switchChord);
	const overflowAfterTip = useTooltip(switchChord);
	const backTip = useTooltip(() => shortcut('navigation.back', `Ctrl+${ALT}+Z`));
	const forwardTip = useTooltip(() => shortcut('navigation.forward', `Ctrl+${ALT}+Y`));
	const glyphFor = (path: string) => {
		const node = { name: fileNameOf(path), isDir: false };
		const theme = props.iconThemes.find((entry) => entry.id === props.iconTheme);
		return theme ? themedGlyph(node, false, theme) : builtinGlyph(node, false, props.iconTheme);
	};
	const iconFor = (path: string) => {
		if (!props.tabIcons || props.iconTheme === 'none') return null;
		const glyph = glyphFor(path);
		return { glyph: glyph.glyph, color: glyph.color };
	};

	/**
	 * Only the tabs that fit are rendered, scrolled to keep the active one in
	 * view. Letting flexbox shrink them instead clips names mid-character.
	 */
	const visible = createMemo(() => {
		// The bar spans the terminal: the tree sits below it, not beside it. Taking
		// the sidebar's width off the budget made tabs reflow on every resize.
		const budget = Math.max(0, dimensions().width - NAV_CHROME);
		const width = (tab: TabInfo) =>
			shorten(tab.name).length + CHROME + (tab.severity || iconFor(tab.path) ? SLOT : 0);

		const active = Math.max(
			0,
			props.tabs.findIndex((tab) => tab.path === props.activePath),
		);
		let first = active;
		let last = active;
		let used = props.tabs[active] ? width(props.tabs[active]!) : 0;

		// Grow outwards from the active tab until the row is full.
		while (first > 0 || last < props.tabs.length - 1) {
			const before = first > 0 ? width(props.tabs[first - 1]!) : Infinity;
			const after = last < props.tabs.length - 1 ? width(props.tabs[last + 1]!) : Infinity;
			const next = Math.min(before, after);
			if (used + next > budget) break;
			if (after <= before) {
				last++;
			} else {
				first--;
			}
			used += next;
		}
		return {
			tabs: props.tabs.slice(first, last + 1),
			before: first,
			after: props.tabs.length - 1 - last,
		};
	});

	return (
		<box flexDirection="column" flexShrink={0}>
			<box height={1} flexDirection="row" backgroundColor={ui.barBg}>
				<text bg={ui.bg} content=" " />
				<Show
					when={props.tabs.length > 0}
					fallback={<text fg={ui.faint} bg={ui.barBg} content=" no open files" />}
				>
					<Show when={visible().before > 0}>
						<box
							ref={overflowBeforeTip.ref}
							paddingLeft={1}
							backgroundColor={ui.barBg}
							onMouseDown={() => props.onOverflow()}
							onMouseOver={overflowBeforeTip.enter}
							onMouseOut={overflowBeforeTip.leave}
						>
							<text fg={ui.dim} bg={ui.barBg} content={`‹${visible().before}`} />
						</box>
					</Show>
					<For each={visible().tabs}>
						{(tab) => {
							const active = () => tab.path === props.activePath;
							const bg = () => (active() ? ui.bg : ui.barBg);
							const closeTip = useTooltip(() => shortcut('tabs.close', 'Ctrl+W'));
							return (
								<box
									flexDirection="row"
									flexShrink={0}
									backgroundColor={bg()}
									paddingLeft={1}
									paddingRight={1}
									onMouseDown={() => props.onSelect(tab.path)}
								>
									<Show when={glyphOf(tab, iconFor(tab.path))}>
										{(mark: () => { glyph: string; color?: string }) => (
											<text
												fg={mark().color ?? (active() ? ui.dim : ui.faint)}
												bg={bg()}
												flexShrink={0}
												content={`${mark().glyph} `}
											/>
										)}
									</Show>
									<text
										fg={active() ? ui.activeTabFg : ui.inactiveTabFg}
										bg={bg()}
										content={shorten(tab.name)}
										attributes={
											tab.preview
												? TextAttributes.ITALIC
												: active()
													? TextAttributes.BOLD
													: undefined
										}
									/>
									<box
										ref={closeTip.ref}
										paddingLeft={1}
										onMouseDown={(e: MouseEvent) => {
											e.stopPropagation();
											props.onClose(tab.path);
										}}
										onMouseOver={closeTip.enter}
										onMouseOut={closeTip.leave}
									>
										<text
											fg={tab.dirty ? ui.dirty : active() ? ui.dim : ui.barBg}
											bg={bg()}
											content={tab.dirty ? '●' : '×'}
										/>
									</box>
								</box>
							);
						}}
					</For>
					<Show when={visible().after > 0}>
						<box
							ref={overflowAfterTip.ref}
							paddingLeft={1}
							paddingRight={1}
							backgroundColor={ui.barBg}
							onMouseDown={() => props.onOverflow()}
							onMouseOver={overflowAfterTip.enter}
							onMouseOut={overflowAfterTip.leave}
						>
							<text fg={ui.dim} bg={ui.barBg} content={`${visible().after}›`} />
						</box>
					</Show>
					<box
						ref={backTip.ref}
						paddingLeft={1}
						backgroundColor={ui.barBg}
						onMouseDown={() => props.onBack()}
						onMouseOver={backTip.enter}
						onMouseOut={backTip.leave}
					>
						<text fg={props.canBack ? ui.dim : ui.faint} bg={ui.barBg} content="‹" />
					</box>
					<box
						ref={forwardTip.ref}
						paddingLeft={1}
						paddingRight={1}
						backgroundColor={ui.barBg}
						onMouseDown={() => props.onForward()}
						onMouseOver={forwardTip.enter}
						onMouseOut={forwardTip.leave}
					>
						<text fg={props.canForward ? ui.dim : ui.faint} bg={ui.barBg} content="›" />
					</box>
				</Show>
			</box>
		</box>
	);
}
