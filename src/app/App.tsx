import { useRenderer, useTerminalDimensions } from '@opentui/solid';
import { createMemo, createSignal } from 'solid-js';
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
import { parseReviewKind, reviewLineTarget, reviewNotePrompt } from './reviewPrompts';
import { discoverRepos, repoOf } from '../core/vcs/repos';
import { invalidateSyntaxStyle } from '../languages/highlight';
import { setTheme } from '../themes';
import type { VimMode } from '../editor/vim';
import { createAppControls } from './appControls';
import { AppView } from './AppView';
import { createAppearancePluginUi } from './appearance/pluginsPage';
import { createPluginsPanel } from './appearance/pluginsPanel';
import { reloadAppearancePlugins as reloadPlugins } from './appearance/reload';
import { prepareStartup } from './appearance/startup';
import { createAppCommandTree } from './commands/tree';
import { READY } from './constants';
import { createDocumentActions } from './documentActions';
import { createFileActions } from './fileActions';
import { createGitCommands } from './gitCommands';
import { useAppKeyboard } from './keyboard';
import { startupOpen, useAppLifecycle } from './lifecycle';
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
import { createTreeSelection } from './treeSelection';
import { hiddenTreeNodes as hiddenNodes } from './treeVisibility';
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
	const [reviewPanel, setReviewPanel] = createSignal(false);
	const [pluginsPanel, setPluginsPanel] = createSignal(false);
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
		pluginStatus ?? { msg: READY, tone: 'info' },
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
	const appearancePluginUi = createAppearancePluginUi({
		rootDir,
		config,
		appearance: appearancePlugins,
		patchConfig: (patch) => patchConfig(patch, settingsPage() ?? 'user'),
		editRegistry: () =>
			setPrompt({ kind: 'appearancePluginRegistry', current: config.pluginRegistry }),
		reload: reloadUi,
		say,
	});
	const plugins = createPluginsPanel({
		rootDir,
		config,
		appearance: appearancePlugins,
		patchConfig: (patch) => patchConfig(patch, settingsPage() ?? 'user'),
		reload: reloadUi,
		say,
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
		upstream,
		setDiffBase,
		setBusy,
		setGitRevision,
		setPrompt,
		say,
		whileFree,
		syncFromDisk: () => documentActions.syncFromDisk(),
	});
	const activeRepo = () => {
		const path = activePath();
		if (path) return repoOf(path, discoverRepos(rootDir, config.gitScanDepth));
		const repos = discoverRepos(rootDir, config.gitScanDepth);
		return repos.length === 1 ? repos[0]! : null;
	};
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
		setGitPanel: gitCommands.setPanel,
		setReviewPanel,
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
	const toggleReviewPanel = () => {
		setSidebar(true);
		gitCommands.setPanel(false);
		setPluginsPanel(false);
		setReviewPanel((was) => {
			if (!was) review.autoFetch();
			return !was;
		});
		setFocus('tree');
	};
	const togglePluginsPanel = () => {
		setSidebar(true);
		gitCommands.setPanel(false);
		setReviewPanel(false);
		setPluginsPanel((was) => {
			if (!was) plugins.ensureCatalog();
			return !was;
		});
		setFocus('tree');
	};
	const toggleGitPanel = () => {
		setSidebar(true);
		setReviewPanel(false);
		setPluginsPanel(false);
		gitCommands.togglePanel();
		setFocus('tree');
	};
	const chooseReviewKind = (kind: string) => {
		const ask = prompt();
		setPrompt(null);
		if (ask?.kind !== 'reviewKind') return;
		const noteKind = parseReviewKind(kind);
		if (!noteKind) return;
		setPrompt(reviewNotePrompt(ask, noteKind));
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
		patchConfig,
		say,
	});
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
		buffers,
		saveActive,
		saveAll: documentActions.saveAll,
		saveWithoutFormatting: documentActions.saveWithoutFormatting,
		formatActive: documentActions.formatActive,
		formatOpenFiles: documentActions.formatOpenFiles,
		setPicker,
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
		gitCommands: { ...gitCommands, sourceControl: toggleGitPanel, togglePanel: toggleGitPanel },
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
		focus: () => (gitCommands.panel() || reviewPanel() || pluginsPanel() ? 'gitPanel' : focus()),
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
		formatActive: documentActions.formatActive,
		foldOp: (op) => setFoldOp((prev) => ({ op, key: (prev?.key ?? 0) + 1 })),
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
		confirmPrompt();
	};
	return (
		<>
			<AppView
				rootDir={rootDir}
				config={config}
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
				reviews={review.marks()}
				problemCounts={problemUi.counts()}
				problemChoices={problemUi.choices()}
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
				gitPanel={gitCommands.panel()}
				reviewPanel={reviewPanel()}
				pluginsPanel={pluginsPanel()}
				review={review}
				plugins={plugins}
				palette={palette()}
				settingsPage={settingsPage() !== null}
				settingsScope={settingsPage() ?? 'user'}
				diff={gitCommands.diff()}
				diffTitle={gitCommands.diffTitle()}
				commands={commands()}
				settingRows={settingRows()}
				commitFiles={gitCommands.commitFiles()}
				branchChoices={gitCommands.branchChoices()}
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
				onGitDiscard={gitCommands.promptDiscard}
				onGitToggleStage={(row) => gitCommands.toggleStage(gitStatusEntries(), row)}
				onGitCommit={gitCommands.openCommitPicker}
				onGitPush={gitCommands.push}
				onGitBranchAction={gitCommands.openPanelBranchAction}
				onOpenReview={() => {
					gitCommands.setPanel(false);
					setPluginsPanel(false);
					setReviewPanel(true);
					review.autoFetch();
				}}
				onCloseReview={() => setReviewPanel(false)}
				onClosePlugins={() => setPluginsPanel(false)}
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
					submitPrompt(value);
				}}
				onCancelPrompt={() => setPrompt(null)}
				onConfirmPrompt={confirmActivePrompt}
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
				onCloseDiff={gitCommands.closeDiff}
				onCommitFiles={gitCommands.startCommit}
				onCancelCommit={gitCommands.cancelCommit}
				onPickBranch={gitCommands.pickBranch}
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
			/>
			{mergeConflicts.view()}
			{appearancePluginUi.view()}
		</>
	);
}
