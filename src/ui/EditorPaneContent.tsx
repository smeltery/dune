import type { TextareaRenderable } from '@opentui/core';
import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import type { LineChange } from '../core/git';
import type { ProblemSeverity } from '../lsp/protocol';
import { ui } from '../themes';
import { EditorEmptyState, EditorNotice } from './EditorEmptyState';
import { EditorPaneBody } from './EditorPaneBody';
import type { FoldNote } from './editorFolds';
import type { ProblemNote } from './editorHost';

export function EditorPaneContent(props: {
	open: boolean;
	content: string;
	focused: boolean;
	tabSize: number;
	wrap: boolean;
	notice: { name: string; reason: string } | null;
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
	completionMenu?: JSX.Element;
	onFocus: () => void;
	onDrag: (event: { y: number }) => void;
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
		<box flexGrow={1} flexDirection="column" backgroundColor={ui.bg}>
			<Show when={props.notice}>
				{(refused: () => { name: string; reason: string }) => <EditorNotice notice={refused()} />}
			</Show>
			<Show when={props.open} fallback={<EditorEmptyState />}>
				{}
				<EditorPaneBody
					content={props.content}
					focused={props.focused}
					tabSize={props.tabSize}
					wrap={props.wrap}
					editorEl={props.editorEl}
					cursorLine={props.cursorLine}
					gutterWidth={props.gutterWidth}
					changeTrack={props.changeTrack}
					problemTrack={props.problemTrack}
					problemNotes={props.problemNotes}
					foldNotes={props.foldNotes}
					foldMarkers={props.foldMarkers}
					scrollbar={props.scrollbar}
					dragging={props.dragging}
					onFocus={props.onFocus}
					onDrag={props.onDrag}
					onDragEnd={props.onDragEnd}
					onHost={props.onHost}
					onGutter={props.onGutter}
					onEditor={props.onEditor}
					onContentChange={props.onContentChange}
					onMouse={props.onMouse}
					onCursorChange={props.onCursorChange}
					onJumpTrack={props.onJumpTrack}
					onStartScrollbarDrag={props.onStartScrollbarDrag}
					onTrack={props.onTrack}
					onToggleFold={props.onToggleFold}
				/>
				{props.completionMenu}
			</Show>
		</box>
	);
}
