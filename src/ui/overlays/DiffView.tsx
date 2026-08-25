import type { KeyEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { createMemo, createSignal, For, Show } from 'solid-js';

import type { DiffFile } from '../../core/gitDiff';
import { fuzzyScore } from '../../core/search';
import { ui } from '../../themes';
import { listRows, modalWidth, PAD } from '../modal';
import { Overlay } from '../Overlay';
import { bodyFor, diffFor, diffLineColor, displayPath, stackFiles } from './diffRows';
import type { DiffMode } from './diffRows';

export function DiffView(props: {
	files: DiffFile[];
	mode: DiffMode;
	title?: string | null;
	onClose: () => void;
}) {
	const dimensions = useTerminalDimensions();
	const [index, setIndex] = createSignal(0);
	const [pickIndex, setPickIndex] = createSignal(0);
	const [picker, setPicker] = createSignal(false);
	const [filter, setFilter] = createSignal('');
	const [top, setTop] = createSignal(0);
	const [mode, setMode] = createSignal<DiffMode>(props.mode);
	const [stacked, setStacked] = createSignal(false);
	const width = () => modalWidth(dimensions().width, 0.82, 76, 120);
	const visibleRows = () => listRows(dimensions().height, 7, 24);
	const file = () => props.files[index()] ?? props.files[0]!;
	const diff = createMemo(() => diffFor(file()));
	const stackedResult = createMemo(() => stackFiles(props.files, mode(), width()));
	const body = createMemo(() =>
		stacked() ? stackedResult().rows : bodyFor(file(), mode(), width()),
	);
	const counts = () => ({
		adds: diff().adds,
		dels: diff().dels,
	});
	const fileCounts = createMemo(() =>
		props.files.map((changed, originalIndex) => ({
			file: changed,
			originalIndex,
			diff: diffFor(changed),
		})),
	);
	const filteredFileCounts = createMemo(() => {
		const query = filter().trim();
		if (!query) return fileCounts();
		return fileCounts().filter((row) => fuzzyScore(displayPath(row.file), query) !== null);
	});
	const totalCounts = () => ({
		adds: fileCounts().reduce((total, row) => total + row.diff.adds, 0),
		dels: fileCounts().reduce((total, row) => total + row.diff.dels, 0),
	});
	const maxTop = () => Math.max(0, body().length - visibleRows());
	const page = (delta: number) => setTop((at) => Math.max(0, Math.min(maxTop(), at + delta)));
	/** Which file's section the scroll currently sits in, stacked mode only. */
	const currentSection = () => {
		const headerAt = stackedResult().headerAt;
		let at = 0;
		for (let i = 0; i < headerAt.length; i++) {
			if (headerAt[i]! <= top()) at = i;
			else break;
		}
		return at;
	};
	const switchFile = (delta: number) => {
		if (stacked()) {
			const headerAt = stackedResult().headerAt;
			const next = (currentSection() + delta + headerAt.length) % headerAt.length;
			setTop(headerAt[next] ?? 0);
			return;
		}
		setIndex((at) => (at + delta + props.files.length) % props.files.length);
		setTop(0);
	};
	const pickFile = (at: number) => {
		const row = filteredFileCounts()[at];
		if (!row) return;
		if (stacked()) setTop(stackedResult().headerAt[row.originalIndex] ?? 0);
		else {
			setIndex(row.originalIndex);
			setTop(0);
		}
		setPicker(false);
	};
	const openPicker = () => {
		const current = index();
		setFilter('');
		setPickIndex(fileCounts().findIndex((row) => row.originalIndex === current));
		setPicker(true);
	};
	const setPickerFilter = (value: string) => {
		setFilter(value);
		setPickIndex(0);
	};

	useKeyboard((key: KeyEvent) => {
		if (picker()) {
			const typed = key.sequence;
			const printable =
				typed?.length === 1 && typed >= ' ' && typed !== '\u007F' && !key.ctrl && !key.meta;
			const count = Math.max(1, filteredFileCounts().length);
			if (key.name === 'escape' || key.name === 'q') setPicker(false);
			else if (key.name === 'up') setPickIndex((at) => (at - 1 + count) % count);
			else if (key.name === 'down') setPickIndex((at) => (at + 1) % count);
			else if (key.name === 'backspace') setPickerFilter(filter().slice(0, -1));
			else if (key.name === 'return' || key.name === 'enter') pickFile(pickIndex());
			else if (printable) setPickerFilter(`${filter()}${typed}`);
			else return;
		} else if (key.name === 'escape' || key.name === 'q') props.onClose();
		else if (key.name === 'f' && props.files.length > 1) {
			openPicker();
		} else if (key.name === 'd') {
			setMode((current) => (current === 'inline' ? 'split' : 'inline'));
			setTop(0);
		} else if (key.name === 'a' && props.files.length > 1) {
			setStacked((value) => !value);
			setTop(0);
		} else if (key.name === 'up') page(-1);
		else if (key.name === 'down') page(1);
		else if (key.name === 'pageup') page(-visibleRows());
		else if (key.name === 'pagedown') page(visibleRows());
		else if (key.name === 'left') switchFile(-1);
		else if (key.name === 'right') switchFile(1);
		else return;
		key.preventDefault();
	});

	return (
		<Overlay zIndex={146}>
			<box
				width={width()}
				flexDirection="column"
				backgroundColor={ui.panelBg}
				border
				borderStyle="rounded"
				borderColor={ui.accent}
				title=" Diff "
				titleColor={ui.text}
				paddingLeft={PAD}
				paddingRight={PAD}
			>
				<Show
					when={picker()}
					fallback={
						<>
							<Show when={props.title}>
								{() => (
									<text
										fg={ui.dim}
										bg={ui.panelBg}
										content={(props.title ?? '').slice(0, width() - PAD * 2 - 2)}
									/>
								)}
							</Show>
							<Show
								when={!stacked()}
								fallback={
									<box flexDirection="row" backgroundColor={ui.panelBg}>
										<text
											fg={ui.text}
											bg={ui.panelBg}
											content={`All changes — ${props.files.length} `}
										/>
										<text fg={ui.gitAdded} bg={ui.panelBg} content={`+${totalCounts().adds} `} />
										<text fg={ui.gitDeleted} bg={ui.panelBg} content={`-${totalCounts().dels} `} />
										<text fg={ui.dim} bg={ui.panelBg} content={`${mode()} `} />
									</box>
								}
							>
								<box flexDirection="row" backgroundColor={ui.panelBg}>
									<text fg={ui.text} bg={ui.panelBg} content={`${displayPath(file())} `} />
									<text fg={ui.gitAdded} bg={ui.panelBg} content={`+${counts().adds} `} />
									<text fg={ui.gitDeleted} bg={ui.panelBg} content={`-${counts().dels} `} />
									<text fg={ui.dim} bg={ui.panelBg} content={`${mode()} `} />
									<Show when={props.files.length > 1}>
										<text
											fg={ui.dim}
											bg={ui.panelBg}
											content={`file ${index() + 1}/${props.files.length}`}
										/>
									</Show>
								</box>
							</Show>
							<For each={body().slice(top(), top() + visibleRows())}>
								{(row) => (
									<text
										fg={diffLineColor(row.kind)}
										bg={ui.panelBg}
										content={row.text.slice(0, width() - PAD * 2 - 2)}
									/>
								)}
							</For>
							<text
								fg={ui.dim}
								bg={ui.panelBg}
								content={
									props.files.length > 1
										? `↑↓ scroll · ←→ file · D layout · A ${stacked() ? 'one file' : 'all'} · F files · Esc close`
										: '↑↓ scroll · D layout · Esc close'
								}
							/>
						</>
					}
				>
					<box flexDirection="row" backgroundColor={ui.panelBg}>
						<text fg={ui.text} bg={ui.panelBg} content={`Changed files — ${props.files.length} `} />
						<text fg={ui.gitAdded} bg={ui.panelBg} content={`+${totalCounts().adds} `} />
						<text fg={ui.gitDeleted} bg={ui.panelBg} content={`-${totalCounts().dels}`} />
					</box>
					<Show when={filter()}>
						<text
							fg={ui.dim}
							bg={ui.panelBg}
							content={`Filter: ${filter()} (${filteredFileCounts().length}/${props.files.length})`.slice(
								0,
								width() - PAD * 2 - 2,
							)}
						/>
					</Show>
					<For each={filteredFileCounts().slice(0, visibleRows())}>
						{(row, at) => {
							const active = () => at() === pickIndex();
							const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg);
							const prefix = () => (active() ? '▌ ' : '  ');
							const label = () =>
								`${prefix()}${displayPath(row.file)} ${
									row.file.binary ? 'binary' : `+${row.diff.adds} -${row.diff.dels}`
								}`.slice(0, width() - PAD * 2 - 2);
							return <text fg={active() ? ui.text : ui.dim} bg={bg()} content={label()} />;
						}}
					</For>
					<Show when={filteredFileCounts().length === 0}>
						<text fg={ui.dim} bg={ui.panelBg} content="No changed files match." />
					</Show>
					<text
						fg={ui.dim}
						bg={ui.panelBg}
						content="Type filter · ↑↓ choose · Enter jump · Esc diff"
					/>
				</Show>
			</box>
		</Overlay>
	);
}
