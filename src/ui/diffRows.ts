import { splitText, unifiedDiff } from '../core/diff';
import type { DiffFile } from '../core/gitDiff';

export interface DiffLine {
	text: string;
	kind: 'meta' | 'same' | 'add' | 'del' | 'header';
}

export type DiffMode = 'inline' | 'split';

/** Columns the split gutter (` │ ` plus both marks) takes out of a row. */
const SPLIT_CHROME = 5;

export function diffFor(file: DiffFile, maxLines?: number) {
	return file.binary
		? { patch: '', adds: 0, dels: 0, lines: 0, truncated: false }
		: unifiedDiff(file.rel, file.oldText, file.newText, maxLines);
}

export const displayPath = (file: DiffFile) =>
	file.oldRel ? `${file.oldRel} -> ${file.rel}` : file.rel;

function unified(patch: string): DiffLine[] {
	return splitText(patch).map((text) => ({
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

function split(patch: string, width: number): DiffLine[] {
	const leftWidth = Math.max(16, Math.floor((width - SPLIT_CHROME) / 2));
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
	for (const line of splitText(patch)) {
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

/**
 * A file's patch as rows. `width` is the text width available, gutters included —
 * split pairs each change block row for row and pads the shorter side, so it has
 * to know how much room there is before it can decide where the middle is.
 */
export function diffRows(
	file: DiffFile,
	mode: DiffMode,
	width: number,
	maxLines?: number,
): DiffLine[] {
	if (file.binary) return [{ text: 'Binary file: textual diff is not available.', kind: 'meta' }];
	const { patch } = diffFor(file, maxLines);
	return mode === 'split' ? split(patch, width) : unified(patch);
}
