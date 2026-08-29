import type { CompletionItem } from '../lsp/protocol';
import { isDeprecated } from '../lsp/completion';
import { wrapText } from './modal';

export const COMPLETION_MENU_ROWS = 8;
const DOC_ROWS = 6;
const SIG_ROWS = 3;
const LABEL_MAX = 40;
const DETAIL_MAX = 28;
const MIN_WIDTH = 22;
const DOC_WIDTH = 56;

export interface CompletionInfo {
	detail: string;
	documentation: string;
	source: string;
	deprecated: boolean;
}

export interface SignatureLine {
	text: string;
	start: number;
}

export interface CompletionMenuLayout {
	width: number;
	height: number;
	rows: number;
	panelRows: number;
	signature: SignatureLine[];
	documentation: string[];
	origin: string;
}

export function completionSignature(item: CompletionItem): string {
	return item.labelDetails?.detail ?? (item.detail ?? '').replaceAll(/\s+/g, ' ').trim();
}

export function plainMarkup(doc: CompletionItem['documentation']): string {
	if (!doc) return '';
	const raw = typeof doc === 'string' ? doc : (doc.value ?? '');
	return raw
		.replaceAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '$1')
		.replaceAll(/`([^`]+)`/g, '$1')
		.trim();
}

export function completionInfo(item: CompletionItem | null | undefined): CompletionInfo | null {
	if (!item) return null;
	return {
		detail: completionSignature(item),
		documentation: plainMarkup(item.documentation),
		source: item.labelDetails?.description ?? '',
		deprecated: isDeprecated(item),
	};
}

function widthFor(items: CompletionItem[], panel: boolean, max: number): number {
	let label = 0;
	let detail = 0;
	for (const item of items.slice(0, COMPLETION_MENU_ROWS)) {
		label = Math.max(label, Math.min(item.label.length, LABEL_MAX));
		detail = Math.max(detail, Math.min(completionSignature(item).length, DETAIL_MAX));
	}
	const want = Math.max(MIN_WIDTH, 1 + 2 + label + (detail > 0 ? 2 + detail : 0) + 1 + 2);
	return Math.min(Math.max(want, panel ? DOC_WIDTH : 0), max);
}

function wrapSignature(text: string, width: number): SignatureLine[] {
	const lines: SignatureLine[] = [];
	let line = '';
	let start = 0;
	for (const match of text.matchAll(/\S+/g)) {
		const word = match[0];
		const at = match.index;
		if (line && line.length + 1 + word.length > width) {
			lines.push({ text: line, start });
			line = '';
		}
		if (word.length > width) {
			if (line) lines.push({ text: line, start });
			for (let from = 0; from < word.length; from += width) {
				lines.push({ text: word.slice(from, from + width), start: at + from });
			}
			line = '';
			continue;
		}
		if (!line) start = at;
		line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push({ text: line, start });
	return lines;
}

function wrapBlock(text: string, width: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split('\n')) {
		if (paragraph.trim().length === 0) {
			if (lines.length > 0) lines.push('');
		} else {
			lines.push(...wrapText(paragraph, width));
		}
	}
	return lines;
}

function capped(lines: string[], rows: number): string[] {
	if (rows <= 0) return [];
	if (lines.length <= rows) return lines;
	const kept = lines.slice(0, rows);
	kept[rows - 1] = `${kept[rows - 1]!.slice(0, Math.max(0, kept[rows - 1]!.length - 1))}…`;
	return kept;
}

export function completionMenuLayout(
	items: CompletionItem[],
	info: CompletionInfo | null,
	max: { width: number; height: number },
	panel: boolean,
): CompletionMenuLayout {
	const width = widthFor(items, panel, Math.max(MIN_WIDTH, max.width));
	if (items.length === 0) {
		return {
			width,
			height: 3,
			rows: 0,
			panelRows: 0,
			signature: [],
			documentation: [],
			origin: '',
		};
	}
	const shown = Math.min(items.length, COMPLETION_MENU_ROWS);
	const room = Math.min(DOC_ROWS, max.height - 3 - shown - 1);
	const panelRows = panel && room >= 2 ? room : 0;
	let signature: SignatureLine[] = [];
	let documentation: string[] = [];
	let origin = '';
	if (panelRows > 0 && info && (info.detail || info.documentation || info.source)) {
		const wrapped = info.detail ? wrapSignature(info.detail, width - 4) : [];
		const docs = wrapBlock(info.documentation, width - 4);
		const rows = capped(
			wrapped.map((line) => line.text),
			Math.min(Math.max(SIG_ROWS, panelRows - docs.length), panelRows),
		);
		signature = rows.map((text, at) => ({ text, start: wrapped[at]!.start }));
		documentation = capped(docs, panelRows - signature.length);
		if (panelRows > signature.length + documentation.length && info.source) {
			origin =
				info.source.length > width - 4
					? `${info.source.slice(0, Math.max(0, width - 5))}…`
					: info.source;
		}
	}
	const reserved = panelRows > 0 ? panelRows + 1 : 0;
	const rows = Math.max(1, Math.min(shown, max.height - 3 - reserved));
	return {
		width,
		height: 3 + rows + reserved,
		rows,
		panelRows,
		signature,
		documentation,
		origin,
	};
}
