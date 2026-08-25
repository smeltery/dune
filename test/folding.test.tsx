import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALT } from '../src/ui/keys';
import { fixture, launch, openFile, press, runCommand, settle } from './helpers';

const FILE = [
	'function outer() {',
	'  const secret = 1',
	'  return secret',
	'}',
	'',
	'const after = 2',
	'',
].join('\n');

async function pressTimes(
	t: Awaited<ReturnType<typeof launch>>,
	n: number,
	action: (input: (typeof t)['mockInput']) => void,
) {
	for (let i = 0; i < n; i++) await press(t, action);
}

test('folding hides the block and says how much it took', async () => {
	const dir = fixture({ 'a.ts': FILE });
	const t = await launch(dir);
	await openFile(t, 'a.ts');
	expect(t.captureCharFrame()).toContain('const secret = 1');

	await runCommand(t, 'Fold block at cursor');
	const folded = t.captureCharFrame();
	expect(folded).not.toContain('const secret = 1');
	expect(folded).not.toContain('return secret');
	expect(folded).toContain('function outer() {');
	expect(folded).toContain('⋯ 2 lines');
	expect(folded).toMatch(/4\s+\}/);
	expect(folded).toMatch(/6\s+const after = 2/);
	expect(folded).toContain(`⋯ 2 lines Ctrl+${ALT}+E`);

	await runCommand(t, 'Unfold block at cursor');
	expect(t.captureCharFrame()).toContain('const secret = 1');
});

test('a fold never reaches the file, however the buffer is edited', async () => {
	const dir = fixture({ 'a.ts': FILE });
	const t = await launch(dir);
	await openFile(t, 'a.ts');
	await runCommand(t, 'Fold block at cursor');

	await pressTimes(t, 5, (i) => i.pressArrow('down'));
	await press(t, (i) => void i.typeText('const tail = 3'));
	await press(t, (i) => i.pressKey('s', { ctrl: true }));
	await settle(t);

	const saved = readFileSync(join(dir, 'a.ts'), 'utf8');
	expect(saved).toContain('const secret = 1');
	expect(saved).toContain('return secret');
	expect(saved).toContain('const tail = 3');
	expect(saved.startsWith('function outer() {\n  const secret = 1')).toBe(true);
});

test('typing on a folded line opens the block rather than editing past it', async () => {
	const dir = fixture({ 'a.ts': FILE });
	const t = await launch(dir);
	await openFile(t, 'a.ts');
	await runCommand(t, 'Fold block at cursor');
	expect(t.captureCharFrame()).not.toContain('const secret = 1');

	await press(t, (i) => void i.typeText(' '));
	const frame = t.captureCharFrame();
	expect(frame).toContain('const secret = 1');
	expect(frame).not.toContain('⋯');

	await press(t, (i) => i.pressKey('s', { ctrl: true }));
	await settle(t);
	const saved = readFileSync(join(dir, 'a.ts'), 'utf8');
	expect(saved.split('\n')[1]).toBe('  const secret = 1');
});

test('fold everything closes every block, and unfold everything opens them', async () => {
	const dir = fixture({ 'a.ts': FILE });
	const t = await launch(dir);
	await openFile(t, 'a.ts');
	await runCommand(t, 'Fold everything');
	expect(t.captureCharFrame()).not.toContain('const secret = 1');
	await runCommand(t, 'Unfold everything');
	expect(t.captureCharFrame()).toContain('const secret = 1');
});
