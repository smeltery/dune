import { TextAttributes } from '@opentui/core';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';

import { computeHighlights, segmentsIn, STALE, styleForId } from '../languages/highlight';
import type { Highlighted } from '../languages/highlight';
import { isDeprecated, kindInfo, matchRuns } from '../lsp/completion';
import type { CompletionMatch, KindGroup } from '../lsp/completion';
import { ui } from '../themes';
import type { CompletionMenuLayout, SignatureLine } from './completionLayout';
import { completionSignature } from './completionLayout';

export interface CompletionMenuProps {
	matches: CompletionMatch[];
	selected: number;
	layout: CompletionMenuLayout;
	detail: string;
	filetype?: string;
	top: number;
	left: number;
}

const GROUP_COLORS: Record<KindGroup, () => string> = {
	fn: () => ui.accent,
	var: () => ui.gitModified,
	type: () => ui.folder,
	module: () => ui.gitAdded,
	keyword: () => ui.dim,
	text: () => ui.dim,
};

interface Span {
	text: string;
	fg: string;
	attributes: number;
}

const truncate = (text: string, room: number) =>
	text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text;

export function CompletionMenu(props: CompletionMenuProps) {
	const windowed = createMemo(() => {
		const start = Math.max(
			0,
			Math.min(props.selected - props.layout.rows + 1, props.matches.length - props.layout.rows),
		);
		return { start, rows: props.matches.slice(start, start + props.layout.rows) };
	});
	const inner = () => props.layout.width - 2;
	const filler = () =>
		props.layout.panelRows -
		props.layout.signature.length -
		props.layout.documentation.length -
		(props.layout.origin ? 1 : 0);
	const [parsed, setParsed] = createSignal<Highlighted | null>(null);
	createEffect(
		on([() => props.detail, () => props.filetype], ([detail, filetype]) => {
			setParsed(null);
			if (!detail || !filetype) return;
			let dropped = false;
			onCleanup(() => {
				dropped = true;
			});
			void (async () => {
				const doc = await computeHighlights(detail, filetype, 2, () => dropped);
				if (!dropped && doc !== STALE) setParsed(doc);
			})();
		}),
	);
	const captures = createMemo(() => {
		const doc = parsed();
		return doc ? segmentsIn(doc, 0, 0) : [];
	});
	const painted = (line: SignatureLine): Span[] => {
		const out: Span[] = [];
		let col = 0;
		for (const segment of captures()) {
			const start = Math.max(segment.start - line.start, col);
			const end = Math.min(segment.end - line.start, line.text.length);
			if (end <= start) continue;
			const style = styleForId(segment.styleId);
			if (!style || typeof style.fg !== 'string') continue;
			if (start > col) out.push({ text: line.text.slice(col, start), fg: ui.text, attributes: 0 });
			out.push({
				text: line.text.slice(start, end),
				fg: style.fg,
				attributes:
					(style.bold ? TextAttributes.BOLD : 0) | (style.italic ? TextAttributes.ITALIC : 0),
			});
			col = end;
		}
		if (col < line.text.length)
			out.push({ text: line.text.slice(col), fg: ui.text, attributes: 0 });
		return out;
	};

	return (
		<box
			position="absolute"
			top={props.top}
			left={props.left}
			width={props.layout.width}
			zIndex={30}
			flexDirection="column"
			backgroundColor={ui.panelBg}
			border
			borderStyle="rounded"
			borderColor={ui.scrollbar}
		>
			<Show
				when={props.matches.length > 0}
				fallback={<text fg={ui.dim} bg={ui.panelBg} content=" No suggestions" />}
			>
				<For each={windowed().rows}>
					{(match, i) => {
						const active = () => windowed().start + i() === props.selected;
						const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg);
						const kind = kindInfo(match.item.kind);
						const dim = isDeprecated(match.item);
						const labelRoom = Math.min(Math.max(match.item.label.length, 1), inner() - 4);
						const detailRoom = () => inner() - 4 - labelRoom - 2;
						const detail = () => completionSignature(match.item);
						return (
							<box flexDirection="row" backgroundColor={bg()}>
								<text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌' : ' '} />
								<text
									fg={GROUP_COLORS[kind.group]()}
									bg={bg()}
									flexShrink={0}
									content={`${kind.glyph} `}
								/>
								<box flexDirection="row" flexGrow={1}>
									<For each={matchRuns(truncate(match.item.label, labelRoom), match.positions)}>
										{(run) => (
											<text
												fg={run.hit ? ui.accent : dim ? ui.faint : active() ? ui.text : ui.dim}
												bg={bg()}
												content={run.text}
											/>
										)}
									</For>
								</box>
								<Show when={detail() && detailRoom() >= 4}>
									<text
										fg={ui.faint}
										bg={bg()}
										flexShrink={0}
										content={` ${truncate(detail(), detailRoom())} `}
									/>
								</Show>
							</box>
						);
					}}
				</For>
				<Show when={props.matches.length > props.layout.rows}>
					<box flexDirection="row" backgroundColor={ui.panelBg}>
						<box flexGrow={1} backgroundColor={ui.panelBg} />
						<text
							fg={ui.faint}
							bg={ui.panelBg}
							content={`${props.selected + 1}/${props.matches.length} `}
						/>
					</box>
				</Show>
				<Show when={props.layout.panelRows > 0}>
					<text
						fg={ui.scrollbar}
						bg={ui.panelBg}
						wrapMode="none"
						content={'─'.repeat(Math.max(0, inner()))}
					/>
					<For each={props.layout.signature}>
						{(line) => (
							<box flexDirection="row" backgroundColor={ui.panelBg}>
								<text fg={ui.text} bg={ui.panelBg} flexShrink={0} content=" " />
								<For each={painted(line)}>
									{(span) => (
										<text
											fg={span.fg}
											bg={ui.panelBg}
											flexShrink={0}
											wrapMode="none"
											attributes={span.attributes}
											content={span.text}
										/>
									)}
								</For>
								<box flexGrow={1} backgroundColor={ui.panelBg} />
							</box>
						)}
					</For>
					<For each={props.layout.documentation}>
						{(line) => <text fg={ui.dim} bg={ui.panelBg} wrapMode="none" content={` ${line}`} />}
					</For>
					<Show when={props.layout.origin}>
						<text
							fg={ui.faint}
							bg={ui.panelBg}
							wrapMode="none"
							content={` ${props.layout.origin}`}
						/>
					</Show>
					<box height={Math.max(0, filler())} backgroundColor={ui.panelBg} />
				</Show>
			</Show>
		</box>
	);
}
