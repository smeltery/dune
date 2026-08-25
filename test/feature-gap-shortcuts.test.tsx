import { expect, test } from 'bun:test';

import { fixture, launch, openFile, press, runCommand, settle } from './helpers';

const ESC = String.fromCharCode(27);
const CTRL_OPT_A = `${ESC}${String.fromCharCode(1)}`;
const CTRL_OPT_R = `${ESC}${String.fromCharCode(18)}`;

const PROJECT = { 'a.ts': 'const a = 1\nconst b = 2\n' };

test('Ctrl+Opt+A opens the review note kind chooser', async () => {
	const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 });
	await openFile(t, 'a.ts');
	await press(t, (i) => void i.pressKeys([CTRL_OPT_A]));
	await settle(t);
	expect(t.captureCharFrame()).toContain('Review note');
	expect(t.captureCharFrame()).toContain('Issue');
});

test('Ctrl+Opt+R opens the review panel', async () => {
	const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 });
	await openFile(t, 'a.ts');
	await press(t, (i) => void i.pressKeys([CTRL_OPT_R]));
	await settle(t);
	expect(t.captureCharFrame()).toContain('review');
	expect(t.captureCharFrame()).toContain('No notes yet');
});

test('Reply to the remark under the cursor is in the palette', async () => {
	const t = await launch(fixture(PROJECT), {}, { width: 100, height: 24 });
	await openFile(t, 'a.ts');
	await runCommand(t, 'Add issue note');
	await press(t, (i) => void i.typeText('needs a fix'));
	await press(t, (i) => i.pressEnter());
	await runCommand(t, 'Reply to the remark under the cursor');
	await settle(t);
	expect(t.captureCharFrame()).toContain('Reply');
});
