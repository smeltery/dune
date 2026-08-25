/**
 * Sidebar plugins view: installed + market rows, cursor, and actions.
 * Drawing lives in `ui/overlays/PluginsPanel.tsx`; install/toggle/remove reuse
 * the Plugin manager helpers in `pluginsPage.tsx`.
 */
import { createMemo, createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';

import type { Config } from '../../core/config';
import type { AppearancePluginLoad } from '../../core/localThemes';
import {
	fetchCatalog,
	readCachedCatalog,
	updatesFor,
	writeCachedCatalog,
	type MarketEntry,
} from '../../core/market';
import { isNewer } from '../../core/update';
import { loadLocalLspServers } from '../../core/plugins/localLspServers';
import { deleteAppearancePlugin, installMarketPlugin, installedMarketPlugins } from './pluginsPage';

export type PluginRow =
	| { kind: 'section'; id: string; label: string; count: number; collapsed: boolean }
	| {
			kind: 'installed';
			id: string;
			label: string;
			version: string;
			update: string | null;
			disabled: boolean;
			about: string;
	  }
	| {
			kind: 'available';
			id: string;
			label: string;
			version: string;
			about: string;
	  }
	| { kind: 'note'; id: string; label: string };

const MAX_RESULTS = 50;

export function createPluginsPanel(deps: {
	rootDir: string;
	config: Config;
	appearance: Accessor<AppearancePluginLoad>;
	patchConfig: (patch: Partial<Config>) => void;
	reload: () => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
}) {
	const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({ available: true });
	const [cursor, setCursor] = createSignal(0);
	const [query, setQuery] = createSignal<string | null>(null);
	const [marketVersion, setMarketVersion] = createSignal(0);
	let fetched = false;

	const refreshMarket = () => setMarketVersion((v) => v + 1);

	const catalog = (): MarketEntry[] => {
		void marketVersion();
		return readCachedCatalog()?.plugins ?? [];
	};

	const matches = (haystack: string) => {
		const q = query()?.trim().toLowerCase();
		if (!q) return true;
		return haystack.toLowerCase().includes(q);
	};

	const installedList = createMemo(() => {
		const cached = catalog();
		return deps
			.appearance()
			.plugins.map((plugin) => {
				const latest = cached.find((entry) => entry.id === plugin.id);
				return {
					kind: 'installed' as const,
					id: plugin.id,
					label: plugin.name,
					version: plugin.version,
					update: latest && isNewer(latest.version, plugin.version) ? latest.version : null,
					disabled: plugin.disabled,
					about: plugin.detail,
				};
			})
			.filter((row) => matches(`${row.label} ${row.id} ${row.about}`));
	});

	const availableList = createMemo(() => {
		const held = new Set(deps.appearance().plugins.map((plugin) => plugin.id));
		for (const plugin of loadLocalLspServers(deps.rootDir).plugins) held.add(plugin.id);
		return catalog()
			.filter((entry) => !held.has(entry.id))
			.map((entry) => ({
				kind: 'available' as const,
				id: entry.id,
				label: entry.name,
				version: entry.version,
				about: entry.description,
			}))
			.filter((row) => matches(`${row.label} ${row.id} ${row.about}`));
	});

	const rows = createMemo<PluginRow[]>(() => {
		const out: PluginRow[] = [];
		const installed = installedList();
		if (installed.length > 0 || !query()) {
			const shut = !query() && collapsed().installed === true;
			out.push({
				kind: 'section',
				id: 'installed',
				label: 'INSTALLED',
				count: installed.length,
				collapsed: shut,
			});
			if (!shut) out.push(...installed);
		}
		const available = availableList();
		if (available.length === 0 && query()) return out;
		const shutMarket = !query() && collapsed().available === true;
		out.push({
			kind: 'section',
			id: 'available',
			label: 'AVAILABLE',
			count: available.length,
			collapsed: shutMarket,
		});
		if (shutMarket) return out;
		out.push(...available.slice(0, MAX_RESULTS));
		if (available.length > MAX_RESULTS) {
			out.push({
				kind: 'note',
				id: 'more',
				label: query()
					? `+${available.length - MAX_RESULTS} more matches`
					: `+${available.length - MAX_RESULTS} more — search to narrow`,
			});
		}
		return out;
	});

	const at = () => Math.max(0, Math.min(cursor(), Math.max(0, rows().length - 1)));
	const row = () => rows()[at()];
	const move = (delta: number) => setCursor(Math.max(0, Math.min(at() + delta, rows().length - 1)));
	const moveTo = (index: number) => setCursor(Math.max(0, Math.min(index, rows().length - 1)));
	const toggleSection = (id: string) =>
		setCollapsed((current) => ({ ...current, [id]: !current[id] }));

	const activate = (index = at()) => {
		moveTo(index);
		const current = rows()[Math.max(0, Math.min(index, rows().length - 1))];
		if (!current || current.kind === 'note') return;
		if (current.kind === 'section') return toggleSection(current.id);
		if (current.kind === 'available') {
			void installMarketPlugin(current.id, {
				config: deps.config,
				reload: deps.reload,
				say: deps.say,
			});
			return;
		}
		const disabled = deps.config.disabledAppearancePlugins;
		const off = disabled.includes(current.id);
		deps.patchConfig({
			disabledAppearancePlugins: off
				? disabled.filter((entry) => entry !== current.id)
				: [...disabled, current.id],
		});
		deps.reload();
		deps.say(`Plugin ${current.id} ${off ? 'enabled' : 'disabled'}`);
	};

	const remove = () => {
		const current = row();
		if (current?.kind !== 'installed') return;
		deleteAppearancePlugin(`installed:${current.id}`, {
			config: deps.config,
			patchConfig: deps.patchConfig,
			reload: deps.reload,
			close: () => {},
			say: deps.say,
		});
	};

	const ensureCatalog = () => {
		if (fetched) return;
		fetched = true;
		void (async () => {
			const next = await fetchCatalog(deps.config.pluginRegistry);
			if (!next) return;
			writeCachedCatalog(next, Date.now());
			refreshMarket();
		})();
	};

	const checkNow = () => {
		void (async () => {
			const next = await fetchCatalog(deps.config.pluginRegistry);
			if (!next) return deps.say('Could not reach plugin market', 'warn');
			writeCachedCatalog(next, Date.now());
			refreshMarket();
			deps.say(`Plugin market: ${next.length} plugin${next.length === 1 ? '' : 's'}`);
		})();
	};

	const updateAll = () => {
		void (async () => {
			const next = await fetchCatalog(deps.config.pluginRegistry);
			if (!next) return deps.say('Could not reach plugin market', 'warn');
			writeCachedCatalog(next, Date.now());
			refreshMarket();
			const updates = updatesFor(
				installedMarketPlugins(deps.appearance(), loadLocalLspServers(deps.rootDir).plugins),
				next,
			);
			if (updates.length === 0) return deps.say('Plugins are up to date');
			const results = await Promise.all(
				updates.map((entry) =>
					installMarketPlugin(entry.id, {
						config: deps.config,
						reload: () => {},
						say: deps.say,
					}),
				),
			);
			deps.reload();
			deps.say(`Updated ${updates.length} plugin${updates.length === 1 ? '' : 's'}`);
			void results;
		})();
	};

	const openSearch = () => setQuery((current) => current ?? '');
	const closeSearch = () => {
		const held = row();
		setQuery(null);
		const next =
			held && held.kind !== 'section' ? rows().findIndex((entry) => entry.id === held.id) : -1;
		setCursor(Math.max(0, next));
	};
	const search = (value: string) => {
		setQuery(value);
		const first = rows().findIndex(
			(entry) => entry.kind === 'installed' || entry.kind === 'available',
		);
		setCursor(Math.max(0, first));
	};

	return {
		rows,
		cursor: at,
		move,
		moveTo,
		activate,
		remove,
		query,
		openSearch,
		closeSearch,
		search,
		ensureCatalog,
		checkNow,
		updateAll,
		installedCount: () => deps.appearance().plugins.length,
	};
}

export type PluginsPanel = ReturnType<typeof createPluginsPanel>;
