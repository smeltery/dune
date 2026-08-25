import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadIconThemes } from '../iconThemes';
import { loadLocalLanguages, loadLocalThemes, USER_THEME_PLUGIN_DIR } from '../localThemes';
import { loadLocalLspServers } from '../plugins/localLspServers';
import { isNewer } from '../update';
import { isThemeName } from '../../themes';
import type { Config } from '../config';

export const MARKET_URL = 'https://dune.smeltery.dev/plugins/';
export const CATALOG_MAX_AGE_MS = 30 * 60 * 1000;

const TIMEOUT_MS = 2500;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ASSET_TIMEOUT_MS = 30_000;
const CACHE_FILE = join(
	process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? tmpdir(), '.cache'),
	'dune',
	'market.json',
);

export interface MarketEntry {
	id: string;
	name: string;
	version: string;
	description: string;
	provides: {
		themes: string[];
		icons: string[];
		languageServers: string[];
		filetypes: string[];
	};
}

export interface CachedCatalog {
	at: number;
	plugins: MarketEntry[];
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type FetchedPlugin =
	| { ok: true; id: string; version: string; body: string; assets?: Map<string, Uint8Array> }
	| { ok: false; error: string };

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
	typeof raw === 'object' && raw !== null && !Array.isArray(raw);

const ids = (raw: unknown): string[] =>
	Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string' && entry) : [];

function parseEntry(raw: unknown): MarketEntry | null {
	if (!isRecord(raw)) return null;
	const { id, name, version, description } = raw;
	if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) return null;
	if (typeof version !== 'string' || !version) return null;
	const provides = isRecord(raw.provides) ? raw.provides : {};
	return {
		id,
		name: typeof name === 'string' && name ? name : id,
		version,
		description: typeof description === 'string' ? description : '',
		provides: {
			themes: ids(provides.themes),
			icons: ids(provides.icons),
			languageServers: ids(provides.languageServers),
			filetypes: ids(provides.filetypes),
		},
	};
}

export function parseCatalog(raw: unknown): MarketEntry[] {
	const list = isRecord(raw) && Array.isArray(raw.plugins) ? raw.plugins : [];
	return list.map(parseEntry).filter((entry) => entry !== null);
}

const dir = (registry: string): string => (registry.endsWith('/') ? registry : `${registry}/`);

async function get(url: string, fetcher: Fetcher): Promise<string | null> {
	try {
		const res = await fetcher(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: 'application/json' },
		});
		if (!res.ok) return null;
		const text = await res.text();
		return text.length > MAX_MANIFEST_BYTES ? null : text;
	} catch {
		return null;
	}
}

async function getBytes(url: string, fetcher: Fetcher): Promise<Uint8Array | null> {
	try {
		const res = await fetcher(url, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) });
		if (!res.ok) return null;
		const bytes = new Uint8Array(await res.arrayBuffer());
		return bytes.byteLength > MAX_ASSET_BYTES ? null : bytes;
	} catch {
		return null;
	}
}

export async function fetchCatalog(
	registry = MARKET_URL,
	fetcher: Fetcher = fetch,
): Promise<MarketEntry[] | null> {
	const body = await get(`${dir(registry)}index.json`, fetcher);
	if (body === null) return null;
	try {
		return parseCatalog(JSON.parse(body));
	} catch {
		return null;
	}
}

export function readCachedCatalog(file = CACHE_FILE): CachedCatalog | null {
	try {
		const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
		if (!isRecord(raw) || typeof raw.at !== 'number') return null;
		return { at: raw.at, plugins: parseCatalog(raw) };
	} catch {
		return null;
	}
}

export function writeCachedCatalog(plugins: MarketEntry[], at: number, file = CACHE_FILE): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ at, plugins }));
	} catch {}
}

export const isStale = (cached: CachedCatalog | null, now: number): boolean =>
	!cached || now - cached.at > CATALOG_MAX_AGE_MS;

function pluginAssetName(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0) return null;
	if (value.startsWith('/') || value.includes('\0') || value.includes('..')) return null;
	if (/^[a-z]+:/i.test(value)) return null;
	return value;
}

function manifestAssets(raw: unknown): string[] {
	if (!isRecord(raw) || !Array.isArray(raw.languages)) return [];
	const assets = new Set<string>();
	for (const language of raw.languages) {
		if (!isRecord(language) || !isRecord(language.grammar)) continue;
		const wasm = pluginAssetName(language.grammar.wasm);
		const query = pluginAssetName(language.grammar.query);
		if (wasm) assets.add(wasm);
		if (query) assets.add(query);
	}
	return [...assets];
}

async function validateManifest(id: string, body: string): Promise<FetchedPlugin> {
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch (error) {
		return { ok: false, error: `${id} is not valid JSON: ${String(error)}` };
	}
	if (!isRecord(raw) || raw.id !== id) return { ok: false, error: `${id} manifest id mismatch` };
	if (typeof raw.version !== 'string' || !raw.version) {
		return { ok: false, error: `${id} manifest has no version` };
	}
	const root = await mkdtemp(join(tmpdir(), 'dune-plugin-'));
	try {
		const plugin = join(root, id);
		mkdirSync(plugin, { recursive: true });
		writeFileSync(join(plugin, 'plugin.json'), body);
		const color = loadLocalThemes(root, root);
		const icon = loadIconThemes(root, root);
		const languages = loadLocalLanguages(root, root);
		const lsp = loadLocalLspServers(root, root);
		const problem =
			color.problems[0]?.reason ??
			icon.problems[0]?.reason ??
			languages.problems[0]?.reason ??
			lsp.problems[0]?.reason;
		if (problem) return { ok: false, error: problem };
		if (
			color.themes.length + icon.themes.length + languages.languages.length + lsp.servers.length ===
			0
		) {
			return { ok: false, error: `${id} does not provide a plugin contribution` };
		}
		return { ok: true, id, version: raw.version, body, assets: new Map() };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

export async function fetchPlugin(
	id: string,
	options: { registry?: string; fetcher?: Fetcher } = {},
): Promise<FetchedPlugin> {
	if (!/^[\w.-]+$/.test(id)) return { ok: false, error: `${id} is not a plugin id` };
	const registry = options.registry ?? MARKET_URL;
	const source = `${dir(registry)}${id}/plugin.json`;
	const fetcher = options.fetcher ?? fetch;
	const body = await get(source, fetcher);
	if (body === null) return { ok: false, error: `could not fetch ${source}` };
	const fetched = await validateManifest(id, body);
	if (!fetched.ok) return fetched;
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch {
		return fetched;
	}
	const assets = await Promise.all(
		manifestAssets(raw).map(async (asset) => ({
			asset,
			bytes: await getBytes(`${dir(registry)}${id}/${asset}`, fetcher),
		})),
	);
	for (const { asset, bytes } of assets) {
		if (bytes === null) return { ok: false, error: `${id}: could not fetch ${asset}` };
		(fetched.assets ??= new Map()).set(asset, bytes);
	}
	return fetched;
}

export function pluginDir(id: string, root = USER_THEME_PLUGIN_DIR): string {
	return join(root, id);
}

export function writePlugin(
	id: string,
	fetched: FetchedPlugin,
	root = USER_THEME_PLUGIN_DIR,
): string | null {
	if (!fetched.ok) return fetched.error;
	if (fetched.id !== id) return `${id} manifest id mismatch`;
	const target = pluginDir(id, root);
	try {
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, 'plugin.json'), fetched.body);
		for (const [name, body] of fetched.assets ?? []) {
			const path = join(target, name);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, body);
		}
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function removeFromDisk(id: string, root = USER_THEME_PLUGIN_DIR): string | null {
	if (!/^[\w.-]+$/.test(id)) return `${id} is not a plugin id`;
	try {
		rmSync(pluginDir(id, root), { recursive: true, force: true });
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function updatesFor(
	installed: readonly { id: string; version: string }[],
	catalog: readonly MarketEntry[],
	newer: (latest: string, current: string) => boolean = isNewer,
): MarketEntry[] {
	const versions = new Map(installed.map((plugin) => [plugin.id, plugin.version]));
	return catalog.filter((entry) => {
		const current = versions.get(entry.id);
		return current ? newer(entry.version, current) : false;
	});
}

export function missingConfiguredAppearancePlugins(
	config: Pick<Config, 'theme' | 'themeLight' | 'themeDark' | 'iconTheme'>,
	iconThemes: readonly { id: string }[],
	catalog: readonly MarketEntry[],
): MarketEntry[] {
	const wantedThemes = new Set<string>(
		[config.theme, config.themeLight, config.themeDark].filter((id) => !isThemeName(id)),
	);
	const hasIconTheme =
		config.iconTheme === 'none' ||
		config.iconTheme === 'unicode' ||
		iconThemes.some((theme) => theme.id === config.iconTheme);
	const wantedIcon = hasIconTheme ? null : config.iconTheme;
	const byId = new Map<string, MarketEntry>();
	for (const entry of catalog) {
		if (
			entry.provides.themes.some((id) => wantedThemes.has(id)) ||
			(wantedIcon !== null && entry.provides.icons.includes(wantedIcon))
		) {
			byId.set(entry.id, entry);
		}
	}
	return [...byId.values()];
}
