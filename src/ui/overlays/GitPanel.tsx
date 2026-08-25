import type { KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { createMemo, createSignal, For, Show } from 'solid-js';

import type { ChangeRow } from '../../core/changeTree';
import {
	ancestorDirs,
	changeRows,
	changesFromEntries,
	foldKey,
	rowArea,
} from '../../core/changeTree';
import type { FileStatus, StatusEntry } from '../../core/git';
import { fuzzyScore } from '../../core/search';
import { ui } from '../../themes';
import { MARKS, statusColor } from '../FileTree';

const stageGlyph = (row: ChangeRow) => (rowArea(row) === 'staged' ? '−' : '+');

export function GitPanel(props: {
	rootDir: string;
	branch: string | null;
	base: string | null;
	upstream: { ahead: number; behind: number } | null;
	view: 'tree' | 'list';
	width: number;
	focused: boolean;
	statusEntries: Map<string, StatusEntry>;
	onFocus: () => void;
	onDiff: (path: string) => void;
	onDiscard: (path: string, status: FileStatus) => void;
	onToggleStage: (row: ChangeRow) => void;
	onCommit: () => void;
	onPush: () => void;
	onBranchAction: (action: 'switch' | 'compare' | 'commits') => void;
	reviewCount: number;
	onReview: () => void;
}) {
	const [index, setIndex] = createSignal(0);
	const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
	const [filtering, setFiltering] = createSignal(false);
	const [filter, setFilter] = createSignal('');
	const staging = () => props.base === null;
	const changes = createMemo(() => {
		const all = changesFromEntries(props.rootDir, props.statusEntries);
		const query = filter().trim();
		if (query.length === 0) return all;
		return all.filter((change) => fuzzyScore(change.rel, query) !== null);
	});
	const rows = createMemo(() => changeRows(changes(), props.view, collapsed(), staging()));
	const selected = () => Math.min(index(), Math.max(0, rows().length - 1));
	const headline = () => {
		const parts = [props.branch ?? 'git'];
		const upstream = props.upstream;
		if (upstream?.ahead) parts.push(`↑${upstream.ahead}`);
		if (upstream?.behind) parts.push(`↓${upstream.behind}`);
		return parts.join(' ');
	};
	const toggleDir = (row: Extract<ChangeRow, { kind: 'dir' }>) =>
		setCollapsed((prev) => {
			const key = foldKey(row.area, row.rel);
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	const toggleSection = (row: Extract<ChangeRow, { kind: 'section' }>) =>
		setCollapsed((prev) => {
			const key = foldKey(row.area, '');
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
		if (row.kind === 'section') toggleSection(row);
		else if (row.kind === 'dir') toggleDir(row);
		else props.onDiff(row.change.path);
	};

	useKeyboard((key: KeyEvent) => {
		if (!props.focused) return;
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
		if (filtering()) {
			if (key.name === 'escape') {
				if (filter()) setFilterValue('');
				else setFiltering(false);
			} else if (key.name === 'backspace') setFilterValue(filter().slice(0, -1));
			else if (printable) setFilterValue(`${filter()}${key.sequence}`);
			else return;
		} else if (key.name === 'up') setIndex((at) => (at - 1 + count) % count);
		else if (key.name === 'down') setIndex((at) => (at + 1) % count);
		else if (key.name === 'return' || key.name === 'enter') {
			activate(row());
		} else if (key.name === 'left') {
			const current = row();
			if (current?.kind === 'dir' && !current.collapsed) toggleDir(current);
			else if (current?.kind === 'section' && !current.collapsed) toggleSection(current);
		} else if (key.name === 'right') {
			const current = row();
			if (current?.kind === 'dir' && current.collapsed) toggleDir(current);
			else if (current?.kind === 'section' && current.collapsed) toggleSection(current);
		} else if (plain && key.name === ' ' && staging()) {
			const current = row();
			if (current) props.onToggleStage(current);
		} else if (plain && key.name === 'c') {
			if (props.base) props.onBranchAction('commits');
			else props.onCommit();
		} else if (plain && key.name === 'd' && !props.base) {
			const current = row();
			if (current?.kind === 'file') props.onDiscard(current.change.path, current.change.status);
		} else if (plain && key.name === 'p') props.onPush();
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
		const fold = props.view === 'tree' ? ' · ←→ fold' : '';
		if (props.base)
			return `b branch · B compare · c commits · / filter · p push · enter diff${fold}`;
		const stage = staging() ? 'space stage · ' : '';
		return `b branch · B compare · c commit · d discard · ${stage}p push · enter diff${fold}`;
	};

	return (
		<box
			width={props.width}
			flexDirection="column"
			backgroundColor={ui.panelBg}
			flexShrink={0}
			onMouseDown={props.onFocus}
		>
			<box height={2} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
				<text fg={props.focused ? ui.text : ui.dim} bg={ui.panelBg} content={headline()} />
				<box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
					<text
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
					/>
					<Show when={canCollapseAll()}>
						<text fg={ui.faint} bg={ui.panelBg} content=" · collapse" onMouseDown={collapseAll} />
					</Show>
				</box>
			</box>
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
									<Show when={row.kind === 'dir' || row.kind === 'section'}>
										{() =>
											(row.kind === 'dir' || row.kind === 'section') && (
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
												row.kind === 'section'
													? ui.text
													: row.kind === 'dir'
														? ui.folder
														: active()
															? ui.text
															: ui.dim
											}
											bg={bg()}
											content={
												row.kind === 'dir' || row.kind === 'section' ? row.label : ` ${row.label}`
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
													content={
														row.collapsed
															? `${row.kind === 'section' ? row.files : row.files} `
															: ' '
													}
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
													fg={ui.accent}
													bg={bg()}
													flexShrink={0}
													content={`${stageGlyph(row)} `}
													onMouseDown={(event) => {
														event.stopPropagation();
														props.onToggleStage(row);
													}}
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
