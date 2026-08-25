import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { fixture, launch, press, pressEscape, runCommand, until } from './helpers';

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts');
const MARKER = join(import.meta.dir, 'fixtures', 'marker-lsp.ts');

const frame = (t: Awaited<ReturnType<typeof launch>>) => t.captureCharFrame();

const spawns = (marker: string) =>
	existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').length : 0;

describe('LSP status page', () => {
	test('shows a running server, its log, and closes on Esc', async () => {
		const dir = fixture({ 'a.ts': 'const bad = oops\n' });
		const t = await launch(
			dir,
			{ lsp: true, lspServers: { typescript: [process.execPath, FAKE] } },
			{ width: 110, height: 30 },
			{ openFile: join(dir, 'a.ts') },
		);

		await until(t, () => frame(t).includes('● 1'));
		await runCommand(t, 'Language server status');
		await until(t, () => frame(t).includes('Language Servers'));

		const shown = frame(t);
		expect(shown).toContain('typescript');
		expect(shown).toContain('ready');
		// The log's three sources: a lifecycle event, the document sync, and stderr.
		expect(shown).toContain('initialized — diagnostics published');
		expect(shown).toContain('opened a.ts');
		expect(shown).toContain('fake-lsp standing by');

		await pressEscape(t);
		await until(t, () => !frame(t).includes('Language Servers'));
		expect(frame(t)).toContain('const bad = oops');
	});

	test('a server that could not start shows as failed, with the reason', async () => {
		const dir = fixture({ 'a.ts': 'const a = 1\n' });
		const t = await launch(
			dir,
			{ lsp: true, lspServers: { typescript: ['dune-no-such-language-server'] } },
			{ width: 120 },
			{ openFile: join(dir, 'a.ts') },
		);

		await until(t, () => frame(t).includes('is not installed, or not on PATH'));
		await runCommand(t, 'Language server status');
		await until(t, () => frame(t).includes('failed'));
		const shown = frame(t);
		expect(shown).toContain('typescript');
		expect(shown).toContain('failed');
		expect(shown).toContain('is not installed, or not on PATH');
	});

	test('r on the page restarts the servers', async () => {
		const dir = fixture({ 'a.ts': 'const a = 1\n' });
		const marker = join(dir, 'spawn-marker');
		const t = await launch(
			dir,
			{ lsp: true, lspServers: { typescript: [process.execPath, MARKER, marker] } },
			{},
			{ openFile: join(dir, 'a.ts') },
		);
		await until(t, () => spawns(marker) === 1);

		await runCommand(t, 'Language server status');
		await until(t, () => frame(t).includes('Language Servers'));
		await press(t, (input) => input.pressKey('r'));
		await until(t, () => frame(t).includes('Restarted language servers'));
		await until(t, () => spawns(marker) === 2);
	});

	test('d on the page refuses to remove a server dune did not install', async () => {
		const dir = fixture({ 'a.ts': 'const bad = oops\n' });
		const t = await launch(
			dir,
			{ lsp: true, lspServers: { typescript: [process.execPath, FAKE] } },
			{ width: 100, height: 34 },
			{ openFile: join(dir, 'a.ts') },
		);
		await until(t, () => frame(t).includes('● 1'));
		await runCommand(t, 'Language server status');
		await until(t, () => frame(t).includes('Language Servers'));

		await press(t, (input) => input.pressKey('d'));
		// The running server is a test override, not a copy in dune's own
		// SERVER_ROOT — nothing of dune's to remove.
		expect(frame(t)).toContain('dune did not install it');
	});
});
