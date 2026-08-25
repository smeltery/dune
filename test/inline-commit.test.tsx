import { expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git as runGit } from './git-fixture';
import { launch, press, settle, until } from './helpers';

setDefaultTimeout(60_000);

const ESC = String.fromCharCode(27);

function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'dune-inline-commit-'));
	runGit(dir, 'init', '-q', '-b', 'main');
	runGit(dir, 'config', 'user.email', 'test@example.com');
	runGit(dir, 'config', 'user.name', 'Test');
	writeFileSync(join(dir, 'a.ts'), 'one\n');
	runGit(dir, 'add', '.');
	runGit(dir, 'commit', '-q', '-m', 'init');
	return dir;
}

const subject = (dir: string) =>
	execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim();

const openScm = async (t: Awaited<ReturnType<typeof launch>>) => {
	await press(t, (input) => void input.pressKeys([`${ESC}${String.fromCharCode(7)}`]));
	await until(t, () => t.captureCharFrame().includes('Message (c to edit)'));
};

test('source control panel has an inline commit message box', async () => {
	const dir = repo();
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	runGit(dir, 'add', 'a.ts');

	const t = await launch(dir);
	await openScm(t);
	expect(t.captureCharFrame()).toContain('✓ Commit');
});

test('inline commit box walks recent subjects with up/down', async () => {
	const dir = repo();
	runGit(dir, 'commit', '--allow-empty', '-q', '-m', 'second thoughts');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	runGit(dir, 'add', 'a.ts');

	const t = await launch(dir);
	await openScm(t);
	await press(t, (input) => void input.typeText('c'));
	await until(t, () => t.captureCharFrame().includes('Commit message'));
	await press(t, (input) => void input.typeText('half a thought'));
	await press(t, (input) => input.pressArrow('up'));
	await until(t, () => t.captureCharFrame().includes('second thoughts'));
	await press(t, (input) => input.pressArrow('up'));
	await until(t, () => t.captureCharFrame().includes('init'));
	await press(t, (input) => input.pressArrow('down'));
	await until(t, () => t.captureCharFrame().includes('second thoughts'));
	await press(t, (input) => input.pressArrow('down'));
	await until(t, () => t.captureCharFrame().includes('half a thought'));
});

test('enter in the inline box commits staged changes', async () => {
	const dir = repo();
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	runGit(dir, 'add', 'a.ts');

	const t = await launch(dir);
	await openScm(t);
	await press(t, (input) => void input.typeText('c'));
	await settle(t, 50);
	await press(t, (input) => void input.typeText('from the box'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => subject(dir) === 'from the box');
});
