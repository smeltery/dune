/**
 * Command registry — the catalogue of everything dune can do. This tree is the
 * command palette (Ctrl+P), so it doubles as the feature index.
 *
 * A command either runs (`run`) or opens a submenu (`children`), never both.
 * Typing in the palette searches every leaf across all levels, so nesting keeps
 * the list short without hiding anything.
 *
 * To add a command: add an action to `CommandActions`, then an entry below. Set
 * `hint` when a keybinding also triggers it (keybindings live in keyboard.ts).
 */
import { THEME_ENTRIES, themeLabels } from '../themes';
import type { ThemeName } from '../themes';
import { isNewer } from '../core/update';
import { ALT } from '../ui/keys';
import { conflictCommands } from './commands/conflicts';
import type { LineOpRequest } from './types';

export interface Command {
	id: string;
	label: string;
	/** Keybinding shown right-aligned, e.g. "Ctrl+S". Leaves only. */
	hint?: string;
	preview?: () => void;
	cancelPreview?: () => void;
	run?: () => void;
	children?: Command[];
}

export interface CommandActions {
	save: () => void;
	saveAll: () => void;
	saveWithoutFormatting: () => void;
	formatActive: () => void;
	formatOpenFiles: () => void;
	openFile: () => void;
	openPathUnderCursor: () => void;
	goToDefinition: () => void;
	navigateBack: () => void;
	navigateForward: () => void;
	switchTab: () => void;
	closeOthers: () => void;
	closeAll: () => void;
	gotoLine: () => void;
	undo: () => void;
	redo: () => void;
	findInFile: () => void;
	findInProject: () => void;
	replaceInFile: () => void;
	replaceInProject: () => void;
	newFile: () => void;
	newFolder: () => void;
	rename: () => void;
	cutForMove: () => void;
	copyForPaste: () => void;
	copyPath: () => void;
	copyRelativePath: () => void;
	paste: () => void;
	remove: () => void;
	closeTab: () => void;
	reopenTab: () => void;
	nextTab: () => void;
	prevTab: () => void;
	toggleFocus: () => void;
	toggleSidebar: () => void;
	collapseSidebar: () => void;
	toggleDotfiles: () => void;
	toggleGitignored: () => void;
	toggleMarkdown: () => void;
	toggleWrap: () => void;
	toggleSidebarPosition: () => void;
	toggleDiffView: () => void;
	openSettings: () => void;
	openProjectSettings: () => void;
	openAppearancePlugins: () => void;
	listAppearancePlugins: () => void;
	checkAppearanceMarket: () => void;
	checkAppearanceUpdates: () => void;
	updateAppearancePlugins: () => void;
	installAppearancePlugin: () => void;
	installAppearancePluginById: (id: string) => void;
	toggleAppearancePlugin: (id: string) => void;
	removeAppearancePlugin: () => void;
	reloadAppearancePlugins: () => void;
	setVim: (enabled: boolean) => void;
	setTabSize: (size: number) => void;
	setTheme: (name: ThemeName) => void;
	previewTheme: (name: ThemeName) => void;
	cancelThemePreview: () => void;
	lineOp: (op: NonNullable<LineOpRequest>['op']) => void;
	foldOp: (op: import('../editor/folds').FoldOp) => void;
	resolveMergeConflict: () => void;
	acceptCurrentChange: () => void;
	acceptIncomingChange: () => void;
	acceptBothChanges: () => void;
	nextMergeConflict: () => void;
	prevMergeConflict: () => void;
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
	completion: () => void;
	reviewOpen: () => void;
	pluginsOpen: () => void;
	previewFile: () => void;
	reviewFetch: () => void;
	reviewNoteChooser: () => void;
	reviewNote: (kind: import('../core/review').NoteKind) => void;
	reviewReply: () => void;
	reviewClear: () => void;
	commit: () => void;
	commitPush: () => void;
	commitSync: () => void;
	commitAmend: () => void;
	sourceControl: () => void;
	gitStage: () => void;
	diffCurrent: () => void;
	discardCurrent: () => void;
	fileHistory: () => void;
	diffAll: () => void;
	compareBranches: () => void;
	compareBranchCommits: () => void;
	compareAgainstBranch: () => void;
	compareAgainstHead: () => void;
	switchBranch: () => void;
	newBranch: () => void;
	newBranchFrom: () => void;
	mergeBranch: () => void;
	renameBranch: () => void;
	deleteBranch: () => void;
	forceDeleteBranch: () => void;
	undoCommit: () => void;
	stash: () => void;
	stashPop: () => void;
	stashList: () => void;
	newTag: () => void;
	deleteTag: () => void;
	addRemote: () => void;
	removeRemote: () => void;
	fetch: () => void;
	pull: () => void;
	push: () => void;
	sync: () => void;
	showHelp: () => void;
	quit: () => void;
}

export interface CommandContext {
	vimEnabled: boolean;
	activeTheme: ThemeName;
	tabSize: number;
	wrap: boolean;
	trimOnSave: boolean;
	formatOnSave: boolean;
	autoSaveOnBlur: boolean;
	showDotfiles: boolean;
	respectGitignore: boolean;
	marketPlugins: readonly { id: string; name: string; version: string; description: string }[];
	installedPlugins: readonly { id: string; version: string; disabled?: boolean }[];
}

const TAB_SIZES = [2, 4, 8];
const MARKET_DESCRIPTION_LENGTH = 52;

/** Marks the entry matching the current setting, so submenus show state. */
const check = (on: boolean) => (on ? '* ' : '  ');

export function buildCommands(actions: CommandActions, ctx: CommandContext): Command[] {
	return [
		{ id: 'open', label: 'Open file…', hint: 'Ctrl+O', run: actions.openFile },
		{ id: 'save', label: 'Save file', hint: 'Ctrl+S', run: actions.save },
		{ id: 'settings', label: 'Settings', run: actions.openSettings },
		{ id: 'settings.project', label: 'Settings: this project', run: actions.openProjectSettings },
		{ id: 'goto', label: 'Go to line…', hint: 'Ctrl+G', run: actions.gotoLine },
		{ id: 'undo', label: 'Undo', hint: 'Ctrl+Z', run: actions.undo },
		{ id: 'redo', label: 'Redo', hint: 'Ctrl+Y', run: actions.redo },
		{
			id: 'find',
			label: 'Find',
			children: [
				{ id: 'find.file', label: 'In current file', hint: 'Ctrl+F', run: actions.findInFile },
				{
					id: 'find.project',
					label: 'In project',
					hint: 'Ctrl+R',
					run: actions.findInProject,
				},
				{
					id: 'find.replace',
					label: 'Replace in current file',
					hint: 'Ctrl+F then Tab',
					run: actions.replaceInFile,
				},
				{
					id: 'find.replaceProject',
					label: 'Replace in project',
					run: actions.replaceInProject,
				},
			],
		},
		{
			id: 'file',
			label: 'File',
			children: [
				{ id: 'file.new', label: 'New file', hint: 'Ctrl+N', run: actions.newFile },
				{ id: 'file.saveAll', label: 'Save all', run: actions.saveAll },
				{
					id: 'file.saveWithoutFormatting',
					label: 'Save without formatting',
					run: actions.saveWithoutFormatting,
				},
				{
					id: 'open.cursor',
					label: 'Open file under cursor',
					hint: `Ctrl+${ALT}+O`,
					run: actions.openPathUnderCursor,
				},
				{ id: 'file.newDir', label: 'New folder', hint: `Ctrl+${ALT}+N`, run: actions.newFolder },
				{ id: 'file.rename', label: 'Rename…', hint: 'r', run: actions.rename },
				{ id: 'file.cut', label: 'Cut for moving', hint: 'x', run: actions.cutForMove },
				{ id: 'file.copy', label: 'Copy', hint: 'c', run: actions.copyForPaste },
				{
					id: 'file.copyPath',
					label: 'Copy path',
					hint: `Ctrl+${ALT}+C`,
					run: actions.copyPath,
				},
				{ id: 'file.copyRelativePath', label: 'Copy relative path', run: actions.copyRelativePath },
				{ id: 'file.paste', label: 'Paste here', hint: 'p', run: actions.paste },
				{ id: 'file.delete', label: 'Delete…', hint: 'd', run: actions.remove },
			],
		},
		{
			id: 'tabs',
			label: 'Tabs',
			children: [
				{ id: 'tabs.switch', label: 'Switch to…', hint: 'Ctrl+T', run: actions.switchTab },
				{ id: 'tabs.close', label: 'Close tab', hint: 'Ctrl+W', run: actions.closeTab },
				{
					id: 'tabs.reopen',
					label: 'Reopen closed tab',
					hint: `Ctrl+${ALT}+T`,
					run: actions.reopenTab,
				},
				{ id: 'tabs.closeOthers', label: 'Close other tabs', run: actions.closeOthers },
				{ id: 'tabs.closeAll', label: 'Close all tabs', run: actions.closeAll },
				{ id: 'tabs.next', label: 'Next tab', hint: `Ctrl+${ALT}+→`, run: actions.nextTab },
				{ id: 'tabs.prev', label: 'Previous tab', hint: `Ctrl+${ALT}+←`, run: actions.prevTab },
				{
					id: 'navigation.back',
					label: 'Go back',
					hint: `Ctrl+${ALT}+Z`,
					run: actions.navigateBack,
				},
				{
					id: 'navigation.forward',
					label: 'Go forward',
					hint: `Ctrl+${ALT}+Y`,
					run: actions.navigateForward,
				},
			],
		},
		{
			id: 'view',
			label: 'View',
			children: [
				{
					id: 'view.sidebar',
					label: 'Toggle sidebar',
					hint: 'Ctrl+B',
					run: actions.toggleSidebar,
				},
				{
					id: 'view.focus',
					label: 'Focus tree / editor',
					hint: 'Tab in · Esc out',
					run: actions.toggleFocus,
				},
				{
					id: 'view.collapseSidebar',
					label: 'Collapse folders in sidebar',
					run: actions.collapseSidebar,
				},
				{
					id: 'view.markdown',
					label: 'Markdown: rendered / source',
					hint: `Ctrl+${ALT}+M`,
					run: actions.toggleMarkdown,
				},
				{
					id: 'view.preview',
					label: 'Preview file (no tab)',
					hint: 'Space in tree',
					run: actions.previewFile,
				},
				{
					id: 'view.wrap',
					label: `${check(ctx.wrap)}Word wrap`,
					run: actions.toggleWrap,
				},
				{
					id: 'view.sidebarPosition',
					label: 'Toggle sidebar position',
					run: actions.toggleSidebarPosition,
				},
				{
					id: 'view.dotfiles',
					label: `${check(ctx.showDotfiles)}Show dotfiles`,
					run: actions.toggleDotfiles,
				},
				{
					id: 'view.gitignored',
					label: `${check(ctx.respectGitignore)}Hide gitignored files`,
					run: actions.toggleGitignored,
				},
			],
		},
		{
			id: 'themes',
			label: 'Themes',
			children: [
				{
					id: 'themes.appearancePlugins',
					label: 'Plugin manager',
					run: actions.openAppearancePlugins,
				},
				{
					id: 'view.extensions',
					label: 'Plugins panel',
					hint: `Ctrl+${ALT}+X`,
					run: actions.pluginsOpen,
				},
				{
					id: 'themes.listAppearancePlugins',
					label: 'List local plugins',
					run: actions.listAppearancePlugins,
				},
				{
					id: 'themes.checkAppearanceMarket',
					label: 'Check plugin market',
					run: actions.checkAppearanceMarket,
				},
				{
					id: 'themes.checkAppearanceUpdates',
					label: 'Check plugin updates',
					run: actions.checkAppearanceUpdates,
				},
				{
					id: 'themes.updateAppearancePlugins',
					label: 'Update plugins',
					run: actions.updateAppearancePlugins,
				},
				{
					id: 'themes.installAppearancePlugin',
					label: 'Install plugin…',
					run: actions.installAppearancePlugin,
				},
				...ctx.marketPlugins.map((plugin) => {
					const installed = ctx.installedPlugins.find((entry) => entry.id === plugin.id);
					const action = installed
						? isNewer(plugin.version, installed.version)
							? 'Update'
							: 'Installed'
						: 'Install';
					return {
						id: `themes.installAppearancePlugin.${plugin.id}`,
						label: `${action} ${plugin.name} ${plugin.version}${plugin.description ? ` - ${plugin.description.slice(0, MARKET_DESCRIPTION_LENGTH)}` : ''}`,
						run: () => actions.installAppearancePluginById(plugin.id),
					};
				}),
				{
					id: 'themes.removeAppearancePlugin',
					label: 'Remove plugin…',
					run: actions.removeAppearancePlugin,
				},
				...ctx.installedPlugins
					.filter((plugin) => plugin.disabled !== undefined)
					.map((plugin) => ({
						id: `themes.toggleAppearancePlugin.${plugin.id}`,
						label: `${plugin.disabled ? 'Enable' : 'Disable'} ${plugin.id} ${plugin.version}`,
						run: () => actions.toggleAppearancePlugin(plugin.id),
					})),
				{
					id: 'themes.reloadAppearancePlugins',
					label: 'Reload local plugins',
					run: actions.reloadAppearancePlugins,
				},
				...THEME_ENTRIES.map(([name]) => ({
					id: `themes.${name}`,
					label: `${check(ctx.activeTheme === name)}${themeLabels[name]}`,
					preview: () => actions.previewTheme(name),
					cancelPreview: actions.cancelThemePreview,
					run: () => actions.setTheme(name),
				})),
			],
		},
		{
			id: 'editor',
			label: 'Editor',
			children: [
				// Also commands because the chords are not always sendable: some layouts
				// have no byte for Ctrl+/ at all.
				{
					id: 'editor.complete',
					label: 'Show completions',
					run: actions.completion,
				},
				{
					id: 'goto.definition',
					label: 'Go to definition',
					hint: 'F12',
					run: actions.goToDefinition,
				},
				{
					id: 'editor.comment',
					label: 'Toggle comment',
					hint: 'Ctrl+/ · Ctrl+L',
					run: () => actions.lineOp('comment'),
				},
				{
					id: 'editor.lineUp',
					label: 'Move line up',
					hint: `${ALT}+↑`,
					run: () => actions.lineOp('up'),
				},
				{
					id: 'editor.lineDown',
					label: 'Move line down',
					hint: `${ALT}+↓`,
					run: () => actions.lineOp('down'),
				},
				{
					id: 'editor.duplicate',
					label: 'Duplicate line',
					hint: `${ALT}+Shift+↓`,
					run: () => actions.lineOp('duplicate'),
				},
				{
					id: 'editor.deleteLine',
					label: 'Delete line',
					hint: `Ctrl+${ALT}+D`,
					run: () => actions.lineOp('delete'),
				},
				{
					id: 'editor.lineStart',
					label: 'Go to beginning of line',
					hint: `Ctrl+${ALT}+B`,
					run: () => actions.lineOp('lineHome'),
				},
				{
					id: 'editor.fold',
					label: 'Fold block at cursor',
					hint: `Ctrl+${ALT}+S`,
					run: () => actions.foldOp('fold'),
				},
				{
					id: 'editor.unfold',
					label: 'Unfold block at cursor',
					hint: `Ctrl+${ALT}+E`,
					run: () => actions.foldOp('unfold'),
				},
				{
					id: 'editor.foldAll',
					label: 'Fold everything',
					run: () => actions.foldOp('foldAll'),
				},
				{
					id: 'editor.unfoldAll',
					label: 'Unfold everything',
					run: () => actions.foldOp('unfoldAll'),
				},
				...conflictCommands(actions),
				{
					id: 'editor.vimOn',
					label: `${check(ctx.vimEnabled)}Vim mode on`,
					run: () => actions.setVim(true),
				},
				{
					id: 'editor.vimOff',
					label: `${check(!ctx.vimEnabled)}Vim mode off`,
					run: () => actions.setVim(false),
				},
				{
					id: 'editor.tabSize',
					label: 'Tab size',
					children: TAB_SIZES.map((size) => ({
						id: `editor.tabSize.${size}`,
						label: `${check(ctx.tabSize === size)}${size} spaces`,
						run: () => actions.setTabSize(size),
					})),
				},
				{
					id: 'editor.wrap',
					label: `${check(ctx.wrap)}Word wrap`,
					run: actions.toggleWrap,
				},
				{
					id: 'editor.trim',
					label: `${check(ctx.trimOnSave)}Trim trailing whitespace on save`,
					run: actions.toggleTrim,
				},
				{
					id: 'editor.formatOnSave',
					label: `${check(ctx.formatOnSave)}Format on save`,
					run: actions.toggleFormat,
				},
				{
					id: 'editor.format',
					label: 'Format document',
					hint: `Ctrl+${ALT}+L`,
					run: actions.formatActive,
				},
				{
					id: 'editor.formatOpen',
					label: 'Format open files',
					run: actions.formatOpenFiles,
				},
				{
					id: 'editor.autoSave',
					label: `${check(ctx.autoSaveOnBlur)}Auto-save on blur and tab switch`,
					run: actions.toggleAutoSave,
				},
			],
		},
		{
			id: 'appearance',
			label: 'Appearance',
			children: [
				{
					id: 'appearance.transparent',
					label: 'Transparent background',
					run: actions.toggleTransparent,
				},
			],
		},
		{
			id: 'review',
			label: 'Review',
			children: [
				{
					id: 'review.open',
					label: 'Open review panel',
					hint: `Ctrl+${ALT}+R`,
					run: actions.reviewOpen,
				},
				{
					id: 'review.note',
					label: 'Note this line…',
					hint: `Ctrl+${ALT}+A`,
					run: actions.reviewNoteChooser,
				},
				{ id: 'review.issue', label: 'Add issue note', run: () => actions.reviewNote('issue') },
				{
					id: 'review.suggestion',
					label: 'Add suggestion note',
					run: () => actions.reviewNote('suggestion'),
				},
				{
					id: 'review.question',
					label: 'Add question note',
					run: () => actions.reviewNote('question'),
				},
				{ id: 'review.note.plain', label: 'Add note', run: () => actions.reviewNote('note') },
				{
					id: 'review.reply',
					label: 'Reply to the remark under the cursor…',
					run: actions.reviewReply,
				},
				{
					id: 'review.fetch',
					label: 'Fetch pull request comments',
					run: actions.reviewFetch,
				},
				{ id: 'review.clear', label: 'Clear review notes', run: actions.reviewClear },
			],
		},
		{
			id: 'problems',
			label: 'Problems',
			children: [
				{ id: 'problems.list', label: 'List problems', run: actions.problemsList },
				{
					id: 'problems.detail',
					label: 'Show problem at cursor',
					hint: `Ctrl+${ALT}+I`,
					run: actions.problemsAtCursor,
				},
				{ id: 'problems.next', label: 'Next problem', run: actions.problemsNext },
				{ id: 'problems.prev', label: 'Previous problem', run: actions.problemsPrev },
				{ id: 'problems.restart', label: 'Restart language servers', run: actions.problemsRestart },
				{ id: 'problems.lspStatus', label: 'Language server status', run: actions.lspStatus },
			],
		},
		{
			id: 'git',
			label: 'Git',
			children: [
				{ id: 'git.commit', label: 'Commit…', run: actions.commit },
				{ id: 'git.sourceControl', label: 'Source control panel', run: actions.sourceControl },
				{ id: 'git.stage', label: 'Stage / unstage current file', run: actions.gitStage },
				{ id: 'git.diffCurrent', label: 'Diff current file', run: actions.diffCurrent },
				{ id: 'git.discardCurrent', label: 'Discard changes', run: actions.discardCurrent },
				{ id: 'git.fileHistory', label: 'File history…', run: actions.fileHistory },
				{ id: 'git.diffAll', label: 'Diff all changes', run: actions.diffAll },
				{
					id: 'git.diffLayout',
					label: 'Toggle diff layout (inline / side-by-side)',
					run: actions.toggleDiffView,
				},
				{
					id: 'git.compareAgainstBranch',
					label: 'Compare against branch…',
					run: actions.compareAgainstBranch,
				},
				{
					id: 'git.compareAgainstHead',
					label: 'Compare against HEAD',
					run: actions.compareAgainstHead,
				},
				{ id: 'git.compareBranches', label: 'Compare branches', run: actions.compareBranches },
				{
					id: 'git.compareBranchCommits',
					label: 'Compare branch commits',
					run: actions.compareBranchCommits,
				},
				{ id: 'git.switchBranch', label: 'Switch branch…', run: actions.switchBranch },
				{ id: 'git.newBranch', label: 'New branch…', run: actions.newBranch },
				{ id: 'git.newBranchFrom', label: 'New branch from…', run: actions.newBranchFrom },
				{ id: 'git.mergeBranch', label: 'Merge branch…', run: actions.mergeBranch },
				{ id: 'git.renameBranch', label: 'Rename branch…', run: actions.renameBranch },
				{ id: 'git.deleteBranch', label: 'Delete branch…', run: actions.deleteBranch },
				{
					id: 'git.forceDeleteBranch',
					label: 'Delete branch (force)…',
					run: actions.forceDeleteBranch,
				},
				{ id: 'git.undoCommit', label: 'Undo last commit…', run: actions.undoCommit },
				{ id: 'git.stash', label: 'Stash changes', run: actions.stash },
				{ id: 'git.stashPop', label: 'Stash pop', run: actions.stashPop },
				{ id: 'git.stashList', label: 'Stashes…', run: actions.stashList },
				{ id: 'git.newTag', label: 'Create tag…', run: actions.newTag },
				{ id: 'git.deleteTag', label: 'Delete tag…', run: actions.deleteTag },
				{ id: 'git.addRemote', label: 'Add remote…', run: actions.addRemote },
				{ id: 'git.removeRemote', label: 'Remove remote…', run: actions.removeRemote },
				{ id: 'git.fetch', label: 'Fetch', run: actions.fetch },
				{ id: 'git.pull', label: 'Pull (fast-forward only)', run: actions.pull },
				{ id: 'git.push', label: 'Push', run: actions.push },
				{ id: 'git.sync', label: 'Sync / publish', run: actions.sync },
				{ id: 'git.commitPush', label: 'Commit & push…', run: actions.commitPush },
				{ id: 'git.commitSync', label: 'Commit & sync…', run: actions.commitSync },
				{ id: 'git.commitAmend', label: 'Commit (amend)…', run: actions.commitAmend },
			],
		},
		{ id: 'help', label: 'Keyboard shortcuts', run: actions.showHelp },
		{ id: 'quit', label: 'Quit', hint: 'Ctrl+Q', run: actions.quit },
	];
}

export interface FlatCommand {
	command: Command;
	/** Breadcrumb of ancestor labels, e.g. ["Themes"]. */
	trail: string[];
}

/** Every runnable leaf, with its path — used while filtering. */
export function flattenCommands(commands: Command[], trail: string[] = []): FlatCommand[] {
	return commands.flatMap((command) =>
		command.children
			? flattenCommands(command.children, [...trail, command.label])
			: [{ command, trail }],
	);
}
