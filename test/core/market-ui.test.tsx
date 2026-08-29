import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writePlugin } from '../../src/core/market';
import { USER_THEME_PLUGIN_DIR } from '../../src/core/localThemes';
import { fixture, launch, press, pressEscape, runCommand, settle, until } from '../helpers';

test('the palette can check the plugin market', async () => {
	const realFetch = globalThis.fetch;
	const requested: string[] = [];
	globalThis.fetch = ((url: string) => {
		requested.push(String(url));
		return Promise.resolve(
			new Response(
				JSON.stringify({
					plugins: [
						{ id: 'mono', version: '1.0.0' },
						{ id: 'contrast', version: '2.0.0' },
					],
				}),
			),
		);
	}) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin market');
		await until(t, () => t.captureCharFrame().includes('Plugin market: 2 plugins'));

		expect(requested).toEqual(['https://example.test/market/index.json']);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the palette can install a plugin by id', async () => {
	const realFetch = globalThis.fetch;
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/mono/plugin.json')
				? new Response(JSON.stringify(manifest))
				: new Response('missing', { status: 404 }),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Install plugin');
		await press(t, (input) => void input.typeText('mono'));
		await press(t, (input) => input.pressEnter());
		await until(t, () => t.captureCharFrame().includes('Installed plugin mono 1.0.0'));
		await until(t, () => t.captureCharFrame().includes('Use the Mono Icons file icons?'));
		await press(t, (input) => input.pressEnter());
		await until(t, () => t.captureCharFrame().includes('File icons: mono-icons'));
		await runCommand(t, 'Plugin manager');
		await until(t, () => t.captureCharFrame().includes('Disable mono 1.0.0'));

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'mono/plugin.json'), 'utf8')),
		).toEqual(manifest);
		expect(
			JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME!, 'dune', 'config.json'), 'utf8'))
				.iconTheme,
		).toBe('mono-icons');
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the palette can install a plugin from the market list', async () => {
	const realFetch = globalThis.fetch;
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/mono/plugin.json')
				? new Response(JSON.stringify(manifest))
				: new Response(
						JSON.stringify({
							plugins: [
								{
									id: 'mono',
									name: 'Mono',
									version: '1.0.0',
									description: 'quiet monochrome icons',
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
		await runCommand(t, 'Install Mono 1.0.0 - quiet monochrome icons');
		await until(t, () => t.captureCharFrame().includes('Installed plugin mono 1.0.0'));
		await until(t, () => t.captureCharFrame().includes('Use the Mono Icons file icons?'));
		await pressEscape(t);

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'mono/plugin.json'), 'utf8')),
		).toEqual(manifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the market list labels installed plugin updates', async () => {
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
	const newManifest = { ...manifest, version: '1.1.0' };
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).endsWith('/mono/plugin.json')
				? new Response(JSON.stringify(newManifest))
				: new Response(
						JSON.stringify({
							plugins: [{ id: 'mono', name: 'Mono', version: '1.1.0' }],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin market');
		await until(t, () => t.captureCharFrame().includes('Plugin market: 1 plugin'));
		await runCommand(t, 'Update Mono 1.1.0');
		await until(t, () => t.captureCharFrame().includes('Installed plugin mono 1.1.0'));
		await until(t, () => t.captureCharFrame().includes('Use the Mono Icons file icons?'));
		await pressEscape(t);

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'mono/plugin.json'), 'utf8')),
		).toEqual(newManifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('startup reports available plugin updates', async () => {
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
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).includes('registry.npmjs.org')
				? new Response(JSON.stringify({ version: '0.0.0' }))
				: new Response(
						JSON.stringify({
							plugins: [{ id: 'mono', name: 'Mono', version: '1.1.0' }],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(
			fixture({ 'a.ts': 'const a = 1\n' }),
			{ pluginRegistry: 'https://example.test/market' },
			{},
			{ checkUpdates: true },
		);
		await until(t, () => t.captureCharFrame().includes('Mono 1.1.0 is available'));
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('startup reports available language server plugin updates', async () => {
	const realFetch = globalThis.fetch;
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
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).includes('registry.npmjs.org')
				? new Response(JSON.stringify({ version: '0.0.0' }))
				: new Response(
						JSON.stringify({
							plugins: [{ id: 'kotlin-tools', name: 'Kotlin Tools', version: '1.1.0' }],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(
			fixture({ 'a.kt': 'fun main() {}\n' }),
			{ pluginRegistry: 'https://example.test/market' },
			{},
			{ checkUpdates: true },
		);
		await until(t, () => t.captureCharFrame().includes('Kotlin Tools 1.1.0 is available'));
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('startup offers a plugin for a missing configured theme', async () => {
	const realFetch = globalThis.fetch;
	globalThis.fetch = ((url: string) =>
		Promise.resolve(
			String(url).includes('registry.npmjs.org')
				? new Response(JSON.stringify({ version: '0.0.0' }))
				: new Response(
						JSON.stringify({
							plugins: [
								{
									id: 'mono',
									name: 'Mono',
									version: '1.0.0',
									provides: { themes: ['mono-dark'], icons: [] },
								},
							],
						}),
					),
		)) as typeof fetch;
	try {
		const t = await launch(
			fixture({ 'a.ts': 'const a = 1\n' }),
			{
				pluginRegistry: 'https://example.test/market',
				themeSync: false,
				theme: 'mono-dark',
			},
			{},
			{ checkUpdates: true },
		);
		await until(t, () => t.captureCharFrame().includes('Configured appearance needs mono'));
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('startup skips plugin updates when disabled', async () => {
	const realFetch = globalThis.fetch;
	const requested: string[] = [];
	globalThis.fetch = ((url: string) => {
		requested.push(String(url));
		return Promise.resolve(new Response(JSON.stringify({ version: '0.0.0' })));
	}) as typeof fetch;
	try {
		const t = await launch(
			fixture({ 'a.ts': 'const a = 1\n' }),
			{ pluginRegistry: 'https://example.test/market', pluginUpdates: false },
			{},
			{ checkUpdates: true },
		);
		await settle(t, 20);

		expect(requested).toEqual(['https://registry.npmjs.org/dune/latest']);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the palette can remove a plugin by id', async () => {
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	const error = writePlugin('mono', {
		ok: true,
		id: 'mono',
		version: '1.0.0',
		body: JSON.stringify(manifest),
	});
	expect(error).toBeNull();

	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
	await runCommand(t, 'Remove plugin');
	await press(t, (input) => void input.typeText('mono'));
	await press(t, (input) => input.pressEnter());
	await until(t, () => t.captureCharFrame().includes('Removed plugin mono'));
	await runCommand(t, 'Plugin manager');
	await until(t, () => t.captureCharFrame().includes('No plugins listed'));

	expect(existsSync(join(USER_THEME_PLUGIN_DIR, 'mono'))).toBe(false);
});

test('the palette can check plugin updates', async () => {
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
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					plugins: [{ id: 'mono', version: '1.1.0' }],
				}),
			),
		)) as unknown as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Check plugin updates');
		await until(t, () => t.captureCharFrame().includes('Plugin updates: mono'));
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('the palette can update plugins', async () => {
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
				: new Response(JSON.stringify({ plugins: [{ id: 'mono', version: '1.1.0' }] })),
		)) as typeof fetch;
	try {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {
			pluginRegistry: 'https://example.test/market',
		});
		await runCommand(t, 'Update plugins');
		await until(t, () => t.captureCharFrame().includes('Updated 1 plugin'));
		await runCommand(t, 'Plugin manager');
		await until(t, () => t.captureCharFrame().includes('Disable mono 1.1.0'));

		expect(
			JSON.parse(readFileSync(join(USER_THEME_PLUGIN_DIR, 'mono/plugin.json'), 'utf8')),
		).toEqual(newManifest);
	} finally {
		globalThis.fetch = realFetch;
	}
});
