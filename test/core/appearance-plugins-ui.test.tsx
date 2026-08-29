import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { USER_THEME_PLUGIN_DIR } from '../../src/core/localThemes';
import { MARKET_URL, writeCachedCatalog, writePlugin } from '../../src/core/market';
import { fixture, launch, openFile, press, pressEscape, runCommand, until } from '../helpers';

const testConfigFile = () => join(process.env.XDG_CONFIG_HOME!, 'dune', 'config.json');
const OLD_REGISTRY = 'https://old.example.test/market';

test('the plugins page lists and toggles installed plugins', async () => {
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();

	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
	await runCommand(t, 'Plugin manager');
	await until(t, () => {
		const frame = t.captureCharFrame();
		return (
			frame.includes('Plugins') &&
			frame.includes('Disable mono 1.0.0') &&
			frame.includes('icons: mono-icons')
		);
	});
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Plugin mono disabled'));

	await runCommand(t, 'Plugin manager');
	await until(t, () => t.captureCharFrame().includes('Enable mono 1.0.0'));
});

test('the plugins page removes installed plugins with Backspace', async () => {
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();

	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
	await runCommand(t, 'Plugin manager');
	await until(t, () => t.captureCharFrame().includes('Disable mono 1.0.0'));
	await press(t, (input) => input.pressBackspace());
	await until(t, () => t.captureCharFrame().includes('Removed plugin mono'));

	expect(existsSync(join(USER_THEME_PLUGIN_DIR, 'mono'))).toBe(false);
});

test('the plugins page lists and removes installed language server plugins', async () => {
	const manifest = {
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
	};
	expect(
		writePlugin('kotlin-tools', {
			ok: true,
			id: 'kotlin-tools',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();

	const t = await launch(fixture({ 'a.kt': 'fun main() {}\n' }));
	await runCommand(t, 'Plugin manager');
	await until(t, () => {
		const frame = t.captureCharFrame();
		return (
			frame.includes('Installed kotlin-tools 1.0.0') &&
			frame.includes('Kotlin Tools') &&
			frame.includes('language servers: kotlin')
		);
	});
	await press(t, (input) => input.pressBackspace());
	await until(t, () =>
		t.captureCharFrame().includes('Removed language server plugin kotlin-tools'),
	);

	expect(existsSync(join(USER_THEME_PLUGIN_DIR, 'kotlin-tools'))).toBe(false);
});

test('the plugins page reloads plugins from disk', async () => {
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};

	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
	await runCommand(t, 'Plugin manager');
	await until(t, () => t.captureCharFrame().includes('Reload from disk'));
	expect(t.captureCharFrame()).not.toContain('Update all plugins');
	expect(t.captureCharFrame()).toContain('Reload from disk - ');
	expect(t.captureCharFrame().replace(/[^\w/]/g, '')).toContain('dune/plugins');

	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();

	await press(t, (input) => void input.typeText('Reload'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Disable mono 1.0.0'));
});

test('the plugins page installs cached market plugins', async () => {
	const realFetch = globalThis.fetch;
	const manifest = {
		id: 'contrast',
		name: 'Contrast',
		version: '2.0.0',
		icons: [
			{ id: 'contrast-icons', name: 'Contrast Icons', file: 'f', folder: 'd', folderOpen: 'o' },
		],
	};
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/contrast/plugin.json')
				? new Response(JSON.stringify(manifest))
				: new Response(
						JSON.stringify({
							plugins: [
								{
									id: 'contrast',
									name: 'Contrast',
									version: '2.0.0',
									description: 'high contrast icons',
								},
							],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin market');
		await until(t, () => t.captureCharFrame().includes('Plugin market: 1 plugin'));
		await runCommand(t, 'Plugin manager');
		await until(t, () => {
			const frame = t.captureCharFrame();
			return (
				frame.includes('Plugins') &&
				frame.includes('Install Contrast 2.0.0') &&
				frame.includes('high contrast icons')
			);
		});
		await press(t, (input) => input.pressEnter());
		await until(t, () => t.captureCharFrame().includes('Installed plugin contrast 2.0.0'), 80);
		await until(t, () => t.captureCharFrame().includes('Use the Contrast Icons file icons?'));
		await pressEscape(t);

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'contrast/plugin.json'), 'utf8')),
		).toEqual(manifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('a missing language server prompt installs the suggested plugin', async () => {
	const realFetch = globalThis.fetch;
	const manifest = {
		id: 'kotlin-tools',
		name: 'Kotlin Tools',
		version: '1.0.0',
		languageServers: [{ id: 'kotlin', command: ['kotlin-language-server'], filetypes: ['kotlin'] }],
	};
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/kotlin-tools/plugin.json')
				? new Response(JSON.stringify(manifest))
				: new Response(
						JSON.stringify({
							plugins: [
								{
									id: 'kotlin-tools',
									name: 'Kotlin Tools',
									version: '1.0.0',
									description: 'Kotlin language server',
									provides: { filetypes: ['kotlin'] },
								},
							],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'main.kt': 'fun main() {}\n' }), {
			lsp: true,
			pluginRegistry: 'https://example.test/market',
		});
		await openFile(t, 'main.kt');
		await until(t, () => t.captureCharFrame().includes('No language server for kotlin'));
		await press(t, (input) => input.pressEnter());
		await until(t, () => t.captureCharFrame().includes('Installed plugin kotlin-tools'));
		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'kotlin-tools/plugin.json'), 'utf8')),
		).toEqual(manifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the plugins page can refresh the market', async () => {
	const realFetch = globalThis.fetch;
	const requested: string[] = [];
	globalThis.fetch = ((url: string) => {
		requested.push(String(url));
		return Promise.resolve(
			new Response(
				JSON.stringify({
					plugins: [{ id: 'contrast', name: 'Contrast', version: '2.0.0' }],
				}),
			),
		);
	}) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Plugin manager');
		await press(t, (input) => input.pressArrow('down'));
		await press(t, (input) => input.pressEnter());
		await until(t, () => {
			const frame = t.captureCharFrame();
			return frame.includes('Plugin market: 1 plugin') && frame.includes('Install Contrast 2.0.0');
		});

		expect(requested.filter((url) => url.endsWith('index.json'))).toHaveLength(2);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('opening the plugins page refreshes a still-fresh cached market once', async () => {
	const realFetch = globalThis.fetch;
	const requested: string[] = [];
	writeCachedCatalog([], Date.now());
	globalThis.fetch = ((url: string) => {
		requested.push(String(url));
		return Promise.resolve(
			new Response(
				JSON.stringify({
					plugins: [{ id: 'contrast', name: 'Contrast', version: '2.0.0' }],
				}),
			),
		);
	}) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
			pluginUpdates: false,
		});
		await runCommand(t, 'Plugin manager');
		await until(t, () => t.captureCharFrame().includes('Install Contrast 2.0.0'));
		await pressEscape(t);
		await runCommand(t, 'Plugin manager');
		await until(t, () => t.captureCharFrame().includes('Install Contrast 2.0.0'));

		expect(requested).toEqual(['https://example.test/market/index.json']);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the plugins page can update every installed plugin', async () => {
	const realFetch = globalThis.fetch;
	const oldManifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	const newManifest = { ...oldManifest, version: '1.1.0' };
	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(oldManifest),
		}),
	).toBeNull();
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/mono/plugin.json')
				? new Response(JSON.stringify(newManifest))
				: new Response(
						JSON.stringify({ plugins: [{ id: 'mono', name: 'Mono', version: '1.1.0' }] }),
					),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin market');
		await until(t, () => t.captureCharFrame().includes('Plugin market: 1 plugin'));
		await runCommand(t, 'Plugin manager');
		await until(t, () => t.captureCharFrame().includes('Update all plugins - Mono'));
		await pressEscape(t);
		await runCommand(t, 'Plugin manager');
		await press(t, (input) => void input.typeText('Update all'));
		await press(t, (input) => input.pressEnter());
		await until(t, () => t.captureCharFrame().includes('Updated 1 plugin'));

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'mono/plugin.json'), 'utf8')),
		).toEqual(newManifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the plugins page can update installed language server plugins', async () => {
	const realFetch = globalThis.fetch;
	const installedManifest = {
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
	};
	const updatedManifest = { ...installedManifest, version: '1.1.0' };
	expect(
		writePlugin('kotlin-tools', {
			ok: true,
			id: 'kotlin-tools',
			version: '1.0.0',
			body: JSON.stringify(installedManifest),
		}),
	).toBeNull();
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/kotlin-tools/plugin.json')
				? new Response(JSON.stringify(updatedManifest))
				: new Response(
						JSON.stringify({
							plugins: [{ id: 'kotlin-tools', name: 'Kotlin Tools', version: '1.1.0' }],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.kt': 'fun main() {}\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin market');
		await until(t, () => t.captureCharFrame().includes('Plugin market: 1 plugin'));
		await runCommand(t, 'Plugin manager');
		await press(t, (input) => void input.typeText('Update all'));
		await press(t, (input) => input.pressEnter());
		await until(t, () => t.captureCharFrame().includes('Updated 1 plugin'));

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'kotlin-tools/plugin.json'), 'utf8')),
		).toEqual(updatedManifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the plugins page toggles startup update checks', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { pluginUpdates: true });
	await runCommand(t, 'Plugin manager');
	await press(t, (input) => void input.typeText('startup'));
	await until(t, () => t.captureCharFrame().includes('Disable startup update checks'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Startup update checks disabled'));

	await press(t, (input) => input.pressKey('p', { ctrl: true }));
	await press(t, (input) => void input.typeText('Plugin manager'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Enable startup update checks'));
});

test('the plugins page edits the market registry', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
		pluginRegistry: OLD_REGISTRY,
	});
	await runCommand(t, 'Plugin manager');
	await press(t, (input) => void input.typeText('Edit market registry'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Plugin registry URL'));

	await press(t, (input) => {
		input.typeText('https://new.example.test/plugins');
	});
	await press(t, (input) => input.pressEnter());
	await until(t, () =>
		t.captureCharFrame().includes('Plugin registry: https://new.example.test/plugins'),
	);

	expect(JSON.parse(readFileSync(testConfigFile(), 'utf8')).pluginRegistry).toBe(
		'https://new.example.test/plugins',
	);
});

test('the plugins page resets an empty market registry to the default', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
		pluginRegistry: OLD_REGISTRY,
	});
	await runCommand(t, 'Plugin manager');
	await press(t, (input) => void input.typeText('Edit market registry'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Plugin registry URL'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes(`Plugin registry: ${MARKET_URL}`));
	expect(JSON.parse(readFileSync(testConfigFile(), 'utf8')).pluginRegistry).toBe(MARKET_URL);
});

test('the plugins page rejects non-https market registries', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
		pluginRegistry: OLD_REGISTRY,
	});
	await runCommand(t, 'Plugin manager');
	await press(t, (input) => void input.typeText('Edit market registry'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Plugin registry URL'));
	await press(t, (input) => {
		input.typeText('http://plain.example.test/plugins');
	});
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Plugin registry must be an https URL'));
	expect(existsSync(testConfigFile())).toBe(false);
});

test('the plugins page hides current installed market plugins', async () => {
	const realFetch = globalThis.fetch;
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();
	globalThis.fetch = ((_url: string) =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					plugins: [{ id: 'mono', name: 'Mono', version: '1.0.0', description: 'already present' }],
				}),
			),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin market');
		await until(t, () => t.captureCharFrame().includes('Plugin market: 1 plugin'));
		await runCommand(t, 'Plugin manager');
		await until(t, () => t.captureCharFrame().includes('Disable mono 1.0.0'));

		expect(t.captureCharFrame()).not.toContain('Installed Mono 1.0.0');
	} finally {
		globalThis.fetch = realFetch;
	}
});
