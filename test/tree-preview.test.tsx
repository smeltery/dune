import { expect, setDefaultTimeout, test } from 'bun:test';

import { fixture, launch, press, pressEscape, runCommand, settle, until } from './helpers';
import type { Harness } from './helpers';

setDefaultTimeout(30_000);

/** The page keys as a terminal sends them; `mockInput` has no helper for either. */
const PAGE_UP = '\u001B[5~';
const PAGE_DOWN = '\u001B[6~';

/** A fresh launch leaves the tree cursor on the root; one down lands on the first file. */
async function onFirstFile(t: Harness) {
	await press(t, (input) => input.pressArrow('down'));
	await until(t, () => t.captureCharFrame().includes('a.ts'));
}

test('Space shows the file under the cursor without opening a tab', async () => {
	const t = await launch(
		fixture({
			'a.ts': 'const previewMe = 1\n',
			'b.ts': 'const other = 2\n',
		}),
	);
	await onFirstFile(t);
	await press(t, (input) => input.pressKey(' '));
	await until(t, () => t.captureCharFrame().includes('const previewMe = 1'));
	expect(t.captureCharFrame()).toContain('preview ·');
});

test('Space again closes the preview', async () => {
	const t = await launch(fixture({ 'a.ts': 'const once = 1\n' }));
	await onFirstFile(t);
	await press(t, (input) => input.pressKey(' '));
	await until(t, () => t.captureCharFrame().includes('preview ·'));
	await press(t, (input) => input.pressKey(' '));
	await settle(t, 50);
	expect(t.captureCharFrame()).not.toContain('preview ·');
});

test('Enter opens the file and closes the preview', async () => {
	const t = await launch(fixture({ 'a.ts': 'const opened = 1\n' }));
	await onFirstFile(t);
	await press(t, (input) => input.pressKey(' '));
	await until(t, () => t.captureCharFrame().includes('preview ·'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => !t.captureCharFrame().includes('preview ·'));
	expect(t.captureCharFrame()).toContain('const opened = 1');
});

test('the page keys scroll the preview while the tree keeps the arrows', async () => {
	const lines = Array.from({ length: 200 }, (_, at) => `const line${at} = ${at}`).join('\n');
	const t = await launch(fixture({ 'a.ts': `${lines}\n`, 'b.ts': '' }));
	await onFirstFile(t);
	await press(t, (input) => input.pressKey(' '));
	await until(t, () => t.captureCharFrame().includes('const line0 = 0'));

	await press(t, (input) => void input.pressKeys([PAGE_DOWN]));
	await until(t, () => !t.captureCharFrame().includes('const line0 = 0'));
	// The cursor has not moved: the arrows are still the tree's.
	expect(t.captureCharFrame()).toContain('a.ts');

	await press(t, (input) => void input.pressKeys([PAGE_UP]));
	await until(t, () => t.captureCharFrame().includes('const line0 = 0'));
});

test('a folder and a file dune cannot read say so rather than showing nothing', async () => {
	// A NUL byte is what makes a file binary — the same sniff git uses.
	const t = await launch(
		fixture({
			'a.ts': 'const a = 1\n',
			'b.ts': 'const b = 2\n',
			'sub/c.ts': 'const c = 3\n',
			'bin.dat': 'a\0b',
		}),
	);
	// Folders sort first, so one down from the root lands on `sub/`.
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressKey(' '));
	await until(t, () => t.captureCharFrame().includes('Folder'));

	// Past `sub/` the rows are alphabetical: a.ts, b.ts, bin.dat.
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressArrow('down'));
	await until(t, () => t.captureCharFrame().includes('Binary'));
});

test('the palette turns it on from the editor, and Esc closes it', async () => {
	const t = await launch(fixture({ 'a.ts': 'const opened = 1\n' }));
	await onFirstFile(t);
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().split('\n')[0]!.includes('a.ts'));

	await runCommand(t, 'Preview file');
	await until(t, () => t.captureCharFrame().includes('preview'));

	await pressEscape(t);
	expect(t.captureCharFrame()).not.toContain('preview ·');
});
