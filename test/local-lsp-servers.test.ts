import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reloadAppearancePlugins } from '../src/app/appearance/reload';
import { DEFAULTS } from '../src/core/config';
import { loadLocalLspServers } from '../src/core/plugins/localLspServers';

test('local plugin manifests can contribute language servers', () => {
	const dir = project({
		'.dune/plugins/kotlin/plugin.json': JSON.stringify({
			id: 'kotlin-tools',
			version: '1.0.0',
			languageServers: [
				{
					id: 'kotlin',
					command: ['kotlin-language-server'],
					filetypes: ['kotlin'],
					install: { kind: 'manual', command: 'brew install kotlin-language-server' },
				},
			],
		}),
	});

	expect(loadLocalLspServers(dir, join(dir, 'empty'))).toEqual({
		servers: [
			{
				id: 'kotlin',
				command: ['kotlin-language-server'],
				filetypes: ['kotlin'],
				install: { kind: 'manual', command: 'brew install kotlin-language-server' },
			},
		],
		plugins: [
			{
				id: 'kotlin-tools',
				name: 'kotlin-tools',
				version: '1.0.0',
				detail: 'language servers: kotlin',
				source: expect.stringContaining('kotlin/plugin.json'),
			},
		],
		problems: [],
	});
});

test('local language server plugins preserve server settings', () => {
	const dir = project({
		'eslint.json': JSON.stringify({
			id: 'eslint-tools',
			version: '1.0.0',
			languageServers: [
				{
					id: 'eslint',
					command: ['vscode-eslint-language-server', '--stdio'],
					filetypes: ['typescript'],
					settings: { validate: 'on', workingDirectory: { mode: 'location' } },
				},
			],
		}),
	});

	expect(loadLocalLspServers(join(dir, 'empty'), dir).servers[0]?.settings).toEqual({
		validate: 'on',
		workingDirectory: { mode: 'location' },
	});
});

test('local language server plugins can declare platform downloads', () => {
	const key = `${process.platform}-${process.arch}`;
	const dir = project({
		'.dune/plugins/elixir/plugin.json': JSON.stringify({
			id: 'elixir-tools',
			version: '1.0.0',
			languageServers: [
				{
					id: 'elixir',
					command: ['expert'],
					filetypes: ['elixir'],
					install: {
						kind: 'download',
						urls: { [key]: 'https://example.test/expert' },
						command: 'mix escript.install hex expert',
					},
				},
			],
		}),
	});

	expect(loadLocalLspServers(dir, join(dir, 'empty')).servers[0]?.install).toEqual({
		kind: 'download',
		url: 'https://example.test/expert',
	});
});

test('local language server plugins fall back to manual install when no download matches', () => {
	const dir = project({
		'.dune/plugins/elixir/plugin.json': JSON.stringify({
			id: 'elixir-tools',
			version: '1.0.0',
			languageServers: [
				{
					id: 'elixir',
					command: ['expert'],
					filetypes: ['elixir'],
					install: {
						kind: 'download',
						urls: { 'unsupported-platform': 'https://example.test/expert' },
						command: 'mix escript.install hex expert',
					},
				},
			],
		}),
	});

	expect(loadLocalLspServers(dir, join(dir, 'empty')).servers[0]?.install).toEqual({
		kind: 'manual',
		command: 'mix escript.install hex expert',
	});
});

test('local language server plugins reject download installs without a usable source', () => {
	const dir = project({
		'.dune/plugins/elixir/plugin.json': JSON.stringify({
			id: 'elixir-tools',
			version: '1.0.0',
			languageServers: [
				{
					id: 'elixir',
					command: ['expert'],
					filetypes: ['elixir'],
					install: {
						kind: 'download',
						urls: { 'unsupported-platform': 'https://example.test/expert' },
					},
				},
			],
		}),
	});
	const loaded = loadLocalLspServers(dir, join(dir, 'empty'));

	expect(loaded.servers).toEqual([]);
	expect(loaded.problems[0]?.reason).toBe('invalid language server');
});

test('invalid language server contributions are skipped with a problem', () => {
	const dir = project({
		'.dune/plugins/bad/plugin.json': JSON.stringify({
			id: 'bad-tools',
			version: '1.0.0',
			languageServers: [{ id: 'bad tools', command: [], filetypes: ['bad'] }],
		}),
	});
	const loaded = loadLocalLspServers(dir, join(dir, 'empty'));

	expect(loaded.servers).toEqual([]);
	expect(loaded.plugins).toEqual([]);
	expect(loaded.problems).toHaveLength(1);
	expect(loaded.problems[0]?.reason).toBe('invalid language server');
});

test('plugin reload refreshes language server manifests', () => {
	const dir = project({
		'.dune/plugins/kotlin/plugin.json': JSON.stringify({
			id: 'kotlin-tools',
			version: '1.0.0',
			languageServers: [
				{ id: 'kotlin', command: ['kotlin-language-server'], filetypes: ['kotlin'] },
			],
		}),
	});
	let servers: unknown[] = [];
	const messages: string[] = [];

	reloadAppearancePlugins({
		rootDir: dir,
		config: DEFAULTS,
		setAppearancePlugins: () => undefined,
		setLspServers: (next) => (servers = [...next]),
		lsp: { restart: () => true },
		say: (msg) => messages.push(msg),
	});

	expect(servers).toEqual([
		{ id: 'kotlin', command: ['kotlin-language-server'], filetypes: ['kotlin'] },
	]);
	expect(messages).toEqual(['Reloaded plugins and restarted language servers']);
});

function project(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-plugins-'));
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(join(path, '..'), { recursive: true });
		writeFileSync(path, content);
	}
	return dir;
}

test('fixture eslint plugin is a valid local language server sidecar', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-eslint-'));
	mkdirSync(join(dir, '.dune', 'plugins', 'eslint'), { recursive: true });
	const body = readFileSync(join(import.meta.dir, 'fixtures/eslint-plugin.json'), 'utf8');
	writeFileSync(join(dir, '.dune', 'plugins', 'eslint', 'plugin.json'), body);
	const loaded = loadLocalLspServers(dir);
	expect(loaded.servers[0]?.id).toBe('eslint');
	expect(loaded.servers[0]?.settings).toMatchObject({ validate: 'on' });
	expect(loaded.plugins[0]?.id).toBe('eslint');
});
