import type { MouseEvent, TextareaRenderable } from '@opentui/core';
import { For, Show } from 'solid-js';

import type { LineChange } from '../core/git';
import type { ProblemSeverity } from '../lsp/protocol';
import { getSyntaxStyle } from '../languages/highlight';
import { ui } from '../themes';
import type { ProblemNote } from './editorHost';
import type { FoldNote } from './editorFolds';
import { problemColor, problemGlyph } from './problemMarks';

const CHANGE_COLORS: Record<LineChange, () => string> = {
	added: () => ui.gitAdded,
	modified: () => ui.gitModified,
	deleted: () => ui.gitDeleted,
};

export interface GutterHost {
	gutter?: { _minWidth?: number; requestRender?: () => void };
	setLineSigns?: (
		signs: Map<
			number,
			{ before?: string; beforeColor?: string; after?: string; afterColor?: string }
		>,
	) => void;
	setLineNumbers?: (numbers: Map<number, number>) => void;
}

export function EditorPaneBody(props: {
	content: string;
	focused: boolean;
	tabSize: number;
	wrap: boolean;
	editorEl: TextareaRenderable | null;
	cursorLine: number;
	gutterWidth: number;
	changeTrack: (LineChange | undefined)[];
	problemTrack: (ProblemSeverity | undefined)[];
	problemNotes: ProblemNote[];
	foldNotes: FoldNote[];
	foldMarkers: { top: number; left: number; line: number }[];
	scrollbar: boolean[];
	dragging: boolean;
	onFocus: () => void;
	onDrag: (event: MouseEvent) => void;
	onDragEnd: () => void;
	onHost: (el: { x: number; y: number; width: number }) => void;
	onGutter: (el: unknown) => void;
	onEditor: (el: TextareaRenderable) => void;
	onContentChange: () => void;
	onMouse: () => void;
	onCursorChange: () => void;
	onJumpTrack: (row: number) => void;
	onStartScrollbarDrag: (y: number) => void;
	onTrack: (el: { y: number }) => void;
	onToggleFold: (line: number) => void;
}) {
	return (
		<box
			ref={props.onHost}
			flexGrow={1}
			flexDirection="row"
			backgroundColor={ui.bg}
			onMouseDown={props.onFocus}
			onMouseDrag={props.onDrag}
			onMouseDragEnd={props.onDragEnd}
			onMouseUp={props.onDragEnd}
		>
			<line_number
				ref={props.onGutter}
				target={props.editorEl ?? undefined}
				fg={ui.gutter}
				bg={ui.bg}
				minWidth={props.gutterWidth}
				paddingRight={1}
				flexGrow={1}
				lineColors={
					new Map([[props.cursorLine, { gutter: ui.currentLine, content: ui.currentLine }]])
				}
			>
				<textarea
					ref={props.onEditor}
					initialValue={props.content}
					focused={props.focused}
					syntaxStyle={getSyntaxStyle()}
					backgroundColor={ui.bg}
					textColor={ui.text}
					focusedBackgroundColor={ui.bg}
					focusedTextColor={ui.text}
					cursorColor={ui.cursor}
					wrapMode={props.wrap ? 'word' : 'none'}
					tabIndicator={props.tabSize}
					tabIndicatorColor={ui.indentGuide}
					flexGrow={1}
					paddingLeft={1}
					onContentChange={props.onContentChange}
					onMouse={props.onMouse}
					onCursorChange={props.onCursorChange}
				/>
			</line_number>
			<For each={props.foldNotes}>
				{(note) => (
					<text
						position="absolute"
						top={note.top}
						left={note.left}
						zIndex={5}
						fg={note.hint ? ui.faint : ui.dim}
						bg={ui.bg}
						content={note.text}
					/>
				)}
			</For>
			<For each={props.foldMarkers}>
				{(marker) => (
					<box
						position="absolute"
						top={marker.top}
						left={marker.left}
						width={2}
						height={1}
						zIndex={6}
						onMouseDown={(event: MouseEvent) => {
							event.stopPropagation();
							props.onToggleFold(marker.line);
						}}
					/>
				)}
			</For>
			<For each={props.problemNotes}>
				{(note) => (
					<text
						position="absolute"
						top={note.top}
						left={note.left}
						zIndex={5}
						fg={note.color}
						bg={ui.bg}
						content={note.text}
					/>
				)}
			</For>
			<Show when={props.problemTrack.some(Boolean)}>
				<box
					width={1}
					flexShrink={0}
					backgroundColor={ui.bg}
					onMouseDown={(event: MouseEvent) => {
						if (!props.dragging) props.onJumpTrack(event.y);
					}}
				>
					<For each={props.problemTrack}>
						{(severity) => (
							<text
								fg={severity ? problemColor(severity) : ui.bg}
								bg={ui.bg}
								content={problemGlyph(severity)}
							/>
						)}
					</For>
				</box>
			</Show>
			<Show when={props.changeTrack.some(Boolean)}>
				<box
					width={1}
					flexShrink={0}
					backgroundColor={ui.bg}
					onMouseDown={(event: MouseEvent) => {
						if (!props.dragging) props.onJumpTrack(event.y);
					}}
				>
					<For each={props.changeTrack}>
						{(change) => (
							<text
								fg={change ? CHANGE_COLORS[change]() : ui.bg}
								bg={ui.bg}
								content={change ? '▎' : ' '}
							/>
						)}
					</For>
				</box>
			</Show>
			<Show when={props.scrollbar.length > 0}>
				<box
					ref={props.onTrack}
					width={1}
					flexShrink={0}
					backgroundColor={ui.bg}
					onMouseDown={(event: MouseEvent) => props.onStartScrollbarDrag(event.y)}
				>
					<For each={props.scrollbar}>
						{(filled) => (
							<text fg={filled ? ui.scrollbar : ui.bg} bg={ui.bg} content={filled ? '█' : '│'} />
						)}
					</For>
				</box>
			</Show>
		</box>
	);
}
