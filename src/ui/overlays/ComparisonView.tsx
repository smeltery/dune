import type { KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { Accessor } from 'solid-js';

import type {
	ComparisonCommitDetail,
	ComparisonContent,
	ComparisonFile,
} from '../../core/git/compare';
import { ui } from '../../themes';
import { bodyFor, comparisonStatusColor, diffLineColor } from './diffRows';
import type { DiffMode } from './diffRows';

const cut = (text: string, width: number) =>
	width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

export interface ComparisonViewProps {
	/** Null for a commit whose first-parent diff is empty — a merge, most often. */
	file: ComparisonFile | null;
	/** Null while the blobs are still being read — the row opened first. */
	content: ComparisonContent | null;
	/** Set when the file is one of a commit's, which adds its header and pager. */
	commit: ComparisonCommitDetail | null;
	mode: DiffMode;
	/** Columns and rows the pane owns — the editor slot, not the terminal. */
	width: number;
	height: number;
	focused: boolean;
	onFocus: () => void;
	onMoveFile: (delta: number) => void;
	onClose: () => void;
}

/**
 * A file from a branch comparison, over the editor slot. One page whichever way
 * the row was reached: a commit adds a header above the diff and makes ←/→ page
 * through its files, and anything with no diff to draw — binary, still loading,
 * a commit that changed nothing — becomes a message in the same frame.
 */
export function ComparisonView(props: ComparisonViewProps) {
	const [mode, setMode] = createSignal<DiffMode>(props.mode);
	const [top, setTop] = createSignal(0);
	/** The one case a textual diff exists for. */
	const text = () => (props.content?.binary === false ? props.content : null);
	const headerRows = () => (props.commit ? 4 : 1);
	const visibleRows = () => Math.max(1, props.height - headerRows() - 1);
	const body = createMemo(() => {
		const file = props.file;
		const content = text();
		if (!file || !content) return [];
		return bodyFor(
			{
				path: file.path,
				rel: file.path,
				status: 'modified',
				oldText: content.oldText,
				newText: content.newText,
			},
			mode(),
			props.width,
		);
	});
	const maxTop = () => Math.max(0, body().length - visibleRows());
	const page = (delta: number) => setTop((at) => Math.max(0, Math.min(maxTop(), at + delta)));
	// A new row means a new diff: the scroll of the previous one would land the
	// reader in the middle of a file they have not seen the top of.
	createEffect(
		on(
			() => props.file?.path ?? null,
			() => setTop(0),
			{ defer: true },
		),
	);

	useKeyboard((key: KeyEvent) => {
		if (!props.focused) return;
		if (props.commit && (key.name === 'left' || key.name === 'right')) {
			props.onMoveFile(key.name === 'left' ? -1 : 1);
		} else if (key.name === 'up') page(-1);
		else if (key.name === 'down') page(1);
		else if (key.name === 'pageup') page(-visibleRows());
		else if (key.name === 'pagedown') page(visibleRows());
		else if (key.sequence === 'd') {
			setMode((current) => (current === 'inline' ? 'split' : 'inline'));
			setTop(0);
		} else if (key.name === 'escape' || key.sequence === 'q') props.onClose();
		else return;
		key.preventDefault();
	});

	/** Columns a header row has, after the pane's own left padding. */
	const room = () => Math.max(8, props.width - 1);

	const fileHeader = (file: ComparisonFile) => {
		const stats = file.binary ? 'binary' : `+${file.additions} -${file.deletions}`;
		const path = file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
		return cut(`${file.status} ${path} ${stats}`, room());
	};

	return (
		<box
			flexGrow={1}
			flexDirection="column"
			backgroundColor={ui.bg}
			onMouseDown={() => props.onFocus()}
		>
			<Show when={props.commit}>
				{(detail: Accessor<ComparisonCommitDetail>) => {
					const commit = () => detail().commit;
					const parents = () => commit().parents.length;
					return (
						// Three rows and three texts: a subject or an address allowed to wrap
						// pushes the rows under it past the fixed height, where they are gone.
						<box height={3} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={1}>
							<text
								wrapMode="none"
								fg={ui.text}
								bg={ui.panelBg}
								content={cut(`${commit().shortOid} ${commit().subject}`, room())}
							/>
							<text
								wrapMode="none"
								fg={ui.dim}
								bg={ui.panelBg}
								content={cut(
									`${commit().authorName} <${commit().authorEmail}> · ${commit().authoredAt}`,
									room(),
								)}
							/>
							<text
								wrapMode="none"
								fg={ui.faint}
								bg={ui.panelBg}
								content={cut(
									`${detail().stats.files} files · ${parents()} parent${parents() === 1 ? '' : 's'}`,
									room(),
								)}
							/>
						</box>
					);
				}}
			</Show>
			<Show
				when={props.file}
				fallback={
					<box flexGrow={1} flexDirection="column" backgroundColor={ui.bg} padding={2}>
						<text fg={ui.text} bg={ui.bg} content="No file changes in this commit." />
					</box>
				}
			>
				{(file: Accessor<ComparisonFile>) => (
					<>
						<box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
							<text
								wrapMode="none"
								fg={comparisonStatusColor(file().status)}
								bg={ui.panelBg}
								content={fileHeader(file())}
							/>
						</box>
						<Show
							when={text()}
							fallback={
								<box flexGrow={1} flexDirection="column" backgroundColor={ui.bg} padding={2}>
									<text
										fg={ui.dim}
										bg={ui.bg}
										content={
											props.content
												? 'Binary file: textual diff is not available.'
												: 'Loading the diff…'
										}
									/>
								</box>
							}
						>
							<box flexGrow={1} flexDirection="column" backgroundColor={ui.bg} paddingLeft={1}>
								<For each={body().slice(top(), top() + visibleRows())}>
									{(row) => (
										<text
											wrapMode="none"
											fg={diffLineColor(row.kind)}
											bg={ui.bg}
											content={row.text.slice(0, room())}
										/>
									)}
								</For>
							</box>
						</Show>
					</>
				)}
			</Show>
			<box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
				<text
					fg={ui.faint}
					bg={ui.panelBg}
					wrapMode="none"
					content={`↑↓ scroll · d ${mode() === 'inline' ? 'split' : 'inline'}${
						props.commit ? ' · ←→ files' : ''
					} · Esc back`}
				/>
			</box>
		</box>
	);
}
