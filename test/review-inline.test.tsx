import { expect, test } from 'bun:test';

import { fixture, launch, openFile, press, runCommand, settle } from './helpers';

const PROJECT = { 'a.ts': 'const a = 1\nconst b = 2\n' };

async function noteLine(t: Awaited<ReturnType<typeof launch>>, kind: string, text: string) {
	await runCommand(t, kind === 'note' ? 'Add note' : `Add ${kind} note`);
	await press(t, (i) => void i.typeText(text));
	await press(t, (i) => i.pressEnter());
}

test('a draft note marks the gutter and shows beside the line', async () => {
	const t = await launch(fixture(PROJECT), {}, { width: 120, height: 24 });
	await openFile(t, 'a.ts');
	await noteLine(t, 'issue', 'this should be const');
	await settle(t);
	const frame = t.captureCharFrame();
	expect(frame).toContain('◆');
	expect(frame).toContain('ISSUE: this should be const');
});

test('inline review notes can be disabled while the gutter mark stays', async () => {
	const t = await launch(fixture(PROJECT), { reviewInline: false }, { width: 120, height: 24 });
	await openFile(t, 'a.ts');
	await noteLine(t, 'issue', 'hidden beside the line');
	await settle(t);
	const frame = t.captureCharFrame();
	expect(frame).toContain('◆');
	expect(frame).not.toContain('ISSUE: hidden beside the line');
});
