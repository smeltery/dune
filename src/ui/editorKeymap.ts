import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';

import { copyToClipboard, readClipboard } from '../core/clipboard';
import { capsChar, latinKey } from '../core/keybindings';
import { handleTyping } from '../editor/typing';
import { handleVimKey } from '../editor/vim';
import type { VimMode, VimState } from '../editor/vim';

export function useEditorKeymap(deps: {
	blocked: () => boolean;
	focused: () => boolean;
	vim: () => boolean;
	tabSize: () => number;
	editor: () => TextareaRenderable | undefined;
	vimState: VimState;
	renderer: { copyToClipboardOSC52: (text: string) => void };
	onChange: (text: string) => void;
	onQuit: () => void;
	onVimMode: (mode: VimMode | null) => void;
	applyWindow: (force?: boolean) => void;
	scheduleCursorSync: () => void;
	scheduleHighlight: () => void;
	setCursorBeforeEdit: (offset: number) => void;
	stepHistory: (kind: 'undo' | 'redo') => void;
	toggleCommentLines: () => void;
	moveSelectedLines: (delta: -1 | 1) => void;
	duplicateSelectedLines: (follow: boolean) => void;
	scrollPage: (delta: -1 | 1) => void;
	centerCursorLine: () => void;
	beforeEdit?: (key?: KeyEvent) => void;
}) {
	useKeyboard((key: KeyEvent) => {
		const editor = deps.editor();
		if (key.defaultPrevented || deps.blocked() || !editor || !deps.focused()) return;
		// Ahead of the textarea's own handling and everything below that reads
		// key.sequence: a terminal speaking the kitty protocol reports Caps Lock as a
		// modifier bit and sends the key's own lowercase code, so without this the lock
		// does nothing and letters type lowercase.
		if (key.capsLock && !key.ctrl && !key.meta && key.sequence) {
			key.sequence = capsChar(key.sequence, key.shift);
		}
		const k = latinKey(key);
		deps.scheduleCursorSync();
		deps.setCursorBeforeEdit(editor.cursorOffset);
		deps.beforeEdit?.(key);
		if (key.ctrl && k === 'a') {
			key.preventDefault();
			editor.selectAll();
			deps.applyWindow(true);
			return;
		}
		if (editor.hasSelection() && (!deps.vim() || deps.vimState.mode === 'insert')) {
			const typed = key.sequence;
			const printable =
				typed?.length === 1 && typed >= ' ' && typed !== '\u007F' && !key.ctrl && !key.meta;
			if (key.name === 'backspace' || key.name === 'delete' || printable) {
				key.preventDefault();
				editor.deleteSelection();
				if (printable) editor.insertText(typed!);
				deps.onChange(editor.plainText);
				deps.scheduleHighlight();
				deps.applyWindow(true);
				return;
			}
		}
		if (key.ctrl && k === 'z') {
			key.preventDefault();
			deps.stepHistory(key.shift ? 'redo' : 'undo');
			return;
		}
		if (key.ctrl && k === 'y') {
			key.preventDefault();
			deps.stepHistory('redo');
			return;
		}
		if (key.ctrl && (k === 'c' || k === 'x')) {
			key.preventDefault();
			const selected = editor.getSelectedText();
			if (!selected) {
				if (k === 'c') deps.onQuit();
				return;
			}
			copyToClipboard(selected);
			deps.renderer.copyToClipboardOSC52(selected);
			if (k === 'x') {
				editor.deleteSelection();
				deps.applyWindow(true);
			}
			return;
		}
		if (key.ctrl && k === 'v') {
			key.preventDefault();
			const text = readClipboard();
			if (text === null) return;
			editor.deleteSelection();
			editor.insertText(text);
			return;
		}
		if (key.ctrl && (k === '_' || k === '/' || k === 'l')) {
			key.preventDefault();
			deps.toggleCommentLines();
			return;
		}
		if ((key.option || key.meta) && !key.ctrl && (key.name === 'up' || key.name === 'down')) {
			key.preventDefault();
			if (key.shift) deps.duplicateSelectedLines(key.name === 'down');
			else deps.moveSelectedLines(key.name === 'up' ? -1 : 1);
			return;
		}
		if (key.name === 'pageup' || key.name === 'pagedown') {
			key.preventDefault();
			deps.scrollPage(key.name === 'pageup' ? -1 : 1);
			return;
		}
		if ((!deps.vim() || deps.vimState.mode === 'insert') && key.ctrl && (k === 'u' || k === 'd')) {
			key.preventDefault();
			deps.scrollPage(k === 'u' ? -1 : 1);
			return;
		}
		if (deps.vim() && deps.vimState.mode !== 'insert') return;
		if (handleTyping(editor, key, deps.tabSize())) key.preventDefault();
	});
	useKeyboard((key: KeyEvent) => {
		const editor = deps.editor();
		if (key.defaultPrevented || deps.blocked() || !deps.vim() || !editor || !deps.focused()) return;
		const before = deps.vimState.mode;
		const stepped = {
			undo: () => deps.stepHistory('undo'),
			redo: () => deps.stepHistory('redo'),
			centerLine: deps.centerCursorLine,
		};
		if (handleVimKey(editor, key, deps.vimState, stepped)) key.preventDefault();
		if (deps.vimState.mode !== before) deps.onVimMode(deps.vimState.mode);
	});
}
