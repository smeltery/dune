import { expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git as runGit } from '../git-fixture';
import { launch, press, pressEscape, runCommand, until, type Harness } from '../helpers';

setDefaultTimeout(20_000);

function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'dune-compare-panel-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	git('init', '-q', '-b', 'trunk');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('config', 'init.defaultBranch', 'trunk');
	writeFileSync(join(dir, 'auth.ts'), 'export const auth = false\n');
	git('add', '.');
	git('commit', '-q', '-m', 'seed');
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'auth.ts'), 'export const auth = true\n');
	writeFileSync(join(dir, 'session.ts'), 'export const session = true\n');
	git('add', '.');
	git('commit', '-q', '-m', 'add authentication');
	return { dir, git };
}

/** The comparison loads asynchronously: wait for the frame it produces. */
async function untilFrame(t: Harness, text: string) {
	await until(t, () => t.captureCharFrame().includes(text), 60);
	expect(t.captureCharFrame()).toContain(text);
}

async function openComparison(t: Harness) {
	await runCommand(t, 'Compare branches');
	await untilFrame(t, 'base  trunk');
}

test('Compare branches opens the panel with the default base and a summary', async () => {
	const t = await launch(repo().dir);

	await openComparison(t);

	const frame = t.captureCharFrame();
	expect(frame).toContain('feature');
	expect(frame).toContain('compare');
	expect(frame).toContain('base  trunk');
	expect(frame).toContain('↑1');
	expect(frame).toContain('2 files');
	expect(frame).toContain('+2 -1');
	expect(frame).toContain('[Files]');
	expect(frame).toContain('auth.ts');
	expect(frame).toContain('session.ts');
});

test('the comparison base is independent of the working-tree diff base', async () => {
	const { dir, git } = repo();
	git('branch', 'develop', 'trunk');
	const t = await launch(dir);

	await openComparison(t);
	await press(t, (input) => void input.typeText('B'));
	await untilFrame(t, 'Compare against branch');
	await press(t, (input) => void input.typeText('develop'));
	await press(t, (input) => input.pressEnter());
	await untilFrame(t, 'base  develop');

	// Retargeting the comparison must not move what staging or the gutter act on.
	const footer = t.captureCharFrame().split('\n').at(-2)!;
	expect(footer).toContain('⎇ feature');
	expect(t.captureCharFrame()).toContain('2 files');
});

test('/ filters comparison rows without touching the source-control panel', async () => {
	const t = await launch(repo().dir);
	await openComparison(t);

	await press(t, (input) => void input.typeText('/'));
	await press(t, (input) => void input.typeText('session'));

	const frame = t.captureCharFrame();
	expect(frame).toContain('filter session');
	expect(frame).toContain('session.ts');
	expect(frame).not.toContain('auth.ts');
});

test('c switches the panel to the commits the branch introduced', async () => {
	const t = await launch(repo().dir);
	await openComparison(t);

	await press(t, (input) => void input.typeText('c'));

	const frame = t.captureCharFrame();
	expect(frame).toContain('[Commits]');
	expect(frame).toContain('add authentication');
	expect(frame).not.toContain('session.ts');
});

test('Enter opens a lazily loaded file diff over the editor slot', async () => {
	const t = await launch(repo().dir);
	await openComparison(t);

	await press(t, (input) => input.pressEnter());
	await untilFrame(t, '+ export const auth = true');

	const frame = t.captureCharFrame();
	expect(frame).toContain('- export const auth = false');
	expect(frame).toContain('modified auth.ts +1 -1');
});

test('d switches the comparison diff between inline and split', async () => {
	const t = await launch(repo().dir, {}, { width: 120 });
	await openComparison(t);
	await press(t, (input) => input.pressEnter());
	await untilFrame(t, '+ export const auth = true');

	await press(t, (input) => void input.typeText('d'));

	const frame = t.captureCharFrame();
	expect(frame).toContain('│');
	expect(frame).toContain('d inline');
});

test('a commit row opens its metadata and pages through its files', async () => {
	const t = await launch(repo().dir, {}, { width: 100 });
	await openComparison(t);
	await press(t, (input) => void input.typeText('c'));
	await press(t, (input) => input.pressEnter());
	await untilFrame(t, '+ export const auth = true');

	const frame = t.captureCharFrame();
	expect(frame).toContain('add authentication');
	expect(frame).toContain('Test <test@example.com>');
	expect(frame).toContain('2 files · 1 parent');

	// ←→ page through the commit's files; ↑↓ stay the diff's own scroll.
	await press(t, (input) => input.pressArrow('right'));
	await untilFrame(t, '+ export const session = true');
	expect(t.captureCharFrame()).toContain('session.ts');
});

test('Esc closes the comparison page before leaving the comparison', async () => {
	const t = await launch(repo().dir);
	await openComparison(t);
	await press(t, (input) => input.pressEnter());
	await untilFrame(t, '+ export const auth = true');

	await pressEscape(t);
	await untilFrame(t, '[Files]');
	expect(t.captureCharFrame()).toContain('base  trunk');

	await pressEscape(t);
	await until(t, () => !t.captureCharFrame().includes('base  trunk'), 40);
	expect(t.captureCharFrame()).not.toContain('base  trunk');
});

test('a branch with no work of its own reports no differences', async () => {
	const { dir, git } = repo();
	git('config', 'init.defaultBranch', 'feature');
	const t = await launch(dir);

	await runCommand(t, 'Compare branches');
	await untilFrame(t, 'no differences');

	expect(t.captureCharFrame()).toContain('0 files');
});

test('a long comparison windows its rows around the cursor', async () => {
	const { dir, git } = repo();
	for (let index = 0; index < 40; index++) {
		writeFileSync(join(dir, `file-${index.toString().padStart(2, '0')}.ts`), `${index}\n`);
	}
	git('add', '.');
	git('commit', '-q', '-m', 'many files');
	const t = await launch(dir, {}, { height: 20 });

	await openComparison(t);
	await untilFrame(t, '42 files');
	for (let index = 0; index < 25; index++) {
		await press(t, (input) => input.pressArrow('down'));
	}

	const frame = t.captureCharFrame();
	expect(frame).toContain('file-24.ts');
	expect(frame).not.toContain('auth.ts');
});

test('binary, deleted and renamed rows keep their comparison status', async () => {
	const { dir, git } = repo();
	git('switch', '-q', 'trunk');
	writeFileSync(join(dir, 'deleted.txt'), 'remove me\n');
	const before = 'one\ntwo\nthree\nfour\nfive\n';
	writeFileSync(join(dir, 'old-name.txt'), before);
	git('add', '.');
	git('commit', '-q', '-m', 'more base files');
	git('branch', '-f', 'feature', 'trunk');
	git('switch', '-q', 'feature');
	git('rm', '-q', 'deleted.txt');
	git('mv', 'old-name.txt', 'new-name.txt');
	writeFileSync(join(dir, 'new-name.txt'), before.replace('one', 'ONE'));
	writeFileSync(join(dir, 'binary.bin'), new Uint8Array([0, 1, 2]));
	git('add', '-A');
	git('commit', '-q', '-m', 'mixed statuses');
	const t = await launch(dir);

	await openComparison(t);
	await untilFrame(t, '3 files');
	const row = (name: string) =>
		t
			.captureCharFrame()
			.split('\n')
			.find((line) => line.includes(name)) ?? '';
	expect(row('binary.bin')).toContain('binary A');
	expect(row('deleted.txt')).toContain('D');
	expect(row('new-name.txt')).toContain('R');

	await press(t, (input) => input.pressEnter());
	await untilFrame(t, 'Binary file');
	expect(t.captureCharFrame()).toContain('textual diff is not available');
});
