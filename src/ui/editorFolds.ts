import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { createMemo, createSignal } from 'solid-js';

import {
	foldableRegions,
	foldsFrom,
	foldView,
	innermostRegion,
	reconcileFolds,
} from '../editor/folds';
import type { FoldOp, FoldRegion, FoldView } from '../editor/folds';
import { ALT } from './keys';

export type FoldNote = { top: number; left: number; text: string; hint?: boolean };

export function createEditorFolds(deps: {
	editor: () => TextareaRenderable | undefined;
	path: () => string | null;
	content: () => string;
	tabSize: () => number;
	host: () => { x: number; y: number; width: number } | undefined;
	viewTop: () => number;
	viewHeight: () => number;
	lineLayout: () => { sources: number[]; widths: number[] };
	rowAtLine: (line: number) => number;
	wrapKey: () => number;
	applyWindow: (force?: boolean) => void;
	scheduleCursorSync: () => void;
	keepingView: (run: () => void) => void;
}) {
	const foldsFor = new Map<string, FoldRegion[]>();
	const [folded, setFolded] = createSignal<FoldView | null>(null);
	let refolding = false;

	const realLine = (row: number): number => folded()?.real[row] ?? row;
	const shownLine = (line: number): number => {
		const view = folded();
		if (!view) return line;
		const at = view.display[line];
		if (at !== undefined && at >= 0) return at;
		for (let up = line - 1; up >= 0; up--) {
			const row = view.display[up];
			if (row !== undefined && row >= 0) return row;
		}
		return 0;
	};

	const docText = (): string => folded()?.source ?? deps.editor()?.plainText ?? deps.content();

	const applyFoldText = (text: string) => {
		const editor = deps.editor();
		if (!editor || editor.plainText === text) return;
		refolding = true;
		try {
			editor.setText(text);
		} finally {
			refolding = false;
		}
	};

	const rememberFolds = (regions: FoldRegion[]) => {
		const path = deps.path();
		if (path == null) return;
		if (regions.length > 0) foldsFor.set(path, regions);
		else foldsFor.delete(path);
	};

	const setFolds = (regions: FoldRegion[], keepAt?: number) => {
		const editor = deps.editor();
		if (!editor) return;
		const source = docText();
		const line = keepAt ?? realLine(editor.logicalCursor.row);
		const col = editor.logicalCursor.col;
		const view = regions.length > 0 ? foldView(source, regions) : null;
		deps.keepingView(() => {
			setFolded(view);
			rememberFolds(view?.folds ?? []);
			applyFoldText(view ? view.text : source);
			editor.setCursor(shownLine(line), col);
		});
		deps.applyWindow(true);
		deps.scheduleCursorSync();
	};

	const syncDocument = (): string => {
		const editor = deps.editor();
		if (!editor) return '';
		const view = folded();
		if (!view) return editor.plainText;
		if (editor.plainText === view.text) return view.source;
		const next = reconcileFolds(view, editor.plainText);
		const rebuilt = next.folds.length > 0 ? foldView(next.source, next.folds) : null;
		setFolded(rebuilt);
		rememberFolds(rebuilt?.folds ?? []);
		const wanted = rebuilt ? rebuilt.text : next.source;
		if (wanted !== editor.plainText) {
			const at = editor.cursorOffset;
			deps.keepingView(() => {
				applyFoldText(wanted);
				editor.cursorOffset = Math.min(at, wanted.length);
			});
			deps.applyWindow(true);
		}
		return next.source;
	};

	const clearFolds = () => {
		if (folded()) setFolded(null);
		const path = deps.path();
		if (path != null) foldsFor.delete(path);
	};

	const restoreForPath = (path: string | null, content: string) => {
		const regions = path == null ? [] : (foldsFor.get(path) ?? []);
		const view = regions.length > 0 ? foldView(content, regions) : null;
		setFolded(view);
		return view?.text ?? content;
	};

	const runFoldOp = (op: FoldOp) => {
		const editor = deps.editor();
		if (!editor || deps.path() == null) return;
		const current = folded()?.folds ?? [];
		const line = realLine(editor.logicalCursor.row);
		if (op === 'unfoldAll') {
			if (current.length > 0) setFolds([], line);
			return;
		}
		if (op === 'foldAll') {
			const all = foldableRegions(docText(), deps.tabSize());
			if (all.length > 0) setFolds(all, line);
			return;
		}
		if (op === 'unfold') {
			const kept = current.filter((fold) => fold.start !== line);
			if (kept.length !== current.length) setFolds(kept, line);
			return;
		}
		const region = innermostRegion(foldableRegions(docText(), deps.tabSize()), line);
		if (!region || current.some((fold) => fold.start === region.start)) return;
		setFolds([...current, region], region.start);
	};

	const toggleFoldAt = (line: number) => {
		if (!deps.editor()) return;
		const current = folded()?.folds ?? [];
		if (current.some((fold) => fold.start === line)) {
			setFolds(
				current.filter((fold) => fold.start !== line),
				line,
			);
			return;
		}
		const region = foldableRegions(docText(), deps.tabSize()).find((fold) => fold.start === line);
		if (region) setFolds([...current, region], line);
	};

	const releaseFoldForEdit = (key?: KeyEvent) => {
		const view = folded();
		const editor = deps.editor();
		if (!view || !editor || editor.hasSelection()) return;
		const { row, col } = editor.logicalCursor;
		const touched = new Set([realLine(row)]);
		if (key?.name === 'backspace' && col === 0 && row > 0) touched.add(realLine(row - 1));
		if (key?.name === 'delete') {
			const line = editor.plainText.split('\n')[row] ?? '';
			if (col === line.length) touched.add(realLine(row + 1));
		}
		const kept = view.folds.filter((fold) => !touched.has(fold.start));
		if (kept.length !== view.folds.length) setFolds(kept, realLine(row));
	};

	const lineNumberMap = (): Map<number, number> => {
		const view = folded();
		const numbers = new Map<number, number>();
		if (view) view.real.forEach((line, row) => numbers.set(row, line + 1));
		return numbers;
	};

	const foldNotes = createMemo((): FoldNote[] => {
		deps.wrapKey();
		void deps.content();
		const view = folded();
		const editor = deps.editor();
		const host = deps.host();
		if (!view || !editor || !host) return [];
		const top = deps.viewTop();
		const height = deps.viewHeight() || editor.height;
		const { sources, widths } = deps.lineLayout();
		const cursorRow = editor.logicalCursor.row;
		const notes: FoldNote[] = [];
		for (const [line, count] of view.hidden) {
			const row = view.display[line];
			if (row === undefined || row < 0) continue;
			const first = deps.rowAtLine(row);
			if (sources.length > 0 && sources[first] !== row && sources[first] !== undefined) continue;
			let last = first;
			while (sources[last + 1] === (sources[first] ?? row)) last++;
			if (last < top || last >= top + height) continue;
			const left = editor.x - host.x + 1 + (widths[last] ?? 0) + 2;
			const room = host.width - left - 2;
			if (room < 4) continue;
			const text = `⋯ ${count} line${count === 1 ? '' : 's'}`;
			const cut = text.length > room ? `${text.slice(0, room - 1)}…` : text;
			notes.push({
				top: editor.y - host.y + (last - top),
				left,
				text: cut,
			});
			const hint = `Ctrl+${ALT}+E`;
			if (row === cursorRow && room - cut.length > hint.length + 1) {
				notes.push({
					top: editor.y - host.y + (last - top),
					left: left + cut.length,
					text: ` ${hint}`,
					hint: true,
				});
			}
		}
		return notes;
	});

	const contentStarts = (): number[] => {
		const text = deps.content();
		const starts = [0];
		for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
		return starts;
	};

	const foldMarkers = createMemo(() => {
		deps.wrapKey();
		const editor = deps.editor();
		const host = deps.host();
		if (!editor || !host || editor.width <= 0 || host.width <= 0) return [];
		const starts = contentStarts();
		let any = false;
		for (let line = 0; line < starts.length; line++) {
			if (foldsFrom(deps.content(), starts, line, deps.tabSize())) {
				any = true;
				break;
			}
		}
		if (!any) return [];
		const top = deps.viewTop();
		const height = deps.viewHeight() || editor.height;
		const { sources } = deps.lineLayout();
		const rows = sources.length > 0 ? sources.length : editor.lineCount;
		const markers: { top: number; left: number; line: number }[] = [];
		let previous = top > 0 ? (sources[top - 1] ?? top - 1) : -1;
		for (let row = top; row < top + height && row < rows; row++) {
			const buffer = sources.length > 0 ? (sources[row] ?? row) : row;
			if (buffer === previous) continue;
			previous = buffer;
			const line = realLine(buffer);
			if (!foldsFrom(deps.content(), starts, line, deps.tabSize())) continue;
			markers.push({ top: editor.y - host.y + (row - top), left: editor.x - host.x - 2, line });
		}
		return markers;
	});

	return {
		folded,
		refolding: () => refolding,
		realLine,
		shownLine,
		docText,
		syncDocument,
		clearFolds,
		restoreForPath,
		runFoldOp,
		toggleFoldAt,
		releaseFoldForEdit,
		lineNumberMap,
		foldNotes,
		foldMarkers,
		setFolds,
	};
}
