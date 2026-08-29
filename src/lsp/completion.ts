import type { CompletionItem, CompletionList, Position, Range } from './protocol';

export interface CompletionReply {
	items: CompletionItem[];
	isIncomplete: boolean;
}

export interface CompletionMatch {
	item: CompletionItem;
	score: number;
	positions: number[];
}

export type KindGroup = 'fn' | 'var' | 'type' | 'module' | 'keyword' | 'text';

const KIND_GROUPS: Record<number, { glyph: string; group: KindGroup }> = {
	1: { glyph: '·', group: 'text' },
	2: { glyph: 'ƒ', group: 'fn' },
	3: { glyph: 'ƒ', group: 'fn' },
	4: { glyph: 'ƒ', group: 'fn' },
	5: { glyph: '◦', group: 'var' },
	6: { glyph: 'ν', group: 'var' },
	7: { glyph: '◆', group: 'type' },
	8: { glyph: '◇', group: 'type' },
	9: { glyph: '⧉', group: 'module' },
	10: { glyph: '◦', group: 'var' },
	11: { glyph: '#', group: 'var' },
	12: { glyph: 'π', group: 'var' },
	13: { glyph: 'Σ', group: 'type' },
	14: { glyph: 'κ', group: 'keyword' },
	15: { glyph: '⌗', group: 'text' },
	16: { glyph: '□', group: 'var' },
	17: { glyph: '⧉', group: 'module' },
	18: { glyph: '→', group: 'module' },
	19: { glyph: '⧉', group: 'module' },
	20: { glyph: 'Σ', group: 'var' },
	21: { glyph: 'π', group: 'var' },
	22: { glyph: '◆', group: 'type' },
	23: { glyph: '⚡︎', group: 'fn' },
	24: { glyph: '±', group: 'fn' },
	25: { glyph: 'τ', group: 'type' },
};

const WORD = /[A-Za-z0-9_$]/;
const SNIPPET = /\$(?:(\d+)|\{(\d+)(?::((?:[^{}]|\{[^}]*\})*))?(?:\|([^,|]*)[^}]*)?\})/g;

export function normalizeCompletion(result: unknown): CompletionReply | null {
	if (result == null) return null;
	if (Array.isArray(result)) return { items: result as CompletionItem[], isIncomplete: false };
	const list = result as CompletionList;
	if (!Array.isArray(list.items)) return null;
	return { items: list.items, isIncomplete: list.isIncomplete === true };
}

export function isWordChar(char: string): boolean {
	return WORD.test(char);
}

export function wordStart(text: string, col: number): number {
	let at = Math.min(col, text.length);
	while (at > 0 && isWordChar(text[at - 1]!)) at--;
	return at;
}

export function extendsWord(text: string, from: number, to: number): boolean {
	if (to < from) return false;
	for (let at = from; at < to; at++) {
		if (!isWordChar(text[at] ?? ' ')) return false;
	}
	return true;
}

const SEPARATORS = new Set(['_', '-', '.', '/', '\\', ':', ' ']);

export function fuzzyMatch(
	query: string,
	text: string,
): { score: number; positions: number[] } | null {
	if (query.length === 0) return { score: 0, positions: [] };
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const positions: number[] = [];
	let score = 0;
	let at = 0;
	for (let q = 0; q < lowerQuery.length; q++) {
		const found = lowerText.indexOf(lowerQuery[q]!, at);
		if (found < 0) return null;
		const char = text[found]!;
		const prev = text[found - 1];
		const hump = char >= 'A' && char <= 'Z' && !(prev! >= 'A' && prev! <= 'Z');
		const strong = found === q || hump || (prev !== undefined && SEPARATORS.has(prev));
		let step = strong ? (char === query[q] ? 7 : 5) : 1;
		if (positions.length > 0 && found === positions.at(-1)! + 1) step += 2;
		score += step - (found - at);
		positions.push(found);
		at = found + 1;
	}
	return { score, positions };
}

function serverOrder(a: CompletionItem, b: CompletionItem): number {
	const aSort = (a.sortText ?? a.label).toLowerCase();
	const bSort = (b.sortText ?? b.label).toLowerCase();
	if (aSort !== bSort) return aSort < bSort ? -1 : 1;
	if (a.label !== b.label) return a.label < b.label ? -1 : 1;
	return (a.kind ?? 0) - (b.kind ?? 0);
}

export function filterCompletions(items: CompletionItem[], prefix: string): CompletionMatch[] {
	const matches: CompletionMatch[] = [];
	for (const item of items) {
		const target = item.filterText ?? item.label;
		const match = fuzzyMatch(prefix, target);
		if (!match) continue;
		matches.push({
			item,
			score: match.score,
			positions: target === item.label ? match.positions : [],
		});
	}
	return matches.toSorted((a, b) => b.score - a.score || serverOrder(a.item, b.item));
}

export function kindInfo(kind: number | undefined): { glyph: string; group: KindGroup } {
	return KIND_GROUPS[kind ?? 1] ?? { glyph: '·', group: 'text' };
}

export function isDeprecated(item: CompletionItem): boolean {
	return item.deprecated === true || item.tags?.includes(1) === true;
}

export function stripSnippet(text: string): { text: string; caret: number | null } {
	let out = '';
	let at = 0;
	let caret: number | null = null;
	for (let hit = SNIPPET.exec(text); hit; hit = SNIPPET.exec(text)) {
		out += text.slice(at, hit.index);
		if (caret === null) caret = out.length;
		out += hit[3] ?? hit[4] ?? '';
		at = hit.index + hit[0].length;
	}
	out += text.slice(at);
	return { text: out, caret: caret === out.length ? null : caret };
}

function offsetOf(content: string, position: Position): number {
	let offset = 0;
	for (let line = 0; line < position.line; line++) {
		const next = content.indexOf('\n', offset);
		if (next < 0) return content.length;
		offset = next + 1;
	}
	const lineEnd = content.indexOf('\n', offset);
	return Math.min(offset + position.character, lineEnd < 0 ? content.length : lineEnd);
}

function positionOf(content: string, offset: number): Position {
	let line = 0;
	let lineStart = 0;
	for (let at = content.indexOf('\n'); at >= 0 && at < offset; at = content.indexOf('\n', at + 1)) {
		line++;
		lineStart = at + 1;
	}
	return { line, character: offset - lineStart };
}

function indentOf(content: string, line: number): string {
	const start = offsetOf(content, { line, character: 0 });
	const end = content.indexOf('\n', start);
	return /^\s*/.exec(content.slice(start, end < 0 ? undefined : end))?.[0] ?? '';
}

function reindentSnippet(text: string, indent: string): string {
	const lines = text.split('\n');
	for (let index = 1; index < lines.length; index++) {
		if (lines[index] !== '') lines[index] = indent + lines[index];
	}
	return lines.join('\n');
}

function editRange(item: CompletionItem, cursor: Position, anchorCol: number): Range {
	if (item.textEdit) {
		if ('range' in item.textEdit) return item.textEdit.range;
		return item.textEdit.replace;
	}
	return { start: { line: cursor.line, character: anchorCol }, end: cursor };
}

export function applyCompletion(
	content: string,
	cursor: Position,
	anchorCol: number,
	item: CompletionItem,
): { content: string; cursor: Position } {
	const raw = item.textEdit?.newText ?? item.insertText ?? item.label;
	const isSnippet = item.insertTextFormat === 2 || raw.includes('$');
	let range = editRange(item, cursor, anchorCol);
	const prepared = isSnippet
		? stripSnippet(
				raw.includes('\n') ? reindentSnippet(raw, indentOf(content, range.start.line)) : raw,
			)
		: { text: raw, caret: null };
	if (
		range.start.line === cursor.line &&
		range.end.line === cursor.line &&
		range.end.character < cursor.character
	) {
		range = { start: range.start, end: cursor };
	}
	const edits = [
		{
			start: offsetOf(content, range.start),
			end: offsetOf(content, range.end),
			text: prepared.text,
			primary: true,
		},
		...(item.additionalTextEdits ?? []).map((edit) => ({
			start: offsetOf(content, edit.range.start),
			end: offsetOf(content, edit.range.end),
			text: edit.newText,
			primary: false,
		})),
	].toSorted((a, b) => b.start - a.start || b.end - a.end);

	let next = content;
	for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
	const primary = edits.find((edit) => edit.primary)!;
	const beforeDelta = edits
		.filter((edit) => !edit.primary && edit.end <= primary.start)
		.reduce((sum, edit) => sum + edit.text.length - (edit.end - edit.start), 0);
	const cursorOffset = primary.start + beforeDelta + (prepared.caret ?? prepared.text.length);
	return { content: next, cursor: positionOf(next, cursorOffset) };
}

export function matchRuns(
	label: string,
	positions: number[],
): Array<{ text: string; hit: boolean }> {
	if (positions.length === 0) return [{ text: label, hit: false }];
	const hits = new Set(positions);
	const runs: Array<{ text: string; hit: boolean }> = [];
	let at = 0;
	while (at < label.length) {
		const hit = hits.has(at);
		let end = at + 1;
		while (end < label.length && hits.has(end) === hit) end++;
		runs.push({ text: label.slice(at, end), hit });
		at = end;
	}
	return runs;
}
