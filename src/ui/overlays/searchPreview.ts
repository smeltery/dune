import { TextAttributes } from '@opentui/core';

import {
	computeHighlights,
	segmentsIn,
	STALE,
	styleForId,
	filetypeForPath,
} from '../../languages/highlight';
import type { Highlighted } from '../../languages/highlight';
import type { Match } from '../../core/search';
import { activeTheme, ui } from '../../themes';

/** Lines either side of the selected match in the preview, at its smallest. */
export const MIN_CONTEXT = 2;
/** …and at its largest: past this the list is the thing being starved. */
export const MAX_CONTEXT = 9;

/**
 * A preview needs the lines around the hit to be worth reading at all, and a
 * three-line window rarely is. Below this height there is no room for one.
 */
export const PREVIEW_MIN_HEIGHT = 24;

/** Rows left unclaimed, so the panel never grows into the edge of the screen. */
export const SLACK = 2;

/**
 * Documents past this size are shown uncoloured. Parsing one costs a worker
 * round-trip on every step through the results, and the preview is eleven lines
 * of a file whose colour nobody is reading it for.
 */
export const MAX_HIGHLIGHT_BYTES = 512 * 1024;

/** A run of preview text painted as one `<text>`. */
export interface PreviewSpan {
	text: string;
	fg?: string;
	attributes?: number;
}

/**
 * The pieces of a painted line between columns `from` and `to`, splitting whichever
 * spans straddle them. Cutting the hit out of its coloured line and trimming the
 * line to the panel's width are the same operation on different bounds.
 */
export function sliceSpans(spans: readonly PreviewSpan[], from: number, to: number): PreviewSpan[] {
	const out: PreviewSpan[] = [];
	let col = 0;
	for (const span of spans) {
		const start = Math.max(from, col);
		const end = Math.min(to, col + span.text.length);
		if (end > start) out.push({ ...span, text: span.text.slice(start - col, end - col) });
		col += span.text.length;
	}
	return out;
}

/**
 * Preview line `at` as coloured pieces: the parsed document's segments, with the
 * gaps between them left in `plain`. A segment carrying only a background — the
 * indent guides — is passed over, or the preview would come out striped with a
 * fill nothing here asked for.
 */
export function paintPreviewLine(
	line: string,
	at: number,
	plain: string,
	doc: Highlighted | null,
): PreviewSpan[] {
	// Read so the pieces are rebuilt when the theme changes.
	activeTheme();
	const out: PreviewSpan[] = [];
	let col = 0;
	for (const segment of doc ? segmentsIn(doc, at, at) : []) {
		const style = styleForId(segment.styleId);
		const fg = typeof style?.fg === 'string' ? style.fg : undefined;
		if (!style || !fg || segment.start < col) continue;
		if (segment.start > col) out.push({ text: line.slice(col, segment.start), fg: plain });
		out.push({
			text: line.slice(segment.start, segment.end),
			fg,
			attributes:
				(style.bold ? TextAttributes.BOLD : 0) | (style.italic ? TextAttributes.ITALIC : 0),
		});
		col = segment.end;
	}
	if (col < line.length) out.push({ text: line.slice(col), fg: plain });
	return out;
}

/** Columns scrolled off the left of the hit's own line when the match sits far right. */
export function previewShift(match: Match, room: number): number {
	if (match.col + match.length <= room) return 0;
	return Math.max(0, match.col - 12);
}

/**
 * A preview line, ready to paint: syntax colours, and on the selected match's own
 * line the hit picked out — struck through beside its replacement once there is
 * one, so the preview and the row above it agree about what the file will say.
 */
export function previewLineSpans(opts: {
	line: string;
	at: number;
	match: Match | null;
	swap: string;
	room: number;
	doc: Highlighted | null;
}): PreviewSpan[] {
	const hit = opts.match && opts.at === opts.match.line;
	const spans = paintPreviewLine(opts.line, opts.at, hit ? ui.text : ui.dim, opts.doc);
	if (!hit || !opts.match) return sliceSpans(spans, 0, opts.room);
	const shift = previewShift(opts.match, opts.room);
	const room = opts.room - (shift > 0 ? 1 : 0);
	const cut: PreviewSpan[] = shift > 0 ? [{ text: '…', fg: ui.dim }] : [];
	const text = opts.line.slice(opts.match.col, opts.match.col + opts.match.length);
	return [
		...cut,
		...sliceSpans(
			[
				...sliceSpans(spans, shift, opts.match.col),
				opts.swap
					? { text, fg: ui.gitDeleted, attributes: TextAttributes.STRIKETHROUGH }
					: { text, fg: ui.accent, attributes: TextAttributes.BOLD },
				...(opts.swap
					? [{ text: opts.swap, fg: ui.gitAdded, attributes: TextAttributes.BOLD }]
					: []),
				...sliceSpans(spans, opts.match.col + opts.match.length, opts.line.length),
			],
			0,
			room,
		),
	];
}

export async function parsePreviewSource(
	path: string,
	text: string,
	dropped: () => boolean,
): Promise<Highlighted | null> {
	if (text.length > MAX_HIGHLIGHT_BYTES) return null;
	const doc = await computeHighlights(text, filetypeForPath(path), 2, dropped);
	return !dropped() && doc !== STALE ? doc : null;
}

/** How far the preview reaches either side of the hit, grown with the terminal. */
export function adaptiveContextLines(height: number, chromeRows: number): number {
	const spare = height - chromeRows - SLACK;
	return Math.max(MIN_CONTEXT, Math.min(MAX_CONTEXT, Math.floor(spare / 5)));
}

/** Rows the preview spends: the lines themselves plus the gap and rule above them. */
export function previewRowBudget(contextLines: number): number {
	return contextLines * 2 + 3;
}
