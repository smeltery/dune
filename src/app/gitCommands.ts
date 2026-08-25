import { relative } from 'node:path';
import { createSignal } from 'solid-js';

import type { ChangeSection, ChangesMeta } from '../core/changeSections';
import { orderedChanges, rowSlotKey, slotKey, takeChangeSections } from '../core/changeSections';
import type { ChangeRow } from '../core/changeTree';
import { changesFor, changesFromEntries, rowArea } from '../core/changeTree';
import {
	addRemote,
	amendCommit,
	commitPaths,
	commitStaged,
	createBranch,
	createTag,
	defaultBranch,
	deleteBranch,
	deleteTag,
	diffFiles,
	discardChanges,
	fetch as gitFetch,
	inRepository,
	lastCommitSubject,
	listBranches,
	listRemotes,
	listTags,
	localBranchName,
	mergeBranch,
	pullAndPush,
	pull as gitPull,
	push as gitPush,
	PUSH_REJECTED,
	recentCommitMessages,
	removeRemote,
	renameBranch,
	stagedPaths,
	stagePaths,
	stashApply,
	stashDrop,
	listStashes,
	stashPop,
	stashPush,
	switchBranch,
	statusEntries,
	statusMap,
	undoLastCommit,
	unstagePaths,
} from '../core/git';
import { stepHistory } from '../core/messageHistory';
import { unifiedDiff } from '../core/diff';
import {
	areaDiffFile,
	branchBehindCount,
	branchDiffCommits,
	branchDiffFiles,
	commitDiffFiles,
	commitsForFile,
	commitSummary,
} from '../core/gitDiff';
import type { FileStatus, GitResult, StatusEntry, Upstream } from '../core/git';
import type { DiffFile } from '../core/gitDiff';
import type { CommitFile } from '../ui/CommitModal';
import type { Tone } from '../ui/StatusBar';
import type { SidebarView } from './panes';
import type { Prompt } from './types';

export function createGitCommands(deps: {
	rootDir: string;
	gitScanDepth: () => number;
	activePath: () => string | null;
	branch: () => string | null;
	diffBase: () => string | null;
	/** The panel's own status, so the stacked page reuses the scan App already ran. */
	statusEntries: () => Map<string, StatusEntry>;
	upstream: () => Upstream | null;
	setDiffBase: (base: string | null) => void;
	setBusy: (busy: { label: string; done: number; total: number } | null) => void;
	setGitRevision: (update: (n: number) => number) => void;
	setPrompt: (prompt: Prompt) => void;
	say: (msg: string, tone?: Tone) => void;
	whileFree: (run: () => void) => void;
	syncFromDisk: () => void;
	showView: (view: SidebarView) => void;
}) {
	const diffBase = deps.diffBase;
	const setDiffBase = deps.setDiffBase;
	const [commitFiles, setCommitFiles] = createSignal<CommitFile[] | null>(null);
	const [commitSelection, setCommitSelection] = createSignal<string[]>([]);
	/** What "Commit & push"/"Commit & sync" asked for, remembered across the file picker. */
	const [commitVariant, setCommitVariant] = createSignal<'plain' | 'push' | 'sync'>('plain');
	const [commitMessageHistory, setCommitMessageHistory] = createSignal<string[]>([]);
	const [commitMessage, setCommitMessage] = createSignal('');
	const [messageEditing, setMessageEditing] = createSignal(false);
	const [messageHistory, setMessageHistory] = createSignal<string[]>([]);
	const [messageAt, setMessageAt] = createSignal(-1);
	const [messageDraft, setMessageDraft] = createSignal('');
	const [diff, setDiff] = createSignal<DiffFile[] | null>(null);
	const [diffTitle, setDiffTitle] = createSignal<string | null>(null);
	type BranchMode =
		| 'commitDiff'
		| 'commits'
		| 'compare'
		| 'delete'
		| 'deleteForce'
		| 'deleteTag'
		| 'diffBase'
		| 'fileHistory'
		| 'from'
		| 'merge'
		| 'removeRemote'
		| 'rename'
		| 'stash'
		| 'switch';
	const [branchMode, setBranchMode] = createSignal<BranchMode>('compare');
	const BRANCH_CHOICE_COPY: Record<BranchMode, { title: string; message: string }> = {
		switch: { title: 'Switch to branch', message: 'Enter checks out the selected branch.' },
		commits: {
			title: 'Compare commits against branch',
			message: 'Enter lists commits ahead of the selected branch.',
		},
		commitDiff: { title: 'Open commit diff', message: 'Enter opens the selected commit diff.' },
		merge: {
			title: 'Merge into current branch',
			message: 'Enter chooses a branch to merge into the current branch.',
		},
		rename: { title: 'Rename branch', message: 'Enter chooses a branch to rename.' },
		delete: { title: 'Delete branch', message: 'Enter chooses a branch to delete.' },
		deleteForce: {
			title: 'Delete branch (force)',
			message: 'Enter chooses a branch to force delete.',
		},
		diffBase: {
			title: 'Compare against branch',
			message: 'Enter makes the editor compare changes against this branch.',
		},
		from: { title: 'New branch from', message: 'Enter chooses the start point for a new branch.' },
		stash: { title: 'Stashes', message: 'Enter applies the selected stash; Backspace drops it.' },
		deleteTag: { title: 'Delete tag', message: 'Enter chooses a tag to delete.' },
		fileHistory: {
			title: 'File history',
			message: "Enter opens the selected commit's diff for this file.",
		},
		removeRemote: { title: 'Remove remote', message: 'Enter chooses a remote to remove.' },
		compare: {
			title: 'Compare against branch',
			message: 'Enter compares the current branch against the selected branch.',
		},
	};
	const [branchChoices, setBranchChoices] = createSignal<{ id: string; label: string }[] | null>(
		null,
	);
	/** Which file "File history…" is listing commits for, so picking one scopes the diff to it. */
	const [historyPath, setHistoryPath] = createSignal<string | null>(null);

	const runGit = (label: string, action: () => Promise<GitResult>, success: string) => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		deps.whileFree(
			() =>
				void (async () => {
					deps.setBusy({ label, done: 0, total: 0 });
					const result = await action();
					deps.setBusy(null);
					deps.setGitRevision((n) => n + 1);
					deps.syncFromDisk();
					if (!result.ok) return deps.say(result.detail || `${label} failed`, 'error');
					deps.say(result.detail || success);
				})(),
		);
	};

	const openCommitPicker = (variant: 'plain' | 'push' | 'sync' = 'plain') => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const statuses = statusMap(deps.rootDir, null, deps.gitScanDepth());
		if (statuses.size === 0) return deps.say('Nothing to commit', 'warn');
		setCommitVariant(variant);
		const staged = stagedPaths(deps.rootDir);
		setCommitFiles(
			[...statuses]
				.map(([path, status]) => ({ path, status, staged: staged.has(path) }))
				.toSorted((a, b) =>
					relative(deps.rootDir, a.path).localeCompare(relative(deps.rootDir, b.path)),
				),
		);
	};

	const [changesOpen, setChangesOpen] = createSignal(false);
	const [changeSections, setChangeSections] = createSignal<ChangeSection[]>([]);
	const [changesMeta, setChangesMeta] = createSignal<ChangesMeta>({ total: 0, adds: 0, dels: 0 });
	/** Which section the panel's cursor is on, so the page can scroll to it. */
	const [changesFocus, setChangesFocus] = createSignal<string | null>(null);

	const panelChanges = () => changesFromEntries(deps.rootDir, deps.statusEntries());

	/**
	 * Rebuild the stacked page from the status the panel is showing. Sections are
	 * reused where neither text moved, so a git refresh does not remount the stack
	 * and lose its scroll position.
	 */
	const rebuildChanges = () => {
		const changes = panelChanges();
		const prev = new Map(changeSections().map((section) => [section.key, section]));
		const { sections, adds, dels } = takeChangeSections(
			orderedChanges(changes),
			(change) =>
				areaDiffFile(change.path, change.rel, change.status, change.area, diffBase(), undefined),
			prev,
			changesFocus(),
		);
		setChangeSections(sections);
		setChangesMeta({ total: changes.length, adds, dels });
	};

	/**
	 * Show every change over the editor slot. The source-control panel is the list
	 * that pages it, so this opens the panel as well — a page whose arrows have
	 * nowhere to live is a dead end.
	 */
	const showChanges = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		deps.showView('git');
		if (panelChanges().length === 0) return deps.say('No changes', 'warn');
		setChangesOpen(true);
		rebuildChanges();
	};

	/**
	 * Point the page at the panel's cursor. A heading or folder row leaves it as it
	 * was — folding a folder must not throw the reader onto another file. The stack
	 * is rebuilt when the cursor lands on a file the row cap left out, so the page
	 * and the cursor cannot disagree about which change is on screen.
	 */
	const focusChange = (row: ChangeRow | undefined) => {
		const key = rowSlotKey(row);
		if (!changesOpen() || key === null) return;
		setChangesFocus(key);
		if (!changeSections().some((section) => section.key === key)) rebuildChanges();
	};

	/**
	 * Re-read the repository under the open page. It is a snapshot taken when it
	 * opened, so a commit, stash or save made anywhere else would otherwise leave it
	 * showing changes that no longer exist. Not a command: App runs it whenever git
	 * moves.
	 */
	const refreshChanges = () => {
		if (!changesOpen()) return;
		// Opening an empty page from the palette still explains itself; a commit or
		// discard that cleared the last change should not leave a message covering
		// the editor.
		const had = changesMeta().total > 0;
		rebuildChanges();
		if (had && changesMeta().total === 0) setChangesOpen(false);
	};

	/** Stage or unstage the file one section names — Space on the page's header. */
	const toggleStageSection = (key: string) => {
		const section = changeSections().find((entry) => entry.key === key);
		if (!section) return;
		const change = panelChanges().find((entry) => slotKey(entry.path, entry.area) === key);
		if (!change) return deps.say('Nothing to stage', 'warn');
		toggleStage(deps.statusEntries(), { kind: 'file', depth: 0, label: section.rel, change });
	};

	const openDiff = (path?: string | null) => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const files = diffFiles(deps.rootDir, path ?? undefined, diffBase(), deps.gitScanDepth());
		if (files.length === 0)
			return deps.say(path ? 'No changes in current file' : 'No changes', 'warn');
		setDiffTitle(null);
		setDiff(files);
	};

	const promptDiscard = (path: string, status?: FileStatus) => {
		const resolved = status ?? statusMap(deps.rootDir, null, deps.gitScanDepth()).get(path);
		if (!resolved) return deps.say('No changes to discard', 'warn');
		deps.setPrompt({ kind: 'discardChanges', path, status: resolved });
	};

	const discard = (path: string, status: FileStatus) =>
		runGit('Discarding changes', () => discardChanges(path, status), 'Discarded changes');

	const openStashList = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const stashes = listStashes(deps.rootDir);
		if (stashes.length === 0) return deps.say('No stashes');
		setBranchMode('stash');
		setBranchChoices(stashes.map((entry) => ({ id: entry.ref, label: entry.message })));
	};

	const openTagCreate = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		deps.setPrompt({ kind: 'newTag' });
	};

	const openTagDelete = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const tags = listTags(deps.rootDir);
		if (tags.length === 0) return deps.say('No tags');
		setBranchMode('deleteTag');
		setBranchChoices(tags.map((name) => ({ id: name, label: name })));
	};

	const submitTag = (name: string) =>
		runGit('Creating tag', () => createTag(deps.rootDir, name), `Tagged ${name}`);

	const removeTag = (name: string) =>
		runGit('Deleting tag', () => deleteTag(deps.rootDir, name), `Deleted tag ${name}`);

	const openRemoteAdd = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		deps.setPrompt({ kind: 'newRemoteName' });
	};

	const openRemoteRemove = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const remotes = listRemotes(deps.rootDir);
		if (remotes.length === 0) return deps.say('No remotes');
		setBranchMode('removeRemote');
		setBranchChoices(remotes.map((name) => ({ id: name, label: name })));
	};

	const submitRemoteName = (name: string) => deps.setPrompt({ kind: 'newRemoteUrl', name });

	const submitRemote = (name: string, url: string) =>
		runGit('Adding remote', () => addRemote(deps.rootDir, name, url), `Added remote ${name}`);

	const removeRemoteConfirmed = (name: string) =>
		runGit('Removing remote', () => removeRemote(deps.rootDir, name), `Removed remote ${name}`);

	const compareWith = (base: string) => {
		const files = branchDiffFiles(deps.rootDir, base);
		const commits = branchDiffCommits(deps.rootDir, base);
		const behind = branchBehindCount(deps.rootDir, base);
		if (files.length === 0) {
			deps.say(`No differences from ${base}: ↑${commits.length} ↓${behind}, 0 files`);
			return;
		}
		const stats = files
			.map((file) => unifiedDiff(file.rel, file.oldText, file.newText))
			.reduce(
				(total, patch) => ({ adds: total.adds + patch.adds, dels: total.dels + patch.dels }),
				{ adds: 0, dels: 0 },
			);
		const binary = files.filter((file) => file.binary).length;
		const binaryPart = binary === 0 ? '' : `, ${binary} binary`;
		setDiffTitle(`Comparing against ${base}`);
		setDiff(files);
		deps.say(
			`Comparing against ${base}: ↑${commits.length} ↓${behind}, ${files.length} files${binaryPart}, +${stats.adds} -${stats.dels}`,
		);
	};

	const openBranchComparison = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter((branch) => branch.name !== deps.branch());
		if (branches.length === 0) {
			const base = defaultBranch(deps.rootDir);
			return base ? compareWith(base) : deps.say('No branch to compare against', 'warn');
		}
		setBranchMode('compare');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const openDiffBasePicker = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter((branch) => branch.name !== deps.branch());
		if (branches.length === 0) return deps.say('No branch to compare against', 'warn');
		setBranchMode('diffBase');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const resetDiffBase = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		if (diffBase() === null) return deps.say('Already comparing against HEAD');
		setDiffBase(null);
		deps.setGitRevision((n) => n + 1);
		deps.say('Comparing against HEAD');
	};

	const openCommitDiff = (oid: string, path?: string) => {
		const files = commitDiffFiles(deps.rootDir, oid, path);
		if (files.length === 0) return deps.say('No files changed in that commit', 'warn');
		const commit = commitSummary(deps.rootDir, oid);
		setDiffTitle(
			commit ? `${commit.shortOid} ${commit.subject} by ${commit.authorName}` : `Commit ${oid}`,
		);
		setDiff(files);
	};

	const showCommitChoices = (base: string) => {
		const commits = branchDiffCommits(deps.rootDir, base);
		if (commits.length === 0) return deps.say(`No commits ahead of ${base}`, 'warn');
		setBranchMode('commitDiff');
		setBranchChoices(
			commits.map((commit) => ({
				id: commit.oid,
				label: `${commit.shortOid}  ${commit.subject}  ${commit.authorName}`,
			})),
		);
	};

	const openFileHistory = (path: string) => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const commits = commitsForFile(deps.rootDir, path);
		if (commits.length === 0) return deps.say('No history for this file', 'warn');
		setHistoryPath(path);
		setBranchMode('fileHistory');
		setBranchChoices(
			commits.map((commit) => ({
				id: commit.oid,
				label: `${commit.shortOid}  ${commit.subject}  ${commit.authorName}`,
			})),
		);
	};

	const openBranchCommitComparison = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter((branch) => branch.name !== deps.branch());
		if (branches.length === 0) {
			const base = defaultBranch(deps.rootDir);
			return base ? showCommitChoices(base) : deps.say('No branch to compare against', 'warn');
		}
		setBranchMode('commits');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const openBranchSwitch = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter((branch) => !branch.current);
		if (branches.length === 0) return deps.say('No other branch to switch to', 'warn');
		setBranchMode('switch');
		setBranchChoices(
			branches.map((branch) => ({
				id: branch.name,
				label: branch.remote ? `${branch.name}  remote` : branch.name,
			})),
		);
	};

	const openBranchMerge = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter((branch) => !branch.current);
		if (branches.length === 0) return deps.say('No other branch to merge', 'warn');
		setBranchMode('merge');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const openBranchRename = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter((branch) => !branch.remote);
		if (branches.length === 0) return deps.say('No local branch to rename', 'warn');
		setBranchMode('rename');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const openBranchDelete = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter(
			(branch) => !branch.remote && !branch.current,
		);
		if (branches.length === 0) return deps.say('No other local branch to delete', 'warn');
		setBranchMode('delete');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const openBranchForceDelete = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir).filter(
			(branch) => !branch.remote && !branch.current,
		);
		if (branches.length === 0) return deps.say('No other local branch to delete', 'warn');
		setBranchMode('deleteForce');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const openBranchFrom = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const branches = listBranches(deps.rootDir);
		if (branches.length === 0) return deps.say('No branch to start from', 'warn');
		setBranchMode('from');
		setBranchChoices(branches.map((branch) => ({ id: branch.name, label: branch.name })));
	};

	const startCommit = (paths: string[]) => {
		setCommitFiles(null);
		setCommitSelection(paths);
		setCommitMessageHistory(recentCommitMessages(deps.rootDir));
		deps.setPrompt({ kind: 'commitMessage' });
	};

	const loadMessageHistory = () => {
		setMessageAt(-1);
		setMessageDraft('');
		setMessageHistory(recentCommitMessages(deps.rootDir));
	};

	const focusCommitBox = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		if (diffBase() !== null)
			return deps.say('Comparing against a branch — nothing to commit here', 'warn');
		deps.showView('git');
		setMessageEditing(true);
		loadMessageHistory();
	};

	const typeMessage = (value: string) => {
		setCommitMessage(value);
		const at = messageAt();
		if (at >= 0 && value !== messageHistory()[at]) setMessageAt(-1);
	};

	const walkMessageHistory = (delta: number) => {
		const step = stepHistory(messageHistory(), messageAt(), delta, commitMessage(), messageDraft());
		if (!step) return;
		setMessageAt(step.at);
		setMessageDraft(step.draft);
		setCommitMessage(step.value);
	};

	const submitCommitAll = (message: string) => {
		const paths = [...statusMap(deps.rootDir, null, deps.gitScanDepth()).keys()];
		if (paths.length === 0) return deps.say('Nothing to commit', 'warn');
		setCommitMessage('');
		runGit('Committing', () => commitPaths(deps.rootDir, message, paths), 'Committed');
	};

	const commitFromBox = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		if (diffBase() !== null)
			return deps.say('Comparing against a branch — nothing to commit here', 'warn');
		const message = commitMessage().trim();
		if (!message) return deps.say('Enter a commit message', 'warn');
		setMessageEditing(false);
		const staged = stagedPaths(deps.rootDir);
		if (staged.size > 0) {
			setCommitMessage('');
			return runGit('Committing', () => commitStaged(deps.rootDir, message), 'Committed');
		}
		const count = statusMap(deps.rootDir, null, deps.gitScanDepth()).size;
		if (count === 0) return deps.say('Nothing to commit — working tree clean');
		deps.setPrompt({ kind: 'commitAll', message, count });
	};

	const submitCommit = (message: string) => {
		const paths = commitSelection();
		const variant = commitVariant();
		setCommitSelection([]);
		setCommitVariant('plain');
		if (paths.length === 0) return deps.say('Nothing selected', 'warn');
		if (variant === 'plain') {
			return runGit('Committing', () => commitPaths(deps.rootDir, message, paths), 'Committed');
		}
		const name = deps.branch();
		const hasUpstream = !!deps.upstream()?.name;
		runGit(
			variant === 'push' ? 'Committing and pushing' : 'Committing and syncing',
			async () => {
				if (!name) return { ok: false, detail: 'No branch to push' };
				const committed = await commitPaths(deps.rootDir, message, paths);
				if (!committed.ok) return committed;
				if (variant === 'push') {
					const pushed = await gitPush(deps.rootDir, name, hasUpstream);
					if (!pushed.ok && pushed.detail === PUSH_REJECTED) {
						deps.setPrompt({ kind: 'pullPush', branch: name, hasUpstream });
					}
					return pushed;
				}
				return pullAndPush(deps.rootDir, name, hasUpstream);
			},
			variant === 'push' ? 'Committed and pushed' : 'Committed and synced',
		);
	};

	const promptAmend = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const subject = lastCommitSubject(deps.rootDir);
		if (!subject) return deps.say('No commit to amend', 'warn');
		setCommitMessageHistory(recentCommitMessages(deps.rootDir));
		deps.setPrompt({ kind: 'commitAmend', subject });
	};

	const submitAmend = (message: string) =>
		runGit('Amending commit', () => amendCommit(deps.rootDir, message), 'Amended commit');

	const submitBranch = (name: string, from?: string | null) => {
		runGit('Creating branch', () => createBranch(deps.rootDir, name, from), `On ${name}`);
	};

	const rename = (from: string, to: string) => {
		runGit(
			'Renaming branch',
			() => renameBranch(deps.rootDir, from, to),
			`Renamed ${from} to ${to}`,
		);
	};

	const remove = (name: string, force: boolean) => {
		runGit('Deleting branch', () => deleteBranch(deps.rootDir, name, force), `Deleted ${name}`);
	};

	const confirmUndoCommit = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		const subject = lastCommitSubject(deps.rootDir);
		if (!subject) return deps.say('No commit to undo', 'warn');
		deps.setPrompt({ kind: 'undoCommit', subject });
	};

	const openBranchPrompt = () => {
		if (!inRepository(deps.rootDir)) return deps.say('Not a git repository', 'warn');
		deps.setPrompt({ kind: 'newBranch' });
	};

	const merge = (name: string) => {
		runGit('Merging', () => mergeBranch(deps.rootDir, name), `Merged ${name}`);
	};

	const pullPush = (branch: string, hasUpstream: boolean) => {
		runGit('Merging origin', () => pullAndPush(deps.rootDir, branch, hasUpstream), 'Pushed');
	};

	const pushBranch = () =>
		runGit(
			'Pushing',
			async () => {
				const name = deps.branch();
				if (!name) return { ok: false, detail: 'No branch to push' };
				const hasUpstream = !!deps.upstream()?.name;
				const result = await gitPush(deps.rootDir, name, hasUpstream);
				if (!result.ok && result.detail === PUSH_REJECTED)
					deps.setPrompt({ kind: 'pullPush', branch: name, hasUpstream });
				return result;
			},
			'Pushed',
		);

	const syncBranch = () => {
		const name = deps.branch();
		if (!name) return deps.say('No branch to sync', 'warn');
		const hasUpstream = !!deps.upstream()?.name;
		if (!hasUpstream) {
			runGit('Publishing', () => gitPush(deps.rootDir, name, false), `Published ${name}`);
			return;
		}
		runGit('Syncing', () => pullAndPush(deps.rootDir, name, true), 'Synced');
	};

	const toggleStage = (entries: Map<string, StatusEntry>, row: ChangeRow) => {
		if (diffBase() !== null)
			return deps.say('Staging compares against HEAD — reset the comparison base', 'warn');
		const changes = changesFromEntries(deps.rootDir, entries);
		const targets = changesFor(changes, row);
		if (targets.length === 0) return deps.say('Nothing to stage', 'warn');
		const area = rowArea(row);
		const paths = [...new Set(targets.map((change) => change.path))];
		const what = paths.length === 1 ? relative(deps.rootDir, paths[0]!) : `${paths.length} files`;
		if (area === 'staged') {
			runGit('Unstaging', () => unstagePaths(deps.rootDir, paths), `Unstaged ${what}`);
		} else {
			runGit('Staging', () => stagePaths(deps.rootDir, paths), `Staged ${what}`);
		}
	};

	const toggleStageActiveFile = () => {
		if (diffBase() !== null)
			return deps.say('Staging compares against HEAD — reset the comparison base', 'warn');
		const path = deps.activePath();
		if (!path) return deps.say('No file open', 'warn');
		const entry = statusEntries(deps.rootDir, null, deps.gitScanDepth()).get(path);
		if (!entry || (!entry.staged && !entry.unstaged))
			return deps.say('No changes to stage', 'warn');
		const what = relative(deps.rootDir, path);
		if (entry.staged && !entry.unstaged) {
			runGit('Unstaging', () => unstagePaths(deps.rootDir, [path]), `Unstaged ${what}`);
		} else {
			runGit('Staging', () => stagePaths(deps.rootDir, [path]), `Staged ${what}`);
		}
	};

	return {
		commitFiles,
		commitMessageHistory,
		commitMessage,
		messageEditing,
		setMessageEditing,
		hasMessageHistory: () => messageHistory().length > 0,
		focusCommitBox,
		typeMessage,
		walkMessageHistory,
		commitFromBox,
		submitCommitAll,
		branchChoices,
		diff,
		diffTitle,
		closeDiff: () => {
			setDiff(null);
			setDiffTitle(null);
		},
		changesOpen,
		changeSections,
		changesMeta,
		changesFocus,
		changesTitle: () => (diffBase() === null ? 'Uncommitted' : `Compared against ${diffBase()}`),
		showChanges,
		focusChange,
		refreshChanges,
		toggleStageSection,
		closeChanges: () => setChangesOpen(false),
		cancelCommit: () => setCommitFiles(null),
		closeBranchChoices: () => setBranchChoices(null),
		branchChoiceTitle: () => BRANCH_CHOICE_COPY[branchMode()].title,
		branchChoiceMessage: () => BRANCH_CHOICE_COPY[branchMode()].message,
		pickBranch: (name: string) => {
			setBranchChoices(null);
			if (branchMode() === 'commits') return showCommitChoices(name);
			if (branchMode() === 'commitDiff') return openCommitDiff(name);
			if (branchMode() === 'fileHistory') return openCommitDiff(name, historyPath() ?? undefined);
			if (branchMode() === 'compare') return compareWith(name);
			if (branchMode() === 'diffBase') {
				setDiffBase(name);
				deps.setGitRevision((n) => n + 1);
				return deps.say(`Comparing against ${name}`);
			}
			if (branchMode() === 'merge') return deps.setPrompt({ kind: 'mergeBranch', name });
			if (branchMode() === 'rename') return deps.setPrompt({ kind: 'renameBranch', from: name });
			if (branchMode() === 'delete')
				return deps.setPrompt({ kind: 'deleteBranch', name, force: false });
			if (branchMode() === 'deleteForce')
				return deps.setPrompt({ kind: 'deleteBranch', name, force: true });
			if (branchMode() === 'from') return deps.setPrompt({ kind: 'newBranch', from: name });
			if (branchMode() === 'stash')
				return runGit('Applying stash', () => stashApply(deps.rootDir, name), 'Applied stash');
			if (branchMode() === 'deleteTag') return deps.setPrompt({ kind: 'deleteTag', name });
			if (branchMode() === 'removeRemote') return deps.setPrompt({ kind: 'removeRemote', name });
			const branch = listBranches(deps.rootDir).find((item) => item.name === name);
			runGit(
				'Switching branch',
				() => switchBranch(deps.rootDir, name, branch?.remote ?? false),
				`On ${localBranchName(name)}`,
			);
		},
		deleteChoice: (id: string) => {
			if (branchMode() !== 'stash') return;
			void stashDrop(deps.rootDir, id).then((result) => {
				deps.setGitRevision((n) => n + 1);
				if (!result.ok) return deps.say(result.detail || 'Could not drop stash', 'error');
				setBranchChoices((prev) => prev?.filter((choice) => choice.id !== id) ?? null);
				deps.say('Dropped stash');
			});
		},
		openStashList,
		openFileHistory,
		openTagCreate,
		openTagDelete,
		submitTag,
		removeTag,
		openRemoteAdd,
		openRemoteRemove,
		submitRemoteName,
		submitRemote,
		removeRemoteConfirmed,
		startCommit,
		promptAmend,
		submitAmend,
		submitCommit,
		submitBranch,
		rename,
		remove,
		merge,
		pullPush,
		confirmUndoCommit,
		undoCommit: () =>
			runGit('Undoing commit', () => undoLastCommit(deps.rootDir), 'Undid last commit'),
		stash: () => runGit('Stashing', () => stashPush(deps.rootDir), 'Stashed changes'),
		stashPop: () => runGit('Applying stash', () => stashPop(deps.rootDir), 'Applied stash'),
		fetch: () => runGit('Fetching', () => gitFetch(deps.rootDir), 'Fetched'),
		pull: () => runGit('Pulling', () => gitPull(deps.rootDir), 'Pulled'),
		openDiff,
		openCommitDiff,
		promptDiscard,
		discard,
		openBranchComparison,
		openBranchCommitComparison,
		openDiffBasePicker,
		resetDiffBase,
		openPanelBranchAction: (action: 'switch' | 'compare' | 'commits') => {
			if (action === 'switch') return openBranchSwitch();
			if (action === 'commits') {
				const base = diffBase();
				return base ? showCommitChoices(base) : openBranchCommitComparison();
			}
			return openBranchComparison();
		},
		openBranchSwitch,
		openBranchMerge,
		openBranchRename,
		openBranchDelete,
		openBranchForceDelete,
		openBranchFrom,
		openBranchPrompt,
		push: pushBranch,
		sync: syncBranch,
		openCommitPicker,
		toggleStage,
		toggleStageActiveFile,
	};
}
