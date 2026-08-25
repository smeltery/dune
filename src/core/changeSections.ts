import type { Change, ChangeRow } from './changeTree';
import { unifiedDiff } from './diff';
import type { ChangeArea, FileStatus } from './git';
import type { DiffFile } from './gitDiff';

/**
 * Patch rows one file may contribute to the stacked page, and the budget the
 * whole page is built against. A rewritten lockfile is thousands of rows on its
 * own; without a cap the page lays out every one of them before drawing a frame.
 */
export const DIFF_MAX_LINES = 400;

/** Rows the stacked page will lay out in total, across every section. */
export const CHANGES_MAX_LINES = 4000;

/**
 * One file in the all-changes page. Staged and unstaged of the same path are two
 * of these, which is why `key` carries the area.
 */
export interface ChangeSection {
	/** `${area}:${path}` — unique when a path sits under both headings. */
	key: string;
	rel: string;
	area: ChangeArea;
	status: FileStatus;
	/** Null when the file has no readable text side — binary, or gone from disk. */
	file: DiffFile | null;
	/** Patch rows actually shown, after the per-file cap. */
	lines: number;
	adds: number;
	dels: number;
	/** True when the patch was cut at `DIFF_MAX_LINES`. */
	truncated: boolean;
}

export interface ChangesMeta {
	/** File rows the panel lists, including ones past the display cap. */
	total: number;
	/** +/- of the sections on screen — not of the files the cap left out. */
	adds: number;
	dels: number;
}

export const slotKey = (path: string, area: ChangeArea) => `${area}:${path}`;

/** The section a panel row stands for — null on a heading or a folder. */
export const rowSlotKey = (row: ChangeRow | undefined): string | null =>
	row?.kind === 'file' ? slotKey(row.change.path, row.change.area) : null;

/** Panel order, but every file: a folded folder's rows are missing from the
 * panel, and this page is the one that shows them all. */
export function orderedChanges(changes: readonly Change[]): Change[] {
	return (['merge', 'staged', 'unstaged'] as const).flatMap((area) =>
		changes.filter((change) => change.area === area),
	);
}

function sectionFor(
	change: Change,
	file: DiffFile | null,
	last: ChangeSection | undefined,
): ChangeSection {
	// Reuse the previous object when neither text moved, so a git refresh does not
	// remount every section and throw away the page's scroll position.
	if (
		last &&
		((file === null && last.file === null) ||
			(file !== null &&
				last.file !== null &&
				last.file.oldText === file.oldText &&
				last.file.newText === file.newText))
	) {
		return last;
	}
	const patch = file
		? unifiedDiff(file.rel, file.oldText, file.newText, DIFF_MAX_LINES)
		: { lines: 0, adds: 0, dels: 0, truncated: false };
	return {
		key: slotKey(change.path, change.area),
		rel: change.rel,
		area: change.area,
		status: change.status,
		file,
		lines: patch.lines,
		adds: patch.adds,
		dels: patch.dels,
		truncated: patch.truncated,
	};
}

/** Rows a section costs the page. A binary stub and an empty patch still take a
 * row, or a folder of them would never trip the cap. */
const sectionCost = (section: ChangeSection) => Math.max(1, section.lines);

/**
 * Walk panel-order changes into stacked sections, stopping once the patches would
 * exceed `maxLines`. The file under the panel cursor (`pin`) is kept even past
 * that cap: arrows that land on an omitted row would otherwise scroll nowhere.
 */
export function takeChangeSections(
	ordered: readonly Change[],
	fileFor: (change: Change) => DiffFile | null,
	prev: ReadonlyMap<string, ChangeSection>,
	pin: string | null,
	maxLines = CHANGES_MAX_LINES,
): { sections: ChangeSection[]; adds: number; dels: number } {
	const sections: ChangeSection[] = [];
	let lines = 0;
	let adds = 0;
	let dels = 0;
	let full = false;

	for (const change of ordered) {
		const key = slotKey(change.path, change.area);
		if (full && key !== pin) continue;
		const section = sectionFor(change, fileFor(change), prev.get(key));
		if (!full && lines + sectionCost(section) > maxLines && sections.length > 0 && key !== pin) {
			full = true;
			continue;
		}
		sections.push(section);
		lines += sectionCost(section);
		adds += section.adds;
		dels += section.dels;
		if (lines >= maxLines) full = true;
	}

	return { sections, adds, dels };
}
