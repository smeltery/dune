import { basename } from 'node:path';

import type { MouseEvent } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show } from 'solid-js';

import type { ChangeSection, ChangesMeta } from '../core/changeSections';
import type { ChangeRow } from '../core/changeTree';
import type { Config } from '../core/config';
import type { TreeNode } from '../core/fs';
import type { FileStatus, LineChange, StatusEntry, Upstream } from '../core/git';
import type { DiffFile } from '../core/gitDiff';
import type { IconTheme } from '../core/iconThemes';
import { isImagePath } from '../core/image';
import { isPdfPath } from '../core/pdf';
import type { Match } from '../core/search';
import type { CompletionItem, ProblemSeverity } from '../lsp/protocol';
import type { CompletionReply } from '../lsp/completion';
import type { VimMode } from '../editor/vim';
import { languageLabel } from '../languages';
import { filetypeForPath } from '../languages/highlight';
import { ui } from '../themes';
import { ChoiceModal, type Choice } from '../ui/ChoiceModal';
import { CommandPalette } from '../ui/CommandPalette';
import { CommitModal } from '../ui/CommitModal';
import type { CommitFile } from '../ui/CommitModal';
import { ChangesView } from '../ui/ChangesView';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DiffView } from '../ui/overlays/DiffView';
import { EditorPane } from '../ui/EditorPane';
import { FilePicker, type PickPosition } from '../ui/FilePicker';
import { FileTree } from '../ui/FileTree';
import { HelpOverlay } from '../ui/HelpOverlay';
import { KeyPeek } from '../ui/KeyPeek';
import { LspStatusView } from '../ui/overlays/LspStatusView';
import { MarkdownView } from '../ui/MarkdownView';
import { GitPanel } from '../ui/overlays/GitPanel';
import { PluginsPanel } from '../ui/overlays/PluginsPanel';
import { PreviewPane } from '../ui/PreviewPane';
import { ReviewPanel } from '../ui/ReviewPanel';
import { SettingsView } from '../ui/overlays/SettingsView';
import type { SettingRow } from '../ui/overlays/SettingsView';
import { PromptModal } from '../ui/PromptModal';
import { SearchPanel } from '../ui/SearchPanel';
import type { SearchScope } from '../ui/SearchPanel';
import { SidebarTabs } from '../ui/SidebarTabs';
import { StatusBar } from '../ui/StatusBar';
import type { Tone } from '../ui/StatusBar';
import { Tabs } from '../ui/Tabs';
import { UpdateBanner } from '../ui/UpdateBanner';
import { ViewerPane } from '../ui/viewers/ViewerPane';
import type { SearchOptions } from '../core/search';
import type { UpdateInfo } from '../core/update';
import type { Command } from './commands';
import type { LspStatusRow } from '../lsp/status';
import type { SidebarView } from './panes';
import type { Review } from './review';
import { ReviewKindModal } from '../ui/overlays/ReviewKindModal';
import type { ProblemsScope } from './lsp/view';
import type { BufferState, Confirmation, Conflict, Focus, LineOpRequest, Prompt } from './types';

const GRIP = [0, 1, 2, 3, 4];

interface AppViewProps {
	rootDir: string;
	config: Config;
	iconThemes: readonly IconTheme[];
	tabs: string[];
	activePath: string | null;
	renderedMarkdownPath: string | null;
	activeBuffer: BufferState | undefined;
	buffers: Record<string, BufferState>;
	previewPath: string | null;
	sidebar: boolean;
	nodes: TreeNode[];
	selectedPath: string | null;
	expanded: Set<string>;
	focus: Focus;
	treeWidth: number;
	gitStatus: Map<string, FileStatus>;
	gitStatusEntries: Map<string, StatusEntry>;
	gitIgnored: Set<string>;
	cutPaths: string[];
	markedPaths: string[];
	resizing: boolean;
	reloadKey: number;
	goto: { line: number; col: number; key: number } | null;
	history: { kind: 'undo' | 'redo'; key: number } | null;
	edit: { content: string; key: number } | null;
	lineOp: LineOpRequest;
	foldOp: import('./types').FoldOpRequest;
	completion: { key: number } | null;
	gitLines: Map<number, LineChange>;
	problems: Map<number, { severity: ProblemSeverity; message: string }>;
	reviews: Map<number, { draft: boolean; label: string; text: string }>;
	problemCounts: { errors: number; warnings: number };
	problemChoices: Choice[];
	problemsOpen: ProblemsScope | false;
	problemsTitle: string;
	prompt: Prompt;
	lspStatusRows: LspStatusRow[];
	lspStatusOpen: boolean;
	notice: { name: string; reason: string } | null;
	blocked: boolean;
	status: { msg: string; tone: Tone };
	cursor: { line: number; col: number };
	vimMode: VimMode | null;
	branch: string | null;
	diffBase: string | null;
	upstream: Upstream | null;
	busy: { label: string; done: number; total: number } | null;
	promptTitle: string | undefined;
	promptValue: string;
	promptHistory: string[];
	confirmation: Confirmation | null;
	search: { scope: SearchScope; replacing?: boolean } | null;
	picker: 'files' | 'tabs' | null;
	sidebarView: SidebarView;
	changesOpen: boolean;
	changeSections: ChangeSection[];
	changesMeta: ChangesMeta;
	changesFocus: string | null;
	changesTitle: string;
	review: Review;
	plugins: import('./appearance/pluginsPanel').PluginsPanel;
	previewTarget: { path: string; isDir: boolean } | null;
	previewScroll: { pages: number; at: number } | null;
	palette: boolean;
	settingsPage: boolean;
	settingsScope: 'user' | 'project';
	diff: DiffFile[] | null;
	diffTitle: string | null;
	commands: Command[];
	settingRows: SettingRow[];
	commitFiles: CommitFile[] | null;
	branchChoices: Choice[] | null;
	branchChoiceTitle: string;
	branchChoiceMessage: string;
	conflict: Conflict | null;
	update: { current: string; latest: string } | null;
	peek: boolean;
	help: boolean;
	selection: string;
	canNavigateBack: boolean;
	canNavigateForward: boolean;
	onSelectTab: (path: string) => void;
	onCloseTab: (path: string) => void;
	onNavigateBack: () => void;
	onNavigateForward: () => void;
	onOverflowTabs: () => void;
	onResizeDrag: (event: MouseEvent) => void;
	onResizeEnd: () => void;
	onActivateNode: (node: TreeNode) => void;
	onPinNode: (node: TreeNode) => void;
	onTreeFocus: () => void;
	onGitDiff: (path: string) => void;
	onGitOpenFile: (path: string) => void;
	onGitOpenCommit: (oid: string) => void;
	onGitDiscard: (path: string, status: FileStatus) => void;
	onGitToggleStage: (row: ChangeRow) => void;
	onGitCursorRow: (row: ChangeRow | undefined) => void;
	onShowChanges: () => void;
	onCloseChanges: () => void;
	onToggleStageSection: (key: string) => void;
	onToggleDiffLayout: () => void;
	onLeaveGitPanel: () => void;
	onGitCommit: () => void;
	onGitFocusMessage: () => void;
	commitMessage: string;
	messageEditing: boolean;
	hasMessageHistory: boolean;
	onGitMessageInput: (value: string) => void;
	onGitWalkHistory: (delta: number) => void;
	onGitCancelMessage: () => void;
	onGitPush: () => void;
	onGitSync: () => void;
	onGitBranchAction: (action: 'switch' | 'compare' | 'commits') => void;
	onOpenReview: () => void;
	onSelectSidebarView: (view: SidebarView) => void;
	onCycleSidebarView: () => void;
	onResizeStart: (event: MouseEvent) => void;
	onEditorChange: (text: string) => void;
	onCursor: (pos: { line: number; col: number }) => void;
	onEditorFocus: () => void;
	onVimMode: (mode: VimMode | null) => void;
	onToggleMarkdown: () => void;
	onComplete: ((line: number, col: number) => Promise<CompletionReply | null>) | null;
	onResolveCompletion: ((item: CompletionItem) => Promise<CompletionItem | null>) | null;
	onQuit: () => void;
	onSubmitPrompt: (value: string) => void;
	onCancelPrompt: () => void;
	onConfirmPrompt: () => void;
	onPickSearch: (match: Match) => void;
	onReplaceOne?: (match: Match, replacement: string) => void;
	onReplaceAll?: (query: string, replacement: string, options: SearchOptions) => void;
	searchBuffers?: () => ReadonlyMap<string, string>;
	onCloseSearch: () => void;
	onPickFile: (path: string, position?: PickPosition) => void;
	onClosePicker: () => void;
	onClosePalette: () => void;
	onCloseSettings: () => void;
	onPickProblem: (id: string) => void;
	onCloseProblems: () => void;
	onChooseReviewKind: (kind: string) => void;
	onCloseLspStatus: () => void;
	onRestartLspStatus: () => void;
	onUninstallLspStatus: (id: string) => void;
	onCloseDiff: () => void;
	onCommitFiles: (paths: string[]) => void;
	onCancelCommit: () => void;
	onPickBranch: (name: string) => void;
	onDeleteBranchChoice: (id: string) => void;
	onCloseBranchChoices: () => void;
	onResolveConflict: (choice: string) => void;
	onCancelConflict: () => void;
	onCloseUpdate: () => void;
	onSkipUpdate: () => void;
}

export function AppView(props: AppViewProps) {
	const dimensions = useTerminalDimensions();
	const activeImage = () =>
		props.activePath && isImagePath(props.activePath) ? props.activePath : null;
	const activePdf = () =>
		props.activePath && isPdfPath(props.activePath) ? props.activePath : null;
	const activeViewer = () => activeImage() || activePdf();
	const textBufferActive = () => props.activePath && !activeViewer() && !props.renderedMarkdownPath;
	const editorSlotFocused = () => props.focus === 'editor' || props.renderedMarkdownPath !== null;
	const editorWidth = () =>
		Math.max(1, dimensions().width - (props.sidebar ? props.treeWidth + 1 : 0));
	const editorHeight = () => Math.max(1, dimensions().height - 2);
	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor={ui.bg}>
			<Tabs
				tabs={props.tabs.map((p) => ({
					path: p,
					name: p === props.renderedMarkdownPath ? `¶ ${basename(p)}` : basename(p),
					dirty: props.buffers[p]?.dirty ?? false,
					preview: p === props.previewPath,
				}))}
				activePath={props.activePath}
				canBack={props.canNavigateBack}
				canForward={props.canNavigateForward}
				onSelect={props.onSelectTab}
				onClose={props.onCloseTab}
				onBack={props.onNavigateBack}
				onForward={props.onNavigateForward}
				onOverflow={() => props.onOverflowTabs()}
				tooltipsEnabled={props.config.tooltips}
				keybindings={props.config.keybindings}
				tabIcons={props.config.tabIcons}
				iconTheme={props.config.iconTheme}
				iconThemes={props.iconThemes}
			/>
			{/* Drag capture lives on the row, not the divider: the pointer leaves a
          one-column target immediately, and each drag event is delivered to
          whatever sits under it. `row-reverse` is what moves the sidebar to the
          right — Show is transparent, so the sidebar pane, its divider and the
          editor block are one flat list of flex children this can reorder. */}
			<box
				flexDirection={props.config.sidebarPosition === 'right' ? 'row-reverse' : 'row'}
				flexGrow={1}
				onMouseDrag={props.onResizeDrag}
				onMouseDragEnd={() => props.onResizeEnd()}
				onMouseUp={() => props.onResizeEnd()}
			>
				<Show when={props.sidebar}>
					<box width={props.treeWidth} flexShrink={0} flexDirection="column">
						<SidebarTabs
							view={props.sidebarView}
							focused={props.focus !== 'editor' && !props.blocked}
							width={props.treeWidth}
							reviewCount={props.review.count()}
							onSelect={props.onSelectSidebarView}
						/>
						{/* The strip above is a fixed-height row, so the body below it needs its
						    own claim on the column's main axis — a box that was the column's only
						    child got that for free from the parent row's stretch, but a second
						    child does not. */}
						<box flexGrow={1} flexDirection="column">
							<Show
								when={props.sidebarView !== 'files'}
								fallback={
									<FileTree
										rootName={basename(props.rootDir) || props.rootDir}
										nodes={props.nodes}
										selectedPath={props.selectedPath}
										expanded={props.expanded}
										focused={props.focus === 'tree'}
										width={props.treeWidth}
										iconTheme={props.config.iconTheme}
										iconThemes={props.iconThemes}
										gitStatus={props.gitStatus}
										gitIgnored={props.gitIgnored}
										cutPaths={props.cutPaths}
										markedPaths={props.markedPaths}
										onActivate={props.onActivateNode}
										onPin={(node) => props.onPinNode(node)}
										onFocus={() => props.onTreeFocus()}
									/>
								}
							>
								<Show
									when={props.sidebarView === 'plugins'}
									fallback={
										<Show
											when={props.sidebarView === 'review'}
											fallback={
												<GitPanel
													rootDir={props.rootDir}
													branch={props.branch}
													base={props.diffBase}
													upstream={props.upstream}
													view={props.config.gitPanelView}
													width={props.treeWidth}
													focused={props.focus !== 'editor' && !props.blocked}
													statusEntries={props.gitStatusEntries}
													onFocus={() => props.onTreeFocus()}
													onDiff={props.onGitDiff}
													onOpenFile={props.onGitOpenFile}
													onOpenCommit={props.onGitOpenCommit}
													onDiscard={props.onGitDiscard}
													onToggleStage={props.onGitToggleStage}
													changesOpen={props.changesOpen}
													onShowChanges={props.onShowChanges}
													onCloseChanges={props.onCloseChanges}
													onCursorRow={props.onGitCursorRow}
													onLeave={props.onLeaveGitPanel}
													onToggleDiffLayout={props.onToggleDiffLayout}
													onCommit={props.onGitCommit}
													onFocusMessage={props.onGitFocusMessage}
													commitMessage={props.commitMessage}
													messageEditing={props.messageEditing}
													hasMessageHistory={props.hasMessageHistory}
													onMessageInput={props.onGitMessageInput}
													onWalkHistory={props.onGitWalkHistory}
													onCancelMessage={props.onGitCancelMessage}
													onPush={props.onGitPush}
													onSync={props.onGitSync}
													onBranchAction={props.onGitBranchAction}
													reviewCount={props.review.count()}
													onReview={props.onOpenReview}
													onCycleView={props.onCycleSidebarView}
												/>
											}
										>
											<ReviewPanel
												rows={props.review.rows()}
												cursor={props.review.cursor()}
												count={props.review.count()}
												pull={
													props.review.pull()
														? `#${props.review.pull()!.number} ${props.review.pull()!.title}`
														: null
												}
												fetching={props.review.fetching()}
												focused={props.focus === 'tree' && !props.blocked}
												width={props.treeWidth}
												onFocus={() => props.onTreeFocus()}
												onActivate={(index) => props.review.activate(index)}
												onCollapseAll={props.review.collapseAll}
												onMove={(delta) => {
													props.review.move(delta);
													props.review.show();
												}}
												onFetch={props.review.fetchPullRequest}
												onRemove={props.review.remove}
												onReply={props.review.promptReply}
												onClose={() => props.onSelectSidebarView('files')}
												onCycleView={props.onCycleSidebarView}
											/>
										</Show>
									}
								>
									<PluginsPanel
										rows={props.plugins.rows()}
										cursor={props.plugins.cursor()}
										installedCount={props.plugins.installedCount()}
										query={props.plugins.query()}
										focused={props.focus === 'tree' && !props.blocked}
										width={props.treeWidth}
										onFocus={() => props.onTreeFocus()}
										onActivate={(index) => props.plugins.activate(index)}
										onMove={(delta) => props.plugins.move(delta)}
										onRemove={props.plugins.remove}
										onCheck={props.plugins.checkNow}
										onUpdateAll={props.plugins.updateAll}
										onOpenSearch={props.plugins.openSearch}
										onCloseSearch={props.plugins.closeSearch}
										onSearch={props.plugins.search}
										onClose={() => props.onSelectSidebarView('files')}
										onCycleView={props.onCycleSidebarView}
									/>
								</Show>
							</Show>
						</box>
					</box>
					{/* Drag handle: the whole column is the grab target, but only a short
              grip is drawn at its middle — a full-height rule is a heavy line
              down the screen for something you touch once. The spacers centre it
              without anyone having to know the pane's height. `scrollbar` is the
              palette's quiet rule colour, and the accent while dragging says the
              grab took. The sidebar starts at column 0, so the pointer's x is the
              width asked for. */}
					<box
						width={1}
						flexShrink={0}
						flexDirection="column"
						backgroundColor={ui.bg}
						onMouseDown={props.onResizeStart}
					>
						<box flexGrow={1} backgroundColor={ui.bg} />
						<For each={GRIP}>
							{() => <text fg={props.resizing ? ui.accent : ui.scrollbar} bg={ui.bg} content="│" />}
						</For>
						<box flexGrow={1} backgroundColor={ui.bg} />
					</box>
				</Show>
				{/* The changes page owns the editor slot while it is up: it is a reading
            surface for the whole change set, not a modal over one file. */}
				<Show
					when={props.changesOpen}
					fallback={
						<Show
							when={activeViewer()}
							fallback={
								<Show
									when={props.renderedMarkdownPath}
									fallback={
										<EditorPane
											path={props.activePath}
											content={props.activeBuffer?.content ?? ''}
											filetype={props.activePath ? filetypeForPath(props.activePath!) : undefined}
											focused={props.focus === 'editor'}
											theme={props.config.theme}
											reloadKey={props.reloadKey}
											goto={props.goto}
											history={props.history}
											edit={props.edit}
											lineOp={props.lineOp}
											foldOp={props.foldOp}
											completion={props.completion}
											vim={props.config.vim}
											cursorStyle={props.config.cursorStyle}
											wrap={props.config.wrap}
											scrollPastEnd={props.config.scrollPastEnd}
											tabSize={props.config.tabSize}
											gitLines={props.gitLines}
											problems={props.problems}
											problemText={props.config.lspInline}
											reviews={props.reviews}
											reviewText={props.config.reviewInline}
											notice={props.notice}
											blocked={props.blocked}
											onChange={props.onEditorChange}
											onCursor={props.onCursor}
											onFocus={props.onEditorFocus}
											onVimMode={props.onVimMode}
											complete={props.onComplete}
											resolveCompletion={props.onResolveCompletion}
											onQuit={props.onQuit}
										/>
									}
								>
									{(path: () => string) => (
										<MarkdownView
											path={path()}
											name={basename(path())}
											content={props.activeBuffer?.content ?? ''}
											width={editorWidth()}
											theme={props.config.theme}
											focused={editorSlotFocused()}
											blocked={props.blocked}
											onFocus={props.onEditorFocus}
											onShowSource={props.onToggleMarkdown}
										/>
									)}
								</Show>
							}
						>
							{(path: () => string) => (
								<ViewerPane
									path={path()}
									width={editorWidth()}
									height={editorHeight()}
									focused={editorSlotFocused()}
									blocked={props.blocked}
									onFocus={props.onEditorFocus}
								/>
							)}
						</Show>
					}
				>
					<ChangesView
						sections={props.changeSections}
						meta={props.changesMeta}
						focusKey={props.changesFocus}
						title={props.changesTitle}
						mode={props.config.diffView}
						width={editorWidth()}
						focused={props.focus === 'editor'}
						blocked={props.blocked}
						staging={props.diffBase === null}
						onFocus={props.onEditorFocus}
						onToggleMode={props.onToggleDiffLayout}
						onToggleStage={props.onToggleStageSection}
						onClose={props.onCloseChanges}
					/>
				</Show>
			</box>
			<StatusBar
				message={props.status.msg}
				tone={props.status.tone}
				filetype={
					activeImage()
						? 'image'
						: activePdf()
							? 'pdf'
							: props.renderedMarkdownPath
								? 'md'
								: props.activePath
									? languageLabel(filetypeForPath(props.activePath!) ?? 'plain')
									: undefined
				}
				cursor={textBufferActive() ? props.cursor : undefined}
				dirty={props.activeBuffer?.dirty ?? false}
				vimMode={textBufferActive() ? props.vimMode : null}
				branch={props.branch}
				ahead={props.upstream?.ahead ?? 0}
				behind={props.upstream?.behind ?? 0}
				changed={props.gitStatus.size}
				problems={props.problemCounts}
				focus={props.renderedMarkdownPath ? 'editor' : props.focus}
				busy={props.busy}
			/>

			<Show when={props.promptTitle}>
				{(title: () => string) => (
					<PromptModal
						title={title()}
						initialValue={props.promptValue}
						history={props.promptHistory}
						onSubmit={props.onSubmitPrompt}
						onCancel={() => props.onCancelPrompt()}
					/>
				)}
			</Show>
			<Show when={props.confirmation}>
				{(ask: () => Confirmation) => (
					<ConfirmModal
						title={ask().title}
						verb={ask().verb}
						danger={ask().danger}
						message={ask().message}
						onConfirm={props.onConfirmPrompt}
						onCancel={() => props.onCancelPrompt()}
					/>
				)}
			</Show>
			<Show when={props.search}>
				{(open: () => { scope: SearchScope; replacing?: boolean }) => {
					const search = open();
					return (
						<SearchPanel
							scope={search.scope}
							rootDir={props.rootDir}
							activePath={props.activePath}
							activeContent={props.activeBuffer?.content ?? ''}
							initialQuery={props.selection}
							replacing={search.replacing}
							buffers={search.scope === 'project' ? props.searchBuffers : undefined}
							suspended={props.confirmation !== null}
							onPick={props.onPickSearch}
							onReplaceOne={props.onReplaceOne}
							onReplaceAll={props.onReplaceAll}
							onClose={() => props.onCloseSearch()}
						/>
					);
				}}
			</Show>
			<Show when={props.picker}>
				{(kind: () => 'files' | 'tabs') => (
					<FilePicker
						rootDir={props.rootDir}
						files={kind() === 'tabs' ? props.tabs : undefined}
						title={kind() === 'tabs' ? 'Switch tab' : 'Open file'}
						onPick={(path, position) => {
							props.onClosePicker();
							props.onPickFile(path, position);
						}}
						onClose={() => props.onClosePicker()}
					/>
				)}
			</Show>
			<Show when={props.palette}>
				<CommandPalette commands={props.commands} onClose={() => props.onClosePalette()} />
			</Show>
			<Show when={props.settingsPage}>
				<SettingsView
					rows={props.settingRows}
					scope={props.settingsScope}
					disabled={Boolean(props.promptTitle || props.confirmation)}
					onClose={() => props.onCloseSettings()}
				/>
			</Show>
			<Show when={props.problemsOpen}>
				<ChoiceModal
					title={props.problemsTitle}
					message="Enter jumps to the selected diagnostic."
					choices={props.problemChoices}
					onPick={props.onPickProblem}
					onCancel={props.onCloseProblems}
				/>
			</Show>
			<Show when={props.prompt?.kind === 'reviewKind' ? props.prompt : undefined}>
				{(ask: () => Extract<NonNullable<Prompt>, { kind: 'reviewKind' }>) => (
					<ReviewKindModal
						path={ask().path}
						line={ask().line}
						onPick={props.onChooseReviewKind}
						onCancel={props.onCancelPrompt}
					/>
				)}
			</Show>
			<Show when={props.lspStatusOpen}>
				<LspStatusView
					rows={props.lspStatusRows}
					onRestart={props.onRestartLspStatus}
					onUninstall={props.onUninstallLspStatus}
					onClose={props.onCloseLspStatus}
				/>
			</Show>
			<Show when={props.previewTarget}>
				{(target: () => { path: string; isDir: boolean }) => (
					<box
						position="absolute"
						top={1}
						left={
							props.sidebar && props.config.sidebarPosition !== 'right' ? props.treeWidth + 1 : 0
						}
						width={editorWidth()}
						height={editorHeight()}
						zIndex={65}
					>
						<PreviewPane
							path={target().path}
							isDir={target().isDir}
							buffer={props.buffers[target().path]?.content}
							width={editorWidth()}
							height={editorHeight()}
							scroll={props.previewScroll}
							onFocus={() => props.onEditorFocus()}
						/>
					</box>
				)}
			</Show>
			<Show when={props.diff}>
				{(files: () => DiffFile[]) => (
					<DiffView
						files={files()}
						mode={props.config.diffView}
						title={props.diffTitle}
						onClose={props.onCloseDiff}
					/>
				)}
			</Show>
			<Show when={props.branchChoices}>
				{(choices: () => Choice[]) => (
					<ChoiceModal
						title={props.branchChoiceTitle}
						message={props.branchChoiceMessage}
						choices={choices()}
						onPick={props.onPickBranch}
						onDelete={props.onDeleteBranchChoice}
						onCancel={props.onCloseBranchChoices}
					/>
				)}
			</Show>
			<Show when={props.commitFiles}>
				{(files: () => CommitFile[]) => (
					<CommitModal
						rootDir={props.rootDir}
						files={files()}
						onCommit={props.onCommitFiles}
						onCancel={() => props.onCancelCommit()}
					/>
				)}
			</Show>
			<Show when={props.conflict}>
				{(c: () => Conflict) => (
					<ChoiceModal
						title={c().deleted ? 'File deleted on disk' : 'File changed on disk'}
						message={
							c().deleted
								? `"${basename(c().path)}" was deleted on disk and has unsaved edits here.`
								: `"${basename(c().path)}" changed on disk and has unsaved edits here.`
						}
						choices={
							c().deleted
								? [
										{ id: 'overwrite', label: 'Write it back (recreate the file)' },
										{ id: 'cancel', label: 'Cancel (keep editing)' },
									]
								: [
										{ id: 'overwrite', label: 'Overwrite (keep my version)' },
										{ id: 'reload', label: 'Reload (discard my changes)' },
										{ id: 'cancel', label: 'Cancel' },
									]
						}
						onPick={props.onResolveConflict}
						onCancel={() => props.onCancelConflict()}
					/>
				)}
			</Show>
			<Show when={props.update}>
				{(info: () => UpdateInfo) => (
					<UpdateBanner
						update={info()}
						onClose={() => props.onCloseUpdate()}
						onSkip={props.onSkipUpdate}
					/>
				)}
			</Show>
			<Show when={props.peek}>
				<KeyPeek pane={props.focus} />
			</Show>
			<Show when={props.help}>
				<HelpOverlay />
			</Show>
		</box>
	);
}
