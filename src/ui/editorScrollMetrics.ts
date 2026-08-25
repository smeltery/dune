import { createMemo } from 'solid-js';

export function createEditorLineCount(content: () => string) {
	return createMemo(() => {
		let lines = 1;
		for (let at = content().indexOf('\n'); at >= 0; at = content().indexOf('\n', at + 1)) {
			lines++;
		}
		return lines;
	});
}

export function createEditorScrollMetrics(
	dimensions: () => { height: number },
	viewport: () => { top: number; height: number; total: number },
	lineCount: () => number,
	lineAtRow: (row: number) => number,
	scrollPastEnd: () => boolean,
) {
	const scrollMetrics = createMemo(() => {
		const measured = viewport();
		const height = measured.height || dimensions().height - 2;
		const total = measured.total || lineCount();
		if (height <= 0 || total <= height) return null;
		const size = Math.max(1, Math.round((height * height) / total));
		return { height, total, size, span: height - size, top: lineAtRow(measured.top) };
	});
	const scrollbar = createMemo(() => {
		const m = scrollMetrics();
		if (!m) return [];
		const last = scrollPastEnd() ? m.total - 1 : m.total - m.height;
		const at = Math.min(m.span, Math.round((m.top / Math.max(1, last)) * m.span));
		return Array.from({ length: m.height }, (_, row) => row >= at && row < at + m.size);
	});
	return { scrollbar, scrollMetrics };
}
