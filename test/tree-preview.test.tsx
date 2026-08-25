import { expect, setDefaultTimeout, test } from 'bun:test';

import { fixture, launch, press, settle } from './helpers';
import type { Harness } from './helpers';

setDefaultTimeout(30_000);

async function until(t: Harness, cond: () => boolean, ms = 5000) {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (cond()) return;
		await settle(t, 25);
	}
	throw new Error('condition not met');
}

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
