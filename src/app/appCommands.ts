import { createMemo, createSignal } from 'solid-js';

import type { ChangeRow } from '../core/changeTree';
import type { Config } from '../core/config';
import type { AppearancePluginLoad } from '../core/localThemes';
import { loadLocalLspServers } from '../core/plugins/localLspServers';
import type { ConflictSide } from '../core/git/conflicts';
import type { FileStatus, StatusEntry } from '../core/git';
import {
	fetchCatalog,
	fetchPlugin,
	readCachedCatalog,
	updatesFor,
	writeCachedCatalog,
	writePlugin,
} from '../core/market';
import type { TreeNode } from '../core/fs';
import type { ThemeName } from '../themes';
import { buildCommands } from './commands';
import { openPathUnderCursor } from './openPathUnderCursor';
import type { Focus, FoldOpRequest, LineOpRequest, Prompt } from './types';

export function createAppCommands(deps: {
	config: Config;
	rootDir: string;
	saveActive: () => void;
	saveAll: () => void;
	saveWithoutFormatting: () => void;
	formatActive: () => void;
	formatOpenFiles: () => void;
	setPicker: (kind: 'files' | 'tabs') => void;
	activePath: () => string | null;
	activeLine: () => string | null;
	cursor: () => { line: number; col: number };
	openResolvedFile: (path: string) => void;
	navigation: { back: () => void; forward: () => void; mark: () => void };
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
	copyPath: (path: string, kind: 'absolute' | 'relative') => void;
	selectedPath: () => string | null;
	paste: () => void;
	closeTab: (path: string) => void;
	reopenTab: () => void;
	switchTab: (delta: number) => void;
	focus: () => Focus;
	setFocus: (focus: Focus) => void;
	focusTree: () => void;
	toggleSidebar: () => void;
	collapseSidebar: () => void;
	applyVim: (enabled: boolean) => void;
	applyTabSize: (size: number) => void;
	applyTheme: (name: ThemeName) => void;
	previewTheme: (name: ThemeName) => void;
	cancelThemePreview: () => void;
	toggleMarkdown: () => void;
	toggleWrap: () => void;
	toggleSidebarPosition: () => void;
	toggleDiffView: () => void;
	toggleDotfiles: () => void;
	toggleGitignored: () => void;
	toggleTrim: () => void;
	toggleFormat: () => void;
	toggleAutoSave: () => void;
	toggleTransparent: () => void;
	problemsList: () => void;
	problemsAtCursor: () => void;
	problemsNext: () => void;
	problemsPrev: () => void;
	problemsRestart: () => void;
	lspStatus: () => void;
	completion: { show: () => void; goToDefinition: () => void };
	reviewOpen: () => void;
	pluginsOpen: () => void;
	reviewFetch: () => void;
	reviewNoteChooser: () => void;
	reviewNote: (kind: import('../core/review').NoteKind) => void;
	reviewReply: () => void;
	reviewClear: () => void;
	openSettings: () => void;
	openProjectSettings: () => void;
	openAppearancePlugins: () => void;
	listAppearancePlugins: () => void;
	reloadAppearancePlugins: () => void;
	appearanceVersion: () => AppearancePluginLoad;
	setLineOp: (update: (prev: LineOpRequest) => NonNullable<LineOpRequest>) => void;
	setFoldOp: (update: (prev: FoldOpRequest) => NonNullable<FoldOpRequest>) => void;
	resolveMergeConflict: () => void;
	acceptMergeConflict: (side: ConflictSide) => void;
	nextMergeConflict: (direction: 1 | -1) => void;
	patchConfig: (patch: Partial<Config>) => void;
	gitCommands: {
		openCommitPicker: (variant?: 'plain' | 'push' | 'sync') => void;
		promptAmend: () => void;
		sourceControl: () => void;
		openDiff: (path?: string | null) => void;
		promptDiscard: (path: string, status?: FileStatus) => void;
		openFileHistory: (path: string) => void;
		openBranchComparison: () => void;
		openBranchCommitComparison: () => void;
		openDiffBasePicker: () => void;
		resetDiffBase: () => void;
		openBranchSwitch: () => void;
		openBranchPrompt: () => void;
		openBranchFrom: () => void;
		openBranchMerge: () => void;
		openBranchRename: () => void;
		openBranchDelete: () => void;
		openBranchForceDelete: () => void;
		confirmUndoCommit: () => void;
		stash: () => void;
		stashPop: () => void;
		openStashList: () => void;
		openTagCreate: () => void;
		openTagDelete: () => void;
		openRemoteAdd: () => void;
		openRemoteRemove: () => void;
		fetch: () => void;
		pull: () => void;
		push: () => void;
		sync: () => void;
		toggleStage: (entries: Map<string, StatusEntry>, row: ChangeRow) => void;
		toggleStageActiveFile: () => void;
	};
	setHelp: (show: boolean) => void;
	quit: () => void;
}) {
	const [marketVersion, setMarketVersion] = createSignal(0);
	const checkAppearanceMarket = async () => {
		const catalog = await fetchCatalog(deps.config.pluginRegistry);
		if (!catalog) return deps.say('Could not reach plugin market', 'warn');
		writeCachedCatalog(catalog, Date.now());
		setMarketVersion((version) => version + 1);
		deps.say(`Plugin market: ${catalog.length} plugin${catalog.length === 1 ? '' : 's'}`);
	};
	const installAppearancePluginById = async (id: string) => {
		const fetched = await fetchPlugin(id, { registry: deps.config.pluginRegistry });
		if (!fetched.ok) return deps.say(`Plugin ${id}: ${fetched.error}`, 'error');
		const error = writePlugin(id, fetched);
		if (error) return deps.say(`Could not install ${id}: ${error}`, 'error');
		deps.reloadAppearancePlugins();
		deps.say(`Installed plugin ${id} ${fetched.version}`);
	};
	const checkAppearanceUpdates = async () => {
		const installed = deps.appearanceVersion().plugins;
		if (installed.length === 0) return deps.say('No local plugins');
		const catalog = await fetchCatalog(deps.config.pluginRegistry);
		if (!catalog) return deps.say('Could not reach plugin market', 'warn');
		writeCachedCatalog(catalog, Date.now());
		const updates = updatesFor(installed, catalog);
		if (updates.length === 0) return deps.say('Plugins are up to date');
		deps.say(`Plugin updates: ${updates.map((entry) => entry.id).join(', ')}`);
	};
	const updateAppearancePlugins = async () => {
		const installed = deps.appearanceVersion().plugins;
		if (installed.length === 0) return deps.say('No local plugins');
		const catalog = await fetchCatalog(deps.config.pluginRegistry);
		if (!catalog) return deps.say('Could not reach plugin market', 'warn');
		writeCachedCatalog(catalog, Date.now());
		const updates = updatesFor(installed, catalog);
		if (updates.length === 0) return deps.say('Plugins are up to date');
		const results = await Promise.all(
			updates.map(async (entry) => {
				const fetched = await fetchPlugin(entry.id, { registry: deps.config.pluginRegistry });
				const error = fetched.ok ? writePlugin(entry.id, fetched) : fetched.error;
				return { id: entry.id, ok: !error };
			}),
		);
		const updated = results.filter((result) => result.ok).length;
		const failed = results.filter((result) => !result.ok).map((result) => result.id);
		if (failed.length > 0) deps.say(`Could not update ${failed.join(', ')}`, 'error');
		if (updated > 0) {
			deps.reloadAppearancePlugins();
			deps.say(`Updated ${updated} plugin${updated === 1 ? '' : 's'}`);
		}
	};
	const toggleAppearancePlugin = (id: string) => {
		const disabled = deps.config.disabledAppearancePlugins;
		const off = disabled.includes(id);
		const next = off ? disabled.filter((entry) => entry !== id) : [...disabled, id];
		deps.patchConfig({ disabledAppearancePlugins: next });
		deps.reloadAppearancePlugins();
		deps.say(`Plugin ${id} ${off ? 'enabled' : 'disabled'}`);
	};
	const withCopyTarget = (run: (path: string) => void) => {
		const path =
			deps.focus() === 'tree'
				? (deps.selectedPath() ?? deps.activePath())
				: (deps.activePath() ?? deps.selectedPath());
		if (path) run(path);
		else deps.say('No file to copy the path of', 'warn');
	};

	return createMemo(() => {
		void deps.appearanceVersion();
		void marketVersion();
		return buildCommands(
			{
				save: deps.saveActive,
				saveAll: deps.saveAll,
				saveWithoutFormatting: deps.saveWithoutFormatting,
				formatActive: deps.formatActive,
				formatOpenFiles: deps.formatOpenFiles,
				openFile: () => deps.setPicker('files'),
				openPathUnderCursor: () =>
					openPathUnderCursor({
						activePath: deps.activePath,
						activeLine: deps.activeLine,
						cursorCol: () => deps.cursor().col,
						rootDir: deps.targetDir,
						openResolvedFile: deps.openResolvedFile,
						markNavigation: deps.navigation.mark,
						goToDefinition: () => void deps.completion.goToDefinition(),
						say: deps.say,
					}),
				navigateBack: deps.navigation.back,
				navigateForward: deps.navigation.forward,
				switchTab: () => deps.setPicker('tabs'),
				closeOthers: () => {
					const keep = deps.activePath();
					if (keep)
						deps.closeTabs(
							deps.tabs().filter((path) => path !== keep),
							'Closed other tabs',
						);
				},
				closeAll: () => deps.closeTabs(deps.tabs(), 'Closed all tabs'),
				gotoLine: () => deps.setPrompt({ kind: 'gotoLine' }),
				undo: () => deps.setHistory((prev) => ({ kind: 'undo', key: (prev?.key ?? 0) + 1 })),
				redo: () => deps.setHistory((prev) => ({ kind: 'redo', key: (prev?.key ?? 0) + 1 })),
				findInFile: () => deps.setSearch({ scope: 'file' }),
				findInProject: () => deps.setSearch({ scope: 'project' }),
				replaceInFile: () => deps.setSearch({ scope: 'file', replacing: true }),
				replaceInProject: () => deps.setSearch({ scope: 'project', replacing: true }),
				newFile: () => deps.setPrompt({ kind: 'newFile', dir: deps.targetDir() }),
				newFolder: () => deps.setPrompt({ kind: 'newFolder', dir: deps.targetDir() }),
				rename: deps.withNode((n) => deps.setPrompt({ kind: 'rename', target: n.path })),
				remove: () => {
					const targets = deps.actionTargets();
					if (targets.length === 0) return deps.say('Nothing selected', 'warn');
					deps.setPrompt({ kind: 'delete', targets });
				},
				cutForMove: () => deps.takeForPaste('cut'),
				copyForPaste: () => deps.takeForPaste('copy'),
				copyPath: () => withCopyTarget((path) => deps.copyPath(path, 'absolute')),
				copyRelativePath: () => withCopyTarget((path) => deps.copyPath(path, 'relative')),
				paste: deps.paste,
				closeTab: () => void (deps.activePath() && deps.closeTab(deps.activePath()!)),
				reopenTab: deps.reopenTab,
				nextTab: () => deps.switchTab(1),
				prevTab: () => deps.switchTab(-1),
				toggleFocus: () => (deps.focus() === 'tree' ? deps.setFocus('editor') : deps.focusTree()),
				toggleSidebar: deps.toggleSidebar,
				collapseSidebar: deps.collapseSidebar,
				toggleMarkdown: deps.toggleMarkdown,
				toggleWrap: deps.toggleWrap,
				toggleSidebarPosition: deps.toggleSidebarPosition,
				toggleDiffView: deps.toggleDiffView,
				toggleDotfiles: deps.toggleDotfiles,
				toggleGitignored: deps.toggleGitignored,
				openSettings: deps.openSettings,
				openProjectSettings: deps.openProjectSettings,
				openAppearancePlugins: deps.openAppearancePlugins,
				listAppearancePlugins: deps.listAppearancePlugins,
				checkAppearanceMarket,
				checkAppearanceUpdates,
				updateAppearancePlugins,
				installAppearancePlugin: () => deps.setPrompt({ kind: 'appearancePluginId' }),
				installAppearancePluginById: (id) => void installAppearancePluginById(id),
				toggleAppearancePlugin,
				removeAppearancePlugin: () => deps.setPrompt({ kind: 'appearancePluginRemoveId' }),
				setVim: deps.applyVim,
				setTabSize: deps.applyTabSize,
				setTheme: deps.applyTheme,
				previewTheme: deps.previewTheme,
				cancelThemePreview: deps.cancelThemePreview,
				lineOp: (op) => deps.setLineOp((prev) => ({ op, key: (prev?.key ?? 0) + 1 })),
				foldOp: (op) => deps.setFoldOp((prev) => ({ op, key: (prev?.key ?? 0) + 1 })),
				resolveMergeConflict: deps.resolveMergeConflict,
				acceptCurrentChange: () => deps.acceptMergeConflict('ours'),
				acceptIncomingChange: () => deps.acceptMergeConflict('theirs'),
				acceptBothChanges: () => deps.acceptMergeConflict('both'),
				nextMergeConflict: () => deps.nextMergeConflict(1),
				prevMergeConflict: () => deps.nextMergeConflict(-1),
				toggleTrim: deps.toggleTrim,
				toggleFormat: deps.toggleFormat,
				toggleAutoSave: deps.toggleAutoSave,
				toggleTransparent: deps.toggleTransparent,
				reloadAppearancePlugins: deps.reloadAppearancePlugins,
				problemsList: deps.problemsList,
				problemsAtCursor: deps.problemsAtCursor,
				problemsNext: deps.problemsNext,
				problemsPrev: deps.problemsPrev,
				problemsRestart: deps.problemsRestart,
				lspStatus: deps.lspStatus,
				completion: deps.completion.show,
				goToDefinition: deps.completion.goToDefinition,
				reviewOpen: deps.reviewOpen,
				pluginsOpen: deps.pluginsOpen,
				reviewFetch: deps.reviewFetch,
				reviewNoteChooser: deps.reviewNoteChooser,
				reviewNote: deps.reviewNote,
				reviewReply: deps.reviewReply,
				reviewClear: deps.reviewClear,
				commit: deps.gitCommands.openCommitPicker,
				commitPush: () => deps.gitCommands.openCommitPicker('push'),
				commitSync: () => deps.gitCommands.openCommitPicker('sync'),
				commitAmend: deps.gitCommands.promptAmend,
				sourceControl: deps.gitCommands.sourceControl,
				gitStage: deps.gitCommands.toggleStageActiveFile,
				diffCurrent: () => deps.gitCommands.openDiff(deps.activePath()),
				discardCurrent: () => {
					const path = deps.activePath();
					if (path) deps.gitCommands.promptDiscard(path);
					else deps.say('No file open', 'warn');
				},
				fileHistory: () => {
					const path = deps.activePath();
					if (path) deps.gitCommands.openFileHistory(path);
					else deps.say('No file open', 'warn');
				},
				diffAll: () => deps.gitCommands.openDiff(),
				compareBranches: deps.gitCommands.openBranchComparison,
				compareBranchCommits: deps.gitCommands.openBranchCommitComparison,
				compareAgainstBranch: deps.gitCommands.openDiffBasePicker,
				compareAgainstHead: deps.gitCommands.resetDiffBase,
				switchBranch: deps.gitCommands.openBranchSwitch,
				newBranch: deps.gitCommands.openBranchPrompt,
				newBranchFrom: deps.gitCommands.openBranchFrom,
				mergeBranch: deps.gitCommands.openBranchMerge,
				renameBranch: deps.gitCommands.openBranchRename,
				deleteBranch: deps.gitCommands.openBranchDelete,
				forceDeleteBranch: deps.gitCommands.openBranchForceDelete,
				undoCommit: deps.gitCommands.confirmUndoCommit,
				stash: deps.gitCommands.stash,
				stashPop: deps.gitCommands.stashPop,
				stashList: deps.gitCommands.openStashList,
				newTag: deps.gitCommands.openTagCreate,
				deleteTag: deps.gitCommands.openTagDelete,
				addRemote: deps.gitCommands.openRemoteAdd,
				removeRemote: deps.gitCommands.openRemoteRemove,
				fetch: deps.gitCommands.fetch,
				pull: deps.gitCommands.pull,
				push: deps.gitCommands.push,
				sync: deps.gitCommands.sync,
				showHelp: () => deps.setHelp(true),
				quit: deps.quit,
			},
			{
				vimEnabled: deps.config.vim,
				activeTheme: deps.config.theme,
				tabSize: deps.config.tabSize,
				wrap: deps.config.wrap,
				trimOnSave: deps.config.trimOnSave,
				formatOnSave: deps.config.formatOnSave,
				autoSaveOnBlur: deps.config.autoSaveOnBlur,
				showDotfiles: deps.config.showDotfiles,
				respectGitignore: deps.config.respectGitignore,
				marketPlugins: readCachedCatalog()?.plugins ?? [],
				installedPlugins: [
					...deps.appearanceVersion().plugins,
					...loadLocalLspServers(deps.rootDir).plugins.filter(
						(plugin) => !deps.appearanceVersion().plugins.some((entry) => entry.id === plugin.id),
					),
				],
			},
		);
	});
}
