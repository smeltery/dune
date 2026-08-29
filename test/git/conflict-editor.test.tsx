import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

import { fixture, launch, openFile, press, runCommand, until } from '../helpers';

const CONFLICTED = [
	'const a = 1',
	'<<<<<<< HEAD',
	'const b = 2',
	'=======',
	'const b = 3',
	'>>>>>>> feature/x',
	'const c = 4',
	'',
].join('\n');

const intoConflict = async (t: Awaited<ReturnType<typeof launch>>) => {
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressArrow('down'));
};

test('accepting the current change edits the active buffer', async () => {
	const dir = fixture({ 'a.ts': CONFLICTED });
	const t = await launch(dir);
	await openFile(t, 'a.ts');
	await intoConflict(t);
	await runCommand(t, 'Accept current change');
	await until(t, () => !t.captureCharFrame().includes('<<<<<<<'));

	expect(t.captureCharFrame()).toContain('const b = 2');
	expect(t.captureCharFrame()).not.toContain('const b = 3');
	await press(t, (input) => input.pressKey('s', { ctrl: true }));
	await until(t, () => !readFileSync(join(dir, 'a.ts'), 'utf8').includes('<<<<<<<'));
	expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const a = 1\nconst b = 2\nconst c = 4\n');
});

test('resolve chooser names both sides', async () => {
	const t = await launch(fixture({ 'a.ts': CONFLICTED }));
	await openFile(t, 'a.ts');
	await intoConflict(t);
	await runCommand(t, 'Resolve conflict at cursor');
	await until(t, () => t.captureCharFrame().includes('Merge conflict'));

	expect(t.captureCharFrame()).toContain('Current change (HEAD)');
	expect(t.captureCharFrame()).toContain('Incoming change (feature/x)');
	expect(t.captureCharFrame()).toContain('Both changes');
});

test('next conflict jumps and reports count', async () => {
	const t = await launch(fixture({ 'a.ts': CONFLICTED + CONFLICTED }));
	await openFile(t, 'a.ts');
	await runCommand(t, 'Next conflict');
	await until(t, () => t.captureCharFrame().includes('Conflict 1 of 2'));
	await runCommand(t, 'Next conflict');
	await until(t, () => t.captureCharFrame().includes('Conflict 2 of 2'));
});

test('Ctrl+Opt+U opens the resolve chooser at the cursor', async () => {
	const t = await launch(fixture({ 'a.ts': CONFLICTED }));
	await openFile(t, 'a.ts');
	await intoConflict(t);
	await press(t, (input) => input.pressKey('u', { ctrl: true, meta: true }));
	await until(t, () => t.captureCharFrame().includes('Merge conflict'));
	expect(t.captureCharFrame()).toContain('Current change (HEAD)');
});

test('Ctrl+Opt+J jumps to the next conflict', async () => {
	const t = await launch(fixture({ 'a.ts': CONFLICTED + CONFLICTED }));
	await openFile(t, 'a.ts');
	await press(t, (input) => input.pressKey('j', { ctrl: true, meta: true }));
	await until(t, () => t.captureCharFrame().includes('Conflict 1 of 2'));
});

test('a custom binding can run next conflict', async () => {
	const F2 = '\u001BOQ';
	const dir = fixture({ 'a.ts': CONFLICTED + CONFLICTED });
	const t = await launch(dir, { keybindings: { 'editor.nextConflict': 'F2' } });
	await openFile(t, 'a.ts');
	await press(t, (input) => void input.pressKeys([F2]));
	await until(t, () => t.captureCharFrame().includes('Conflict 1 of 2'));
});
