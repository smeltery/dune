import { expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	comparisonCommitDetail,
	comparisonFileContent,
	loadBranchComparison,
	resolveComparison,
} from '../../src/core/git/compare';
import { git as runGit } from '../git-fixture';

setDefaultTimeout(15_000);

function repo(initial = 'trunk') {
	const dir = mkdtempSync(join(tmpdir(), 'dune-compare-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	git('init', '-q', '-b', initial);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(join(dir, 'seed.txt'), 'seed\n');
	git('add', '.');
	git('commit', '-q', '-m', 'seed');
	return { dir, git };
}

test('comparison resolves the merge base and both directions of divergence', async () => {
	const { dir, git } = repo();
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.txt'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature');
	git('switch', '-q', 'trunk');
	writeFileSync(join(dir, 'base.txt'), 'base\n');
	git('add', '.');
	git('commit', '-q', '-m', 'base');
	git('switch', '-q', 'feature');

	const result = await resolveComparison(dir, 'trunk');

	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.base.name).toBe('trunk');
	expect(result.value.compare.name).toBe('feature');
	expect(result.value.ahead).toBe(1);
	expect(result.value.behind).toBe(1);
	expect(result.value.mergeBase).toMatch(/^[0-9a-f]{40,64}$/);
});

test('comparison refuses detached HEAD without calling it an invalid branch', async () => {
	const { dir, git } = repo();
	git('switch', '--detach', '-q');

	expect(await resolveComparison(dir, 'trunk')).toMatchObject({
		ok: false,
		reason: 'detachedHead',
	});
});

test('comparison distinguishes an unborn current branch', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-compare-unborn-'));
	runGit(dir, 'init', '-q', '-b', 'feature');

	expect(await resolveComparison(dir, 'trunk')).toMatchObject({
		ok: false,
		reason: 'unbornBranch',
	});
});

test('comparison reports a base name that does not resolve', async () => {
	const { dir } = repo();

	expect(await resolveComparison(dir, 'missing')).toMatchObject({
		ok: false,
		reason: 'invalidBase',
	});
});

test('comparison outside a repository is not a git error', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-compare-bare-'));

	expect(await resolveComparison(dir, 'main')).toMatchObject({
		ok: false,
		reason: 'notRepository',
	});
});

test('comparison reports branches with unrelated histories', async () => {
	const { dir, git } = repo();
	git('switch', '-q', '--orphan', 'other');
	rmSync(join(dir, 'seed.txt'), { force: true });
	writeFileSync(join(dir, 'other.txt'), 'other\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'other root');

	expect(await resolveComparison(dir, 'trunk', 'other')).toMatchObject({
		ok: false,
		reason: 'noMergeBase',
	});
});

test('comparison contains only feature work with complete file metadata', async () => {
	const { dir, git } = repo();
	writeFileSync(join(dir, 'changed.txt'), 'before\n');
	writeFileSync(join(dir, 'deleted.txt'), 'delete me\n');
	writeFileSync(join(dir, 'old-name.txt'), 'rename me\n');
	git('add', '.');
	git('commit', '-q', '-m', 'base files');
	git('switch', '-q', '-c', 'feature');

	writeFileSync(join(dir, 'added.txt'), 'added\n');
	writeFileSync(join(dir, 'changed.txt'), 'after\n');
	rmSync(join(dir, 'deleted.txt'));
	git('mv', 'old-name.txt', 'new-name.txt');
	writeFileSync(join(dir, 'image.bin'), new Uint8Array([0, 1, 2, 3]));
	git('add', '-A');
	git('commit', '-q', '-m', 'feature files');

	git('switch', '-q', 'trunk');
	writeFileSync(join(dir, 'base-only.txt'), 'base\n');
	git('add', '.');
	git('commit', '-q', '-m', 'base only');
	git('switch', '-q', 'feature');

	const result = await loadBranchComparison(dir, 'trunk', 'feature');

	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.files.map((file) => [file.status, file.oldPath, file.path])).toEqual([
		['added', null, 'added.txt'],
		['modified', null, 'changed.txt'],
		['deleted', null, 'deleted.txt'],
		['added', null, 'image.bin'],
		['renamed', 'old-name.txt', 'new-name.txt'],
	]);
	// `mergeBase..compare`, not tip to tip: what only the base gained is not this
	// branch's work and must not show up as a change of its own.
	expect(result.value.files.some((file) => file.path === 'base-only.txt')).toBe(false);
	expect(result.value.files.find((file) => file.path === 'changed.txt')).toMatchObject({
		binary: false,
		additions: 1,
		deletions: 1,
	});
	expect(result.value.files.find((file) => file.path === 'image.bin')).toMatchObject({
		binary: true,
		additions: null,
		deletions: null,
	});
	expect(result.value.files.find((file) => file.path === 'new-name.txt')).toMatchObject({
		similarity: 100,
		additions: 0,
		deletions: 0,
	});
	expect(result.value.stats).toEqual({
		files: 5,
		additions: 2,
		deletions: 2,
		binaryFiles: 1,
	});
	expect(result.value.commits.map((commit) => commit.subject)).toEqual(['feature files']);
});

test('comparison with the same branch has no commits or changed files', async () => {
	const { dir } = repo();

	const result = await loadBranchComparison(dir, 'trunk', 'trunk');

	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.files).toEqual([]);
	expect(result.value.commits).toEqual([]);
	expect(result.value.stats).toEqual({ files: 0, additions: 0, deletions: 0, binaryFiles: 0 });
});

test('comparison preserves merge commits and all of their parents', async () => {
	const { dir, git } = repo();
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.txt'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature work');
	git('switch', '-q', '-c', 'integration', 'trunk');
	writeFileSync(join(dir, 'integration.txt'), 'integration\n');
	git('add', '.');
	git('commit', '-q', '-m', 'integration work');
	git('switch', '-q', 'feature');
	git('merge', '-q', '--no-ff', 'integration', '-m', 'merge integration');

	const result = await loadBranchComparison(dir, 'trunk', 'feature');

	expect(result.ok).toBe(true);
	if (!result.ok) return;
	const merge = result.value.commits.find((commit) => commit.subject === 'merge integration');
	expect(merge?.parents).toHaveLength(2);
	expect(result.value.files.map((file) => file.path)).toEqual([
		'feature.txt',
		'integration.txt',
	]);
});

test('comparison preserves paths that porcelain output would quote', async () => {
	const { dir, git } = repo();
	const paths = ['line\nbreak.txt', 'space name.txt', 'tab\tname.txt', 'ümlaut.txt'];
	git('switch', '-q', '-c', 'feature');
	for (const path of paths) writeFileSync(join(dir, path), `${path}\n`);
	git('add', '.');
	git('commit', '-q', '-m', 'unusual paths');

	const result = await loadBranchComparison(dir, 'trunk', 'feature');

	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.files.map((file) => file.path).toSorted()).toEqual(paths.toSorted());
});

test('comparison file content loads the exact object sides for every status', async () => {
	const { dir, git } = repo();
	const oldName = 'one\ntwo\nthree\nfour\nfive\n';
	const newName = 'ONE\ntwo\nthree\nfour\nfive\n';
	writeFileSync(join(dir, 'deleted.txt'), 'deleted old\n');
	writeFileSync(join(dir, 'old-name.txt'), oldName);
	git('add', '.');
	git('commit', '-q', '-m', 'base files');
	git('switch', '-q', '-c', 'feature');
	rmSync(join(dir, 'deleted.txt'));
	git('mv', 'old-name.txt', 'new-name.txt');
	writeFileSync(join(dir, 'new-name.txt'), newName);
	writeFileSync(join(dir, 'added.txt'), 'added new\n');
	writeFileSync(join(dir, 'image.bin'), new Uint8Array([0, 1, 2, 3]));
	git('add', '-A');
	git('commit', '-q', '-m', 'feature files');
	const comparison = await loadBranchComparison(dir, 'trunk', 'feature');
	expect(comparison.ok).toBe(true);
	if (!comparison.ok) return;
	const file = (path: string) => comparison.value.files.find((item) => item.path === path)!;

	expect(await comparisonFileContent(dir, file('added.txt'))).toEqual({
		ok: true,
		value: { binary: false, oldText: '', newText: 'added new\n' },
	});
	expect(await comparisonFileContent(dir, file('deleted.txt'))).toEqual({
		ok: true,
		value: { binary: false, oldText: 'deleted old\n', newText: '' },
	});
	expect(await comparisonFileContent(dir, file('new-name.txt'))).toEqual({
		ok: true,
		value: { binary: false, oldText: oldName, newText: newName },
	});
	expect(await comparisonFileContent(dir, file('image.bin'))).toEqual({
		ok: true,
		value: { binary: true },
	});
});

test('loading a comparison reads no blobs until a row is opened', async () => {
	const { dir, git } = repo();
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'seed.txt'), 'changed\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature');
	const trace = join(dir, 'trace.json');
	const previous = process.env.GIT_TRACE2_EVENT;

	process.env.GIT_TRACE2_EVENT = trace;
	try {
		const comparison = await loadBranchComparison(dir, 'trunk', 'feature');
		expect(comparison.ok).toBe(true);
		if (!comparison.ok) return;
		const commands = () =>
			execFileSync('cat', [trace], { encoding: 'utf8' })
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as { event?: string; argv?: string[] })
				.filter((event) => event.event === 'start')
				.map((event) => event.argv ?? []);
		expect(commands().some((argv) => argv.includes('cat-file'))).toBe(false);

		expect((await comparisonFileContent(dir, comparison.value.files[0]!)).ok).toBe(true);
		expect(commands().some((argv) => argv.includes('cat-file'))).toBe(true);
	} finally {
		if (previous === undefined) delete process.env.GIT_TRACE2_EVENT;
		else process.env.GIT_TRACE2_EVENT = previous;
	}
});

test('commit detail contains metadata, files and line totals', async () => {
	const { dir, git } = repo();
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.txt'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature work');
	const oid = git('rev-parse', 'HEAD').toString().trim();

	const detail = await comparisonCommitDetail(dir, oid);

	expect(detail.ok).toBe(true);
	if (!detail.ok) return;
	expect(detail.value.commit).toMatchObject({
		oid,
		subject: 'feature work',
		authorName: 'Test',
		authorEmail: 'test@example.com',
	});
	expect(detail.value.files.map((file) => file.path)).toEqual(['feature.txt']);
	expect(detail.value.stats).toEqual({
		files: 1,
		additions: 1,
		deletions: 0,
		binaryFiles: 0,
	});
});

test('root commit detail compares against the empty tree', async () => {
	const { dir, git } = repo();
	const oid = git('rev-parse', 'HEAD').toString().trim();

	const detail = await comparisonCommitDetail(dir, oid);

	expect(detail.ok).toBe(true);
	if (!detail.ok) return;
	expect(detail.value.files.map((file) => file.path)).toEqual(['seed.txt']);
	expect(detail.value.files[0]).toMatchObject({ status: 'added', additions: 1, deletions: 0 });
});

test('merge commit detail uses its first parent', async () => {
	const { dir, git } = repo();
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.txt'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature');
	git('switch', '-q', '-c', 'integration', 'trunk');
	writeFileSync(join(dir, 'integration.txt'), 'integration\n');
	git('add', '.');
	git('commit', '-q', '-m', 'integration');
	git('switch', '-q', 'feature');
	git('merge', '-q', '--no-ff', 'integration', '-m', 'merge integration');
	const oid = git('rev-parse', 'HEAD').toString().trim();

	const detail = await comparisonCommitDetail(dir, oid);

	expect(detail.ok).toBe(true);
	if (!detail.ok) return;
	expect(detail.value.commit.parents).toHaveLength(2);
	expect(detail.value.files.map((file) => file.path)).toEqual(['integration.txt']);
});
