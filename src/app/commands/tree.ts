import type { Accessor, Setter } from 'solid-js';

import type { Config } from '../../core/config';
import type { TreeNode } from '../../core/fs';
import type { AppearancePluginLoad } from '../../core/localThemes';
import type { ThemeName } from '../../themes';
import { createAppCommands } from '../appCommands';
import { summarizeAppearancePlugins } from '../appearance/reload';
import type { Command } from '../commands';
import type { Navigation } from '../navigation';
import type {
	BufferState,
	Focus,
	FoldOpRequest,
	HistoryRequest,
	LineOpRequest,
	PickerState,
	Prompt,
} from '../types';
import type { ConflictSide } from '../../core/git/conflicts';

export function createAppCommandTree(deps: {
	config: Config;
	rootDir: string;
	iconTheme: () => string;
	buffers: Record<string, BufferState>;
	activePath: Accessor<string | null>;
	cursor: Accessor<{ line: number; col: number }>;
	setPicker: Setter<PickerState>;
	openWorkspace: () => void;
	switchWorkspace: () => void;
	setPrompt: Setter<Prompt>;
	setHistory: Setter<HistoryRequest>;
	setSearch: Setter<{ scope: 'file' | 'project'; replacing?: boolean } | null>;
	setLineOp: Setter<LineOpRequest>;
	setFoldOp: Setter<FoldOpRequest>;
	resolveMergeConflict: () => void;
	acceptMergeConflict: (side: ConflictSide) => void;
	nextMergeConflict: (direction: 1 | -1) => void;
	setHelp: Setter<boolean>;
	patchConfig: (patch: Partial<Config>, scope?: 'user' | 'project') => void;
	saveActive: () => void;
	saveAll: () => void;
	saveWithoutFormatting: () => void;
	formatActive: () => void;
	formatOpenFiles: () => void;
	targetDir: () => string;
	tabs: Accessor<string[]>;
	closeTabs: (paths: string[], done: string) => void;
	actionTargets: () => string[];
	takeForPaste: (mode: 'cut' | 'copy') => void;
	copyPath: (path: string, kind: 'absolute' | 'relative') => void;
	selectedPath: Accessor<string | null>;
	paste: () => void;
	closeTab: (path: string) => void;
	reopenTab: () => void;
	switchTab: (delta: number) => void;
	focus: Accessor<Focus>;
	setFocus: Setter<Focus>;
	focusTree: () => void;
	toggleSidebar: () => void;
	collapseSidebar: () => void;
	toggleMarkdown: () => void;
	togglePreview: () => void;
	controls: {
		withNode: (run: (node: TreeNode) => void) => () => void;
		applyVim: (enabled: boolean) => void;
		applyTabSize: (size: number) => void;
		applyTheme: (name: ThemeName) => void;
		previewTheme: (name: ThemeName) => void;
		cancelThemePreview: () => void;
		applyIconTheme: (id: string) => void;
		previewIcons: (id: string) => void;
		cancelIconPreview: () => void;
		toggleDotfiles: () => void;
		toggleGitignored: () => void;
		toggleWrap: () => void;
		toggleSidebarPosition: () => void;
		toggleDiffView: () => void;
		toggleTrim: () => void;
		toggleFormat: () => void;
		toggleAutoSave: () => void;
		toggleTransparent: () => void;
	};
	openFile: (path: string) => void;
	navigation: Navigation;
	problemUi: {
		list: () => void;
		atCursor: () => void;
		next: (direction: 1 | -1) => void;
	};
	lspRestart: () => boolean;
	openLspStatus: () => void;
	completion: { show: () => void; goToDefinition: () => void };
	reviewOpen: () => void;
	pluginsOpen: () => void;
	reviewFetch: () => void;
	reviewNoteChooser: () => void;
	reviewNote: (kind: import('../../core/review').NoteKind) => void;
	reviewReply: () => void;
	reviewClear: () => void;
	gitCommands: Parameters<typeof createAppCommands>[0]['gitCommands'];
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	quit: () => void;
	openSettings: () => void;
	openProjectSettings: () => void;
	openAppearancePlugins: () => void;
	reloadAppearancePlugins: () => void;
	appearanceVersion: () => AppearancePluginLoad;
}): Accessor<Command[]> {
	return createAppCommands({
		config: deps.config,
		rootDir: deps.rootDir,
		iconTheme: deps.iconTheme,
		saveActive: deps.saveActive,
		saveAll: deps.saveAll,
		saveWithoutFormatting: deps.saveWithoutFormatting,
		formatActive: deps.formatActive,
		formatOpenFiles: deps.formatOpenFiles,
		setPicker: (kind) => deps.setPicker(kind),
		openWorkspace: deps.openWorkspace,
		switchWorkspace: deps.switchWorkspace,
		activePath: deps.activePath,
		activeLine: () =>
			deps.buffers[deps.activePath()!]?.content.split('\n')[deps.cursor().line] ?? null,
		cursor: deps.cursor,
		openResolvedFile: deps.openFile,
		navigation: deps.navigation,
		tabs: deps.tabs,
		closeTabs: deps.closeTabs,
		setPrompt: deps.setPrompt,
		setHistory: deps.setHistory,
		setSearch: deps.setSearch,
		targetDir: deps.targetDir,
		withNode: deps.controls.withNode,
		actionTargets: deps.actionTargets,
		say: deps.say,
		takeForPaste: deps.takeForPaste,
		copyPath: deps.copyPath,
		selectedPath: deps.selectedPath,
		paste: deps.paste,
		closeTab: deps.closeTab,
		reopenTab: deps.reopenTab,
		switchTab: deps.switchTab,
		focus: deps.focus,
		setFocus: deps.setFocus,
		focusTree: deps.focusTree,
		toggleSidebar: deps.toggleSidebar,
		collapseSidebar: deps.collapseSidebar,
		toggleMarkdown: deps.toggleMarkdown,
		togglePreview: deps.togglePreview,
		toggleWrap: deps.controls.toggleWrap,
		toggleSidebarPosition: deps.controls.toggleSidebarPosition,
		toggleDiffView: deps.controls.toggleDiffView,
		applyVim: deps.controls.applyVim,
		applyTabSize: deps.controls.applyTabSize,
		applyTheme: deps.controls.applyTheme,
		previewTheme: deps.controls.previewTheme,
		cancelThemePreview: deps.controls.cancelThemePreview,
		applyIconTheme: deps.controls.applyIconTheme,
		previewIcons: deps.controls.previewIcons,
		cancelIconPreview: deps.controls.cancelIconPreview,
		toggleDotfiles: deps.controls.toggleDotfiles,
		toggleGitignored: deps.controls.toggleGitignored,
		toggleTrim: deps.controls.toggleTrim,
		toggleFormat: deps.controls.toggleFormat,
		toggleAutoSave: deps.controls.toggleAutoSave,
		toggleTransparent: deps.controls.toggleTransparent,
		openSettings: deps.openSettings,
		openProjectSettings: deps.openProjectSettings,
		openAppearancePlugins: deps.openAppearancePlugins,
		listAppearancePlugins: () => deps.say(summarizeAppearancePlugins(deps.appearanceVersion())),
		reloadAppearancePlugins: deps.reloadAppearancePlugins,
		appearanceVersion: deps.appearanceVersion,
		problemsList: deps.problemUi.list,
		problemsAtCursor: deps.problemUi.atCursor,
		problemsNext: () => deps.problemUi.next(1),
		problemsPrev: () => deps.problemUi.next(-1),
		problemsRestart: () =>
			deps.say(deps.lspRestart() ? 'Restarted language servers' : 'No language servers running'),
		lspStatus: deps.openLspStatus,
		reviewOpen: deps.reviewOpen,
		pluginsOpen: deps.pluginsOpen,
		reviewFetch: deps.reviewFetch,
		reviewNoteChooser: deps.reviewNoteChooser,
		reviewNote: deps.reviewNote,
		reviewReply: deps.reviewReply,
		reviewClear: deps.reviewClear,
		completion: {
			show: deps.completion.show,
			goToDefinition: () => {
				deps.navigation.mark();
				void deps.completion.goToDefinition();
			},
		},
		setLineOp: deps.setLineOp,
		setFoldOp: deps.setFoldOp,
		resolveMergeConflict: deps.resolveMergeConflict,
		acceptMergeConflict: deps.acceptMergeConflict,
		nextMergeConflict: deps.nextMergeConflict,
		patchConfig: deps.patchConfig,
		gitCommands: deps.gitCommands,
		setHelp: deps.setHelp,
		quit: deps.quit,
	});
}
