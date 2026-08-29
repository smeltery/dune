import type { KeyEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { createMemo, createSignal, For, Show } from 'solid-js';

import type { ProblemSeverity } from '../../lsp/protocol';
import { ui } from '../../themes';
import { cut, listRows, modalWidth, PAD, wrapText } from '../modal';
import { Overlay } from '../Overlay';
import { problemColor, problemGlyph } from '../problemMarks';

/** A problem with the path already relativised for drawing. */
export interface ProblemEntry {
	path: string;
	rel: string;
	line: number;
	col: number;
	severity: ProblemSeverity;
	message: string;
	source?: string;
}

export interface ProblemsModalProps {
	problems: ProblemEntry[];
	title: string;
	onPick: (problem: ProblemEntry) => void;
	onCancel: () => void;
}

const DETAIL_LINES = 4;

const glyph = (severity: ProblemSeverity) =>
	severity === 'error' || severity === 'warning' ? problemGlyph(severity) : '○';

const origin = (problem: ProblemEntry) => problem.source ?? '';

const location = (problem: ProblemEntry) => `${problem.rel}:${problem.line + 1}:${problem.col + 1}`;

const oneLine = (message: string) => message.replaceAll(/\s+/g, ' ').trim();

/**
 * Every open file's diagnostics, with the selected one spelled out in full.
 *
 * A server's message is routinely longer than a row, so the list carries as much
 * of each as it has columns for and the detail block under it carries the rest.
 */
export function ProblemsModal(props: ProblemsModalProps) {
	const dimensions = useTerminalDimensions();
	const [index, setIndex] = createSignal(0);

	const width = () => modalWidth(dimensions().width, 0.7, 64, 120);
	const visibleRows = () =>
		Math.min(listRows(dimensions().height, 12 + DETAIL_LINES, 24), props.problems.length);
	const room = () => width() - PAD * 2 - 4;

	const selected = () => Math.min(index(), Math.max(0, props.problems.length - 1));
	const current = () => props.problems[selected()];

	const counts = createMemo(() => {
		const tally: Record<ProblemSeverity, number> = { error: 0, warning: 0, info: 0, hint: 0 };
		for (const problem of props.problems) tally[problem.severity] += 1;
		return tally;
	});

	const heading = createMemo(() => {
		const tally = counts();
		const parts: string[] = [];
		if (tally.error > 0) parts.push(`${tally.error} error${tally.error === 1 ? '' : 's'}`);
		if (tally.warning > 0) parts.push(`${tally.warning} warning${tally.warning === 1 ? '' : 's'}`);
		const rest = tally.info + tally.hint;
		if (rest > 0) parts.push(`${rest} info`);
		return parts.join(' · ');
	});

	const locationWidth = createMemo(() => {
		const longest = props.problems.reduce((most, p) => Math.max(most, location(p).length), 0);
		return Math.min(longest, Math.floor(room() * 0.45));
	});

	const view = createMemo(() => {
		const size = visibleRows();
		const start = Math.max(0, Math.min(selected() - size + 1, props.problems.length - size));
		return { start, rows: props.problems.slice(start, start + size) };
	});

	const detailRows = createMemo(() => {
		const longest = props.problems.reduce(
			(most, p) => Math.max(most, oneLine(p.message).length),
			0,
		);
		return Math.max(1, Math.min(DETAIL_LINES, Math.ceil(longest / room())));
	});

	const detail = createMemo(() => {
		const problem = current();
		if (!problem) return [];
		const rows = detailRows();
		const lines = wrapText(oneLine(problem.message), room());
		if (lines.length <= rows) return lines;
		return [...lines.slice(0, rows - 1), cut(lines.slice(rows - 1).join(' '), room())];
	});

	useKeyboard((key: KeyEvent) => {
		const k = key.name;
		const count = props.problems.length;
		if (k === 'up') {
			key.preventDefault();
			if (count > 0) setIndex((i) => (i - 1 + count) % count);
		} else if (k === 'down') {
			key.preventDefault();
			if (count > 0) setIndex((i) => (i + 1) % count);
		} else if (k === 'return' || k === 'enter') {
			key.preventDefault();
			const problem = current();
			if (problem) props.onPick(problem);
		} else if (k === 'escape') {
			key.preventDefault();
			props.onCancel();
		}
	});

	return (
		<Overlay zIndex={160}>
			<box
				width={width()}
				flexDirection="column"
				backgroundColor={ui.panelBg}
				border
				borderStyle="rounded"
				borderColor={ui.dirty}
				title={` ${props.title} `}
				titleColor={ui.dirty}
				paddingLeft={PAD}
				paddingRight={PAD}
			>
				<text fg={ui.dim} bg={ui.panelBg} wrapMode="none" content={cut(heading(), room())} />
				<text fg={ui.panelBg} bg={ui.panelBg} content="" />
				<box flexDirection="column" height={visibleRows()}>
					<For each={view().rows}>
						{(problem, i) => {
							const active = () => view().start + i() === selected();
							const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg);
							const note = () => cut(origin(problem), Math.floor(room() / 3));
							const place = () => cut(location(problem), locationWidth()).padEnd(locationWidth());
							const message = () =>
								cut(oneLine(problem.message), room() - locationWidth() - note().length - 2);
							const noteText = () => (note() ? ` ${note()}` : '');
							return (
								<box flexDirection="row" backgroundColor={bg()}>
									<text fg={ui.dirty} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
									<text
										fg={problemColor(problem.severity)}
										bg={bg()}
										flexShrink={0}
										content={`${glyph(problem.severity)} `}
									/>
									<text
										wrapMode="none"
										fg={active() ? ui.text : ui.dim}
										bg={bg()}
										flexShrink={0}
										content={place()}
									/>
									<box flexGrow={1} backgroundColor={bg()}>
										<text
											wrapMode="none"
											fg={active() ? ui.text : ui.dim}
											bg={bg()}
											content={` ${message()}`}
										/>
									</box>
									<text
										wrapMode="none"
										fg={ui.faint}
										bg={bg()}
										flexShrink={0}
										content={noteText()}
									/>
								</box>
							);
						}}
					</For>
				</box>
				<text fg={ui.panelBg} bg={ui.panelBg} content="" />
				<box flexDirection="column" height={detailRows()}>
					<For each={detail()}>
						{(line) => <text wrapMode="none" fg={ui.text} bg={ui.panelBg} content={line} />}
					</For>
				</box>
				<Show when={current()}>
					{(problem: () => ProblemEntry) => (
						<text
							wrapMode="none"
							fg={ui.dim}
							bg={ui.panelBg}
							content={cut(
								[problem().severity, location(problem()), origin(problem())]
									.filter(Boolean)
									.join(' · '),
								room(),
							)}
						/>
					)}
				</Show>
				<text fg={ui.panelBg} bg={ui.panelBg} content="" />
				<text
					fg={ui.dim}
					bg={ui.panelBg}
					wrapMode="none"
					content={cut(
						`${selected() + 1}/${props.problems.length} · ↑↓ move · Enter jumps · Esc close`,
						room(),
					)}
				/>
			</box>
		</Overlay>
	);
}
