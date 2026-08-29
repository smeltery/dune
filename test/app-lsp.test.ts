import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

import { confirmationForPrompt } from '../src/app/confirmation';
import { createAppLsp, problemFrom, wireAppLspEffects } from '../src/app/lsp/index';
import { createServerPluginSuggester } from '../src/app/lsp/pluginSuggestion';
import type { BufferState, Prompt } from '../src/app/types';
import { DEFAULTS } from '../src/core/config';

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts');
const SYNC = join(import.meta.dir, 'fixtures', 'sync-lsp.ts');

const disposers: Array<() => void> = [];

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

const waitFor = async (done: () => boolean, attempts = 40): Promise<void> => {
	if (done() || attempts <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, 25));
	return waitFor(done, attempts - 1);
};

function project(name = 'a.ts') {
	const dir = mkdtempSync(join(tmpdir(), 'dune-app-lsp-'));
	const path = join(dir, name);
	writeFileSync(path, 'const oops = 1\n');
	return { dir, path };
}

function runLsp(content = 'const oops = 1\n') {
	const { dir, path } = project();
	return createRoot((dispose) => {
		disposers.push(dispose);
		const [tabs, setTabs] = createSignal([path]);
		const [buffers, setBuffers] = createStore<Record<string, BufferState>>({
			[path]: { content, saved: content, dirty: false, mtime: 0 },
		});
		const warnings: string[] = [];
		const config = { ...DEFAULTS, lsp: true, lspServers: { typescript: ['bun', FAKE] } };
		const lsp = createAppLsp({
			rootDir: dir,
			config,
			say: (msg) => warnings.push(msg),
		});
		wireAppLspEffects({ lsp, config, tabs, buffers });
		return { path, lsp, warnings, setTabs, setBuffers };
	});
}

test('app LSP syncs open buffers into diagnostics', async () => {
	const { path, lsp } = runLsp();
	await waitFor(() => lsp.problems[path]?.length === 1);

	expect(lsp.problems[path]?.[0]).toMatchObject({
		path,
		line: 0,
		col: 6,
		endLine: 0,
		endCol: 10,
		severity: 'error',
		message: 'found oops',
	});
});

test('language server status rows report state and diagnostics', async () => {
	const { path, lsp } = runLsp();
	await waitFor(() => lsp.clientFor(path)?.ready() === true);
	await waitFor(() => lsp.problems[path]?.length === 1);

	const typescript = lsp.statusRows().find((row) => row.id === 'typescript');

	expect(typescript).toMatchObject({
		command: `bun ${FAKE}`,
		state: 'ready',
		problems: 1,
	});
});

test('the built-in vue server spawns for .vue files', async () => {
	const { dir, path } = project('App.vue');
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		const config = {
			...DEFAULTS,
			lsp: true,
			// Disable the sibling tsserver half — this test only checks the Vue
			// language server itself can spawn for `.vue`.
			lspServers: { vue: ['bun', FAKE], 'vue-typescript': [] },
		};
		const lsp = createAppLsp({ rootDir: dir, config, say: (msg) => warnings.push(msg) });

		lsp.clientFor(path);

		return waitFor(() => lsp.clientFor(path)?.ready() === true).then(() => {
			expect(warnings).toEqual([]);
			expect(lsp.statusRows().find((row) => row.id === 'vue')).toMatchObject({
				command: `bun ${FAKE}`,
				state: 'ready',
			});
		});
	});
});

test('plugin language servers handle additional filetypes', async () => {
	const { dir, path } = project('a.kt');
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		const config = { ...DEFAULTS, lsp: true };
		const lsp = createAppLsp({
			rootDir: dir,
			config,
			say: (msg) => warnings.push(msg),
			servers: () => [{ id: 'kotlin', command: ['bun', FAKE], filetypes: ['kotlin'] }],
		});

		lsp.clientFor(path);

		return waitFor(() => lsp.clientFor(path)?.ready() === true).then(() => {
			const row = lsp.statusRows().find((entry) => entry.id === 'kotlin');
			expect(warnings).toEqual([]);
			expect(row).toMatchObject({
				command: `bun ${FAKE}`,
				state: 'ready',
			});
		});
	});
});

test('files can sync with every matching language server', async () => {
	const { dir, path } = project();
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		const config = { ...DEFAULTS, lsp: true, lspServers: { typescript: ['bun', FAKE] } };
		const lsp = createAppLsp({
			rootDir: dir,
			config,
			say: (msg) => warnings.push(msg),
			servers: () => [{ id: 'eslint', command: ['bun', FAKE], filetypes: ['typescript'] }],
		});
		const [tabs] = createSignal([path]);
		const [buffers] = createStore<Record<string, BufferState>>({
			[path]: { content: 'const oops = 1\n', saved: 'const oops = 1\n', dirty: false, mtime: 0 },
		});
		wireAppLspEffects({ lsp, config, tabs, buffers });

		return waitFor(() => lsp.problems[path]?.length === 2).then(() => {
			expect(warnings).toEqual([]);
			expect(lsp.clientsFor(path)).toHaveLength(2);
			expect(lsp.statusRows().find((row) => row.id === 'typescript')?.problems).toBe(1);
			expect(lsp.statusRows().find((row) => row.id === 'eslint')?.problems).toBe(1);
		});
	});
});

test('an edit still reaches a live server after a sibling dies', async () => {
	const { dir, path } = project();
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		// A healthy server that refuses a duplicate didOpen, the way real ones
		// do — beside a sibling whose binary does not exist, the shape of a
		// plugin server installed without its command. The dead client used to
		// make the next edit re-open the document into every server sharing the
		// path instead of syncing it, which left the live server answering
		// completions against a buffer one edit behind.
		const config = { ...DEFAULTS, lsp: true, lspServers: { typescript: ['bun', SYNC] } };
		const lsp = createAppLsp({
			rootDir: dir,
			config,
			say: (msg) => warnings.push(msg),
			servers: () => [
				{ id: 'ghost', command: ['dune-test-missing-binary'], filetypes: ['typescript'] },
			],
		});
		const [tabs] = createSignal([path]);
		const [buffers, setBuffers] = createStore<Record<string, BufferState>>({
			[path]: { content: 'const oops = 1\n', saved: 'const oops = 1\n', dirty: false, mtime: 0 },
		});
		wireAppLspEffects({ lsp, config, tabs, buffers });

		// The death is what arms the bug, so it must land before the edit does.
		return waitFor(() => warnings.some((warning) => warning.includes('dune-test-missing-binary')))
			.then(() => waitFor(() => lsp.clientFor(path)?.ready() === true))
			.then(() => {
				setBuffers(path, 'content', 'const ab = 1\n');
				return lsp.complete(path, 0, 8);
			})
			.then((reply) => {
				// The label names the word at the cursor as the server sees it, and
				// how many didOpens it took: stale text or a second didOpen would
				// spell differently.
				expect(reply?.items.map((item) => item.label)).toContain('abSync1');
			});
	});
});

test('closing a tab clears diagnostics for that path', async () => {
	const { path, lsp, setTabs } = runLsp();
	await waitFor(() => lsp.problems[path]?.length === 1);

	setTabs([]);
	await waitFor(() => lsp.problems[path]?.length === 0);

	expect(lsp.problems[path]).toEqual([]);
});

test('completion flushes pending document edits before asking the server', async () => {
	const { path, lsp, setBuffers } = runLsp('const ok = 1\n');
	await waitFor(() => lsp.clientFor(path)?.ready() === true);

	setBuffers(path, 'content', 'const oops = 1\n');
	const reply = await lsp.complete(path, 0, 10);
	await waitFor(() => lsp.problems[path]?.length === 1);

	expect(reply?.items.map((item) => item.label)).toContain('duneAlpha');
	expect(lsp.problems[path]?.[0]?.message).toBe('found oops');
});

test('completion resolve asks servers for lazy edits', async () => {
	const { path, lsp } = runLsp('const ok = 1\n');
	await waitFor(() => lsp.clientFor(path)?.ready() === true);

	const resolved = await lsp.resolveCompletion(path, { label: 'duneLazy', kind: 7 });

	expect(resolved?.additionalTextEdits?.[0]?.newText).toContain('duneLazy');
});

test('restart clears clients and resyncs open documents', async () => {
	const { path, lsp } = runLsp();
	await waitFor(() => lsp.clientFor(path)?.ready() === true);
	const before = lsp.clientFor(path);

	expect(lsp.restart()).toBe(true);
	await waitFor(() => lsp.clientFor(path)?.ready() === true);
	await waitFor(() => lsp.problems[path]?.[0]?.message === 'found oops');

	expect(lsp.clientFor(path)).not.toBe(before);
	expect(lsp.problems[path]?.[0]?.message).toBe('found oops');
});

test('dependency changes restart active language servers after a quiet period', async () => {
	const { path, lsp, warnings } = runLsp();
	await waitFor(() => lsp.clientFor(path)?.ready() === true);
	const before = lsp.clientFor(path);

	lsp.dependenciesChanged();
	await waitFor(() => warnings.includes('Dependencies changed — restarted language servers'), 100);

	expect(lsp.clientFor(path)).not.toBe(before);
});

test('settings gate LSP clients and completion separately', async () => {
	const { dir, path } = project();
	createRoot((dispose) => {
		disposers.push(dispose);
		const config = { ...DEFAULTS, lsp: false, lspCompletion: false };
		const lsp = createAppLsp({ rootDir: dir, config, say: () => {} });
		expect(lsp.clientFor(path)).toBeNull();
		expect(lsp.complete(path, 0, 0)).resolves.toBeNull();
	});
});

test('missing default servers show install hints', async () => {
	const { dir, path } = project();
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		const config = { ...DEFAULTS, lsp: true };
		const lsp = createAppLsp({ rootDir: dir, config, say: (msg) => warnings.push(msg) });

		lsp.clientFor(path);

		return waitFor(() => warnings.length > 0).then(() => {
			expect(warnings[0]).toBe(
				'LSP: typescript-language-server not installed — npm i -g typescript-language-server typescript@5',
			);
		});
	});
});

test('missing npm servers can prompt for installation', async () => {
	const { dir, path } = project();
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		let prompt: Prompt = null;
		const config = { ...DEFAULTS, lsp: true };
		const lsp = createAppLsp({
			rootDir: dir,
			config,
			say: (msg) => warnings.push(msg),
			setPrompt: (next) => (prompt = next),
		});

		lsp.clientFor(path);

		return waitFor(() => prompt?.kind === 'installServer').then(() => {
			expect(warnings).toEqual([]);
			expect(prompt).toEqual({
				kind: 'installServer',
				id: 'typescript',
				name: 'typescript-language-server',
				install: { kind: 'npm', packages: ['typescript-language-server', 'typescript@5'] },
				manager: 'npm',
			});
		});
	});
});

test('auto-install can be disabled', async () => {
	const { dir, path } = project();
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		let prompt: Prompt = null;
		const config = { ...DEFAULTS, lsp: true, lspAutoInstall: false };
		const lsp = createAppLsp({
			rootDir: dir,
			config,
			say: (msg) => warnings.push(msg),
			setPrompt: (next) => (prompt = next),
		});

		lsp.clientFor(path);

		return waitFor(() => warnings.length > 0).then(() => {
			expect(prompt).toBeNull();
			expect(warnings[0]).toContain('npm i -g typescript-language-server typescript@5');
		});
	});
});

test('files with no server can ask for a plugin suggestion', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-suggest-'));
	const path = join(dir, 'main.kt');
	writeFileSync(path, 'fun main() {}\n');
	const suggested: string[] = [];
	const lsp = createAppLsp({
		rootDir: dir,
		config: { ...DEFAULTS, lsp: true },
		say: () => {},
		servers: () => [],
		suggestServerPlugin: (filetype) => suggested.push(filetype),
	});

	expect(lsp.clientFor(path)).toBeNull();
	expect(lsp.clientFor(path)).toBeNull();
	expect(suggested).toEqual(['kotlin', 'kotlin']);
});

test('server plugin suggestions raise an install prompt', async () => {
	const realFetch = globalThis.fetch;
	let prompt: Prompt = null;
	globalThis.fetch = ((url: Parameters<typeof fetch>[0]) =>
		Promise.resolve(
			new Response(
				JSON.stringify(
					String(url).endsWith('/index.json')
						? {
								plugins: [
									{
										id: 'kotlin-tools',
										name: 'Kotlin Tools',
										version: '1.0.0',
										provides: { filetypes: ['kotlin'] },
									},
								],
							}
						: {
								id: 'kotlin-tools',
								name: 'Kotlin Tools',
								version: '1.0.0',
								languageServers: [
									{
										id: 'kotlin',
										command: ['kotlin-language-server'],
										filetypes: ['kotlin'],
									},
								],
							},
				),
			),
		)) as unknown as typeof fetch;
	try {
		const suggest = createServerPluginSuggester({
			config: { ...DEFAULTS, pluginRegistry: 'https://example.test/plugins' },
			setPrompt: (next) => (prompt = next),
		});

		suggest('kotlin');

		await waitFor(() => prompt?.kind === 'installPlugin');
		expect(prompt).toMatchObject({
			kind: 'installPlugin',
			id: 'kotlin-tools',
			name: 'Kotlin Tools',
			reason: 'No language server for kotlin',
			commands: ['kotlin-language-server'],
		});
		expect(confirmationForPrompt(prompt)?.message).toContain('It may run: kotlin-language-server');
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('missing overridden servers do not show default install hints', async () => {
	const { dir, path } = project();
	await createRoot((dispose) => {
		disposers.push(dispose);
		const warnings: string[] = [];
		const config = {
			...DEFAULTS,
			lsp: true,
			lspServers: { typescript: ['dune-no-such-language-server'] },
		};
		const lsp = createAppLsp({ rootDir: dir, config, say: (msg) => warnings.push(msg) });

		lsp.clientFor(path);

		return waitFor(() => warnings.length > 0).then(() => {
			expect(warnings[0]).toBe(
				'LSP: dune-no-such-language-server is not installed, or not on PATH',
			);
		});
	});
});

test('typescript sdk setting is handed to the language server', async () => {
	const { dir, path } = project();
	const dump = join(dir, 'init.json');
	createRoot((dispose) => {
		disposers.push(dispose);
		const config = {
			...DEFAULTS,
			lsp: true,
			typescriptTsdk: '/opt/typescript/lib',
			lspServers: { typescript: ['bun', FAKE, dump] },
		};
		const lsp = createAppLsp({ rootDir: dir, config, say: () => {} });
		lsp.clientFor(path);
	});
	await waitFor(() => existsSync(dump));
	expect(JSON.parse(readFileSync(dump, 'utf8'))).toEqual({
		tsserver: { path: '/opt/typescript/lib' },
	});

	rmSync(dump);
	createRoot((dispose) => {
		disposers.push(dispose);
		const config = { ...DEFAULTS, lsp: true, lspServers: { typescript: ['bun', FAKE, dump] } };
		const lsp = createAppLsp({ rootDir: dir, config, say: () => {} });
		lsp.clientFor(path);
	});
	await waitFor(() => existsSync(dump));
	expect(JSON.parse(readFileSync(dump, 'utf8'))).toBeNull();
});

test('problem navigation wraps in both directions', () => {
	const first = { path: 'a.ts', line: 1, col: 2 } as Parameters<typeof problemFrom>[0][number];
	const second = { path: 'a.ts', line: 3, col: 1 } as Parameters<typeof problemFrom>[0][number];
	const list = [first, second];

	expect(problemFrom(list, 1, 2, 1)).toBe(second);
	expect(problemFrom(list, 9, 0, 1)).toBe(first);
	expect(problemFrom(list, 3, 1, -1)).toBe(first);
	expect(problemFrom(list, 0, 0, -1)).toBe(second);
});
