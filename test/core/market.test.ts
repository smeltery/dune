import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	fetchCatalog,
	fetchPlugin,
	isStale,
	MARKET_URL,
	parseCatalog,
	readCachedCatalog,
	removeFromDisk,
	updatesFor,
	writeCachedCatalog,
	writePlugin,
} from '../../src/core/market';
import type { Fetcher, MarketEntry } from '../../src/core/market';
import { loadIconThemes } from '../../src/core/iconThemes';
import { loadAppearancePlugins, loadLocalThemes } from '../../src/core/localThemes';
import { loadLocalLspServers } from '../../src/core/plugins/localLspServers';

const REGISTRY = 'https://example.test/plugins/';
const MANIFEST = {
	id: 'mono',
	name: 'Mono',
	version: '1.2.0',
	themes: [
		{
			id: 'mono-dark',
			name: 'Mono Dark',
			ui: {
				bg: '#101010',
				panelBg: '#161616',
				barBg: '#0d0d0d',
				statusBg: '#222222',
				statusFg: '#ffffff',
				text: '#dddddd',
				dim: '#888888',
				faint: '#666666',
				accent: '#79b8ff',
				activeTabFg: '#ffffff',
				inactiveTabFg: '#999999',
				treeSelectedBg: '#244f7a',
				treeFocusBg: '#1d2833',
				dirty: '#f2cc60',
				error: '#ff7b72',
				folder: '#79b8ff',
				cursor: '#ffffff',
				scrollbar: '#333333',
				gutter: '#777777',
				currentLine: '#151515',
				indentGuide: '#262626',
				gitAdded: '#7ee787',
				gitModified: '#f2cc60',
				gitDeleted: '#ff7b72',
			},
			syntax: { comment: { fg: '#888888', italic: true } },
		},
	],
	icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
};
const INDEX = {
	plugins: [
		{
			id: 'mono',
			name: 'Mono',
			version: '1.2.0',
			description: 'quiet appearance',
			provides: {
				themes: ['mono-dark'],
				icons: ['mono-icons'],
				languageServers: [],
				filetypes: [],
			},
		},
	],
};
const LSP_MANIFEST = {
	id: 'kotlin-tools',
	name: 'Kotlin Tools',
	version: '1.0.0',
	languageServers: [
		{
			id: 'kotlin',
			command: ['kotlin-language-server'],
			filetypes: ['kotlin'],
			install: { kind: 'manual', command: 'install kotlin-language-server' },
		},
	],
};
const LANGUAGE_MANIFEST = {
	id: 'nim-tools',
	name: 'Nim Tools',
	version: '1.0.0',
	languages: [
		{
			id: 'nim',
			extensions: ['.nim'],
			grammar: { wasm: 'tree-sitter-nim.wasm', query: 'queries/highlights.scm' },
		},
	],
};

const serving = (bodies: Record<string, unknown>, seen: string[] = []): Fetcher =>
	((url) => {
		seen.push(url);
		const body = bodies[url];
		return Promise.resolve(
			body === undefined
				? new Response('missing', { status: 404 })
				: body instanceof Uint8Array
					? new Response(body)
					: new Response(typeof body === 'string' ? body : JSON.stringify(body)),
		);
	}) as Fetcher;

const temp = (name: string) => mkdtempSync(join(tmpdir(), `dune-${name}-`));

test('a malformed catalog row is dropped, not fatal', () => {
	const parsed = parseCatalog({
		plugins: [
			{ id: 'ok', version: '1.0.0' },
			{ id: 'no version' },
			{ id: 'sp ace', version: '1.0.0' },
			'not an object',
		],
	});

	expect(parsed).toEqual([
		{
			id: 'ok',
			name: 'ok',
			version: '1.0.0',
			description: '',
			provides: { themes: [], icons: [], languageServers: [], filetypes: [] },
		},
	]);
});

test('catalog rows can advertise language server plugins', () => {
	expect(
		parseCatalog({
			plugins: [
				{
					id: 'kotlin-tools',
					version: '1.0.0',
					provides: { languageServers: ['kotlin'], filetypes: ['kotlin'] },
				},
			],
		}),
	).toEqual([
		{
			id: 'kotlin-tools',
			name: 'kotlin-tools',
			version: '1.0.0',
			description: '',
			provides: { themes: [], icons: [], languageServers: ['kotlin'], filetypes: ['kotlin'] },
		},
	]);
});

test('the catalog is read from the registry directory', async () => {
	const seen: string[] = [];
	const catalog = await fetchCatalog(REGISTRY, serving({ [`${REGISTRY}index.json`]: INDEX }, seen));

	expect(seen).toEqual([`${REGISTRY}index.json`]);
	expect(catalog?.map((entry) => entry.id)).toEqual(['mono']);
});

test('a registry that answers with nothing usable leaves no catalog', async () => {
	expect(await fetchCatalog(REGISTRY, serving({}))).toBeNull();
	expect(await fetchCatalog(REGISTRY, serving({ [`${REGISTRY}index.json`]: '{ nope' }))).toBeNull();
});

test('the default registry is an https directory', () => {
	expect(MARKET_URL.startsWith('https://')).toBe(true);
	expect(MARKET_URL.endsWith('/')).toBe(true);
});

test('a manifest is fetched from the plugin directory and validated', async () => {
	const seen: string[] = [];
	const result = await fetchPlugin('mono', {
		registry: REGISTRY,
		fetcher: serving({ [`${REGISTRY}mono/plugin.json`]: MANIFEST }, seen),
	});

	expect(seen).toEqual([`${REGISTRY}mono/plugin.json`]);
	expect(result.ok && result.version).toBe('1.2.0');
});

test('a manifest Dune would reject is refused before install', async () => {
	const results = await Promise.all(
		[
			{ id: 'mono', version: '1.0.0' },
			{ id: 'other', version: '1.0.0', themes: MANIFEST.themes },
			'not json at all',
		].map((body) =>
			fetchPlugin('mono', {
				registry: REGISTRY,
				fetcher: serving({ [`${REGISTRY}mono/plugin.json`]: body }),
			}),
		),
	);
	expect(results.every((result) => !result.ok)).toBe(true);
});

test('a fetched manifest is written where plugin loading finds it', async () => {
	const root = temp('plugins');
	const project = temp('project');
	const fetched = await fetchPlugin('mono', {
		registry: REGISTRY,
		fetcher: serving({ [`${REGISTRY}mono/plugin.json`]: MANIFEST }),
	});

	expect(writePlugin('mono', fetched, root)).toBeNull();
	expect(JSON.parse(readFileSync(join(root, 'mono', 'plugin.json'), 'utf8'))).toEqual(MANIFEST);

	const themes = loadLocalThemes(project, root);
	const icons = loadIconThemes(project, root);
	const appearance = loadAppearancePlugins(project, root);
	expect(themes.problems).toEqual([]);
	expect(icons.problems).toEqual([]);
	expect(themes.themes.map((entry) => entry.id)).toEqual(['mono-dark']);
	expect(icons.themes.map((entry) => entry.id)).toEqual(['mono-icons']);
	expect(appearance.plugins.map((entry) => `${entry.id}@${entry.version}`)).toEqual(['mono@1.2.0']);

	const disabled = loadAppearancePlugins(project, root, ['mono']);
	expect(disabled.themes).toEqual([]);
	expect(disabled.iconThemes).toEqual([]);
	expect(disabled.plugins.map((entry) => `${entry.id}:${entry.disabled}`)).toEqual(['mono:true']);

	expect(writePlugin('other', fetched, root)).toBe('other manifest id mismatch');
	expect(removeFromDisk('../outside', root)).toContain('not a plugin id');
	expect(removeFromDisk('mono', root)).toBeNull();
	expect(existsSync(join(root, 'mono'))).toBe(false);
	expect(removeFromDisk('mono', root)).toBeNull();
});

test('a fetched language server manifest is written where plugin loading finds it', async () => {
	const root = temp('lsp-plugins');
	const project = temp('lsp-project');
	const fetched = await fetchPlugin('kotlin-tools', {
		registry: REGISTRY,
		fetcher: serving({ [`${REGISTRY}kotlin-tools/plugin.json`]: LSP_MANIFEST }),
	});

	expect(writePlugin('kotlin-tools', fetched, root)).toBeNull();
	expect(JSON.parse(readFileSync(join(root, 'kotlin-tools', 'plugin.json'), 'utf8'))).toEqual(
		LSP_MANIFEST,
	);

	const lsp = loadLocalLspServers(project, root);
	expect(lsp.problems).toEqual([]);
	expect(lsp.servers).toEqual([
		{
			id: 'kotlin',
			command: ['kotlin-language-server'],
			filetypes: ['kotlin'],
			install: { kind: 'manual', command: 'install kotlin-language-server' },
		},
	]);
});

test('a fetched language plugin writes grammar assets beside the manifest', async () => {
	const root = temp('language-plugins');
	const project = temp('language-project');
	const wasm = new Uint8Array([0, 97, 115, 109]);
	const query = new Uint8Array(Buffer.from('(comment) @comment'));
	const seen: string[] = [];
	const fetched = await fetchPlugin('nim-tools', {
		registry: REGISTRY,
		fetcher: serving(
			{
				[`${REGISTRY}nim-tools/plugin.json`]: LANGUAGE_MANIFEST,
				[`${REGISTRY}nim-tools/tree-sitter-nim.wasm`]: wasm,
				[`${REGISTRY}nim-tools/queries/highlights.scm`]: query,
			},
			seen,
		),
	});

	expect(fetched.ok && fetched.version).toBe('1.0.0');
	expect(seen).toEqual([
		`${REGISTRY}nim-tools/plugin.json`,
		`${REGISTRY}nim-tools/tree-sitter-nim.wasm`,
		`${REGISTRY}nim-tools/queries/highlights.scm`,
	]);
	expect(writePlugin('nim-tools', fetched, root)).toBeNull();
	expect(readFileSync(join(root, 'nim-tools', 'tree-sitter-nim.wasm'))).toEqual(Buffer.from(wasm));
	expect(readFileSync(join(root, 'nim-tools', 'queries', 'highlights.scm'))).toEqual(
		Buffer.from(query),
	);

	const appearance = loadAppearancePlugins(project, root);
	expect(appearance.problems).toEqual([]);
	expect(appearance.plugins.map((entry) => entry.detail)).toEqual(['languages: nim']);
});

test('a missing language grammar asset fails the market install before writing', async () => {
	const fetched = await fetchPlugin('nim-tools', {
		registry: REGISTRY,
		fetcher: serving({ [`${REGISTRY}nim-tools/plugin.json`]: LANGUAGE_MANIFEST }),
	});

	expect(fetched).toEqual({ ok: false, error: 'nim-tools: could not fetch tree-sitter-nim.wasm' });
});

test('the cache survives a round trip and knows when it is old', () => {
	const file = join(temp('cache'), 'market.json');
	expect(readCachedCatalog(file)).toBeNull();
	expect(isStale(null, 1000)).toBe(true);

	writeCachedCatalog(INDEX.plugins as MarketEntry[], 1000, file);
	const cached = readCachedCatalog(file);
	expect(cached?.plugins.map((entry) => entry.id)).toEqual(['mono']);
	expect(isStale(cached, 1000 + 60_000)).toBe(false);
	expect(isStale(cached, 1000 + 31 * 60 * 1000)).toBe(true);
});

test('only an installed plugin with a lower version is an update', () => {
	const catalog = INDEX.plugins as MarketEntry[];
	expect(updatesFor([{ id: 'mono', version: '1.1.0' }], catalog)).toHaveLength(1);
	expect(updatesFor([{ id: 'mono', version: '1.2.0' }], catalog)).toEqual([]);
	expect(updatesFor([{ id: 'mono', version: '2.0.0' }], catalog)).toEqual([]);
	expect(updatesFor([], catalog)).toEqual([]);
});
