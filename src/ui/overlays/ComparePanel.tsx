import { TextAttributes, type KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { createMemo, For, Show } from 'solid-js';

import type { BranchComparison, ComparisonCommit, ComparisonFile } from '../../core/git/compare';
import { ui } from '../../themes';
import { COMPARISON_MARKS, comparisonStatusColor } from './diffRows';

const cut = (text: string, width: number) =>
	width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

/** Header rows above the list, plus the footer hint row. */
const CHROME_ROWS = 5;

export interface ComparePanelProps {
	state: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
	comparison: BranchComparison | null;
	files: ComparisonFile[];
	commits: ComparisonCommit[];
	mode: 'files' | 'commits';
	cursor: number;
	filter: string;
	filtering: boolean;
	error: string;
	focused: boolean;
	width: number;
	/** Rows the sidebar owns, so a long comparison can window its list. */
	height: number;
	onFocus: () => void;
	onActivate: (index: number) => void;
	onMove: (delta: number) => void;
	onToggleMode: () => void;
	onOpenFilter: () => void;
	onCloseFilter: (clear: boolean) => void;
	onFilter: (value: string) => void;
	onOpenBase: () => void;
	onSwitchBranch?: () => void;
	onClose: () => void;
}

/**
 * The sidebar's branch-comparison view: what this branch introduced against its
 * base, as files or as commits. Independent of the editor-wide comparison base —
 * see `createComparison`.
 */
export function ComparePanel(props: ComparePanelProps) {
	const rows = () => (props.mode === 'files' ? props.files : props.commits);
	const cursor = createMemo(() => Math.max(0, Math.min(props.cursor, rows().length - 1)));
	const visibleRows = () => Math.max(1, props.height - CHROME_ROWS);
	/**
	 * Slice start, kept so the cursor is always inside the window. The list has no
	 * scroll of its own: the cursor is the only thing that moves it.
	 */
	const start = createMemo(() =>
		Math.max(0, Math.min(cursor() - Math.floor(visibleRows() / 2), rows().length - visibleRows())),
	);
	const window = createMemo(() => rows().slice(start(), start() + visibleRows()));
	/** Columns a header row has, after the panel's own left padding. */
	const room = () => Math.max(8, props.width - 2);

	const summary = () => {
		const comparison = props.comparison;
		if (!comparison) return '';
		const { files, additions, deletions } = comparison.stats;
		return `↑${comparison.ahead} ↓${comparison.behind} · ${files} files · +${additions} -${deletions}`;
	};

	const emptyMessage = () =>
		props.state === 'error'
			? props.error
			: props.state === 'loading'
				? 'loading comparison…'
				: props.filter
					? 'no matches'
					: 'no differences';

	useKeyboard((key: KeyEvent) => {
		if (!props.focused) return;
		const printable =
			key.sequence?.length === 1 &&
			key.sequence >= ' ' &&
			key.sequence !== '\u007F' &&
			!key.ctrl &&
			!key.meta &&
			!key.option;
		if (props.filtering) {
			if (key.name === 'escape') props.onCloseFilter(props.filter.length > 0);
			else if (key.name === 'return' || key.name === 'enter') props.onCloseFilter(false);
			else if (key.name === 'backspace') props.onFilter(props.filter.slice(0, -1));
			else if (printable) props.onFilter(`${props.filter}${key.sequence}`);
			else return;
		} else if (key.name === 'up') props.onMove(-1);
		else if (key.name === 'down') props.onMove(1);
		else if (key.name === 'return' || key.name === 'enter') props.onActivate(cursor());
		else if (key.name === 'escape') props.onClose();
		else if (key.sequence === 'c') props.onToggleMode();
		else if (key.sequence === '/') props.onOpenFilter();
		else if (key.sequence === 'B') props.onOpenBase();
		else if (key.sequence === 'b' && !key.shift) props.onSwitchBranch?.();
		else return;
		key.preventDefault();
	});

	return (
		<box
			width={props.width}
			flexDirection="column"
			backgroundColor={ui.panelBg}
			flexShrink={0}
			onMouseDown={() => props.onFocus()}
		>
			{/* Four rows and four texts: a branch name allowed to wrap takes the rows
          under it with it, and the header is a fixed height, so what it pushes
          past the fourth row is simply gone. */}
			<box height={4} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
				<box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
					<text
						fg={props.focused ? ui.text : ui.dim}
						bg={ui.panelBg}
						flexShrink={1}
						wrapMode="none"
						content={cut(props.comparison?.compare.name ?? 'branch comparison', room() - 8)}
						attributes={TextAttributes.BOLD}
					/>
					<box flexGrow={1} backgroundColor={ui.panelBg} />
					<text fg={ui.faint} bg={ui.panelBg} flexShrink={0} content="compare" />
				</box>
				<text
					wrapMode="none"
					fg={ui.dim}
					bg={ui.panelBg}
					content={`base  ${cut(props.comparison?.base.name ?? 'loading…', room() - 6)}`}
					onMouseDown={() => props.onOpenBase()}
				/>
				<text fg={ui.dim} bg={ui.panelBg} wrapMode="none" content={summary()} />
				<box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
					<text
						fg={ui.accent}
						bg={ui.panelBg}
						flexShrink={0}
						wrapMode="none"
						content={props.mode === 'files' ? '[Files]  Commits' : 'Files  [Commits]'}
						onMouseDown={() => props.onToggleMode()}
					/>
					<Show when={props.filtering || props.filter}>
						<text
							fg={ui.faint}
							bg={ui.panelBg}
							flexShrink={1}
							wrapMode="none"
							content={` · filter ${props.filter}`}
						/>
					</Show>
				</box>
			</box>
			<Show
				when={rows().length > 0}
				fallback={
					<box flexGrow={1} backgroundColor={ui.panelBg} paddingLeft={2}>
						<text fg={ui.faint} bg={ui.panelBg} wrapMode="none" content={emptyMessage()} />
					</box>
				}
			>
				<box flexGrow={1} flexDirection="column" backgroundColor={ui.panelBg}>
					<For each={window()}>
						{(row, at) => {
							const index = () => start() + at();
							const active = () => index() === cursor();
							const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg);
							const file = () => (props.mode === 'files' ? (row as ComparisonFile) : null);
							const commit = () => (props.mode === 'files' ? null : (row as ComparisonCommit));
							return (
								<box
									height={1}
									flexDirection="row"
									backgroundColor={bg()}
									onMouseDown={() => props.onActivate(index())}
								>
									<Show when={file()}>
										{(changed: () => ComparisonFile) => (
											<>
												<text
													wrapMode="none"
													fg={active() ? ui.text : ui.dim}
													bg={bg()}
													flexShrink={1}
													content={` ${changed().path}`}
												/>
												<box flexGrow={1} backgroundColor={bg()} />
												<text
													fg={ui.faint}
													bg={bg()}
													flexShrink={0}
													content={` ${
														changed().binary
															? 'binary'
															: `+${changed().additions} -${changed().deletions}`
													} `}
												/>
												<text
													fg={comparisonStatusColor(changed().status)}
													bg={bg()}
													flexShrink={0}
													content={`${COMPARISON_MARKS[changed().status]} `}
												/>
											</>
										)}
									</Show>
									<Show when={commit()}>
										{(entry: () => ComparisonCommit) => (
											<>
												<text
													wrapMode="none"
													fg={active() ? ui.text : ui.dim}
													bg={bg()}
													flexShrink={1}
													content={` ${entry().subject}`}
												/>
												<box flexGrow={1} backgroundColor={bg()} />
												<text
													fg={ui.faint}
													bg={bg()}
													flexShrink={0}
													content={` ${entry().shortOid} `}
												/>
											</>
										)}
									</Show>
								</box>
							);
						}}
					</For>
				</box>
			</Show>
			<box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
				<text
					fg={ui.faint}
					bg={ui.panelBg}
					wrapMode="none"
					content="↑↓ · Enter · c commits · / filter · B base · Esc"
				/>
			</box>
		</box>
	);
}
