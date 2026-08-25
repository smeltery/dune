import { expect, test } from 'bun:test';

import { ui } from '../src/themes';
import { fixture, launch, openFile, press, runCommand, settle } from './helpers';
import type { Harness } from './helpers';

/**
 * The strip is the sidebar's own row, under the file tabs bar that spans the
 * terminal. Columns assume the full labels fit — `sidebarWidth` below is wide
 * enough for "Plugins", the longest one.
 */
const TABS_ROW = 1;
const FILES_X = 2;
const GIT_X = 10;
const WIDE_SIDEBAR = { sidebarWidth: 40 as const };

interface Span {
	text: string;
	bg?: { buffer: Uint8Array };
	fg?: { buffer: Uint8Array };
}
interface Frame {
	lines: { spans: Span[] }[];
}

const hex = (color: Span['bg']) =>
	color
		? `#${Array.from(color.buffer.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
		: '';

/** Background behind a button's label, which is what says it is the pressed one. */
function fillBehind(t: Harness, label: string): string {
	const frame = t.captureSpans() as unknown as Frame;
	const span = frame.lines[TABS_ROW]?.spans.find((s) => s.text.includes(label));
	return hex(span?.bg);
}

const frame = (t: Harness) => t.captureCharFrame();

test('the tab strip switches the sidebar between its views on click', async () => {
	const t = await launch(fixture({ 'a.ts': 'alpha\n' }), WIDE_SIDEBAR, { width: 100 });
	expect(frame(t)).toContain('explorer');

	await t.mockMouse.click(GIT_X, TABS_ROW);
	await settle(t);
	expect(frame(t)).toContain('no changes');
	expect(frame(t)).not.toContain('explorer');

	await t.mockMouse.click(FILES_X, TABS_ROW);
	await settle(t);
	expect(frame(t)).toContain('explorer');
});

test('the view on screen is the filled button, and the fill follows the click', async () => {
	const t = await launch(fixture({ 'a.ts': 'alpha\n' }), WIDE_SIDEBAR, { width: 100 });
	expect(fillBehind(t, 'Files')).toBe(ui.statusBg.toLowerCase());
	expect(fillBehind(t, 'Git')).toBe(ui.barBg.toLowerCase());

	await t.mockMouse.click(GIT_X, TABS_ROW);
	await settle(t);
	expect(fillBehind(t, 'Git')).toBe(ui.statusBg.toLowerCase());
	expect(fillBehind(t, 'Files')).toBe(ui.barBg.toLowerCase());
});

test('a keybinding that opens a panel selects its tab, not a separate mode', async () => {
	const t = await launch(fixture({ 'a.ts': 'alpha\n' }), WIDE_SIDEBAR, { width: 100 });
	await runCommand(t, 'Plugins panel');
	expect(fillBehind(t, 'Plugins')).toBe(ui.statusBg.toLowerCase());
	expect(frame(t)).toContain('INSTALLED');

	// Selecting Files by clicking its tab puts the tree back, the same way Esc does.
	await t.mockMouse.click(FILES_X, TABS_ROW);
	await settle(t);
	expect(frame(t)).toContain('explorer');
	expect(fillBehind(t, 'Files')).toBe(ui.statusBg.toLowerCase());
});

test('Shift+Tab walks the strip forward, wrapping from Plugins back to Files', async () => {
	const t = await launch(fixture({ 'a.ts': 'alpha\n' }), WIDE_SIDEBAR, { width: 100 });

	await press(t, (input) => input.pressTab({ shift: true }));
	expect(fillBehind(t, 'Git')).toBe(ui.statusBg.toLowerCase());
	expect(frame(t)).toContain('no changes');

	await press(t, (input) => input.pressTab({ shift: true }));
	expect(fillBehind(t, 'Review')).toBe(ui.statusBg.toLowerCase());

	await press(t, (input) => input.pressTab({ shift: true }));
	expect(fillBehind(t, 'Plugins')).toBe(ui.statusBg.toLowerCase());
	expect(frame(t)).toContain('INSTALLED');

	await press(t, (input) => input.pressTab({ shift: true }));
	expect(fillBehind(t, 'Files')).toBe(ui.statusBg.toLowerCase());
	expect(frame(t)).toContain('explorer');
});

test('Shift+Tab still walks the strip while the git panel owns the keyboard', async () => {
	const t = await launch(fixture({ 'a.ts': 'alpha\n' }), WIDE_SIDEBAR, { width: 100 });
	await t.mockMouse.click(GIT_X, TABS_ROW);
	await settle(t);

	await press(t, (input) => input.pressTab({ shift: true }));
	expect(fillBehind(t, 'Review')).toBe(ui.statusBg.toLowerCase());
});

test('the review tab carries the note count', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), WIDE_SIDEBAR, { width: 100 });
	await openFile(t, 'a.ts');
	await runCommand(t, 'Add issue note');
	await press(t, (input) => void input.typeText('needs a look'));
	await press(t, (input) => input.pressEnter());

	expect(frame(t).split('\n')[TABS_ROW]).toContain('Review 1');
});

test('a sidebar too narrow for the full labels falls back to initials', async () => {
	// The default width (no `sidebarWidth` override) is narrower than the strip
	// needs for every label, so it drops to single letters instead of wrapping.
	const t = await launch(fixture({ 'a.ts': 'alpha\n' }));
	const strip = frame(t).split('\n')[TABS_ROW]!;
	expect(strip).toContain('F');
	expect(strip).toContain('G');
	expect(strip).not.toContain('Files');
	expect(strip).not.toContain('Git');
});
