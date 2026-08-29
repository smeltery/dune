import type { TextareaRenderable } from '@opentui/core';

import { inCells } from '../editor/columns';
import type { Segment } from '../languages/highlight';
import { styleIdOver } from '../languages/highlight';
import type { ProblemSeverity } from '../lsp/protocol';

export type ProblemRange = {
	line: number;
	col: number;
	endLine: number;
	endCol: number;
	severity: ProblemSeverity;
	unnecessary: boolean;
	deprecated: boolean;
};

export function indexProblemRanges(ranges: readonly ProblemRange[]) {
	const byStart = new Map<number, ProblemRange[]>();
	const crossing: ProblemRange[] = [];
	for (const problem of ranges) {
		const list = byStart.get(problem.line);
		if (list) list.push(problem);
		else byStart.set(problem.line, [problem]);
		if (problem.endLine > problem.line) crossing.push(problem);
	}
	return { byStart, crossing };
}

/**
 * Paint `group` over columns `start`..`end` as one highlight per syntax segment
 * underneath. A single highlight over the whole range would replace syntax
 * colour rather than tint it — `styleIdOver` is what keeps both.
 */
export function overlaySpan(
	editor: TextareaRenderable,
	byLine: Map<number, Segment[]>,
	row: number,
	text: string,
	start: number,
	end: number,
	group: string,
	priority: number,
): void {
	const paint = (from: number, to: number, base: number | null) => {
		if (to <= from) return;
		const styleId = styleIdOver(group, base);
		if (styleId == null) return;
		editor.addHighlight(row, inCells({ start: from, end: to, styleId, priority }, text));
	};
	let at = start;
	for (const segment of byLine.get(row) ?? []) {
		if (segment.end <= at || segment.start >= end) continue;
		const from = Math.max(segment.start, at);
		const to = Math.min(segment.end, end);
		paint(at, from, null);
		paint(from, to, segment.styleId);
		at = to;
	}
	paint(at, end, null);
}

export function markProblemSpans(
	editor: TextareaRenderable,
	byLine: Map<number, Segment[]>,
	indexed: ReturnType<typeof indexProblemRanges>,
	row: number,
	line: number,
	text: string,
): void {
	const { byStart, crossing } = indexed;
	const starting = byStart.get(line);
	const covering = crossing.filter((problem) => problem.line < line && line <= problem.endLine);
	if (!starting && covering.length === 0) return;
	const mark = (problem: ProblemRange, start: number, end: number) => {
		if (end <= start) return;
		const group = problem.unnecessary
			? 'unnecessary'
			: problem.deprecated
				? 'deprecated'
				: problem.severity;
		overlaySpan(editor, byLine, row, text, start, end, `dune.problem.${group}`, 100);
	};
	for (const problem of starting ?? []) {
		const end =
			problem.endLine === problem.line
				? Math.max(problem.endCol, problem.col + 1)
				: Math.max(text.length, problem.col + 1);
		mark(problem, problem.col, end);
	}
	for (const problem of covering) {
		mark(problem, 0, line === problem.endLine ? problem.endCol : text.length);
	}
}
