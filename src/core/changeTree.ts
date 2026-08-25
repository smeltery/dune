import { relative } from 'node:path';

import type { ChangeArea, FileStatus, StatusEntry } from './git';

export interface Change {
	path: string;
	rel: string;
	status: FileStatus;
	area: ChangeArea;
}

export interface FileRow {
	kind: 'file';
	depth: number;
	label: string;
	change: Change;
}

export interface DirRow {
	kind: 'dir';
	depth: number;
	label: string;
	rel: string;
	area: ChangeArea;
	collapsed: boolean;
	files: number;
}

export interface SectionRow {
	kind: 'section';
	depth: 0;
	label: string;
	area: ChangeArea;
	collapsed: boolean;
	files: number;
}

export type CommitGroup = 'incoming' | 'outgoing';

export interface CommitSectionRow {
	kind: 'commitSection';
	depth: 0;
	label: string;
	group: CommitGroup;
	collapsed: boolean;
	count: number;
}

export interface CommitRow {
	kind: 'commit';
	depth: number;
	label: string;
	oid: string;
	group: CommitGroup;
}

export type ChangeRow = FileRow | DirRow | SectionRow | CommitSectionRow | CommitRow;

export const foldKey = (area: ChangeArea | CommitGroup, rel: string) => `${area}:${rel}`;

export const rowArea = (row: ChangeRow): ChangeArea | CommitGroup =>
	row.kind === 'file'
		? row.change.area
		: row.kind === 'commit' || row.kind === 'commitSection'
			? row.group
			: row.area;

export const rowRel = (row: ChangeRow): string =>
	row.kind === 'file' ? row.change.rel : row.kind === 'dir' ? row.rel : '';

export function ancestorDirs(rel: string): string[] {
	const parts = rel.split('/');
	return parts.slice(0, -1).map((_, at) => parts.slice(0, at + 1).join('/'));
}

const SECTION_LABEL: Record<ChangeArea, string> = {
	merge: 'Merge Changes',
	staged: 'Staged Changes',
	unstaged: 'Changes',
};

const COMMIT_SECTION_LABEL: Record<CommitGroup, string> = {
	incoming: 'Incoming',
	outgoing: 'Outgoing',
};

const AREAS: ChangeArea[] = ['merge', 'staged', 'unstaged'];

export function changesFromEntries(rootDir: string, entries: Map<string, StatusEntry>): Change[] {
	const changes: Change[] = [];
	for (const [path, entry] of entries) {
		const rel = relative(rootDir, path);
		if (entry.conflicted) {
			changes.push({ path, rel, status: 'modified', area: 'merge' });
			continue;
		}
		if (entry.staged) changes.push({ path, rel, status: entry.staged, area: 'staged' });
		if (entry.unstaged) changes.push({ path, rel, status: entry.unstaged, area: 'unstaged' });
	}
	return changes.toSorted((a, b) => a.rel.localeCompare(b.rel) || a.area.localeCompare(b.area));
}

export function changeRows(
	changes: readonly Change[],
	mode: 'tree' | 'list' = 'tree',
	collapsed: ReadonlySet<string> = new Set(),
	sections = false,
): ChangeRow[] {
	if (!sections) return rowsFor(changes, mode, collapsed, 'unstaged');

	const rows: ChangeRow[] = [];
	for (const area of AREAS) {
		const mine = changes.filter((change) => change.area === area);
		if (mine.length === 0) continue;
		const shut = collapsed.has(foldKey(area, ''));
		rows.push({
			kind: 'section',
			depth: 0,
			label: SECTION_LABEL[area],
			area,
			collapsed: shut,
			files: mine.length,
		});
		if (shut) continue;
		for (const row of rowsFor(mine, mode, collapsed, area)) {
			rows.push({ ...row, depth: row.depth + 1 });
		}
	}
	return rows;
}

/** Sync sections under the change list — skipped when empty. */
export function commitRows(
	incoming: readonly { oid: string; subject: string }[],
	outgoing: readonly { oid: string; subject: string }[],
	collapsed: ReadonlySet<string> = new Set(),
): ChangeRow[] {
	const rows: ChangeRow[] = [];
	const groups: [CommitGroup, readonly { oid: string; subject: string }[]][] = [
		['incoming', incoming],
		['outgoing', outgoing],
	];
	for (const [group, commits] of groups) {
		if (commits.length === 0) continue;
		const shut = collapsed.has(foldKey(group, ''));
		rows.push({
			kind: 'commitSection',
			depth: 0,
			label: COMMIT_SECTION_LABEL[group],
			group,
			collapsed: shut,
			count: commits.length,
		});
		if (shut) continue;
		for (const commit of commits) {
			rows.push({
				kind: 'commit',
				depth: 1,
				label: commit.subject,
				oid: commit.oid,
				group,
			});
		}
	}
	return rows;
}

function rowsFor(
	changes: readonly Change[],
	mode: 'tree' | 'list',
	collapsed: ReadonlySet<string>,
	area: ChangeArea,
): (FileRow | DirRow)[] {
	if (mode === 'list') {
		return changes.map((change) => ({ kind: 'file', depth: 0, label: change.rel, change }));
	}

	const rows: (FileRow | DirRow)[] = [];
	const emitted = new Map<string, { depth: number }>();

	for (const change of changes) {
		const dirs = ancestorDirs(change.rel);
		let hidden = false;
		let depth = 0;
		for (const dir of dirs) {
			if (hidden) break;
			const seen = emitted.get(dir);
			if (seen) {
				depth = seen.depth + 1;
			} else {
				const folded = foldable(changes, dir);
				rows.push({
					kind: 'dir',
					depth,
					label: folded.slice(dir.lastIndexOf('/') + 1),
					rel: dir,
					area,
					collapsed: collapsed.has(foldKey(area, dir)),
					files: changes.filter((candidate) => candidate.rel.startsWith(`${dir}/`)).length,
				});
				emitted.set(dir, { depth });
				for (const joined of ancestorsUnder(dir, folded)) emitted.set(joined, { depth });
				depth += 1;
			}
			if (collapsed.has(foldKey(area, dir))) hidden = true;
		}
		if (hidden) continue;
		rows.push({
			kind: 'file',
			depth,
			label: change.rel.slice(change.rel.lastIndexOf('/') + 1),
			change,
		});
	}
	return rows;
}

export function changesFor(changes: readonly Change[], row: ChangeRow): Change[] {
	if (row.kind === 'file') return [row.change];
	if (row.kind === 'commit' || row.kind === 'commitSection') return [];
	const area = rowArea(row);
	if (area === 'incoming' || area === 'outgoing') return [];
	const mine = changes.filter((change) => change.area === area);
	return row.kind === 'section' ? mine : mine.filter((c) => c.rel.startsWith(`${row.rel}/`));
}

function foldable(changes: readonly Change[], dir: string): string {
	let at = dir;
	for (;;) {
		const under = changes.filter((change) => change.rel.startsWith(`${at}/`));
		const next = new Set(under.map((change) => change.rel.slice(at.length + 1).split('/')[0]!));
		if (next.size !== 1) return at;
		const only = [...next][0]!;
		if (under.some((change) => change.rel === `${at}/${only}`)) return at;
		at = `${at}/${only}`;
	}
}

function ancestorsUnder(dir: string, folded: string): string[] {
	if (folded === dir) return [];
	return ancestorDirs(`${folded}/x`).filter((rel) => rel.length > dir.length);
}
