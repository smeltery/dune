import { TextAttributes, type KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { For, Show } from 'solid-js';

import type { ReviewRow } from '../app/review';
import { ui } from '../themes';

const cut = (text: string, width: number) =>
	width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

const rowBg = (active: boolean, focused: boolean) =>
	active ? (focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg;

/** `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row
 * (or nothing) so the block inside needs no cast. */
const fileRow = (row: ReviewRow) => (row.kind === 'file' ? row : undefined);
const hintRow = (row: ReviewRow) => (row.kind === 'hint' ? row : undefined);
type Remark = Extract<ReviewRow, { kind: 'note' | 'comment' }>;
const remarkRow = (row: ReviewRow): Remark | undefined =>
	row.kind === 'note' || row.kind === 'comment' ? row : undefined;

export interface ReviewPanelProps {
	rows: ReviewRow[];
	cursor: number;
	/** How many items the review holds, whatever a fold leaves on screen. */
	count: number;
	/** `#12 Fix the parser`, or null while no pull request has been fetched. */
	pull: string | null;
	fetching: boolean;
	focused: boolean;
	width: number;
	onFocus: () => void;
	/** A row clicked: move the cursor there, and jump to it or fold it. */
	onActivate: (index: number) => void;
	onCollapseAll: () => void;
	onMove: (delta: number) => void;
	onFetch: () => void;
	onRemove: () => void;
	onReply: () => void;
	onClose: () => void;
	onCycleView: () => void;
}

/**
 * The sidebar's review view: the notes dropped on lines while reading, and the
 * comments fetched from the pull request, under the file each belongs to.
 *
 * Two columns per row and no more — the label (`ISSUE 42`, `@peer 17`) and the
 * remark itself, cut to what the sidebar has. A note is a sentence and a
 * sidebar is thirty columns, so the row says which and where; the whole text is
 * on the line itself, where Enter lands.
 */
export function ReviewPanel(props: ReviewPanelProps) {
	const cursor = () => Math.max(0, Math.min(props.cursor, props.rows.length - 1));

	/** The label column, which the text is cut against. */
	const labelOf = (row: ReviewRow) =>
		row.kind === 'note' || row.kind === 'comment' ? row.label : '';

	useKeyboard((key: KeyEvent) => {
		if (!props.focused) return;
		if (key.name === 'tab' && key.shift) props.onCycleView();
		else if (key.name === 'up') props.onMove(-1);
		else if (key.name === 'down') props.onMove(1);
		else if (key.name === 'return' || key.name === 'enter') props.onActivate(cursor());
		else if (key.name === 'left') {
			if (props.rows[cursor()]?.kind === 'file') props.onActivate(cursor());
		} else if (key.name === 'right') {
			if (props.rows[cursor()]?.kind === 'file') props.onActivate(cursor());
		} else if (key.name === 'f') props.onFetch();
		else if (key.name === 'r') props.onReply();
		else if (key.name === 'backspace') props.onRemove();
		else if (key.name === 'escape') props.onClose();
		else return;
		key.preventDefault();
	});

	return (
		<box
			width={props.width}
			flexDirection="column"
			backgroundColor={ui.panelBg}
			flexShrink={0}
			flexGrow={1}
			flexBasis={0}
			onMouseDown={() => props.onFocus()}
		>
			{/* One row, as the tree's header and the git panel's are. Everything on it
          is cut: a pull request title is the user's own words at whatever length
          they were written, and a wrapped header eats the list below it. */}
			<box
				height={1}
				flexDirection="row"
				backgroundColor={ui.panelBg}
				paddingLeft={2}
				paddingRight={1}
			>
				<text
					fg={props.focused ? ui.text : ui.dim}
					bg={ui.panelBg}
					flexShrink={1}
					wrapMode="none"
					content={cut(
						props.fetching
							? 'fetching…'
							: (props.pull ?? `${props.count} item${props.count === 1 ? '' : 's'}`),
						Math.max(4, props.width - 12),
					)}
					attributes={TextAttributes.BOLD}
				/>
				<box flexGrow={1} backgroundColor={ui.panelBg} />
				<Show when={props.rows.some((row) => row.kind === 'file' && !row.collapsed)}>
					<text
						fg={ui.dim}
						bg={ui.panelBg}
						flexShrink={0}
						wrapMode="none"
						content="▴"
						onMouseDown={() => props.onCollapseAll()}
					/>
				</Show>
				<text fg={ui.faint} bg={ui.panelBg} flexShrink={0} wrapMode="none" content=" review" />
			</box>

			<box flexGrow={1} flexDirection="column" backgroundColor={ui.panelBg}>
				<For each={props.rows}>
					{(row, at) => {
						const index = at;
						const bg = () => rowBg(index() === cursor(), props.focused);
						const label = () => labelOf(row);
						// The remark takes what the label leaves: 3 for the indent, 1 for the
						// gap, 1 for the trailing pad.
						const room = () => props.width - label().length - 5;
						return (
							<box
								height={1}
								flexDirection="row"
								backgroundColor={bg()}
								onMouseDown={() => props.onActivate(index())}
							>
								<Show when={fileRow(row)}>
									{(file: () => ReviewRow & { kind: 'file' }) => (
										<>
											<text
												fg={ui.dim}
												bg={bg()}
												flexShrink={0}
												wrapMode="none"
												content={` ${file().collapsed ? '▸' : '▾'} `}
											/>
											<box flexGrow={1} backgroundColor={bg()}>
												<text
													fg={ui.folder}
													bg={bg()}
													wrapMode="none"
													content={cut(file().rel, Math.max(3, props.width - 8))}
													attributes={TextAttributes.BOLD}
												/>
											</box>
											<text
												fg={ui.faint}
												bg={bg()}
												flexShrink={0}
												wrapMode="none"
												content={`${file().count} `}
											/>
										</>
									)}
								</Show>
								<Show when={hintRow(row)}>
									{(hint: () => ReviewRow & { kind: 'hint' }) => (
										<text
											fg={ui.faint}
											bg={bg()}
											wrapMode="none"
											content={` ${cut(hint().label, props.width - 2)}`}
										/>
									)}
								</Show>
								<Show when={remarkRow(row)}>
									{(remark: () => Remark) => (
										<>
											{/* Drafts in the accent, fetched comments in the folder
                          colour: which of the two a row is decides what
                          Backspace may do to it. */}
											<text
												fg={remark().kind === 'note' ? ui.accent : ui.folder}
												bg={bg()}
												flexShrink={0}
												wrapMode="none"
												content={`   ${label()}`}
											/>
											<text
												fg={ui.text}
												bg={bg()}
												flexShrink={1}
												wrapMode="none"
												content={room() > 3 ? ` ${cut(remark().text, room())}` : ''}
											/>
										</>
									)}
								</Show>
							</box>
						);
					}}
				</For>
			</box>
			<box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
				<text
					fg={ui.faint}
					bg={ui.panelBg}
					wrapMode="none"
					content="↑↓ · Enter · f fetch · r reply · Backspace · Esc"
				/>
			</box>
		</box>
	);
}
