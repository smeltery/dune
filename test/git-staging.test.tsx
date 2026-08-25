import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { statusEntries, statusMap } from '../src/core/git';
import { git } from './git-fixture';
import { launch, press, until } from './helpers';

const ESC = String.fromCharCode(27);

function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'dune-git-stage-'));
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'config', 'user.email', 'test@example.com');
	git(dir, 'config', 'user.name', 'Test');
	writeFileSync(join(dir, 'tracked.ts'), 'one\n');
	git(dir, 'add', '.');
	git(dir, 'commit', '-q', '-m', 'init');
	return dir;
}

test('statusEntries keeps staged and unstaged columns apart', () => {
	const dir = repo();
	writeFileSync(join(dir, 'tracked.ts'), 'one\nchanged\n');
	git(dir, 'add', 'tracked.ts');

	const entries = statusEntries(dir);
	const entry = entries.get(join(dir, 'tracked.ts'));
	expect(entry?.staged).toBe('modified');
	expect(entry?.unstaged).toBeNull();
	expect(statusMap(dir).get(join(dir, 'tracked.ts'))).toBe('modified');

	writeFileSync(join(dir, 'tracked.ts'), 'one\nchanged again\n');
	const both = statusEntries(dir).get(join(dir, 'tracked.ts'));
	expect(both?.staged).toBe('modified');
	expect(both?.unstaged).toBe('modified');
});

test('source control panel shows staged and unstaged sections', async () => {
	const dir = repo();
	writeFileSync(join(dir, 'tracked.ts'), 'one\nchanged\n');
	git(dir, 'add', 'tracked.ts');
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');

	const t = await launch(dir);
	await press(t, (input) => void input.pressKeys([`${ESC}${String.fromCharCode(7)}`]));

	const frame = t.captureCharFrame();
	expect(frame).toContain('Staged Changes');
	expect(frame).toContain('Changes');
	expect(frame).toContain('tracked.ts');
	expect(frame).toContain('fresh.ts');
});

test('space in source control panel stages and unstages the selected file', async () => {
	const dir = repo();
	writeFileSync(join(dir, 'fresh.ts'), 'new\n');

	const t = await launch(dir);
	await press(t, (input) => void input.pressKeys([`${ESC}${String.fromCharCode(7)}`]));
	await until(t, () => t.captureCharFrame().includes('fresh.ts'));
	await press(t, (input) => input.pressArrow('down'));

	await press(t, (input) => void input.typeText(' '));
	await until(t, () => t.captureCharFrame().includes('Staged Changes'));

	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => void input.typeText(' '));
	await until(t, () => !t.captureCharFrame().includes('Staged Changes'));
	expect(t.captureCharFrame()).toContain('fresh.ts');
});
