import { basename } from 'node:path';

import { createMemo } from 'solid-js';

import type { Config } from '../core/config';
import type { TreeNode } from '../core/fs';
import { invalidateSyntaxStyle } from '../languages/highlight';
import { setTheme, setTransparency, themeLabels } from '../themes';
import type { ThemeName } from '../themes';
import { confirmationForPrompt } from './confirmation';
import { createAppCommands } from './appCommands';
import { promptTitleFor } from './prompts';
import type { Focus, LineOpRequest, Prompt } from './types';

function previewTheme(name: ThemeName) {
	setTheme(name);
	invalidateSyntaxStyle();
}

export function createAppControls(deps: {
	config: Config;
	configScope: () => 'user' | 'project';
	currentAppearance: () => 'dark' | 'light' | null;
	prompt: () => Prompt;
	selectedNode: () => TreeNode | undefined;
	setVimMode: (mode: 'normal' | null) => void;
	setPrompt: (prompt: Prompt) => void;
	patchConfig: (patch: Partial<Config>, scope?: 'user' | 'project') => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
}) {
	const patch = (change: Partial<Config>) => deps.patchConfig(change, deps.configScope());
	const applyTheme = (name: ThemeName) => {
		setTheme(name);
		invalidateSyntaxStyle();
		patch({ theme: name, themeSync: false });
		deps.say(`Theme: ${themeLabels[name]}`);
	};
	const cancelThemePreview = () => {
		setTheme(deps.config.theme);
		invalidateSyntaxStyle();
	};
	const applyThemeSlot = (slot: 'themeLight' | 'themeDark', name: ThemeName) => {
		const appearance = deps.currentAppearance();
		const active =
			deps.config.themeSync && appearance === (slot === 'themeDark' ? 'dark' : 'light');
		if (active) {
			setTheme(name);
			invalidateSyntaxStyle();
		}
		patch(active ? { [slot]: name, theme: name } : { [slot]: name });
		deps.say(`${slot === 'themeDark' ? 'Dark' : 'Light'} theme: ${themeLabels[name]}`);
	};
	const toggleThemeSync = () => {
		const next = !deps.config.themeSync;
		const appearance = deps.currentAppearance();
		const theme =
			next && appearance
				? deps.config[appearance === 'dark' ? 'themeDark' : 'themeLight']
				: deps.config.theme;
		setTheme(theme);
		invalidateSyntaxStyle();
		patch({ theme, themeSync: next });
		deps.say(next ? 'Following OS appearance' : 'Theme sync off');
	};
	const applyTabSize = (size: number) => {
		patch({ tabSize: size });
		deps.say(`Tab size: ${size}`);
	};
	const applyVim = (enabled: boolean) => {
		deps.setVimMode(enabled ? 'normal' : null);
		patch({ vim: enabled });
		deps.say(`Vim mode ${enabled ? 'on' : 'off'}`);
	};
	const toggleWrap = () => {
		patch({ wrap: !deps.config.wrap });
		deps.say(`Word wrap ${deps.config.wrap ? 'off' : 'on'}`);
	};
	const toggleDotfiles = () => {
		patch({ showDotfiles: !deps.config.showDotfiles });
		deps.say(`Dotfiles ${deps.config.showDotfiles ? 'shown' : 'hidden'}`);
	};
	const toggleGitignored = () => {
		patch({ respectGitignore: !deps.config.respectGitignore });
		deps.say(`Gitignored files ${deps.config.respectGitignore ? 'hidden' : 'shown'}`);
	};
	const toggleTrim = () => {
		patch({ trimOnSave: !deps.config.trimOnSave });
		deps.say(`Trim on save ${deps.config.trimOnSave ? 'on' : 'off'}`);
	};
	const toggleFormat = () => {
		patch({ formatOnSave: !deps.config.formatOnSave });
		deps.say(`Format on save ${deps.config.formatOnSave ? 'on' : 'off'}`);
	};
	const editFormatter = () => deps.setPrompt({ kind: 'formatterCommand' });
	const editLspServer = () => deps.setPrompt({ kind: 'lspServerCommand' });
	const editTypescriptTsdk = () => deps.setPrompt({ kind: 'typescriptTsdk' });
	const editKeybinding = () => deps.setPrompt({ kind: 'keybindingCommand' });
	const editSidebarWidth = () => deps.setPrompt({ kind: 'sidebarWidth' });
	const toggleAutoSave = () => {
		patch({ autoSaveOnBlur: !deps.config.autoSaveOnBlur });
		deps.say(`Auto-save on blur ${deps.config.autoSaveOnBlur ? 'on' : 'off'}`);
	};
	const toggleTransparent = () => {
		const next = !deps.config.transparent;
		setTransparency(next);
		patch({ transparent: next });
		deps.say(`Transparent background ${next ? 'on' : 'off'}`);
	};
	const toggleSidebarPosition = () => {
		const next = deps.config.sidebarPosition === 'left' ? 'right' : 'left';
		patch({ sidebarPosition: next });
		deps.say(`Sidebar position: ${next}`);
	};
	const toggleDiffView = () => {
		const next = deps.config.diffView === 'inline' ? 'split' : 'inline';
		patch({ diffView: next });
		deps.say(`Diff layout: ${next === 'inline' ? 'inline' : 'side-by-side'}`);
	};
	const withNode = (run: (node: TreeNode) => void) => () => {
		const node = deps.selectedNode();
		if (node) run(node);
		else deps.say('Select a file in the tree first', 'warn');
	};
	const promptTitle = () => promptTitleFor(deps.prompt());
	const promptValue = () => {
		const p = deps.prompt();
		if (p?.kind === 'rename') return basename(p.target);
		if (p?.kind === 'renameBranch') return p.from;
		if (p?.kind === 'commitAmend') return p.subject;
		return '';
	};
	const confirmation = createMemo(() => confirmationForPrompt(deps.prompt()));
	return {
		applyTheme,
		applyThemeSlot,
		previewTheme,
		cancelThemePreview,
		applyTabSize,
		applyVim,
		confirmation,
		editFormatter,
		editLspServer,
		editTypescriptTsdk,
		editKeybinding,
		editSidebarWidth,
		promptTitle,
		promptValue,
		toggleDotfiles,
		toggleGitignored,
		toggleWrap,
		toggleFormat,
		toggleTrim,
		toggleAutoSave,
		toggleThemeSync,
		toggleTransparent,
		toggleSidebarPosition,
		toggleDiffView,
		withNode,
	};
}

export type AppCommandDeps = {
	config: Config;
	saveActive: () => void;
	setPicker: (kind: 'files' | 'tabs') => void;
	activePath: () => string | null;
	tabs: () => string[];
	closeTabs: (paths: string[], done: string) => void;
	setPrompt: (prompt: Prompt) => void;
	setHistory: (
		update: (prev: { kind: 'undo' | 'redo'; key: number } | null) => {
			kind: 'undo' | 'redo';
			key: number;
		},
	) => void;
	setSearch: (search: { scope: 'file' | 'project'; replacing?: boolean }) => void;
	targetDir: () => string;
	withNode: (run: (node: TreeNode) => void) => () => void;
	actionTargets: () => string[];
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	takeForPaste: (mode: 'cut' | 'copy') => void;
	paste: () => void;
	closeTab: (path: string) => void;
	reopenTab: () => void;
	switchTab: (delta: number) => void;
	focus: () => Focus;
	setFocus: (focus: Focus) => void;
	focusTree: () => void;
	toggleSidebar: () => void;
	applyVim: (enabled: boolean) => void;
	applyTabSize: (size: number) => void;
	applyTheme: (name: ThemeName) => void;
	toggleThemeSync: () => void;
	editFormatter: () => void;
	editKeybinding: () => void;
	editSidebarWidth: () => void;
	setLineOp: (update: (prev: LineOpRequest) => NonNullable<LineOpRequest>) => void;
	patchConfig: (patch: Partial<Config>) => void;
	toggleFormat: () => void;
	gitCommands: Parameters<typeof createAppCommands>[0]['gitCommands'];
	setHelp: (show: boolean) => void;
	quit: () => void;
};
