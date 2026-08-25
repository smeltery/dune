import { expect, test } from 'bun:test';

import { fixture, launch, press, pressEscape, runCommand, settle } from './helpers';

const ESC = String.fromCharCode(27);
const CTRL_OPT_X = `${ESC}${String.fromCharCode(24)}`;

test('Plugins panel opens from the palette and Ctrl+Opt+X', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, { width: 100, height: 24 });
	await runCommand(t, 'Plugins panel');
	await settle(t);
	expect(t.captureCharFrame()).toContain('plugins');
	expect(t.captureCharFrame()).toContain('INSTALLED');

	await pressEscape(t);
	await settle(t);
	expect(t.captureCharFrame()).not.toContain('INSTALLED');
	expect(t.captureCharFrame()).toContain('explorer');

	await press(t, (i) => void i.pressKeys([CTRL_OPT_X]));
	await settle(t);
	expect(t.captureCharFrame()).toContain('plugins');
	expect(t.captureCharFrame()).toContain('INSTALLED');
});

test('Esc closes the plugins panel back to the file tree', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, { width: 100, height: 24 });
	await runCommand(t, 'Plugins panel');
	await settle(t);
	expect(t.captureCharFrame()).toContain('INSTALLED');
	await pressEscape(t);
	await settle(t);
	expect(t.captureCharFrame()).toContain('a.ts');
	expect(t.captureCharFrame()).not.toContain('INSTALLED');
});
