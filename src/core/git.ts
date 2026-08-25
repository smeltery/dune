import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { BinaryFileError, readFile } from './fs';
import { hasBinaryContent } from './gitDiff';
import type { DiffFile } from './gitDiff';
import { DEFAULT_SCAN_DEPTH, discoverRepos, groupByRepo } from './vcs/repos';

export type LineChange = 'added' | 'modified' | 'deleted';
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted' | 'renamed';

/** Which of git's two columns a change is in — the index, or the working tree. */
export type StageArea = 'staged' | 'unstaged';

/** The source-control panel's groups. */
export type ChangeArea = StageArea | 'merge';

/**
 * One path's change split the way porcelain reports it. Both sides can be set at
 * once: a file edited after being added is staged and unstaged.
 */
export interface StatusEntry {
	staged: FileStatus | null;
	unstaged: FileStatus | null;
	conflicted?: boolean;
	oldRel?: string;
}

/** The single mark the tree and the gutter want: staged wins when both are set. */
export function combinedStatus(entry: StatusEntry): FileStatus {
	return entry.staged ?? entry.unstaged ?? 'modified';
}

export interface Branch {
	name: string;
	current: boolean;
	remote: boolean;
	upstream: string | null;
}

/**
 * Queries run synchronously because they sit behind gutter marks, tree marks and
 * the status bar. Mutations run asynchronously below, so push/fetch/stash/commit
 * cannot freeze the terminal UI.
 *
 * `spawnSync` truncates at 1 MB by default and reports ENOBUFS, which every caller
 * here reads as "no output" — `status` would lose files in a large repository.
 */
const MAX_OUTPUT = 128 * 1024 * 1024;

function git(cwd: string, args: string[], timeout = 5000, input?: string) {
	return spawnSync('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT, input });
}

function keyBase(cwd: string): string | null {
	const top = git(cwd, ['rev-parse', '--show-toplevel'], 3000);
	if (top.status !== 0) return null;
	const root = top.stdout.trim();
	try {
		if (realpathSync(cwd) === realpathSync(root)) return cwd;
	} catch {
		// unreadable path: fall back to git's own root
	}
	return root;
}

/**
 * Lines changed against HEAD, keyed by 0-based line number. Returns an empty map
 * outside a repository, for untracked files, or when git is unavailable.
 */
export function diffLines(path: string, ref: string | null = null): Map<number, LineChange> {
	const marks = new Map<number, LineChange>();
	const args = ['diff', '--no-color', '--unified=0'];
	if (ref !== null) args.push(ref);
	args.push('--', path);
	const run = git(dirname(path), args, 3000);
	if (run.status !== 0 || !run.stdout) return marks;

	for (const hunk of run.stdout.split('\n')) {
		// @@ -oldStart,oldCount +newStart,newCount @@
		const header = hunk.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (!header) continue;
		const removed = header[1] === undefined ? 1 : Number(header[1]);
		const start = Number(header[2]);
		const added = header[3] === undefined ? 1 : Number(header[3]);

		if (added === 0) {
			// Pure deletion: mark the line the removed text sat above.
			marks.set(Math.max(0, start - 1), 'deleted');
			continue;
		}
		// A hunk that replaces N lines with M: the first N are rewrites, the rest new.
		for (let i = 0; i < added; i++) {
			marks.set(start - 1 + i, i < removed ? 'modified' : 'added');
		}
	}
	return marks;
}

/**
 * Current branch, or null outside a repository and on a detached HEAD. Git calls
 * detached HEAD "HEAD", which must never reach `git push --set-upstream`.
 */
export function currentBranch(cwd: string): string | null {
	const run = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 3000);
	if (run.status !== 0) return null;
	const branch = run.stdout.trim();
	return branch.length > 0 && branch !== 'HEAD' ? branch : null;
}

export function defaultBranch(cwd: string): string | null {
	const remotes = git(cwd, ['remote']).stdout.trim().split('\n').filter(Boolean);
	for (const remote of remotes.toSorted((a, b) =>
		a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b),
	)) {
		const head = git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
		if (head.status === 0 && head.stdout.trim()) return head.stdout.trim();
	}
	const configured = git(cwd, ['config', '--get', 'init.defaultBranch']);
	const name = configured.status === 0 ? configured.stdout.trim() : '';
	return name && git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).status === 0
		? name
		: null;
}

export function listBranches(cwd: string): Branch[] {
	const run = git(cwd, [
		'for-each-ref',
		'--sort=-committerdate',
		'--format=%(refname:short)%00%(HEAD)%00%(upstream:short)',
		'refs/heads',
		'refs/remotes',
	]);
	if (run.status !== 0) return [];
	return run.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name = '', head = '', upstream = ''] = line.split('\0');
			return {
				name,
				current: head === '*',
				remote: name.includes('/'),
				upstream: upstream || null,
			};
		})
		.filter((branch) => !branch.name.endsWith('/HEAD'));
}

export function localBranchName(name: string): string {
	return name.replace(/^[^/]+\//, '');
}

const STATUS_BY_CODE: Record<string, FileStatus> = {
	'?': 'untracked',
	A: 'added',
	M: 'modified',
	R: 'renamed',
	C: 'modified',
	U: 'modified',
	D: 'deleted',
};

const STATUS_ARGS = ['status', '--porcelain', '-z', '-uall'] as const;
const UNTRACKED_ARGS = ['ls-files', '--others', '--exclude-standard', '-z'] as const;

/** Porcelain's unmerged states — a `U` in either column, plus both-added/-deleted. */
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

interface PorcelainEntry {
	xy: string;
	path: string;
	source: string | null;
}

function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
	const parsed: PorcelainEntry[] = [];
	const entries = stdout.split('\0');
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		if (entry.length < 4) continue;
		const xy = entry.slice(0, 2);
		const source = xy[0] === 'R' || xy[0] === 'C' ? (entries[++i] ?? null) : null;
		parsed.push({ xy, path: entry.slice(3), source });
	}
	return parsed;
}

function parsePorcelain(stdout: string, base: string): Map<string, StatusEntry> {
	const statuses = new Map<string, StatusEntry>();
	for (const entry of parsePorcelainEntries(stdout)) {
		if (CONFLICT_CODES.has(entry.xy)) {
			statuses.set(join(base, entry.path), {
				staged: null,
				unstaged: 'modified',
				conflicted: true,
				oldRel: entry.source ?? undefined,
			});
			continue;
		}
		const untracked = entry.xy === '??';
		const staged = untracked ? null : (STATUS_BY_CODE[entry.xy[0]!] ?? null);
		const unstaged = untracked ? 'untracked' : (STATUS_BY_CODE[entry.xy[1]!] ?? null);
		if (staged || unstaged) {
			statuses.set(join(base, entry.path), {
				staged,
				unstaged,
				oldRel: entry.source ?? undefined,
			});
		}
	}
	return statuses;
}

function flatten(entries: Map<string, StatusEntry>): Map<string, FileStatus> {
	return new Map([...entries].map(([path, entry]) => [path, combinedStatus(entry)]));
}

function asUnstaged(statuses: Map<string, FileStatus>): Map<string, StatusEntry> {
	return new Map([...statuses].map(([path, status]) => [path, { staged: null, unstaged: status }]));
}

function parseNameStatus(stdout: string, base: string): Map<string, FileStatus> {
	const statuses = new Map<string, FileStatus>();
	const fields = stdout.split('\0');
	for (let i = 0; i < fields.length; i += 2) {
		const code = fields[i];
		if (!code) continue;
		if (code[0] === 'R' || code[0] === 'C') i++;
		const path = fields[i + 1];
		const status = STATUS_BY_CODE[code[0]!];
		if (status && path) statuses.set(join(base, path), status);
	}
	return statuses;
}

function addUntracked(stdout: string, base: string, into: Map<string, FileStatus>) {
	for (const rel of stdout.split('\0')) {
		if (rel.length > 0) into.set(join(base, rel), 'untracked');
	}
}

/**
 * Working-tree status per absolute path. Staged and unstaged changes collapse to
 * one mark — the tree only needs "this differs from HEAD".
 */
export function statusMap(
	cwd: string,
	ref: string | null = null,
	depth = DEFAULT_SCAN_DEPTH,
): Map<string, FileStatus> {
	return flatten(statusEntries(cwd, ref, depth));
}

/**
 * The same status with both columns kept apart — what the source-control panel's
 * Staged/Changes headings are built from.
 */
export function statusEntries(
	cwd: string,
	ref: string | null = null,
	depth = DEFAULT_SCAN_DEPTH,
): Map<string, StatusEntry> {
	if (keyBase(cwd) === null) {
		const entries = new Map<string, StatusEntry>();
		for (const repo of discoverRepos(cwd, depth)) {
			for (const [path, entry] of statusEntries(repo, ref, depth)) entries.set(path, entry);
		}
		return entries;
	}
	const base = keyBase(cwd);
	if (base === null) return new Map();
	if (ref !== null) return statusAgainst(cwd, ref, base);

	const run = git(cwd, [...STATUS_ARGS]);
	return run.status === 0 ? parsePorcelain(run.stdout, base) : new Map();
}

interface FlatStatusEntry {
	path: string;
	status: FileStatus;
	oldRel?: string;
}

function flatStatusEntries(cwd: string, ref: string | null = null): FlatStatusEntry[] {
	const entries = statusEntries(cwd, ref);
	return [...entries].map(([path, entry]) => ({
		path,
		status: combinedStatus(entry),
		oldRel: entry.oldRel,
	}));
}

export function textAtHead(cwd: string, path: string): string {
	const base = keyBase(cwd);
	if (base === null) return '';
	const rel = relative(base, path);
	const run = git(cwd, ['show', `HEAD:${rel}`], 5000);
	return run.status === 0 ? run.stdout : '';
}

function textAtRef(cwd: string, ref: string, rel: string): string | null {
	const run = git(cwd, ['show', `${ref}:${rel}`], 5000);
	return run.status === 0 ? run.stdout : null;
}

function statusAgainst(cwd: string, ref: string, base: string): Map<string, StatusEntry> {
	const diff = git(cwd, ['diff', '--name-status', '-M', '-z', ref]);
	if (diff.status !== 0) return new Map();
	const statuses = parseNameStatus(diff.stdout, base);
	const others = git(cwd, [...UNTRACKED_ARGS]);
	if (others.status === 0) addUntracked(others.stdout, base, statuses);
	return asUnstaged(statuses);
}

export function diffFiles(
	cwd: string,
	only?: string,
	ref: string | null = null,
	depth = DEFAULT_SCAN_DEPTH,
): DiffFile[] {
	if (keyBase(cwd) === null) {
		const files: DiffFile[] = [];
		for (const repo of discoverRepos(cwd, depth)) files.push(...diffFiles(repo, only, ref, depth));
		return files.toSorted((a, b) => a.path.localeCompare(b.path));
	}
	const statuses = flatStatusEntries(cwd, ref);
	const files: DiffFile[] = [];
	const base = keyBase(cwd) ?? cwd;
	for (const { path, status, oldRel } of statuses) {
		if (only && path !== only) continue;
		if (!existsSync(path) && status !== 'deleted') continue;
		let newText = '';
		let binary = false;
		try {
			newText = status === 'deleted' ? '' : readFile(path);
		} catch (error) {
			if (status === 'deleted') continue;
			if (!(error instanceof BinaryFileError)) continue;
			binary = true;
		}
		const oldText =
			status === 'untracked'
				? ''
				: (textAtRef(cwd, ref ?? 'HEAD', oldRel ?? relative(base, path)) ?? '');
		files.push({
			path,
			rel: relative(base, path),
			status,
			oldRel,
			binary: binary || hasBinaryContent(oldText),
			oldText,
			newText,
		});
	}
	return files.toSorted((a, b) => a.rel.localeCompare(b.rel));
}

export function ignoredAmong(
	cwd: string,
	paths: string[],
	depth = DEFAULT_SCAN_DEPTH,
): Set<string> {
	const ignored = new Set<string>();
	if (paths.length === 0) return ignored;
	if (keyBase(cwd) === null) {
		for (const [repo, repoPaths] of groupByRepo(paths, discoverRepos(cwd, depth))) {
			for (const path of ignoredAmong(repo, repoPaths, depth)) ignored.add(path);
		}
		return ignored;
	}
	const run = git(cwd, ['check-ignore', '--stdin', '-z'], 5000, `${paths.join('\0')}\0`);
	if (run.status !== 0) return ignored;
	for (const path of run.stdout.split('\0')) {
		if (path.length > 0) ignored.add(path);
	}
	return ignored;
}

export function ignoredPaths(cwd: string, depth = DEFAULT_SCAN_DEPTH): Set<string> {
	const ignored = new Set<string>();
	const base = keyBase(cwd);
	if (base === null) {
		for (const repo of discoverRepos(cwd, depth)) {
			for (const path of ignoredPaths(repo, depth)) ignored.add(path);
		}
		return ignored;
	}
	const run = git(cwd, [
		'ls-files',
		'--others',
		'--ignored',
		'--exclude-standard',
		'--directory',
		'-z',
	]);
	if (run.status !== 0) return ignored;
	for (const rel of run.stdout.split('\0')) {
		if (rel.length === 0) continue;
		ignored.add(join(base, rel.endsWith('/') ? rel.slice(0, -1) : rel));
	}
	return ignored;
}

export interface Upstream {
	/** `origin/main`, or null when the branch was never pushed. */
	name: string | null;
	/** Commits here but not on the remote, and the other way round. */
	ahead: number;
	behind: number;
}

/**
 * Where a push would go and how far apart the two sides are. Two subprocesses at
 * worst, one outside a repository — the status bar asks for this often enough
 * that a `currentBranch` call on top of them is worth avoiding.
 */
export function upstreamOf(cwd: string): Upstream | null {
	const ref = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
	if (ref.status !== 0) {
		// No upstream and no repository look the same here; the branch tells them apart.
		// Ahead/behind stay 0: with nothing to compare against there is no distance to
		// report, and a repo with no remote at all must not show a phantom ↑.
		return currentBranch(cwd) ? { name: null, ahead: 0, behind: 0 } : null;
	}

	const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
	const [behind, ahead] = (counts.stdout ?? '').trim().split(/\s+/).map(Number);
	return { name: ref.stdout.trim(), ahead: ahead ?? 0, behind: behind ?? 0 };
}

/**
 * The configured remote URL, before git applies insteadOf rewrites. Forge
 * discovery needs the host the user configured, not a rewritten mirror.
 */
export function remoteUrl(cwd: string, remote = 'origin'): string | null {
	const run = git(cwd, ['config', '--get', `remote.${remote}.url`], 3000);
	const url = run.status === 0 ? run.stdout.trim() : '';
	return url.length > 0 ? url : null;
}

export function inRepository(cwd: string): boolean {
	return git(cwd, ['rev-parse', '--is-inside-work-tree'], 3000).stdout?.trim() === 'true';
}

export function stagedPaths(cwd: string): Set<string> {
	const staged = new Set<string>();
	const base = keyBase(cwd);
	if (base === null) return staged;
	const run = git(cwd, ['diff', '--cached', '--name-only', '-z']);
	if (run.status !== 0) return staged;
	for (const rel of run.stdout.split('\0')) {
		if (rel.length > 0) staged.add(join(base, rel));
	}
	return staged;
}

export function lastCommitSubject(cwd: string): string | null {
	const run = git(cwd, ['log', '-1', '--format=%s'], 3000);
	if (run.status !== 0) return null;
	const subject = run.stdout.trim();
	return subject.length > 0 ? subject : null;
}

export interface GitResult {
	ok: boolean;
	detail: string;
}

const MUTATE_TIMEOUT = 60_000;
export const PUSH_REJECTED = "origin has commits you don't - pull first, then push";

function firstLine(text: string): string {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? ''
	);
}

export function failureLine(text: string): string {
	const line =
		text
			.split('\n')
			.map((item) => item.trim())
			.find((item) => item.length > 0 && !item.startsWith('hint:') && !item.startsWith('To ')) ??
		firstLine(text);
	return line.replace(/^error:\s*/i, '');
}

function failureDetail(text: string): string {
	const line = failureLine(text);
	return /\[rejected\].*(?:non-fast-forward|fetch first)/i.test(line) ? PUSH_REJECTED : line;
}

function mutate(cwd: string, args: string[]): Promise<GitResult> {
	return new Promise((resolve) => {
		const child = spawn('git', args, {
			cwd,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		const timer = setTimeout(() => child.kill('SIGKILL'), MUTATE_TIMEOUT);
		let settled = false;
		const finish = (result: GitResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		child.on('error', (err) => finish({ ok: false, detail: err.message }));
		child.on('close', (code) => {
			const ok = code === 0;
			const text = ok ? stdout || stderr : stderr || stdout;
			finish({ ok, detail: ok ? firstLine(text) : failureDetail(text) });
		});
	});
}

export async function commitPaths(
	cwd: string,
	message: string,
	paths: string[],
): Promise<GitResult> {
	const add = await mutate(cwd, ['add', '-A', '--', ...paths]);
	if (!add.ok) return add;
	return mutate(cwd, ['commit', '-m', message, '--', ...paths]);
}

function hasCommits(cwd: string): boolean {
	return git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], 3000).status === 0;
}

/** Put `paths` in the index. `-A` records deletions and stages folder contents. */
export function stagePaths(cwd: string, paths: readonly string[]): Promise<GitResult> {
	return mutate(cwd, ['add', '-A', '--', ...paths]);
}

/**
 * Take `paths` back out of the index, leaving the working tree alone. On an
 * unborn branch there is no HEAD to restore from, so the index entry is removed.
 */
export function unstagePaths(cwd: string, paths: readonly string[]): Promise<GitResult> {
	return hasCommits(cwd)
		? mutate(cwd, ['restore', '--staged', '--', ...paths])
		: mutate(cwd, ['rm', '-q', '--cached', '-r', '--', ...paths]);
}

export function amendCommit(cwd: string, message: string): Promise<GitResult> {
	return mutate(cwd, ['commit', '--amend', '-m', message]);
}

/**
 * Reverts one file's working-tree changes. A path git has never committed has
 * nothing to restore to — discarding it means removing it, the way an
 * untracked or newly staged file's "changes" are its whole existence.
 */
export async function discardChanges(path: string, status: FileStatus): Promise<GitResult> {
	const cwd = dirname(path);
	if (status === 'untracked' || status === 'added') {
		await mutate(cwd, ['reset', '--', path]);
		await rm(path, { force: true });
		return { ok: true, detail: '' };
	}
	return mutate(cwd, ['checkout', 'HEAD', '--', path]);
}

export function recentCommitMessages(cwd: string): string[] {
	const run = git(cwd, ['log', '-n', '50', '--format=%s'], 5000);
	if (run.status !== 0) return [];
	const seen = new Set<string>();
	for (const line of run.stdout.split('\n')) {
		const subject = line.trim();
		if (subject) seen.add(subject);
	}
	return [...seen];
}

export function undoLastCommit(cwd: string): Promise<GitResult> {
	return mutate(cwd, ['reset', '--soft', 'HEAD~1']);
}

export function stashPush(cwd: string): Promise<GitResult> {
	return mutate(cwd, ['stash', 'push', '-u']);
}

export function stashPop(cwd: string): Promise<GitResult> {
	return mutate(cwd, ['stash', 'pop']);
}

export interface StashEntry {
	/** `stash@{0}` and so on — what every other stash subcommand addresses it by. */
	ref: string;
	message: string;
}

export function listStashes(cwd: string): StashEntry[] {
	const run = git(cwd, ['stash', 'list', '--format=%gd%x00%s']);
	if (run.status !== 0) return [];
	return run.stdout
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => {
			const [ref = '', message = ''] = line.split('\0');
			return { ref, message };
		});
}

export function stashApply(cwd: string, ref: string): Promise<GitResult> {
	return mutate(cwd, ['stash', 'apply', ref]);
}

export function stashDrop(cwd: string, ref: string): Promise<GitResult> {
	return mutate(cwd, ['stash', 'drop', ref]);
}

export function listTags(cwd: string): string[] {
	const run = git(cwd, ['tag', '--list', '--sort=-creatordate']);
	if (run.status !== 0) return [];
	return run.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function createTag(cwd: string, name: string): Promise<GitResult> {
	return mutate(cwd, ['tag', name]);
}

export function deleteTag(cwd: string, name: string): Promise<GitResult> {
	return mutate(cwd, ['tag', '-d', name]);
}

export function listRemotes(cwd: string): string[] {
	const run = git(cwd, ['remote']);
	if (run.status !== 0) return [];
	return run.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function addRemote(cwd: string, name: string, url: string): Promise<GitResult> {
	return mutate(cwd, ['remote', 'add', name, url]);
}

export function removeRemote(cwd: string, name: string): Promise<GitResult> {
	return mutate(cwd, ['remote', 'remove', name]);
}

export function fetch(cwd: string): Promise<GitResult> {
	return mutate(cwd, ['fetch']);
}

export function pull(cwd: string): Promise<GitResult> {
	return mutate(cwd, ['pull', '--ff-only']);
}

export function push(cwd: string, branch: string, hasUpstream: boolean): Promise<GitResult> {
	return mutate(cwd, hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', branch]);
}

export async function pullAndPush(
	cwd: string,
	branch: string,
	hasUpstream: boolean,
): Promise<GitResult> {
	const pulled = await mutate(cwd, ['pull', '--no-rebase', '--no-edit']);
	if (!pulled.ok) return pulled;
	return push(cwd, branch, hasUpstream);
}

export function switchBranch(cwd: string, name: string, remote: boolean): Promise<GitResult> {
	if (!remote) return mutate(cwd, ['checkout', name]);
	const local = localBranchName(name);
	const exists = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`], 3000);
	return exists.status === 0
		? mutate(cwd, ['checkout', local])
		: mutate(cwd, ['checkout', '-b', local, '--track', name]);
}

export function createBranch(cwd: string, name: string, from?: string | null): Promise<GitResult> {
	return mutate(cwd, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name]);
}

export function renameBranch(cwd: string, from: string, to: string): Promise<GitResult> {
	return mutate(cwd, ['branch', '-m', from, to]);
}

export function deleteBranch(cwd: string, name: string, force = false): Promise<GitResult> {
	return mutate(cwd, ['branch', force ? '-D' : '-d', name]);
}

export function mergeBranch(cwd: string, name: string): Promise<GitResult> {
	return mutate(cwd, ['merge', '--no-edit', name]);
}
