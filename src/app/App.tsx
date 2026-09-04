import { useRenderer, useTerminalDimensions } from '@opentui/solid';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { resolvedTheme, type Config } from '../core/config';
import { flattenVisible } from '../core/fs';
import {
	currentBranch,
	type FileStatus,
	type LineChange,
	type StatusEntry,
	type Upstream,
} from '../core/git';
import { shortenHome } from '../core/workspaces';
import { parseReviewKind, reviewLineTarget, reviewNotePrompt } from './reviewPrompts';
import { discoverRepos, repoOf } from '../core/vcs/repos';
import { invalidateSyntaxStyle } from '../languages/highlight';
import { setTheme } from '../themes';
import type { VimMode } from '../editor/vim';
import { createAppControls } from './appControls';
import { AppView } from './AppView';
import { createAppearanceControllers } from './appearance/controllers';
import { reloadAppearancePlugins as reloadPlugins } from './appearance/reload';
import { prepareStartup } from './appearance/startup';
import { createAppCommandTree } from './commands/tree';
import { READY } from './constants';
import { createDocumentActions } from './documentActions';
import { createFileActions } from './fileActions';
import { createGitCommands } from './gitCommands';
import { useAppKeyboard } from './keyboard';
import { startupOpen, useAppLifecycle } from './lifecycle';
import { createPreview } from './preview';
import { nextSidebarView, type SidebarView } from './panes';
import { problemFrom, wireAppLspEffects } from './lsp/index';
import { createCompletionActions } from './lsp/completionActions';
import { createDuneAppLsp } from './lsp/pluginSuggestion';
import { createProblemUi, type ProblemsScope } from './lsp/view';
import { createMarkdownView } from './markdown/view';
import { createMergeConflictActions } from './commands/mergeConflicts';
import { createNavigation } from './navigation';
import { createFileOpener } from './openFile';
import { openPathUnderCursor as openPathUnderCursorAction } from './openPathUnderCursor';
import { createOverlayOpen } from './overlayState';
import { createAppRuntime, selectedSingleLineText } from './runtime';
import { createReplacementHandlers } from './searchReplace';
import { createReview } from './review';
import { createAppSettingRows } from './settings/view';
import { createSidebarSizing } from './sidebarSizing';
import { editedBuffer } from './state/buffers';
import { createComparison } from './state/comparison';
import { createTreeSelection } from './treeSelection';
import { hiddenTreeNodes as hiddenNodes } from './treeVisibility';
import { createWorkspaces } from './workspaces';
import type * as AppTypes from './types';
export function App(props: AppTypes.AppProps) {
	const renderer = useRenderer();
	const dimensions = useTerminalDimensions();
	const startup = prepareStartup(props);
	const { rootDir, restored, pluginStatus, initialConfig, initialAppearance } = startup;
	const [appearancePlugins, setAppearancePlugins] = createSignal(startup.appearancePlugins);
	const [lspServers, setLspServers] = createSignal(startup.lspServers);
	const [userConfig, setUserConfig] = createStore<Config>({ ...props.initialConfig });
	const [projectConfig, setProjectConfig] = createStore<Partial<Config>>(props.projectConfig ?? {});
	const [config, setConfig] = createStore<Config>(initialConfig);
	const [buffers, setBuffers] = createStore<Record<string, AppTypes.BufferState>>(restored.buffers);
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set(restored.expanded));
	const [selectedPath, setSelectedPath] = createSignal<string | null>(restored.activePath);
	const [marked, setMarked] = createSignal<string[]>([]);
	const [anchor, setAnchor] = createSignal<string | null>(null);
	const [notice, setNotice] = createSignal<{ name: string; reason: string } | null>(null);
	const [tabs, setTabs] = createSignal<string[]>(restored.tabs);
	const [activePath, setActivePath] = createSignal<string | null>(restored.activePath);
	const [previewPath, setPreviewPath] = createSignal<string | null>(null);
	const [iconPreview, setIconPreview] = createSignal<string | null>(null);
	const activeIconTheme = () => iconPreview() ?? config.iconTheme;
	const [renderedMarkdown, setRenderedMarkdown] = createSignal<string[]>([]);
	const [sidebar, setSidebar] = createSignal(restored.sidebar);
	const [focus, setFocus] = createSignal<AppTypes.Focus>(restored.sidebar ? 'tree' : 'editor');
	const [prompt, setPrompt] = createSignal<AppTypes.Prompt>(null);
	const [help, setHelp] = createSignal(false),
		[peek, setPeek] = createSignal(false),
		[palette, setPalette] = createSignal(false);
	const [settingsPage, setSettingsPage] = createSignal<'user' | 'project' | null>(null);
	const [lspStatusOpen, setLspStatusOpen] = createSignal(false);
	const [appearance, setAppearance] = createSignal<'dark' | 'light' | null>(initialAppearance);
	const [vimMode, setVimMode] = createSignal<VimMode | null>(initialConfig.vim ? 'normal' : null);
	const [reloadKey, setReloadKey] = createSignal(0);
	const [conflict, setConflict] = createSignal<AppTypes.Conflict | null>(null);
	const [search, setSearch] = createSignal<AppTypes.SearchState>(null);
	const [problemsOpen, setProblemsOpen] = createSignal<ProblemsScope | false>(false);
	const [picker, setPicker] = createSignal<AppTypes.PickerState>(null);
	const [clipboard, setClipboard] = createSignal({ paths: [] as string[], mode: 'cut' as const });
	const cut = () => (clipboard().mode === 'cut' ? clipboard().paths : []);
	const [update, setUpdate] = createSignal<{ current: string; latest: string } | null>(null);
	const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map());
	const [gitRevision, setGitRevision] = createSignal(0);
	const [gitStatus, setGitStatus] = createSignal<Map<string, FileStatus>>(new Map());
	const [gitStatusEntries, setGitStatusEntries] = createSignal<Map<string, StatusEntry>>(new Map());
	const [gitIgnored, setGitIgnored] = createSignal<Set<string>>(new Set());
	const [branch, setBranch] = createSignal(currentBranch(rootDir));
	const [diffBase, setDiffBase] = createSignal<string | null>(null);
	const [upstream, setUpstream] = createSignal<Upstream | null>(null);
	const [sidebarView, setSidebarView] = createSignal<SidebarView>('files');
	const [resizing, setResizing] = createSignal(false);
	const [history, setHistory] = createSignal<AppTypes.HistoryRequest>(null);
	const [goto, setGoto] = createSignal<AppTypes.GotoRequest>(null);
	const [edit, setEdit] = createSignal<AppTypes.EditRequest>(null);
	const [lineOp, setLineOp] = createSignal<AppTypes.LineOpRequest>(null);
	const [foldOp, setFoldOp] = createSignal<AppTypes.FoldOpRequest>(null);
	const [recentlyClosed, setRecentlyClosed] = createSignal<string[]>([]);
	const [cursor, setCursor] = createSignal({ line: 0, col: 0 });
	const [busy, setBusy] = createSignal<AppTypes.BusyState>(null);
	const [status, setStatus] = createSignal<AppTypes.StatusMessage>(
		props.notice
			? { msg: props.notice, tone: 'info' }
			: (pluginStatus ?? { msg: READY, tone: 'info' }),
	);
	const nodes = createMemo(() => flattenVisible(rootDir, expanded(), hiddenNodes(rootDir, config)));
	const activeBuffer = () => (activePath() ? buffers[activePath()!] : undefined);
	const { patchConfig, quit, say, whileFree } = createAppRuntime({
		buffers,
		busy,
		rootDir,
		userConfig,
		projectConfig,
		config,
		renderer,
		setConfig,
		setUserConfig,
		setProjectConfig,
		setPrompt,
		setStatus,
	});
	const refreshTree = () => setExpanded((prev) => new Set(prev));
	const reloadUi = () =>
		reloadPlugins({ rootDir, config, setAppearancePlugins, setLspServers, lsp, say });
	const { ui: appearancePluginUi, panel: plugins } = createAppearanceControllers({
		rootDir,
		config,
		appearance: appearancePlugins,
		patchConfig: (patch) => patchConfig(patch, settingsPage() ?? 'user'),
		editRegistry: () =>
			setPrompt({ kind: 'appearancePluginRegistry', current: config.pluginRegistry }),
		reload: reloadUi,
		say,
		prompt,
		setPrompt,
	});
	const { renderedMarkdownPath, toggleMarkdown } = createMarkdownView({
		activePath,
		renderedMarkdown,
		setRenderedMarkdown,
		setFocus,
		say,
	});
	const lsp = createDuneAppLsp({ rootDir, config, say, setPrompt, servers: lspServers });
	wireAppLspEffects({ lsp, config, tabs, buffers });
	const expand = (path: string) => setExpanded((prev) => new Set(prev).add(path));
	const discardBuffer = (path: string) => setBuffers(produce((draft) => void delete draft[path]));
	const toggleExpand = (path: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (!next.delete(path)) next.add(path);
			return next;
		});
	const saveDirtyPathsRef = { run: (_paths: string[]) => {} };
	const { collapseAll, extendSelection, focusTree, moveSelection, reveal, toggleSidebar } =
		createTreeSelection({
			rootDir,
			nodes,
			sidebar,
			selectedPath,
			anchor,
			setExpanded,
			setSelectedPath,
			setMarked,
			setAnchor,
			setSidebar,
			setFocus,
		});
	const { openFile, pinTab } = createFileOpener({
		activePath,
		buffers,
		config,
		discardBuffer,
		previewPath,
		reveal,
		saveDirtyPathsRef,
		setActivePath,
		setBuffers,
		setFocus,
		setNotice,
		setPreviewPath,
		setSelectedPath,
		setTabs,
	});
	const fileActions = createFileActions({
		rootDir,
		buffers,
		nodes,
		tabs,
		activePath,
		previewPath,
		recentlyClosed,
		clipboard,
		marked,
		selectedPath,
		sidebar,
		setBuffers,
		setTabs,
		setActivePath,
		setPreviewPath,
		setSelectedPath,
		setExpanded,
		setMarked,
		setAnchor,
		setClipboard,
		setRecentlyClosed,
		setPrompt,
		setBusy,
		say,
		whileFree,
		renderer,
		refreshTree,
		expand,
		discardBuffer,
		focusTree,
		openFile,
		toggleExpand,
	});
	const {
		actionTargets,
		activateNode,
		closeTab,
		closeTabs,
		movePath,
		paste,
		reopenTab,
		selectedNode,
		switchTab,
		takeForPaste,
		targetDir,
	} = fileActions;
	const preview = createPreview({
		sidebar,
		focus: () => (sidebarView() !== 'files' || comparison.active() ? 'gitPanel' : focus()),
		selectedNode: () => {
			const node = selectedNode();
			return node ? { path: node.path, isDir: node.isDir } : null;
		},
	});
	const pushEdit = (content: string) => setEdit((prev) => ({ content, key: (prev?.key ?? 0) + 1 }));
	const applyReplacement = (path: string, next: string) => (
		pinTab(path),
		setBuffers(path, editedBuffer(buffers[path] ?? { saved: '', mtime: 0 }, next)),
		pushEdit(next)
	);
	const applyBufferReplacement = (path: string, next: string) => {
		pinTab(path);
		setBuffers(path, editedBuffer(buffers[path] ?? { saved: '', mtime: 0 }, next));
		if (path === activePath()) pushEdit(next);
	};
	const mergeConflicts = createMergeConflictActions({
		activePath,
		activeBuffer,
		cursor,
		applyBufferReplacement,
		setFocus,
		setGoto,
		say,
	});
	const jumpTo = (match: { path: string | null; line: number; col: number }) => {
		setSearch(null);
		if (match.path && match.path !== activePath()) openFile(match.path);
		setGoto((prev) => ({ line: match.line, col: match.col, key: (prev?.key ?? 0) + 1 }));
		setFocus('editor');
	};
	const problemUi = createProblemUi({
		rootDir,
		problems: lsp.problems,
		tabs,
		activePath,
		cursor,
		problemsOpen,
		setProblemsOpen,
		setGoto,
		setFocus,
		openFile,
		say,
		nextFrom: problemFrom,
	});
	const completion = createCompletionActions(
		activePath,
		config,
		cursor,
		lsp,
		openFile,
		setFocus,
		setGoto,
		say,
	);
	const navigation = createNavigation({ activePath, cursor, openFile, setFocus, setGoto, say });
	const goToDefinition = () => (navigation.mark(), void completion.goToDefinition());
	const openPathUnderCursor = () => {
		openPathUnderCursorAction({
			activePath,
			activeLine: () => {
				const path = activePath();
				return path ? (buffers[path]?.content.split('\n')[cursor().line] ?? null) : null;
			},
			cursorCol: () => cursor().col,
			rootDir: targetDir,
			openResolvedFile: openFile,
			markNavigation: navigation.mark,
			goToDefinition: () => void completion.goToDefinition(),
			say,
		});
	};
	const gitCommands = createGitCommands({
		rootDir,
		gitScanDepth: () => config.gitScanDepth,
		activePath,
		branch,
		diffBase,
		statusEntries: gitStatusEntries,
		upstream,
		setDiffBase,
		setBusy,
		setGitRevision,
		setPrompt,
		say,
		whileFree,
		syncFromDisk: () => documentActions.syncFromDisk(),
		showView: (view: SidebarView) => showView(view),
	});
	/**
	 * The changes page is a snapshot, so anything that moves the repository has to
	 * push it back: a commit made from the panel, a save picked up by the watcher, a
	 * stage from the page itself. `reloadKey` is in the key because a reload is what
	 * turns an edit on disk into new text to diff against.
	 */
	// Keyed on the status map itself, not on the revisions that produce it: the scan
	// is a fresh Map every time, and waiting for it is what guarantees this reads
	// the status the panel is already showing rather than the one before it.
	createEffect(on(gitStatusEntries, () => gitCommands.refreshChanges(), { defer: true }));
	const activeRepo = () => {
		const path = activePath();
		if (path) return repoOf(path, discoverRepos(rootDir, config.gitScanDepth));
		const repos = discoverRepos(rootDir, config.gitScanDepth);
		return repos.length === 1 ? repos[0]! : null;
	};
	const repos = () => {
		const active = activeRepo();
		return [
			...new Set([...(active ? [active] : []), ...discoverRepos(rootDir, config.gitScanDepth)]),
		];
	};
	const workspaces = createWorkspaces({
		rootDir,
		repos,
		dirtyPaths: () =>
			Object.entries(buffers)
				.filter(([, buffer]) => buffer.dirty)
				.map(([path]) => path),
		setPrompt,
		say,
		open: props.onOpenWorkspace,
	});
	const workspaceChoices = createMemo(() => {
		const p = prompt();
		if (p?.kind !== 'workspacePick') return null;
		return p.entries.map((entry) => ({
			id: entry.path,
			label: `${entry.current ? '* ' : '  '}${entry.name}  ${shortenHome(entry.path)}${entry.branch ? `  ${entry.branch}` : ''}  ${entry.source}`,
		}));
	});
	const comparison = createComparison({ rootDir, activeRepo, branch, diffBase, say });
	createEffect(on(gitRevision, () => comparison.refresh(), { defer: true }));
	/** Open the sidebar on one of its views, as the tab strip above it does. */
	const showView = (next: SidebarView) => {
		comparison.close();
		setSidebarView(next);
		setSidebar(true);
		setFocus('tree');
	};
	const cycleSidebarView = () => showView(nextSidebarView(sidebarView()));
	const review = createReview({
		rootDir,
		config,
		activePath,
		activeLine: () => cursor().line,
		activeRepo,
		branch,
		openFile,
		setFocus,
		setGoto,
		showView,
		setPrompt,
		say,
	});
	const reviewLine = () => cursor().line;
	const openReviewKindChooser = () => {
		const target = reviewLineTarget(activePath, reviewLine, say);
		if (target) setPrompt(target);
	};
	const openReviewNote = (kind: import('../core/review').NoteKind) => {
		const target = reviewLineTarget(activePath, reviewLine, say);
		if (target) setPrompt(reviewNotePrompt(target, kind));
	};
	const openReviewReply = () => {
		const parent = review.replyTarget();
		if (!parent) return;
		setPrompt({ kind: 'reviewReply', parentId: parent.id });
	};
	/** Ctrl+Opt+R: show the panel, or put the tree back — the same in-and-out
	 * as git's and plugins'. */
	const toggleReviewPanel = () => {
		if (sidebar() && sidebarView() === 'review') return showView('files');
		showView('review');
		review.autoFetch();
	};
	/** Ctrl+Opt+X. */
	const togglePluginsPanel = () => {
		if (sidebar() && sidebarView() === 'plugins') return showView('files');
		showView('plugins');
		plugins.ensureCatalog();
	};
	/** Ctrl+Opt+G, as VS Code's Ctrl+Shift+G. */
	const toggleGitPanel = () => {
		if (sidebar() && sidebarView() === 'git') return showView('files');
		showView('git');
	};
	const openComparison = () => {
		gitCommands.closeChanges();
		setSidebar(true);
		setFocus('tree');
		comparison.open();
	};
	const chooseReviewKind = (kind: string) => {
		const ask = prompt();
		setPrompt(null);
		if (ask?.kind !== 'reviewKind') return;
		const noteKind = parseReviewKind(kind);
		if (!noteKind) return;
		setPrompt(reviewNotePrompt(ask, noteKind));
	};
	const appearanceApply = {
		theme: (_id: string) => {},
		icons: (_id: string) => {},
	};
	const documentActions = createDocumentActions({
		config,
		buffers,
		activePath,
		activeBuffer,
		prompt,
		conflict,
		nodes,
		tabs,
		selectedPath,
		gitCommands,
		installLspServer: lsp.install,
		closeTab,
		expand,
		movePath,
		openFile,
		pinTab,
		quit,
		refreshTree,
		say,
		setAnchor,
		setBuffers,
		setBusy,
		setConflict,
		setFocus,
		setGitRevision,
		setGoto,
		setMarked,
		setPrompt,
		setReloadKey,
		setSelectedPath,
		pushEdit,
		patchConfig: (patch) => patchConfig(patch, settingsPage() ?? 'user'),
		reloadAppearancePlugins: reloadUi,
		appearance: appearancePlugins,
		applyTheme: (id) => appearanceApply.theme(id),
		applyIconTheme: (id) => appearanceApply.icons(id),
		addReviewNote: review.add,
		addReviewReply: review.reply,
		whileFree,
		rootDir,
	});
	saveDirtyPathsRef.run = documentActions.saveDirtyPaths;
	const {
		onEditorChange,
		resolveConflict,
		saveActive,
		saveDirtyOnBlur,
		submitPrompt,
		confirmPrompt,
		syncFromDisk,
	} = documentActions;
	const overlay = createOverlayOpen({
		prompt,
		palette,
		conflict,
		mergeConflictChoice: mergeConflicts.open,
		help,
		search,
		settingsPage: () => settingsPage() !== null,
		appearancePluginsOpen: appearancePluginUi.open,
		lspStatusOpen,
		diff: gitCommands.diff,
		update,
		picker,
		problemsOpen,
		commitFiles: gitCommands.commitFiles,
		comparisonBase: comparison.basePick,
	});
	const { nudgeSidebar, resizeSidebar, treeWidth } = createSidebarSizing({
		config,
		width: () => dimensions().width,
		patchConfig,
	});
	const controls = createAppControls({
		config,
		configScope: () => settingsPage() ?? 'user',
		currentAppearance: appearance,
		prompt,
		selectedNode,
		setVimMode,
		setPrompt,
		setIconPreview,
		patchConfig,
		say,
	});
	appearanceApply.theme = controls.applyTheme;
	appearanceApply.icons = controls.applyIconTheme;
	const settingRows = createAppSettingRows({
		config,
		iconThemes: () => appearancePlugins().iconThemes,
		controls,
		patchConfig,
		configScope: () => settingsPage() ?? 'user',
	});
	const commands = createAppCommandTree({
		config,
		rootDir,
		iconTheme: activeIconTheme,
		buffers,
		saveActive,
		saveAll: documentActions.saveAll,
		saveWithoutFormatting: documentActions.saveWithoutFormatting,
		formatActive: documentActions.formatActive,
		formatOpenFiles: documentActions.formatOpenFiles,
		setPicker,
		openWorkspace: workspaces.openPrompt,
		switchWorkspace: workspaces.pick,
		activePath,
		cursor,
		openFile,
		navigation,
		tabs,
		closeTabs,
		setPrompt,
		setHistory,
		setSearch,
		targetDir,
		actionTargets,
		takeForPaste,
		copyPath: fileActions.copyPath,
		selectedPath,
		paste,
		closeTab,
		reopenTab,
		switchTab,
		focus,
		setFocus,
		focusTree,
		toggleSidebar,
		collapseSidebar: () => say(collapseAll() ? 'Collapsed sidebar folders' : 'No folders expanded'),
		toggleMarkdown,
		togglePreview: () => preview.toggle(),
		controls,
		openSettings: () => setSettingsPage('user'),
		openProjectSettings: () => setSettingsPage('project'),
		openAppearancePlugins: appearancePluginUi.show,
		reloadAppearancePlugins: reloadUi,
		appearanceVersion: () => appearancePlugins(),
		problemUi,
		lspRestart: lsp.restart,
		openLspStatus: () => setLspStatusOpen(true),
		reviewOpen: toggleReviewPanel,
		pluginsOpen: togglePluginsPanel,
		reviewFetch: review.fetchPullRequest,
		reviewNoteChooser: openReviewKindChooser,
		reviewNote: openReviewNote,
		reviewReply: openReviewReply,
		reviewClear: review.clear,
		completion,
		setLineOp,
		setFoldOp,
		resolveMergeConflict: mergeConflicts.choose,
		acceptMergeConflict: mergeConflicts.accept,
		nextMergeConflict: mergeConflicts.next,
		patchConfig,
		gitCommands: {
			...gitCommands,
			sourceControl: toggleGitPanel,
			openBranchComparison: openComparison,
		},
		setHelp,
		say,
		quit,
	});
	useAppLifecycle({
		rootDir,
		...startupOpen(props),
		initialConfig: props.initialConfig,
		checkUpdates: props.checkUpdates,
		appearanceVersion: () => appearancePlugins(),
		restoredFailed: restored.failed,
		activeBuffer,
		activePath,
		expanded,
		nodes,
		gitRevision,
		diffBase,
		reloadKey,
		sidebar,
		tabs,
		branch,
		config,
		renderer,
		onAppearance: (next) => {
			setAppearance(next);
			if (!config.themeSync) return;
			const theme = resolvedTheme(config, next);
			setTheme(theme);
			invalidateSyntaxStyle();
			setConfig('theme', theme);
		},
		saveDirtyOnBlur,
		syncFromDisk,
		dependenciesChanged: lsp.dependenciesChanged,
		reloadNotes: review.reloadNotes,
		say,
		setPrompt,
		setGitRevision,
		setGitLines,
		setGitStatus,
		setGitStatusEntries,
		setGitIgnored,
		setBranch,
		setUpstream,
		setGoto,
		setNotice,
		setUpdate,
		status,
	});
	useAppKeyboard({
		config,
		activePath,
		clipboard,
		focus: () => (sidebarView() !== 'files' || comparison.active() ? 'gitPanel' : focus()),
		help,
		marked,
		notice,
		overlay,
		peek,
		selectedNode,
		sidebar,
		vimMode,
		activateNode,
		actionTargets,
		closeTab,
		extendSelection,
		focusTree,
		moveSelection,
		nudgeSidebar,
		paste,
		quit,
		navigateBack: navigation.back,
		navigateForward: navigation.forward,
		openPathUnderCursor,
		copyPath: fileActions.copyPath,
		reopenTab,
		saveActive,
		saveAll: documentActions.saveAll,
		formatActive: documentActions.formatActive,
		lineOp: (op) => setLineOp((prev) => ({ op, key: (prev?.key ?? 0) + 1 })),
		toggleWrap: controls.toggleWrap,
		toggleSidebarPosition: controls.toggleSidebarPosition,
		toggleDiffView: controls.toggleDiffView,
		foldOp: (op) => setFoldOp((prev) => ({ op, key: (prev?.key ?? 0) + 1 })),
		resolveConflict: mergeConflicts.choose,
		nextConflict: () => mergeConflicts.next(1),
		say,
		setAnchor,
		setClipboard,
		setFocus,
		setHelp,
		setMarked,
		setNotice,
		setPalette,
		setPeek,
		setPicker,
		setPrompt,
		setSearch,
		setSelectedPath,
		switchTab,
		takeForPaste,
		targetDir,
		toggleExpand,
		toggleSidebar,
		toggleGitPanel,
		toggleReviewPanel,
		togglePluginsPanel,
		toggleMarkdown,
		previewToggle: () => preview.toggle(),
		previewScroll: (pages: number) => preview.scroll(pages),
		previewClose: () => preview.close(),
		previewShowing: () => preview.target() !== null,
		cycleSidebarView,
		reviewNoteChooser: openReviewKindChooser,
		reviewReply: openReviewReply,
		goToDefinition,
		problemsList: problemUi.list,
		problemsAtCursor: problemUi.atCursor,
		problemsNext: () => problemUi.next(1),
		problemsPrev: () => problemUi.next(-1),
		problemsRestart: () =>
			say(lsp.restart() ? 'Restarted language servers' : 'No language servers running'),
		completion: completion.show,
		expanded,
	});
	const {
		replaceOne,
		replaceEvery,
		replaceProjectOne,
		confirmProject,
		applyProject,
		replaceOverlay,
	} = createReplacementHandlers({
		rootDir,
		activePath,
		buffers,
		buffer: (path) => buffers[path],
		closeSearch: () => setSearch(null),
		pinTab,
		applyReplacement,
		applyBufferReplacement,
		syncFromDisk,
		bumpGit: () => setGitRevision((n) => n + 1),
		setPrompt,
		say,
	});
	const confirmActivePrompt = () => {
		const p = prompt();
		if (p?.kind === 'replaceProject') {
			setPrompt(null);
			setSearch(null);
			applyProject(p.paths, p.query, p.replacement, p.options);
			return;
		}
		if (p?.kind === 'workspaceDirty') {
			setPrompt(null);
			workspaces.switchTo(p.dir, true);
			return;
		}
		confirmPrompt();
	};
	return (
		<>
			<AppView
				rootDir={rootDir}
				config={config}
				iconTheme={activeIconTheme()}
				iconThemes={appearancePlugins().iconThemes}
				tabs={tabs()}
				activePath={activePath()}
				renderedMarkdownPath={renderedMarkdownPath()}
				activeBuffer={activeBuffer()}
				buffers={buffers}
				previewPath={previewPath()}
				sidebar={sidebar()}
				nodes={nodes()}
				selectedPath={selectedPath()}
				expanded={expanded()}
				focus={focus()}
				peekScope={
					sidebarView() === 'plugins'
						? 'plugins'
						: sidebarView() === 'review'
							? 'review'
							: sidebarView() === 'git'
								? 'git'
								: focus()
				}
				treeWidth={treeWidth()}
				gitStatus={gitStatus()}
				gitStatusEntries={gitStatusEntries()}
				gitIgnored={gitIgnored()}
				cutPaths={cut()}
				markedPaths={marked()}
				resizing={resizing()}
				reloadKey={reloadKey()}
				goto={goto()}
				history={history()}
				edit={edit()}
				lineOp={lineOp()}
				foldOp={foldOp()}
				completion={completion.request()}
				gitLines={gitLines()}
				problems={problemUi.lines()}
				fileProblems={lsp.problems}
				problemRanges={activePath() ? (lsp.problems[activePath()!] ?? []) : []}
				reviews={review.marks()}
				problemCounts={problemUi.counts()}
				problemEntries={problemUi.entries()}
				problemsOpen={problemsOpen()}
				problemsTitle={problemsOpen() === 'cursor' ? 'Problem at cursor' : 'Problems'}
				prompt={prompt()}
				onChooseReviewKind={chooseReviewKind}
				lspStatusRows={lsp.statusRows()}
				lspStatusOpen={lspStatusOpen()}
				notice={notice()}
				blocked={overlay()}
				status={status()}
				cursor={cursor()}
				vimMode={vimMode()}
				branch={branch()}
				diffBase={diffBase()}
				upstream={upstream()}
				busy={busy()}
				promptTitle={controls.promptTitle()}
				promptValue={controls.promptValue()}
				promptHistory={
					prompt()?.kind === 'commitMessage' || prompt()?.kind === 'commitAmend'
						? gitCommands.commitMessageHistory()
						: []
				}
				confirmation={controls.confirmation()}
				search={search()}
				picker={picker()}
				sidebarView={sidebarView()}
				changesOpen={gitCommands.changesOpen()}
				changeSections={gitCommands.changeSections()}
				changesMeta={gitCommands.changesMeta()}
				changesFocus={gitCommands.changesFocus()}
				changesTitle={gitCommands.changesTitle()}
				review={review}
				comparison={comparison}
				plugins={plugins}
				previewTarget={preview.target()}
				previewScroll={preview.scrollRequest()}
				palette={palette()}
				settingsPage={settingsPage() !== null}
				settingsScope={settingsPage() ?? 'user'}
				diff={gitCommands.diff()}
				diffTitle={gitCommands.diffTitle()}
				commands={commands()}
				settingRows={settingRows()}
				commitFiles={gitCommands.commitFiles()}
				branchChoices={gitCommands.branchChoices()}
				workspaceChoices={workspaceChoices()}
				branchChoiceTitle={gitCommands.branchChoiceTitle()}
				branchChoiceMessage={gitCommands.branchChoiceMessage()}
				conflict={conflict()}
				update={update()}
				peek={peek()}
				help={help()}
				selection={selectedSingleLineText(renderer)}
				canNavigateBack={navigation.canBack()}
				canNavigateForward={navigation.canForward()}
				onSelectTab={openFile}
				onCloseTab={closeTab}
				onNavigateBack={navigation.back}
				onNavigateForward={navigation.forward}
				onOverflowTabs={() => setPicker('tabs')}
				onResizeDrag={(event) => resizing() && resizeSidebar(event.x)}
				onResizeEnd={() => setResizing(false)}
				onActivateNode={activateNode}
				onPinNode={(node) => pinTab(node.path)}
				onTreeFocus={() => setFocus('tree')}
				onGitDiff={gitCommands.openDiff}
				onGitOpenFile={(path) => {
					gitCommands.closeChanges();
					openFile(path);
					setFocus('editor');
				}}
				onGitOpenCommit={(oid) => {
					gitCommands.closeChanges();
					gitCommands.openCommitDiff(oid);
				}}
				onGitDiscard={gitCommands.promptDiscard}
				onGitToggleStage={(row) => gitCommands.toggleStage(gitStatusEntries(), row)}
				onGitCommit={gitCommands.commitFromBox}
				onGitFocusMessage={gitCommands.focusCommitBox}
				commitMessage={gitCommands.commitMessage()}
				messageEditing={gitCommands.messageEditing()}
				hasMessageHistory={gitCommands.hasMessageHistory()}
				onGitMessageInput={gitCommands.typeMessage}
				onGitWalkHistory={gitCommands.walkMessageHistory}
				onGitCancelMessage={() => gitCommands.setMessageEditing(false)}
				onGitCursorRow={gitCommands.focusChange}
				onShowChanges={gitCommands.showChanges}
				onCloseChanges={() => {
					gitCommands.closeChanges();
					setFocus('tree');
				}}
				onToggleStageSection={gitCommands.toggleStageSection}
				onToggleDiffLayout={controls.toggleDiffView}
				onLeaveGitPanel={() => setFocus('editor')}
				onGitPush={gitCommands.push}
				onGitSync={gitCommands.sync}
				onGitBranchAction={(action) =>
					action === 'compare' ? openComparison() : gitCommands.openPanelBranchAction(action)
				}
				onCloseComparison={comparison.close}
				onOpenReview={() => {
					showView('review');
					review.autoFetch();
				}}
				onSelectSidebarView={showView}
				onCycleSidebarView={cycleSidebarView}
				onResizeStart={(event) => {
					setResizing(true);
					resizeSidebar(event.x);
				}}
				onEditorChange={onEditorChange}
				onCursor={setCursor}
				onEditorFocus={() => setFocus('editor')}
				onVimMode={setVimMode}
				onToggleMarkdown={toggleMarkdown}
				onComplete={completion.complete}
				onResolveCompletion={completion.resolve}
				onQuit={quit}
				onSubmitPrompt={(value) => {
					if (prompt()?.kind === 'gotoLine') navigation.mark();
					if (prompt()?.kind === 'workspaceOpen') {
						setPrompt(null);
						workspaces.switchTo(value);
						return;
					}
					submitPrompt(value);
				}}
				onCancelPrompt={() => setPrompt(null)}
				onConfirmPrompt={confirmActivePrompt}
				onChooseActivation={documentActions.chooseActivation}
				onPickSearch={jumpTo}
				onReplaceOne={(match, replacement) =>
					search()?.scope === 'project'
						? replaceProjectOne(match, replacement)
						: replaceOne(match, replacement)
				}
				onReplaceAll={(query, replacement, options) =>
					search()?.scope === 'project'
						? confirmProject(query, replacement, options)
						: replaceEvery(query, replacement, options)
				}
				searchBuffers={replaceOverlay}
				onCloseSearch={() => setSearch(null)}
				onPickFile={(path, position) => {
					setPicker(null);
					// A jump inside the already-open file changes no tab, so nothing
					// else records where it started; mark history like Go to line does.
					if (position && path === activePath()) navigation.mark();
					openFile(path);
					// Viewer tabs have no buffer to land in, and a failed open leaves
					// the previous file on screen — a goto then would aim at it.
					const lines = buffers[path]?.content.split('\n').length;
					if (position && lines && activePath() === path) {
						setGoto((prev) => ({
							line: Math.min(position.line, lines - 1),
							col: position.col,
							key: (prev?.key ?? 0) + 1,
						}));
					}
				}}
				onClosePicker={() => setPicker(null)}
				onClosePalette={() => setPalette(false)}
				onCloseSettings={() => setSettingsPage(null)}
				onPickProblem={problemUi.pick}
				onCloseProblems={() => setProblemsOpen(false)}
				onCloseLspStatus={() => setLspStatusOpen(false)}
				onRestartLspStatus={() =>
					say(lsp.restart() ? 'Restarted language servers' : 'No language servers running')
				}
				onUninstallLspStatus={(id) => void lsp.uninstall(id)}
				onCloseDiff={gitCommands.closeDiff}
				onCommitFiles={gitCommands.startCommit}
				onCancelCommit={gitCommands.cancelCommit}
				onPickBranch={gitCommands.pickBranch}
				onPickWorkspace={(path) => {
					setPrompt(null);
					workspaces.switchTo(path);
				}}
				onDeleteBranchChoice={gitCommands.deleteChoice}
				onCloseBranchChoices={gitCommands.closeBranchChoices}
				onResolveConflict={resolveConflict}
				onCancelConflict={() => setConflict(null)}
				onCloseUpdate={() => setUpdate(null)}
				onSkipUpdate={() => {
					const info = update();
					if (info) patchConfig({ skipUpdate: info.latest });
					setUpdate(null);
				}}
				onSave={() => void saveActive()}
				onGotoLine={() => setPrompt({ kind: 'gotoLine' })}
				onToggleGit={toggleGitPanel}
				onProblemsList={problemUi.list}
			/>
			{mergeConflicts.view()}
			{appearancePluginUi.view()}
		</>
	);
}
