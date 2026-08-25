import type { MouseEvent, TextareaRenderable } from '@opentui/core';
import { useRenderer } from '@opentui/solid';
import { lineAt } from '../editor/window';
import { lineRangeAt, wordRangeAt } from '../editor/words';

const selectionHosts = new WeakMap<object, unknown>();
const DOUBLE_CLICK_MS = 400;
const SCROLL_MARGIN = 0.2;

type EditorScrollEvent = {
	scroll: { direction: 'down' | 'up'; delta: number };
};

const pastScrollEnd = (offset: number, total: number, height: number) =>
	offset > Math.max(0, total - height);

export function allowSelectionOnlyInEditor(el: TextareaRenderable) {
	const renderer = useRenderer() as unknown as {
		startSelection: (renderable: unknown, x: number, y: number) => void;
	};
	const gated = selectionHosts.has(renderer);
	selectionHosts.set(renderer, el);
	if (gated) return;
	const start = renderer.startSelection.bind(renderer);
	renderer.startSelection = (renderable: unknown, x: number, y: number) => {
		if (renderable === selectionHosts.get(renderer)) start(renderable, x, y);
	};
}

export function afterResize(el: TextareaRenderable, after: () => void) {
	const host = el as unknown as { onResize: (width: number, height: number) => void };
	const resize = host.onResize.bind(host);
	host.onResize = (width: number, height: number) => {
		resize(width, height);
		after();
	};
}

export function ignoreScrollOutsideBounds(el: TextareaRenderable) {
	const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void };
	const handle = host.onMouseEvent.bind(host);
	host.onMouseEvent = (event: MouseEvent) => {
		if (event.type === 'scroll') {
			const { x, y, width, height } = el;
			const inside = event.x >= x && event.x < x + width && event.y >= y && event.y < y + height;
			if (!inside) return;
		}
		handle(event);
	};
}

export function allowScrollPastEnd(el: TextareaRenderable, active: () => boolean) {
	const view = el.editorView;
	const setMargin = (next: number) => {
		view.setScrollMargin(next);
	};

	const host = el as unknown as {
		handleScroll: (event: EditorScrollEvent) => void;
		onResize: (width: number, height: number) => void;
	};
	const scroll = host.handleScroll.bind(host);
	host.handleScroll = (event: EditorScrollEvent) => {
		if (!active()) {
			scroll(event);
			return;
		}
		const port = view.getViewport();
		const wanted =
			event.scroll.direction === 'down' ? port.offsetY + event.scroll.delta : port.offsetY;
		if (pastScrollEnd(wanted, view.getTotalVirtualLineCount(), port.height)) setMargin(0);
		scroll(event);
		const next = view.getViewport();
		if (pastScrollEnd(next.offsetY, view.getTotalVirtualLineCount(), next.height)) return;
		setMargin(SCROLL_MARGIN);
		el.requestRender();
	};

	const resize = host.onResize.bind(host);
	host.onResize = (width: number, height: number) => {
		const port = view.getViewport();
		const wanted = port.offsetY;
		const wasPastEnd =
			active() && pastScrollEnd(wanted, view.getTotalVirtualLineCount(), port.height);
		resize(width, height);
		if (!wasPastEnd) return;
		const next = view.getViewport();
		const offset = Math.min(wanted, Math.max(0, view.getTotalVirtualLineCount() - 1));
		if (next.offsetY === offset) return;
		setMargin(0);
		view.setViewport(next.offsetX, offset, next.width, next.height, true);
		el.requestRender();
	};
}

export function selectOnMultiClick(el: TextareaRenderable, after: () => void) {
	let last = { x: -1, y: -1, at: 0, count: 0 };
	const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void };
	const handle = host.onMouseEvent.bind(host);
	host.onMouseEvent = (event: MouseEvent) => {
		handle(event);
		if (event.type !== 'down') return;
		const now = Date.now();
		const same = event.x === last.x && event.y === last.y && now - last.at < DOUBLE_CLICK_MS;
		const count = same ? last.count + 1 : 1;
		last = { x: event.x, y: event.y, at: now, count };
		if (count < 2) return;
		const range =
			count >= 3
				? lineRangeAt(el.plainText, el.cursorOffset)
				: wordRangeAt(el.plainText, el.cursorOffset);
		if (range.start >= range.end) return;
		el.setSelection(range.start, range.end);
		if (count >= 3) last.count = 0;
		after();
	};
}

export interface InlineNote {
	top: number;
	left: number;
	text: string;
	color: string;
}

/** @deprecated Prefer InlineNote — kept as an alias for call sites mid-rename. */
export type ProblemNote = InlineNote;

export function createEditorLayout(
	editor: () => TextareaRenderable | undefined,
	onForget: () => void,
) {
	let layout: { sources: number[]; widths: number[] } | null = null;
	const lineLayout = (): { sources: number[]; widths: number[] } => {
		const el = editor();
		if (!el) return { sources: [], widths: [] };
		if (!layout) {
			const info = el.lineInfo;
			layout = {
				sources: info.lineSources as number[],
				widths: info.lineWidthCols as number[],
			};
		}
		return layout;
	};
	const wrapMap = (): number[] => lineLayout().sources;
	const rowAtLine = (line: number): number => {
		const map = wrapMap();
		if (map.length === 0) return line;
		let low = 0;
		let high = map.length - 1;
		while (low < high) {
			const mid = (low + high) >> 1;
			if ((map[mid] ?? 0) < line) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	return {
		lineLayout,
		wrapMap,
		lineAtRow: (row: number): number => lineAt(wrapMap(), row),
		rowAtLine,
		forget: () => {
			layout = null;
			onForget();
		},
	};
}

export function scrollTextarea(editor: TextareaRenderable, delta: number) {
	const scroller = editor as unknown as { onMouseEvent: (event: unknown) => void };
	scroller.onMouseEvent({
		type: 'scroll',
		x: editor.x + 1,
		y: editor.y + 1,
		scroll: { direction: delta > 0 ? 'down' : 'up', delta: Math.abs(delta) },
	});
}

export function inlineLineNotes(args: {
	editor: TextareaRenderable;
	host: { x: number; y: number; width: number };
	annotations: Map<number, { text: string; color: string }>;
	top: number;
	height: number;
	sources: number[];
	widths: number[];
	rowAtLine: (line: number) => number;
}): InlineNote[] {
	const notes: InlineNote[] = [];
	for (const [line, note] of args.annotations) {
		const first = args.rowAtLine(line);
		if (args.sources.length > 0 && args.sources[first] !== line) continue;
		let last = first;
		while (args.sources[last + 1] === line) last++;
		if (last < args.top || last >= args.top + args.height) continue;
		const left = args.editor.x - args.host.x + 1 + (args.widths[last] ?? 0) + 2;
		const room = args.host.width - left - 2;
		if (room < 8) continue;
		const flat = note.text.replaceAll(/\s+/g, ' ');
		notes.push({
			top: args.editor.y - args.host.y + (last - args.top),
			left,
			text: flat.length > room ? `${flat.slice(0, room - 1)}…` : flat,
			color: note.color,
		});
	}
	return notes;
}
