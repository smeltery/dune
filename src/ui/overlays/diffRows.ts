import { splitText, unifiedDiff } from '../../core/diff';
import type { ComparisonFileStatus } from '../../core/git/compare';
import type { DiffFile } from '../../core/gitDiff';
import { ui } from '../../themes';
import { PAD } from '../modal';

export interface DiffLine {
	text: string;
	kind: 'meta' | 'same' | 'add' | 'del' | 'header';
}

export type DiffMode = 'inline' | 'split';

function unified(file: DiffFile): DiffLine[] {
	return splitText(unifiedDiff(file.rel, file.oldText, file.newText).patch).map((text) => ({
		text: `${text[0] === '+' || text[0] === '-' ? `${text[0]} ` : text[0] === ' ' ? '  ' : ''}${text.slice(text[0] === '@' ? 0 : 1)}`,
		kind:
			text.startsWith('---') || text.startsWith('+++') || text[0] === '@'
				? 'meta'
				: text[0] === '+'
					? 'add'
					: text[0] === '-'
						? 'del'
						: 'same',
	}));
}

function split(file: DiffFile, width: number): DiffLine[] {
	const leftWidth = Math.max(16, Math.floor((width - PAD * 2 - 5) / 2));
	const rows: DiffLine[] = [];
	const deletes: string[] = [];
	const additions: string[] = [];
	const flush = () => {
		const max = Math.max(deletes.length, additions.length);
		for (let at = 0; at < max; at++) {
			const before = deletes[at] ?? '';
			const after = additions[at] ?? '';
			rows.push({
				kind: before && !after ? 'del' : after ? 'add' : 'same',
				text: `${before ? '-' : ' '} ${before.slice(0, leftWidth).padEnd(leftWidth)} │ ${
					after ? '+' : ' '
				} ${after}`,
			});
		}
		deletes.length = 0;
		additions.length = 0;
	};
	for (const line of splitText(unifiedDiff(file.rel, file.oldText, file.newText).patch)) {
		if (line.startsWith('---') || line.startsWith('+++')) {
			flush();
			rows.push({ kind: 'meta', text: line });
		} else if (line[0] === '-') deletes.push(line.slice(1));
		else if (line[0] === '+') additions.push(line.slice(1));
		else {
			flush();
			if (line[0] === ' ') {
				const text = line.slice(1);
				rows.push({
					kind: 'same',
					text: `  ${text.slice(0, leftWidth).padEnd(leftWidth)} │   ${text}`,
				});
			} else rows.push({ kind: 'meta', text: line });
		}
	}
	flush();
	return rows;
}

export const diffFor = (file: DiffFile) =>
	file.binary ? { patch: '', adds: 0, dels: 0 } : unifiedDiff(file.rel, file.oldText, file.newText);

export const displayPath = (file: DiffFile) =>
	file.oldRel ? `${file.oldRel} -> ${file.rel}` : file.rel;

export function fileHeader(file: DiffFile): DiffLine {
	const diff = diffFor(file);
	const stats = file.binary ? 'binary' : `+${diff.adds} -${diff.dels}`;
	return { kind: 'header', text: `${displayPath(file)} ${stats}` };
}

export function bodyFor(file: DiffFile, mode: DiffMode, width: number): DiffLine[] {
	return file.binary
		? [{ text: 'Binary file: textual diff is not available.', kind: 'meta' }]
		: mode === 'split'
			? split(file, width)
			: unified(file);
}

export function diffLineColor(kind: DiffLine['kind']) {
	if (kind === 'add') return ui.gitAdded;
	if (kind === 'del') return ui.gitDeleted;
	if (kind === 'header') return ui.accent;
	return kind === 'meta' ? ui.faint : ui.dim;
}

/**
 * Every file's header and diff, one after another, so scrolling reads the whole
 * change set instead of paging one file at a time. `headerAt` is where each file's
 * header landed, for jumping between files without re-flattening the list.
 */
export function stackFiles(
	files: readonly DiffFile[],
	mode: DiffMode,
	width: number,
): { rows: DiffLine[]; headerAt: number[] } {
	const rows: DiffLine[] = [];
	const headerAt: number[] = [];
	for (const file of files) {
		headerAt.push(rows.length);
		rows.push(fileHeader(file));
		rows.push(...bodyFor(file, mode, width));
	}
	return { rows, headerAt };
}

/** The single letter a comparison row wears, as `git diff --raw` spells it. */
export const COMPARISON_MARKS: Record<ComparisonFileStatus, string> = {
	added: 'A',
	modified: 'M',
	deleted: 'D',
	renamed: 'R',
	copied: 'C',
	typeChanged: 'T',
};

export const comparisonStatusColor = (status: ComparisonFileStatus) =>
	status === 'added' || status === 'copied'
		? ui.gitAdded
		: status === 'deleted'
			? ui.gitDeleted
			: ui.gitModified;
