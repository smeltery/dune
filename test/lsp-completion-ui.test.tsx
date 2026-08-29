import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { fixture, launch, press, pressEscape, runCommand, until } from './helpers';

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts');
const lspConfig = { lsp: true, lspServers: { typescript: [process.execPath, FAKE] } };

const frame = (t: Awaited<ReturnType<typeof launch>>) => t.captureCharFrame();

describe('LSP completions in the editor', () => {
	test('auto-triggers completions while typing a word', async () => {
		const dir = fixture({ 'a.ts': '' });
		const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') });

		await runCommand(t, 'Show completions');
		await until(t, () => frame(t).includes('duneAlpha'));
		await pressEscape(t);
		await press(t, (input) => void input.typeText('dune'));
		await until(t, () => frame(t).includes('duneAlpha'), 120);

		expect(frame(t)).toContain('duneAlpha');
	});

	test('shows and accepts completions from the command palette', async () => {
		const dir = fixture({ 'a.ts': '' });
		const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') });

		await press(t, (input) => void input.typeText('dune'));
		await runCommand(t, 'Show completions');
		await until(t, () => frame(t).includes('duneAlpha'));

		expect(frame(t)).toContain('duneAlpha');
		await until(t, () => frame(t).includes('Runs the alpha completion.'));
		expect(frame(t)).toContain('function duneAlpha(): void');
		expect(frame(t)).toContain('dune/fake');
		await press(t, (input) => input.pressEnter());
		await until(t, () => frame(t).includes('duneAlpha()'));
	});

	test('Ctrl+Space and NUL ask for completions in the editor', async () => {
		const dir = fixture({ 'a.ts': '' });
		const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') });

		await press(t, (input) => void input.typeText('dune'));
		await press(t, (input) => input.pressKey(' ', { ctrl: true }));
		await until(t, () => frame(t).includes('duneAlpha'));
		expect(frame(t)).toContain('duneAlpha');

		await pressEscape(t);
		await press(t, (input) => {
			input.pressKey('\u0000');
		});
		await until(t, () => frame(t).includes('duneAlpha'));
		expect(frame(t)).toContain('duneAlpha');
	});

	test('resolves a completion before applying it', async () => {
		const dir = fixture({ 'a.ts': '' });
		const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') });

		await press(t, (input) => void input.typeText('duneL'));
		await runCommand(t, 'Show completions');
		await until(t, () => frame(t).includes('duneLazy'));

		await press(t, (input) => input.pressEnter());
		await until(t, () => frame(t).includes('import { duneLazy } from "dune"'));
		expect(frame(t)).toContain('duneLazy');
	});

	test('scope triggers replace the global list with member completions', async () => {
		const dir = fixture({ 'a.ts': '' });
		const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') });

		await press(t, (input) => void input.typeText('dune.'));
		await until(t, () => frame(t).includes('memberTable'));

		expect(frame(t)).toContain('memberOther');
		expect(frame(t)).not.toContain('duneAlpha');
	});

	test('stale global replies are dropped after a scope-changing keystroke', async () => {
		const dir = fixture({ 'a.ts': '' });
		const t = await launch(dir, lspConfig, {}, { openFile: join(dir, 'a.ts') });

		await press(t, (input) => void input.typeText('dune'));
		await new Promise((resolve) => setTimeout(resolve, 150));
		await press(t, (input) => void input.typeText('('));
		await new Promise((resolve) => setTimeout(resolve, 600));

		expect(frame(t)).not.toContain('duneAlpha');
	});
});
