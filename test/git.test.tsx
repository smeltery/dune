import { expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	createBranch,
	currentBranch,
	deleteBranch,
	diffFiles,
	diffLines,
	ignoredAmong,
	listBranches,
	localBranchName,
	mergeBranch,
	pull,
	renameBranch,
	statusMap,
	switchBranch,
} from '../src/core/git';
import { branchDiffCommits, branchDiffFiles } from '../src/core/gitDiff';
import { git as runGit } from './git-fixture';
import { F1, launch, press, pressEscape, runCommand, settle, type Harness } from './helpers';

const ESC = String.fromCharCode(27);
setDefaultTimeout(10_000);

interface Frame {
	lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[];
}

function repo(committed: string) {
	const dir = mkdtempSync(join(tmpdir(), 'dune-git-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(join(dir, 'a.ts'), committed);
	git('add', '.');
	git('commit', '-q', '-m', 'init');
	return dir;
}

test('marks modified and added lines', () => {
	const dir = repo('one\ntwo\nthree\n');
	writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nthree\nfour\n');

	const marks = diffLines(join(dir, 'a.ts'));
	expect(marks.get(1)).toBe('modified'); // "two" -> "CHANGED"
	expect(marks.get(3)).toBe('added'); // new final line
	expect(marks.get(0)).toBeUndefined(); // untouched
});

test('a hunk that grows marks rewrites and additions separately', () => {
	const dir = repo('one\ntwo\n');
	writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nEXTRA\n');

	const marks = diffLines(join(dir, 'a.ts'));
	expect(marks.get(1)).toBe('modified');
	expect(marks.get(2)).toBe('added');
});

test('is empty outside a repository', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-'));
	writeFileSync(join(dir, 'a.ts'), 'x\n');
	expect(diffLines(join(dir, 'a.ts')).size).toBe(0);
	expect(currentBranch(dir)).toBeNull();
});

test('a branch with no upstream shows without ahead/behind arrows', async () => {
	const t = await launch(repo('one\n'));
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressEnter());

	const footer = t.captureCharFrame().split('\n').at(-2)!;
	expect(footer).toContain('⎇ main');
	expect(footer).not.toMatch(/↑\d/);
	expect(footer).not.toMatch(/↓\d/);
});

test('status marks reach the file tree', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'changed\n'); // modified
	writeFileSync(join(dir, 'fresh.ts'), 'new\n'); // untracked

	const t = await launch(dir);
	const frame = t.captureCharFrame();
	const row = (name: string) => frame.split('\n').find((line) => line.includes(name)) ?? '';

	expect(row('a.ts')).toContain('M');
	expect(row('fresh.ts')).toContain('U');
});

test('diffFiles returns text snapshots for changed files', () => {
	const dir = repo('one\ntwo\n');
	writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');

	const files = diffFiles(dir);
	expect(files.map((file) => file.rel)).toEqual(['a.ts', 'fresh.ts']);
	expect(files[0]).toMatchObject({ oldText: 'one\ntwo\n', newText: 'one\nTWO\nthree\n' });
	expect(files[1]).toMatchObject({ oldText: '', newText: 'new\n', status: 'untracked' });
});

test('branchDiffFiles returns snapshots introduced since the base branch', () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature work');

	const files = branchDiffFiles(dir, 'main');
	const commits = branchDiffCommits(dir, 'main');
	expect(files.map((file) => file.rel)).toEqual(['a.ts', 'fresh.ts']);
	expect(commits[0]).toMatchObject({ subject: 'feature work', authorName: 'Test' });
	expect(files[0]).toMatchObject({ oldText: 'one\n', newText: 'two\n', status: 'modified' });
	expect(files[1]).toMatchObject({ oldText: '', newText: 'new\n', status: 'added' });
});

test('listBranches reports local and remote branches for pickers', () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
	git('update-ref', 'refs/remotes/origin/main', 'main');

	const branches = listBranches(dir);
	expect(branches.find((branch) => branch.name === 'feature')).toMatchObject({
		current: true,
		remote: false,
	});
	expect(branches.find((branch) => branch.name === 'origin/main')).toMatchObject({
		current: false,
		remote: true,
	});
	expect(branches.some((branch) => branch.name === 'origin/HEAD')).toBe(false);
});

test('switchBranch checks out local and remote-tracking branches', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	git('switch', '-q', 'main');
	git('remote', 'add', 'origin', dir);
	git('update-ref', 'refs/remotes/origin/remote-work', 'feature');

	expect(localBranchName('origin/remote-work')).toBe('remote-work');
	expect(await switchBranch(dir, 'feature', false)).toMatchObject({ ok: true });
	expect(git('branch', '--show-current').toString().trim()).toBe('feature');
	expect(await switchBranch(dir, 'origin/remote-work', true)).toMatchObject({ ok: true });
	expect(git('branch', '--show-current').toString().trim()).toBe('remote-work');
});

test('createBranch creates and checks out a branch from HEAD', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);

	expect(await createBranch(dir, 'work')).toMatchObject({ ok: true });
	expect(git('branch', '--show-current').toString().trim()).toBe('work');
	expect(git('rev-parse', 'work').toString()).toBe(git('rev-parse', 'main').toString());
});

test('createBranch can start from another branch', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.ts'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature');
	git('switch', '-q', 'main');

	expect(await createBranch(dir, 'work', 'feature')).toMatchObject({ ok: true });
	expect(git('branch', '--show-current').toString().trim()).toBe('work');
	expect(git('rev-parse', 'work').toString()).toBe(git('rev-parse', 'feature').toString());
});

test('renameBranch renames a local branch', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'work');
	git('switch', '-q', 'main');

	expect(await renameBranch(dir, 'work', 'done')).toMatchObject({ ok: true });
	expect(
		spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/work'], { cwd: dir }).status,
	).not.toBe(0);
	expect(
		spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/done'], { cwd: dir }).status,
	).toBe(0);
});

test('deleteBranch deletes a merged local branch', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'work');
	git('switch', '-q', 'main');

	expect(await deleteBranch(dir, 'work')).toMatchObject({ ok: true });
	expect(
		spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/work'], { cwd: dir }).status,
	).not.toBe(0);
});

test('deleteBranch can force delete an unmerged local branch', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'work');
	writeFileSync(join(dir, 'work.ts'), 'work\n');
	git('add', '.');
	git('commit', '-q', '-m', 'work');
	git('switch', '-q', 'main');

	expect(await deleteBranch(dir, 'work', true)).toMatchObject({ ok: true });
	expect(
		spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/work'], { cwd: dir }).status,
	).not.toBe(0);
});

test('mergeBranch merges another branch into the current branch', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.ts'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature');
	git('switch', '-q', 'main');

	expect(await mergeBranch(dir, 'feature')).toMatchObject({ ok: true });
	expect(git('log', '-1', '--format=%s').toString().trim()).toBe('feature');
	expect(git('status', '--porcelain').toString()).toBe('');
});

test('pull fast-forwards from the configured upstream', async () => {
	const dir = repo('one\n');
	const remote = mkdtempSync(join(tmpdir(), 'dune-origin-'));
	runGit(remote, 'init', '-q', '--bare');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('remote', 'add', 'origin', remote);
	git('push', '-q', '-u', 'origin', 'main');

	const other = mkdtempSync(join(tmpdir(), 'dune-peer-'));
	execFileSync('git', ['clone', '-q', '-b', 'main', remote, other]);
	const peer = (...args: string[]) => runGit(other, ...args);
	peer('config', 'user.email', 'test@example.com');
	peer('config', 'user.name', 'Test');
	writeFileSync(join(other, 'b.ts'), 'two\n');
	peer('add', '.');
	peer('commit', '-q', '-m', 'remote change');
	peer('push', '-q');

	expect(await pull(dir)).toMatchObject({ ok: true });
	expect(git('log', '-1', '--format=%s').toString().trim()).toBe('remote change');
	expect(git('status', '--porcelain').toString()).toBe('');
}, 10_000);

test('diff commands show current file and all changed files', async () => {
	const dir = repo('one\ntwo\n');
	writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');

	const t = await launch(dir);
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressEnter());
	await runCommand(t, 'Diff current file');
	expect(t.captureCharFrame()).toContain('+ THREE'.replace('THREE', 'three'));
	expect(t.captureCharFrame()).toContain('- two');

	await pressEscape(t);
	await runCommand(t, 'Diff all changes');
	expect(t.captureCharFrame()).toContain('file 1/2');
	await press(t, (i) => void i.typeText('f'));
	expect(t.captureCharFrame()).toContain('Changed files');
	expect(t.captureCharFrame()).toContain('fresh.ts +1 -0');
	await press(t, (i) => void i.typeText('fresh'));
	expect(t.captureCharFrame()).toContain('Filter: fresh (1/2)');
	expect(t.captureCharFrame()).toContain('fresh.ts +1 -0');
	expect(t.captureCharFrame()).not.toContain('a.ts +2 -1');
	await press(t, (i) => i.pressEnter());
	expect(t.captureCharFrame()).toContain('fresh.ts');
	expect(t.captureCharFrame()).toContain('file 2/2');
	await press(t, (i) => void i.typeText('f'));
	await pressEscape(t);
	expect(t.captureCharFrame()).toContain('file 2/2');
	expect(t.captureCharFrame()).not.toContain('Changed files');
	await press(t, (i) => i.pressArrow('right'));
	expect(t.captureCharFrame()).toContain('a.ts');
});

test('diff all changes can stack every file in one scroll', async () => {
	const dir = repo('one\ntwo\n');
	writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');

	const t = await launch(dir, {}, { height: 30 });
	await runCommand(t, 'Diff all changes');
	expect(t.captureCharFrame()).toContain('file 1/2');
	expect(t.captureCharFrame()).not.toContain('All changes');

	await press(t, (i) => void i.typeText('a'));
	expect(t.captureCharFrame()).toContain('All changes — 2');
	expect(t.captureCharFrame()).toContain('a.ts +2 -1');
	expect(t.captureCharFrame()).toContain('fresh.ts +1 -0');
	expect(t.captureCharFrame()).toContain('- two');
	expect(t.captureCharFrame()).toContain('+ new');

	// Toggling back returns to the single-file pager, unaffected by having
	// stacked and unstacked.
	await press(t, (i) => void i.typeText('a'));
	expect(t.captureCharFrame()).not.toContain('All changes');
	expect(t.captureCharFrame()).toContain('file 1/2');
});

test('compare against branch changes source-control diffs', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature work');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Compare against branch');
	expect(t.captureCharFrame()).toContain('Compare against branch');
	await press(t, (input) => input.pressEnter());
	await press(t, (input) => void input.pressKeys([`${ESC}${String.fromCharCode(7)}`]));

	expect(t.captureCharFrame()).toContain('vs feature');
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('- two');
	expect(t.captureCharFrame()).toContain('+ one');
	await pressEscape(t);
	await press(t, (input) => void input.pressKeys([F1]));
	await press(t, (input) => void input.typeText('Compare against HEAD'));
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('no changes');
}, 60_000);

test('diff commands can render split layout', async () => {
	const dir = repo('one\ntwo\n');
	writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n');

	const t = await launch(dir, { diffView: 'split' });
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressEnter());
	await runCommand(t, 'Diff current file');

	const frame = t.captureCharFrame();
	expect(frame).toContain('split');
	expect(frame).toContain('│');
	expect(frame).toContain('- two');
	expect(frame).toContain('+ TWO');
});

test('source control panel lists changes from Ctrl+Opt+G', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	git('switch', '-q', 'main');
	writeFileSync(join(dir, 'a.ts'), 'changed\n');
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');

	const t = await launch(dir);
	await press(t, (input) => void input.pressKeys([`${ESC}${String.fromCharCode(7)}`]));

	const frame = t.captureCharFrame();
	expect(frame).toContain('B compare');
	expect(frame).toContain('a.ts');
	expect(frame).toContain('fresh.ts');

	await press(t, (input) => void input.typeText('b'));
	expect(t.captureCharFrame()).toContain('Switch to branch');
	await pressEscape(t);
	await press(t, (input) => void input.typeText('B'));
	expect(t.captureCharFrame()).toContain('compare');
	await pressEscape(t);
	await pressEscape(t);
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('+ changed');
	await pressEscape(t);
	await press(t, (input) => void input.typeText('c'));
	expect(t.captureCharFrame()).toContain('Commit');
});

test('source control panel groups changed files by folder', async () => {
	const dir = repo('one\n');
	mkdirSync(join(dir, 'src'));
	writeFileSync(join(dir, 'src/a.ts'), 'a\n');
	writeFileSync(join(dir, 'src/b.ts'), 'b\n');

	const t = await launch(dir);
	await press(t, (input) => void input.pressKeys([`${ESC}${String.fromCharCode(7)}`]));

	expect(t.captureCharFrame()).toContain('src');
	expect(t.captureCharFrame()).toContain('a.ts');
	expect(t.captureCharFrame()).toContain('b.ts');
	await press(t, (input) => input.pressArrow('left'));
	expect(t.captureCharFrame()).toContain('2');
	expect(t.captureCharFrame()).not.toContain('a.ts');
	expect(t.captureCharFrame()).not.toContain('b.ts');
	await press(t, (input) => input.pressArrow('right'));
	expect(t.captureCharFrame()).toContain('a.ts');
	expect(t.captureCharFrame()).toContain('b.ts');
});

test('a folder inherits the status of its contents', async () => {
	const dir = repo('one\n');
	mkdirSync(join(dir, 'sub'));
	writeFileSync(join(dir, 'sub/deep.ts'), 'new\n');

	// Rendered, not just statusMap()'d: the inheritance lives in FileTree.statusOf,
	// and git reports `?? sub/` on its own, so the map alone proves nothing.
	const t = await launch(dir);
	const row = t
		.captureCharFrame()
		.split('\n')
		.find((line) => line.includes('sub'))!;
	expect(row).toContain('U');
});

test('a path git has to quote still gets its mark', () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'ümlaut.ts'), 'new\n');
	writeFileSync(join(dir, 'two words.ts'), 'new\n');

	// `git status --porcelain` C-quotes and octal-escapes both of these names; the
	// keys have to come back as real paths or the tree shows no mark for them.
	const statuses = statusMap(dir);
	expect(statuses.get(join(dir, 'ümlaut.ts'))).toBe('untracked');
	expect(statuses.get(join(dir, 'two words.ts'))).toBe('untracked');
});

test('a rename is keyed by the path that exists on disk', () => {
	const dir = repo('one\n');
	execFileSync('git', ['mv', 'a.ts', 'renamed.ts'], { cwd: dir });

	// `-z` emits `R  new\0old\0`, so the second field must be skipped rather than
	// read as its own entry — otherwise the mark lands on the path that is gone.
	const statuses = statusMap(dir);
	expect(statuses.get(join(dir, 'renamed.ts'))).toBe('renamed');
	expect(statuses.has(join(dir, 'a.ts'))).toBe(false);
});

test('ignoredAmong reports only the gitignored paths asked about', () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, '.gitignore'), 'dist\n*.log\n');
	mkdirSync(join(dir, 'dist'));
	writeFileSync(join(dir, 'dist/out.js'), 'bundle\n');
	writeFileSync(join(dir, 'debug.log'), 'noise\n');

	const paths = [
		join(dir, 'dist'),
		join(dir, 'dist/out.js'),
		join(dir, 'debug.log'),
		join(dir, '.gitignore'),
		join(dir, 'a.ts'),
	];
	const ignored = ignoredAmong(dir, paths);

	expect(ignored.has(join(dir, 'dist'))).toBe(true);
	expect(ignored.has(join(dir, 'dist/out.js'))).toBe(true);
	expect(ignored.has(join(dir, 'debug.log'))).toBe(true);
	expect(ignored.has(join(dir, '.gitignore'))).toBe(false);
	expect(ignored.has(join(dir, 'a.ts'))).toBe(false);
});

test('ignoredAmong is empty outside a repository', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-ignore-'));
	writeFileSync(join(dir, 'debug.log'), 'noise\n');

	expect(ignoredAmong(dir, [join(dir, 'debug.log')]).size).toBe(0);
});

test('every file inside a brand-new directory is marked, not just the directory', async () => {
	// `git status --porcelain` collapses an untracked directory to one `?? dir/`
	// entry, which left every file inside it with no mark at all.
	const dir = repo('one\n');
	mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true });
	writeFileSync(join(dir, 'newdir', 'a.ts'), 'const a = 1\n');
	writeFileSync(join(dir, 'newdir', 'sub', 'b.ts'), 'const b = 2\n');

	const statuses = statusMap(dir);
	expect(statuses.get(join(dir, 'newdir', 'a.ts'))).toBe('untracked');
	expect(statuses.get(join(dir, 'newdir', 'sub', 'b.ts'))).toBe('untracked');

	// And the tree shows the mark on the files, with the folders inheriting it.
	const t = await launch(dir);
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressEnter());
	const frame = t.captureCharFrame();
	expect(frame).toContain('newdir');
	expect(frame).toContain('a.ts');
	expect(frame.split('\n').find((row) => row.includes('a.ts'))).toContain('U');
});

function foregroundOf(t: Harness, name: string): string | null {
	for (const line of (t.captureSpans() as unknown as Frame).lines) {
		for (const span of line.spans) {
			if (!span.fg || !span.text.endsWith(name)) continue;
			const b = span.fg.buffer;
			return `${b['0']},${b['1']},${b['2']}`;
		}
	}
	return null;
}

test('a gitignored entry is dimmed without inventing a status mark', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, '.gitignore'), 'dist\n');
	mkdirSync(join(dir, 'dist'));
	writeFileSync(join(dir, 'dist/out.js'), 'bundle\n');

	const t = await launch(dir);
	await settle(t);
	await settle(t);
	const frame = t.captureCharFrame();

	expect(frame).toContain('dist');
	expect(frame.split('\n').find((row) => /\bdist\b/.test(row))!).not.toMatch(/[UMAD]/);
	expect(foregroundOf(t, 'dist')).not.toBe(foregroundOf(t, 'a.ts'));
});
