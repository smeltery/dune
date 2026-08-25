import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launch, press, pressEscape, runCommand, until, untilFrame, untilGone } from './helpers';
import { git } from './git-fixture';

function initRepo(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), 'dune-changes-'));
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'config', 'user.email', 'test@example.com');
	git(dir, 'config', 'user.name', 'Test');
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	git(dir, 'add', '.');
	git(dir, 'commit', '-q', '-m', 'init');
	return dir;
}

test('Show all changes stacks every file in the editor slot', async () => {
	const dir = initRepo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' });
	writeFileSync(join(dir, 'a.ts'), 'ALPHA\n');
	writeFileSync(join(dir, 'b.ts'), 'BETA\n');

	const t = await launch(dir, {}, { height: 40 });
	await runCommand(t, 'Show all changes');
	await untilFrame(t, '+ ALPHA');

	const frame = t.captureCharFrame();
	expect(frame).toContain('Uncommitted');
	expect(frame).toContain('+ ALPHA');
	expect(frame).toContain('+ BETA');
	expect(frame).toContain('a.ts');
	expect(frame).toContain('b.ts');
});

test('Esc closes the all-changes page back to the editor', async () => {
	const dir = initRepo({ 'a.ts': 'alpha\n' });
	writeFileSync(join(dir, 'a.ts'), 'ALPHA\n');

	const t = await launch(dir, {}, { height: 40 });
	await runCommand(t, 'Show all changes');
	await untilFrame(t, 'Uncommitted');
	await pressEscape(t);
	await untilGone(t, 'Uncommitted');
});

test('a in the source-control panel opens the page', async () => {
	const dir = initRepo({ 'a.ts': 'alpha\n' });
	writeFileSync(join(dir, 'a.ts'), 'ALPHA\n');

	const t = await launch(dir, {}, { height: 40 });
	await runCommand(t, 'Source control');
	await untilFrame(t, 'Changes');
	await press(t, (i) => i.pressKey('a'));
	await untilFrame(t, 'Uncommitted');
	expect(t.captureCharFrame()).toContain('+ ALPHA');
});

test('Space on the page stages the file its header names', async () => {
	const dir = initRepo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' });
	writeFileSync(join(dir, 'a.ts'), 'ALPHA\n');
	writeFileSync(join(dir, 'b.ts'), 'BETA\n');

	const t = await launch(dir, {}, { height: 40 });
	await runCommand(t, 'Show all changes');
	await untilFrame(t, 'a.ts');
	await press(t, (i) => i.pressTab());
	await press(t, (i) => void i.typeText(' '));

	await until(t, () =>
		execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().startsWith('M  a.ts'),
	);
	await untilFrame(t, 'staged');
});

test('Enter in the panel opens the file and closes the page', async () => {
	const dir = initRepo({ 'a.ts': 'alpha\n' });
	writeFileSync(join(dir, 'a.ts'), 'ALPHA\n');

	const t = await launch(dir, {}, { height: 40 });
	await runCommand(t, 'Show all changes');
	await untilFrame(t, 'Uncommitted');
	await press(t, (i) => i.pressEnter());
	await untilGone(t, 'Uncommitted');
	expect(t.captureCharFrame()).toContain('ALPHA');
});
