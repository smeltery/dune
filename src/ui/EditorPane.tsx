import type { TextareaRenderable } from '@opentui/core';
import { useRenderer, useTerminalDimensions } from '@opentui/solid';
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import type { CursorStyle } from '../core/config';
import type { LineChange } from '../core/git';
import { changeRows } from '../editor/changes';
import { inCells } from '../editor/columns';
import type { FoldOp } from '../editor/folds';
import { History } from '../editor/history';
import { problemRows } from '../editor/problems';
import { initialVimState } from '../editor/vim';
import type { VimMode } from '../editor/vim';
import { logicalWindow } from '../editor/window';
import type { ProblemSeverity } from '../lsp/protocol';
import { computeHighlights, getSyntaxStyle, segmentsIn, STALE } from '../languages/highlight';
import type { Highlighted, Segment } from '../languages/highlight';
import { ui } from '../themes';
import type { ThemeName } from '../themes';
import type { GutterHost } from './EditorPaneBody';
import { EditorPaneContent } from './EditorPaneContent';
import { createEditorFolds } from './editorFolds';
import {
	afterResize,
	allowScrollPastEnd,
	allowSelectionOnlyInEditor,
	createEditorLayout,
	ignoreScrollOutsideBounds,
	inlineLineNotes,
	scrollTextarea,
	selectOnMultiClick,
} from './editorHost';
import { useEditorKeymap } from './editorKeymap';
import { createEditorCompletion } from './editorCompletion';
import type { EditorCompletionProps } from './editorCompletion';
import { createEditorLineActions } from './editorLineActions';
import { createEditorLineCount, createEditorScrollMetrics } from './editorScrollMetrics';
import { indexProblemRanges, markProblemSpans } from './editorProblemOverlays';
import type { ProblemRange } from './editorProblemOverlays';
import { buildInlineAnnotations, editorLineSigns, type ReviewMark } from './problemMarks';

export type { ProblemRange } from './editorProblemOverlays';

export interface EditorPaneProps extends EditorCompletionProps {
	filetype?: string;
	theme: ThemeName;
	reloadKey: number;
	goto: { line: number; col: number; key: number } | null;
	history: { kind: 'undo' | 'redo'; key: number } | null;
	edit: { content: string; key: number } | null;
	lineOp: {
		op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete' | 'lineHome';
		key: number;
	} | null;
	foldOp: { op: FoldOp; key: number } | null;
	vim: boolean;
	cursorStyle: CursorStyle;
	wrap: boolean;
	scrollPastEnd: boolean;
	tabSize: number;
	gitLines: Map<number, LineChange>;
	problems: Map<number, { severity: ProblemSeverity; message: string }>;
	problemRanges: readonly ProblemRange[];
	problemText: boolean;
	reviews: Map<number, ReviewMark>;
	reviewText: boolean;
	notice: { name: string; reason: string } | null;
	onChange: (text: string) => void;
	onCursor: (pos: { line: number; col: number }) => void;
	onFocus: () => void;
	onVimMode: (mode: VimMode | null) => void;
	onQuit: () => void;
}
const DEBOUNCE_MS = 16;
const OVERSCAN = 60;

export function EditorPane(props: EditorPaneProps) {
	const dimensions = useTerminalDimensions();
	const renderer = useRenderer();
	let gutter: GutterHost | undefined;
	let editor: TextareaRenderable | undefined;
	let highlightTimer: ReturnType<typeof setTimeout> | null = null;
	let parsing = false;
	let queuedParse = false;
	let byLine = new Map<number, Segment[]>();
	let parsed: Highlighted | null = null;
	const segmented = new Set<number>();
	const appliedLines = new Set<number>();
	const cursor = { line: 0, col: 0 };
	const history = new History({ content: props.content, cursor: 0 });
	let cursorBeforeEdit = 0;
	const vimState = initialVimState();
	const [editorEl, setEditorEl] = createSignal<TextareaRenderable | null>(null);
	const [vimMode, setVimMode] = createSignal<VimMode>(vimState.mode);
	const [cursorLine, setCursorLine] = createSignal(0);
	const [viewTop, setViewTop] = createSignal(0);
	const [viewHeight, setViewHeight] = createSignal(0);
	const [viewTotal, setViewTotal] = createSignal(0);
	const [wrapKey, setWrapKey] = createSignal(0);
	const viewport = () => ({ top: viewTop(), height: viewHeight(), total: viewTotal() });
	let host: { x: number; y: number; width: number } | undefined;
	const bumpWrapKey = () => setWrapKey((key) => key + 1);
	const layout = createEditorLayout(() => editor, bumpWrapKey);
	const lineCount = createEditorLineCount(() => props.content);
	const { scrollbar, scrollMetrics } = createEditorScrollMetrics(
		dimensions,
		viewport,
		lineCount,
		layout.lineAtRow,
		() => props.scrollPastEnd,
	);
	let track: { y: number } | undefined;
	const [dragging, setDragging] = createSignal(false);
	const gutterWidth = () => String(lineCount()).length + 2;
	createEffect(() => {
		const width = gutterWidth();
		if (gutter?.gutter) gutter.gutter['_minWidth'] = width;
	});

	const keepingView = (rewrite: () => void) => {
		const wasTop = editor ? folds.realLine(layout.lineAtRow(editor.scrollY)) : 0;
		rewrite();
		layout.forget();
		if (!editor) return;
		scrollTo(folds.shownLine(wasTop));
		const height = editor.height;
		if (height <= 0) return;
		const caret = layout.rowAtLine(editor.logicalCursor.row);
		if (caret < editor.scrollY) scrollTextarea(editor, caret - editor.scrollY);
		else if (caret >= editor.scrollY + height)
			scrollTextarea(editor, caret - height + 1 - editor.scrollY);
	};

	const folds = createEditorFolds({
		editor: () => editor,
		path: () => props.path,
		content: () => props.content,
		tabSize: () => props.tabSize,
		host: () => host,
		viewTop,
		viewHeight,
		lineLayout: () => layout.lineLayout(),
		rowAtLine: layout.rowAtLine,
		wrapKey,
		applyWindow: (force) => applyWindow(force),
		scheduleCursorSync: () => scheduleCursorSync(),
		keepingView,
	});

	const applyLineSigns = () => {
		const view = folds.folded();
		const raw = editorLineSigns(props.gitLines, props.reviews, props.problems);
		const signs = new Map<
			number,
			{ before?: string; beforeColor?: string; after?: string; afterColor?: string }
		>();
		for (const [line, sign] of raw) {
			const row = view ? (view.display[line] ?? -1) : line;
			if (row < 0) continue;
			signs.set(row, sign);
		}
		if (signs.size === 0) signs.set(0, { before: ' ' });
		const markers = folds.foldMarkers();
		if (markers.length > 0) {
			signs.set(0, { ...signs.get(0), after: signs.get(0)?.after ?? ' ' });
			const closed = new Set(view?.folds.map((fold) => fold.start));
			for (const marker of markers) {
				const row = view ? (view.display[marker.line] ?? -1) : marker.line;
				if (row < 0) continue;
				const shut = closed.has(marker.line);
				signs.set(row, {
					...signs.get(row),
					after: shut ? '▸' : '▾',
					afterColor: shut ? ui.text : ui.gutter,
				});
			}
		}
		gutter?.setLineSigns?.(signs);
		gutter?.setLineNumbers?.(folds.lineNumberMap());
	};
	createEffect(applyLineSigns);
	const syncViewport = () => {
		if (!editor) return;
		setViewTop(editor.scrollY);
		setViewHeight(editor.height);
		setViewTotal(editor.lineCount);
	};
	const effectiveCursorStyle = (): CursorStyle =>
		props.vim ? (vimMode() === 'insert' ? 'line' : 'block') : props.cursorStyle;
	const syncCursor = () => {
		if (!editor) return;
		syncViewport();
		const at = editor.visualCursor;
		if (!at) return;
		const line = folds.realLine(at.logicalRow);
		if (line === cursor.line && at.logicalCol === cursor.col) return;
		cursor.line = line;
		cursor.col = at.logicalCol;
		setCursorLine(at.visualRow);
		props.onCursor({ ...cursor });
	};
	const ensureSegments = (from: number, to: number) => {
		if (!parsed) return;
		for (let line = from; line <= to; line++) {
			if (segmented.has(line)) continue;
			let last = line;
			while (last + 1 <= to && !segmented.has(last + 1)) last++;
			for (const segment of segmentsIn(parsed, line, last)) {
				const list = byLine.get(segment.line);
				if (list) list.push(segment);
				else byLine.set(segment.line, [segment]);
			}
			for (let done = line; done <= last; done++) segmented.add(done);
			line = last;
		}
	};
	const parsedLine = (line: number): string => {
		const at = parsed?.starts[line];
		if (!parsed || at === undefined) return '';
		const next = parsed.starts[line + 1];
		return next === undefined ? parsed.content.slice(at) : parsed.content.slice(at, next - 1);
	};
	const lineTextAt = (row: number): string => {
		if (!editor) return '';
		const lines = editor.plainText.split('\n');
		return lines[row] ?? '';
	};
	const problemsByLine = createMemo(() => indexProblemRanges(props.problemRanges));
	const applyWindow = (force = false) => {
		if (!editor) return;
		syncViewport();
		if (force) {
			editor.clearAllHighlights();
			appliedLines.clear();
		}
		const { from, to } = logicalWindow(editor.scrollY, editor.height, layout.wrapMap(), OVERSCAN);
		for (const line of appliedLines) {
			if (line < from || line > to) {
				editor.clearLineHighlights(line);
				appliedLines.delete(line);
			}
		}
		ensureSegments(from, to);
		const indexed = problemsByLine();
		for (let row = from; row <= to; row++) {
			if (appliedLines.has(row)) continue;
			appliedLines.add(row);
			const text = parsedLine(row) || lineTextAt(row);
			for (const segment of byLine.get(row) ?? []) editor.addHighlight(row, inCells(segment, text));
			markProblemSpans(editor, byLine, indexed, row, folds.realLine(row), text);
		}
	};
	const scrollTo = (wanted: number) => {
		if (!editor) return;
		const delta = layout.rowAtLine(Math.round(wanted)) - editor.scrollY;
		if (delta === 0) return;
		scrollTextarea(editor, delta);
		syncViewport();
		applyWindow();
	};
	const centerCursorLine = () => {
		if (!editor) return;
		const row = layout.rowAtLine(editor.logicalCursor.row);
		const height = editor.height || editor.editorView.getViewport().height;
		const target = Math.max(0, row - Math.floor(height / 2));
		const delta = target - editor.scrollY;
		if (delta === 0) return;
		scrollTextarea(editor, delta);
		syncViewport();
		applyWindow();
		scheduleCursorSync();
	};
	const scrollPage = (direction: -1 | 1) => {
		if (!editor) return;
		const pageRows = Math.max(1, editor.height - 1);
		const maxTop = Math.max(0, editor.lineCount - editor.height);
		const target = Math.max(0, Math.min(maxTop, editor.scrollY + direction * pageRows));
		const delta = target - editor.scrollY;
		if (delta === 0) return;
		scrollTextarea(editor, delta);
		syncViewport();
		applyWindow();
		scheduleCursorSync();
	};
	const dragTo = (screenY: number) => {
		const m = scrollMetrics();
		if (!m || !track) return;
		const within = Math.max(0, Math.min(m.span, screenY - track.y - Math.floor(m.size / 2)));
		scrollTo(m.span === 0 ? 0 : (within / m.span) * Math.max(0, m.total - 1));
	};
	let cursorSync: ReturnType<typeof setTimeout> | null = null;
	const scheduleCursorSync = () => {
		if (cursorSync) return;
		cursorSync = setTimeout(() => {
			cursorSync = null;
			applyWindow();
			syncCursor();
		}, 0);
	};
	const highlight = async (snapshot: string, forPath: string | null) => {
		const result = await computeHighlights(
			snapshot,
			props.filetype,
			props.tabSize,
			() => !editor || forPath !== props.path || editor.plainText !== snapshot,
		);
		if (result === STALE) return;
		if (!editor || forPath !== props.path || editor.plainText !== snapshot) return;
		parsed = result;
		byLine = new Map();
		segmented.clear();
		applyWindow(true);
	};
	const runHighlight = async (text: string) => {
		if (parsing) {
			queuedParse = true;
			return;
		}
		parsing = true;
		try {
			await highlight(text, props.path);
		} finally {
			parsing = false;
		}
		if (!queuedParse) return;
		queuedParse = false;
		if (editor) void runHighlight(editor.plainText);
	};
	const rehighlight = (text: string) => {
		layout.forget();
		parsed = null;
		byLine = new Map();
		segmented.clear();
		void runHighlight(text);
	};
	const {
		deleteSelectedLines,
		duplicateSelectedLines,
		moveSelectedLines,
		stepHistory,
		toggleCommentLines,
	} = createEditorLineActions({
		editor: () => editor,
		filetype: () => props.filetype,
		history,
		onChange: props.onChange,
		rehighlight,
		scheduleCursorSync,
	});
	createEffect(
		on(
			() => props.history?.key,
			() => {
				const request = props.history;
				if (request) stepHistory(request.kind);
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => props.lineOp?.key,
			() => {
				switch (props.lineOp?.op) {
					case 'comment':
						return toggleCommentLines();
					case 'up':
						return moveSelectedLines(-1);
					case 'down':
						return moveSelectedLines(1);
					case 'duplicate':
						return duplicateSelectedLines(true);
					case 'delete':
						return deleteSelectedLines();
					case 'lineHome':
						return void editor?.gotoLineHome();
				}
			},
			{ defer: true },
		),
	);
	const scheduleHighlight = () => {
		if (highlightTimer) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => {
			if (editor) void runHighlight(editor.plainText);
		}, DEBOUNCE_MS);
	};
	const changeTrack = createMemo(() => {
		const m = scrollMetrics();
		const height = m?.height ?? viewHeight();
		const total = m?.total ?? viewTotal();
		if (height <= 0) return [];
		return changeRows(props.gitLines, total, height);
	});
	const problemTrack = createMemo(() => {
		const m = scrollMetrics();
		const height = m?.height ?? viewHeight();
		const total = m?.total ?? viewTotal();
		if (height <= 0) return [];
		return problemRows(props.problems, total, height);
	});
	const problemNotes = createMemo(() => {
		wrapKey();
		void props.content;
		if (!editor || !host) return [];
		const view = folds.folded();
		const annotations = buildInlineAnnotations({
			reviews: props.reviews,
			reviewText: props.reviewText,
			problems: props.problems,
			problemText: props.problemText,
			displayOf: (line) => (view ? (view.display[line] ?? -1) : line),
		});
		if (annotations.size === 0) return [];
		const top = viewTop();
		const height = viewHeight() || editor.height;
		const { sources, widths } = layout.lineLayout();
		return inlineLineNotes({
			editor,
			host,
			annotations,
			top,
			height,
			sources,
			widths,
			rowAtLine: layout.rowAtLine,
		});
	});
	createEffect(
		on(
			() => props.problemRanges,
			() => {
				appliedLines.clear();
				applyWindow(true);
			},
			{ defer: true },
		),
	);
	const jumpToRow = (row: number) => {
		const m = scrollMetrics();
		if (!m || !editor) return;
		const line = Math.round((row / Math.max(1, m.height - 1)) * (m.total - 1));
		scrollTo(Math.max(0, line - Math.floor(editor.height / 2)));
	};
	const releaseEditor = () => {
		editor = undefined;
		setEditorEl(null);
		if (highlightTimer) clearTimeout(highlightTimer);
		if (cursorSync) clearTimeout(cursorSync);
		highlightTimer = null;
		cursorSync = null;
	};
	onCleanup(releaseEditor);
	const completion = createEditorCompletion(props, {
		editor: () => editor,
		onChange: props.onChange,
		rehighlight,
		scheduleCursorSync,
	});
	useEditorKeymap({
		blocked: () => props.blocked,
		focused: () => props.focused,
		vim: () => props.vim,
		tabSize: () => props.tabSize,
		editor: () => editor,
		vimState,
		renderer,
		onChange: (text) => {
			if (folds.refolding()) return;
			props.onChange(text);
		},
		onQuit: props.onQuit,
		onVimMode: (mode) => {
			if (mode) setVimMode(mode);
			props.onVimMode(mode);
		},
		applyWindow,
		scheduleCursorSync,
		scheduleHighlight,
		setCursorBeforeEdit: (offset) => void (cursorBeforeEdit = offset),
		stepHistory,
		toggleCommentLines,
		moveSelectedLines,
		duplicateSelectedLines,
		deleteSelectedLines,
		scrollPage,
		centerCursorLine,
		beforeEdit: (key) => folds.releaseFoldForEdit(key),
	});
	createEffect(
		on(
			() => props.foldOp?.key,
			() => {
				const request = props.foldOp;
				if (request) folds.runFoldOp(request.op);
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => props.path,
			() => {
				if (!editor) return;
				scheduleCursorSync();
				const text = folds.restoreForPath(props.path, props.content);
				if (editor.plainText !== text) editor.setText(text);
				editor.setCursor(0, 0);
				history.reset({ content: props.content, cursor: 0 });
				editor.syntaxStyle = getSyntaxStyle();
				rehighlight(props.content);
			},
		),
	);
	createEffect(
		on(
			() => props.focused,
			(focused) => void (focused && editor?.focus()),
		),
	);
	createEffect(
		on(
			() => props.blocked,
			(blocked) => void (!blocked && props.focused && editor?.focus()),
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => [props.vim, props.path],
			() => {
				Object.assign(vimState, initialVimState());
				setVimMode(vimState.mode);
				props.onVimMode(props.vim ? 'normal' : null);
			},
		),
	);
	createEffect(
		() => void (editor && (editor.cursorStyle = { style: effectiveCursorStyle(), blinking: true })),
	);
	createEffect(
		on(
			() => [props.theme, props.tabSize],
			() => {
				if (!editor) return;
				editor.syntaxStyle = getSyntaxStyle();
				void highlight(editor.plainText, props.path);
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => props.wrap,
			() => {
				if (!editor) return;
				layout.forget();
				applyWindow(true);
				syncViewport();
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => props.reloadKey,
			() => {
				if (!editor) return;
				folds.clearFolds();
				if (props.content !== editor.plainText) {
					editor.setText(props.content);
					history.reset({ content: props.content, cursor: editor.cursorOffset });
					rehighlight(props.content);
				}
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => props.edit?.key,
			() => {
				const edit = props.edit;
				if (!edit || !editor || edit.content === folds.docText()) return;
				folds.clearFolds();
				const at = editor.cursorOffset;
				editor.setText(edit.content);
				editor.cursorOffset = Math.min(at, edit.content.length);
				props.onChange(edit.content);
				rehighlight(edit.content);
				scheduleCursorSync();
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			() => props.goto?.key,
			() => {
				const target = props.goto;
				if (!target || !editor) return;
				editor.setCursor(folds.shownLine(target.line), target.col);
				editor.focus();
			},
		),
	);
	return (
		<EditorPaneContent
			open={props.path != null}
			content={props.content}
			focused={props.focused}
			tabSize={props.tabSize}
			wrap={props.wrap}
			notice={props.notice}
			editorEl={editorEl()}
			cursorLine={cursorLine()}
			gutterWidth={gutterWidth()}
			changeTrack={changeTrack()}
			problemTrack={problemTrack()}
			problemNotes={problemNotes()}
			foldNotes={folds.foldNotes()}
			foldMarkers={folds.foldMarkers()}
			scrollbar={scrollbar()}
			dragging={dragging()}
			completionMenu={completion.menu()}
			onFocus={props.onFocus}
			onDrag={(event) => {
				if (dragging()) dragTo(event.y);
			}}
			onDragEnd={() => setDragging(false)}
			onHost={(el) => {
				host = el;
			}}
			onGutter={(el) => {
				gutter = el as GutterHost;
			}}
			onEditor={(el) => {
				editor = el;
				setEditorEl(el);
				editor.cursorStyle = { style: effectiveCursorStyle(), blinking: true };
				ignoreScrollOutsideBounds(el);
				allowScrollPastEnd(el, () => props.focused && props.scrollPastEnd);
				afterResize(el, () => {
					applyLineSigns();
					syncViewport();
					layout.forget();
					applyWindow(true);
				});
				allowSelectionOnlyInEditor(el);
				selectOnMultiClick(el, scheduleCursorSync);
				onCleanup(releaseEditor);
			}}
			onContentChange={() => {
				if (!editor || folds.refolding()) return;
				const source = folds.syncDocument();
				history.record({ content: source, cursor: cursorBeforeEdit }, Date.now());
				props.onChange(source);
				scheduleHighlight();
			}}
			onMouse={() => applyWindow()}
			onCursorChange={() => {
				applyWindow();
				syncCursor();
			}}
			onJumpTrack={(row) => jumpToRow(row - (editor?.y ?? 0))}
			onStartScrollbarDrag={(y) => {
				setDragging(true);
				dragTo(y);
			}}
			onTrack={(el) => {
				track = el;
			}}
			onToggleFold={(line) => folds.toggleFoldAt(line)}
		/>
	);
}
