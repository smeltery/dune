import { expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoot } from 'solid-js';

import { createComparison } from '../../src/app/state/comparison';
import { git as runGit } from '../git-fixture';

setDefaultTimeout(15_000);

function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'dune-compare-controller-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	git('init', '-q', '-b', 'trunk');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('config', 'init.defaultBranch', 'trunk');
	writeFileSync(join(dir, 'seed.txt'), 'seed\n');
	git('add', '.');
	git('commit', '-q', '-m', 'seed');
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'auth.ts'), 'export const auth = true\n');
	writeFileSync(join(dir, 'other.ts'), 'export const other = true\n');
	git('add', '.');
	git('commit', '-q', '-m', 'add authentication');
	return { dir, git };
}

function open(dir: string, branch: string | null = 'feature') {
	return createRoot((dispose) => {
		const comparison = createComparison({
			rootDir: dir,
			activeRepo: () => dir,
			branch: () => branch,
			diffBase: () => null,
			say: () => {},
		});
		return { comparison, dispose };
	});
}

async function until(condition: () => boolean, timeout = 8000) {
	const started = Date.now();
	while (!condition() && Date.now() - started < timeout) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(condition()).toBe(true);
}

test('the controller loads, filters and keeps independent file and commit cursors', async () => {
	const root = open(repo().dir);

	root.comparison.open();
	expect(root.comparison.active()).toBe(true);
	expect(root.comparison.state()).toBe('loading');
	await until(() => root.comparison.state() === 'ready');
	expect(root.comparison.result()).toMatchObject({
		base: { name: 'trunk' },
		compare: { name: 'feature' },
	});
	expect(root.comparison.filteredFiles()).toHaveLength(2);

	root.comparison.setFilter('auth');
	expect(root.comparison.filteredFiles().map((file) => file.path)).toEqual(['auth.ts']);
	root.comparison.move(4);
	expect(root.comparison.fileCursor()).toBe(0);

	root.comparison.setFilter('');
	root.comparison.move(1);
	expect(root.comparison.fileCursor()).toBe(1);
	root.comparison.toggleMode();
	expect(root.comparison.mode()).toBe('commits');
	expect(root.comparison.commitCursor()).toBe(0);
	root.comparison.toggleMode();
	expect(root.comparison.fileCursor()).toBe(1);
	root.dispose();
});

test('the controller changes base through the branch list', async () => {
	const { dir, git } = repo();
	git('branch', 'develop', 'trunk');
	const root = open(dir);

	root.comparison.open();
	await until(() => root.comparison.state() === 'ready');
	root.comparison.openBasePicker();
	expect(root.comparison.basePick()?.map((branch) => branch.name)).toContain('develop');
	root.comparison.chooseBase('develop');
	await until(
		() => root.comparison.state() === 'ready' && root.comparison.result()?.base.name === 'develop',
	);
	expect(root.comparison.basePick()).toBeNull();
	root.dispose();
});

test('a newer base choice wins over an earlier load still in flight', async () => {
	const { dir, git } = repo();
	git('branch', 'develop', 'trunk');
	const root = open(dir);

	root.comparison.open();
	root.comparison.chooseBase('develop');
	await until(() => root.comparison.state() === 'ready');

	expect(root.comparison.result()?.base.name).toBe('develop');
	root.dispose();
});

test('the controller lazily opens selected file content and closes detail first', async () => {
	const root = open(repo().dir);

	root.comparison.open();
	await until(() => root.comparison.state() === 'ready');
	expect(root.comparison.selectedContent()).toBeNull();
	root.comparison.openSelection();
	await until(() => root.comparison.selectedContent() !== null);
	expect(root.comparison.selectedContent()).toMatchObject({
		binary: false,
		newText: 'export const auth = true\n',
	});
	expect(root.comparison.detailOpen()).toBe(true);
	root.comparison.closeDetail();
	expect(root.comparison.selectedFile()).toBeNull();
	expect(root.comparison.detailOpen()).toBe(false);
	expect(root.comparison.active()).toBe(true);
	root.dispose();
});

test('the controller opens the base picker instead of guessing main', () => {
	const { dir, git } = repo();
	git('config', '--unset', 'init.defaultBranch');
	const root = open(dir);

	root.comparison.open();

	expect(root.comparison.state()).toBe('idle');
	expect(root.comparison.basePick()?.map((branch) => branch.name)).toContain('trunk');
	root.dispose();
});

test('the controller reports detached HEAD as an explicit comparison error', async () => {
	const { dir, git } = repo();
	git('switch', '--detach', '-q');
	const root = open(dir, null);

	root.comparison.open();
	await until(() => root.comparison.state() === 'error');

	expect(root.comparison.error()).toContain('checked-out branch');
	root.dispose();
});

test('the controller opens commit metadata and pages its files', async () => {
	const root = open(repo().dir);

	root.comparison.open();
	await until(() => root.comparison.state() === 'ready');
	root.comparison.toggleMode();
	root.comparison.openSelection();
	await until(
		() => root.comparison.selectedCommit() !== null && root.comparison.selectedContent() !== null,
	);

	expect(root.comparison.selectedCommit()?.commit.subject).toBe('add authentication');
	expect(root.comparison.selectedFile()?.path).toBe('auth.ts');
	root.comparison.moveDetail(1);
	await until(() => {
		const content = root.comparison.selectedContent();
		return (
			root.comparison.selectedFile()?.path === 'other.ts' &&
			content?.binary === false &&
			content.newText === 'export const other = true\n'
		);
	});
	root.dispose();
});

test('a branch with nothing of its own is empty rather than an error', async () => {
	const { dir, git } = repo();
	git('config', 'init.defaultBranch', 'feature');
	const root = open(dir);

	root.comparison.open();
	await until(() => root.comparison.state() === 'empty');

	expect(root.comparison.result()?.stats.files).toBe(0);
	expect(root.comparison.error()).toBe('');
	root.dispose();
});

test('closing the comparison drops its detail and state', async () => {
	const root = open(repo().dir);

	root.comparison.open();
	await until(() => root.comparison.state() === 'ready');
	root.comparison.openSelection();
	await until(() => root.comparison.selectedContent() !== null);
	root.comparison.close();

	expect(root.comparison.active()).toBe(false);
	expect(root.comparison.detailOpen()).toBe(false);
	expect(root.comparison.state()).toBe('idle');
	root.dispose();
});
