import { dirname } from 'node:path';

import type { KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';

import type { Config } from '../core/config';
import type { TreeNode } from '../core/fs';
import {
	bindingProblem,
	isDisabledShortcut,
	latinKey,
	matchesChord,
	parseChord,
	secondary,
} from '../core/keybindings';
import type { VimMode } from '../editor/vim';
import type { Focus, Prompt } from './types';

const chord = (key: KeyEvent) => key.shift || key.option || key.meta;

export function useAppKeyboard(deps: {
	config: Config;
	activePath: () => string | null;
	clipboard: () => { paths: string[]; mode: 'cut' | 'copy' };
	focus: () => Focus | 'gitPanel';
	help: () => boolean;
	marked: () => string[];
	notice: () => { name: string; reason: string } | null;
	overlay: () => boolean;
	peek: () => boolean;
	selectedNode: () => TreeNode | undefined;
	sidebar: () => boolean;
	vimMode: () => VimMode | null;
	activateNode: (node: TreeNode) => void;
	actionTargets: () => string[];
	closeTab: (path: string) => void;
	extendSelection: (delta: number) => void;
	focusTree: () => void;
	moveSelection: (delta: number) => void;
	nudgeSidebar: (delta: number) => void;
	paste: () => void;
	quit: () => void;
	navigateBack: () => void;
	navigateForward: () => void;
	openPathUnderCursor: () => void;
	copyPath: (path: string, kind: 'absolute' | 'relative') => void;
	reopenTab: () => void;
	saveActive: () => void;
	formatActive: () => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	setAnchor: (path: string | null) => void;
	setClipboard: (clipboard: { paths: string[]; mode: 'cut' | 'copy' }) => void;
	setFocus: (focus: Focus) => void;
	setHelp: (show: boolean) => void;
	setMarked: (paths: string[]) => void;
	setNotice: (notice: { name: string; reason: string } | null) => void;
	setPalette: (open: boolean) => void;
	setPeek: (update: (open: boolean) => boolean) => void;
	setPicker: (picker: 'files' | 'tabs' | null) => void;
	setPrompt: (prompt: Prompt) => void;
	setSearch: (search: { scope: 'file' | 'project'; replacing?: boolean } | null) => void;
	setSelectedPath: (path: string | null) => void;
	switchTab: (delta: number) => void;
	takeForPaste: (mode: 'cut' | 'copy') => void;
	targetDir: () => string;
	toggleExpand: (path: string) => void;
	toggleSidebar: () => void;
	toggleGitPanel: () => void;
	toggleReviewPanel: () => void;
	togglePluginsPanel: () => void;
	toggleMarkdown: () => void;
	previewToggle: () => void;
	previewScroll: (pages: number) => void;
	previewClose: () => void;
	previewShowing: () => boolean;
	cycleSidebarView: () => void;
	reviewNoteChooser: () => void;
	reviewReply: () => void;
	goToDefinition: () => void;
	problemsList: () => void;
	problemsAtCursor: () => void;
	problemsNext: () => void;
	problemsPrev: () => void;
	problemsRestart: () => void;
	completion: () => void;
	foldOp: (op: 'fold' | 'unfold' | 'foldAll' | 'unfoldAll') => void;
	expanded: () => Set<string>;
}) {
	const customCommands: Record<string, () => void> = {
		open: () => deps.setPicker('files'),
		save: deps.saveActive,
		'editor.format': deps.formatActive,
		'editor.fold': () => deps.foldOp('fold'),
		'editor.unfold': () => deps.foldOp('unfold'),
		'editor.foldAll': () => deps.foldOp('foldAll'),
		'editor.unfoldAll': () => deps.foldOp('unfoldAll'),
		'tabs.switch': () => deps.setPicker('tabs'),
		'navigation.back': deps.navigateBack,
		'navigation.forward': deps.navigateForward,
		'tabs.reopen': deps.reopenTab,
		goto: () => deps.setPrompt({ kind: 'gotoLine' }),
		'goto.definition': deps.goToDefinition,
		'find.file': () => deps.setSearch({ scope: 'file' }),
		'find.project': () => deps.setSearch({ scope: 'project' }),
		'find.replaceProject': () => deps.setSearch({ scope: 'project', replacing: true }),
		'file.new': () => deps.setPrompt({ kind: 'newFile', dir: deps.targetDir() }),
		'open.cursor': deps.openPathUnderCursor,
		'file.newDir': () => deps.setPrompt({ kind: 'newFolder', dir: deps.targetDir() }),
		'file.copyPath': () => {
			const path =
				deps.focus() === 'tree'
					? (deps.selectedNode()?.path ?? deps.activePath())
					: (deps.activePath() ?? deps.selectedNode()?.path);
			if (path) deps.copyPath(path, 'absolute');
			else deps.say('No file to copy the path of', 'warn');
		},
		'tabs.close': () => void (deps.activePath() && deps.closeTab(deps.activePath()!)),
		'view.sidebar': deps.toggleSidebar,
		'view.preview': deps.previewToggle,
		'view.markdown': deps.toggleMarkdown,
		'git.sourceControl': deps.toggleGitPanel,
		'view.review': deps.toggleReviewPanel,
		'view.extensions': deps.togglePluginsPanel,
		'review.note': deps.reviewNoteChooser,
		'review.reply': deps.reviewReply,
		'problems.list': deps.problemsList,
		'problems.detail': deps.problemsAtCursor,
		'problems.next': deps.problemsNext,
		'problems.prev': deps.problemsPrev,
		'problems.restart': deps.problemsRestart,
		'editor.complete': deps.completion,
		help: () => deps.setHelp(true),
		quit: deps.quit,
	};
	const customizes = (id: string) => {
		const spelling = deps.config.keybindings[id];
		if (!spelling) return false;
		if (isDisabledShortcut(spelling)) return true;
		const parsed = parseChord(spelling);
		return Boolean(parsed && !bindingProblem(parsed));
	};
	useKeyboard((key: KeyEvent) => {
		const k = latinKey(key);
		if (deps.help()) {
			if (k === 'escape') deps.setHelp(false);
			return;
		}
		if (deps.overlay()) return;
		if (deps.notice()) deps.setNotice(null);
		const claim = (run: () => void) => {
			key.preventDefault();
			run();
		};
		for (const [id, spelling] of Object.entries(deps.config.keybindings)) {
			const run = customCommands[id];
			if (isDisabledShortcut(spelling)) continue;
			const parsed = parseChord(spelling);
			if (!run || !parsed || bindingProblem(parsed) || !matchesChord(parsed, key)) continue;
			return claim(run);
		}
		if (key.ctrl && k === 'k') return claim(() => deps.setPeek((p) => !p));
		if (deps.peek()) deps.setPeek(() => false);
		if (key.ctrl && k === 'q' && !customizes('quit')) return claim(deps.quit);
		if (key.ctrl && k === 'c' && !secondary(key) && deps.focus() !== 'editor')
			return claim(deps.quit);
		// Also accepts Ctrl+Opt+P / Ctrl+Shift+P when the terminal reports the modifier.
		if (key.ctrl && k === 'p') return claim(() => deps.setPalette(true));
		if (k === 'f1') return claim(() => deps.setPalette(true));
		if (k === 'f12' && !customizes('goto.definition')) return claim(deps.goToDefinition);
		if (key.ctrl && chord(key) && k === 'o' && !customizes('open.cursor'))
			return claim(deps.openPathUnderCursor);
		if (key.ctrl && k === 'o' && !customizes('open')) return claim(() => deps.setPicker('files'));
		if (key.ctrl && chord(key) && k === 't' && !customizes('tabs.reopen'))
			return claim(deps.reopenTab);
		if (key.ctrl && chord(key) && k === 'z' && !customizes('navigation.back'))
			return claim(deps.navigateBack);
		if (key.ctrl && chord(key) && k === 'y' && !customizes('navigation.forward'))
			return claim(deps.navigateForward);
		if (key.ctrl && (k === 't' || k === 'up') && !customizes('tabs.switch'))
			return claim(() => deps.setPicker('tabs'));
		if (key.ctrl && chord(key) && k === 'g' && !customizes('git.sourceControl'))
			return claim(deps.toggleGitPanel);
		if (key.ctrl && chord(key) && k === 'r' && !customizes('view.review'))
			return claim(deps.toggleReviewPanel);
		if (key.ctrl && chord(key) && k === 'x' && !customizes('view.extensions'))
			return claim(deps.togglePluginsPanel);
		if (key.ctrl && chord(key) && k === 'a' && !customizes('review.note'))
			return claim(deps.reviewNoteChooser);
		if (key.ctrl && chord(key) && k === 'i' && !customizes('problems.detail'))
			return claim(deps.problemsAtCursor);
		if (key.ctrl && k === 'g' && !customizes('goto'))
			return claim(() => deps.setPrompt({ kind: 'gotoLine' }));
		if (key.ctrl && k === 's' && !chord(key) && !customizes('save')) return claim(deps.saveActive);
		if (key.ctrl && chord(key) && k === 's' && !customizes('editor.fold'))
			return claim(() => deps.foldOp('fold'));
		if (key.ctrl && chord(key) && k === 'e' && !customizes('editor.unfold'))
			return claim(() => deps.foldOp('unfold'));
		if (key.ctrl && chord(key) && k === 'l' && !customizes('editor.format')) {
			return claim(deps.formatActive);
		}
		const vimOwnsRedo = deps.config.vim && deps.focus() === 'editor' && deps.vimMode() !== 'insert';
		if (key.ctrl && k === 'r' && !vimOwnsRedo && !customizes('find.project'))
			return claim(() => deps.setSearch({ scope: 'project' }));
		if (key.ctrl && chord(key) && k === 'f' && !customizes('find.project'))
			return claim(() => deps.setSearch({ scope: 'project' }));
		if (key.ctrl && k === 'f' && !customizes('find.file'))
			return claim(() => deps.setSearch({ scope: 'file' }));
		if (key.ctrl && k === 'w' && !customizes('tabs.close')) {
			return claim(() => void (deps.activePath() && deps.closeTab(deps.activePath()!)));
		}
		if (key.ctrl && chord(key) && k === 'n' && !customizes('file.newDir')) {
			return claim(() => deps.setPrompt({ kind: 'newFolder', dir: deps.targetDir() }));
		}
		if (key.ctrl && chord(key) && k === 'c' && !customizes('file.copyPath')) {
			return claim(() => {
				const path =
					deps.focus() === 'tree'
						? (deps.selectedNode()?.path ?? deps.activePath())
						: (deps.activePath() ?? deps.selectedNode()?.path);
				if (path) deps.copyPath(path, 'absolute');
				else deps.say('No file to copy the path of', 'warn');
			});
		}
		if (key.ctrl && k === 'n' && !customizes('file.new'))
			return claim(() => deps.setPrompt({ kind: 'newFile', dir: deps.targetDir() }));
		if (key.ctrl && !chord(key) && k === 'b' && !customizes('view.sidebar')) {
			return claim(deps.toggleSidebar);
		}
		if (key.ctrl && chord(key) && k === 'm' && !customizes('view.markdown'))
			return claim(deps.toggleMarkdown);
		if (key.ctrl && (k === 'pageup' || k === 'left')) return claim(() => deps.switchTab(-1));
		if (key.ctrl && (k === 'pagedown' || k === 'right')) return claim(() => deps.switchTab(1));
		if (deps.focus() === 'editor') {
			const vimOwnsEscape = deps.config.vim && deps.vimMode() !== 'normal';
			if (k === 'escape' && deps.sidebar() && !vimOwnsEscape) deps.focusTree();
			return;
		}
		if (key.ctrl || key.meta || key.option) return;
		if (deps.focus() === 'gitPanel') return;
		key.preventDefault();
		const node = deps.selectedNode();
		const treeKey = deps.config.vim
			? (({ h: 'left', j: 'down', k: 'up', l: 'right' } as Record<string, string>)[k] ?? k)
			: k;
		switch (treeKey) {
			case 'tab':
				// Shift+Tab walks the tab strip above the sidebar; plain Tab keeps
				// handing the keyboard to the editor.
				if (key.shift) deps.cycleSidebarView();
				else if (deps.activePath()) deps.setFocus('editor');
				break;
			case 'up':
				if (key.shift) deps.extendSelection(-1);
				else deps.moveSelection(-1);
				break;
			case 'down':
				if (key.shift) deps.extendSelection(1);
				else deps.moveSelection(1);
				break;
			case 'right':
				if (node?.isDir && !deps.expanded().has(node.path)) deps.toggleExpand(node.path);
				else deps.moveSelection(1);
				break;
			case 'left':
				if (node?.isDir && deps.expanded().has(node.path)) deps.toggleExpand(node.path);
				else if (node) deps.setSelectedPath(dirname(node.path));
				break;
			case 'return':
			case 'enter':
				if (node && !node.isDir) deps.previewClose();
				if (node) deps.activateNode(node);
				break;
			case ' ':
			case 'space':
				deps.previewToggle();
				break;
			case 'pageup':
				if (deps.previewShowing()) deps.previewScroll(-1);
				break;
			case 'pagedown':
				if (deps.previewShowing()) deps.previewScroll(1);
				break;
			case '[':
				deps.nudgeSidebar(-2);
				break;
			case ']':
				deps.nudgeSidebar(2);
				break;
			case 'a':
				deps.setPrompt({ kind: key.shift ? 'newFolder' : 'newFile', dir: deps.targetDir() });
				break;
			case 'r':
				if (node) deps.setPrompt({ kind: 'rename', target: node.path });
				break;
			case 'x':
				deps.takeForPaste('cut');
				break;
			case 'c':
				deps.takeForPaste('copy');
				break;
			case 'p':
				deps.paste();
				break;
			case 'escape':
				if (deps.previewShowing()) deps.previewClose();
				else if (deps.clipboard().paths.length > 0) {
					const cancelled = deps.clipboard().mode === 'cut' ? 'Move' : 'Copy';
					deps.setClipboard({ paths: [], mode: 'cut' });
					deps.say(`${cancelled} cancelled`);
				} else if (deps.marked().length > 0) {
					deps.setMarked([]);
					deps.setAnchor(null);
				}
				break;
			case 'd':
			case 'delete':
			case 'backspace': {
				const targets = deps.actionTargets();
				if (targets.length > 0) deps.setPrompt({ kind: 'delete', targets });
				break;
			}
		}
	});
}
