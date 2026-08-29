import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULTS, loadProjectConfig } from '../src/core/config';
import { parseLspServerEdit } from '../src/core/lspSettings';
import { settingsRows } from '../src/app/settingsRows';
import { downloadServer, installedCommand } from '../src/lsp/install';
import { projectCommand, typescriptMajor } from '../src/lsp/project';
import { installHint, resolveServer, resolveServers, serverSpecs } from '../src/lsp/servers';
import { fixture } from './helpers';

test('language server resolution applies overrides and disables empty commands', () => {
	expect(resolveServer('typescript', {})?.command[0]).toBe('typescript-language-server');
	expect(resolveServer('typescript', {})?.install).toEqual({
		kind: 'npm',
		packages: ['typescript-language-server', 'typescript@5'],
	});
	expect(resolveServer('typescriptreact', {})?.id).toBe('typescript');
	expect(resolveServer('jsonc', {})?.id).toBe('json');
	expect(resolveServer('solidity', {})).toEqual({
		id: 'solidity',
		command: ['nomicfoundation-solidity-language-server', '--stdio'],
		install: { kind: 'npm', packages: ['@nomicfoundation/solidity-language-server'] },
		settings: undefined,
	});
	expect(resolveServer('vue', {})).toEqual({
		id: 'vue',
		command: ['vue-language-server', '--stdio'],
		install: { kind: 'npm', packages: ['@vue/language-server', 'typescript@5'] },
		settings: undefined,
	});
	expect(resolveServers('vue', {}).map((server) => server.id)).toEqual(['vue', 'vue-typescript']);
	expect(
		resolveServers('vue', {}).find((server) => server.id === 'vue-typescript')?.install,
	).toEqual({
		kind: 'npm',
		packages: ['typescript-language-server', '@vue/typescript-plugin', 'typescript@5'],
	});
	expect(resolveServer('typescript', { typescript: ['deno', 'lsp'] })?.command).toEqual([
		'deno',
		'lsp',
	]);
	expect(resolveServer('typescript', { typescript: ['deno', 'lsp'] })?.install).toBeUndefined();
	expect(resolveServer('typescript', { typescript: [] })).toBeNull();
	expect(resolveServer('brainfuck', {})).toBeNull();
	expect(resolveServer(undefined, {})).toBeNull();
	expect(
		resolveServer('kotlin', {}, [
			{
				id: 'kotlin',
				command: ['kotlin-language-server'],
				filetypes: ['kotlin'],
				install: { kind: 'manual', command: 'install kotlin-language-server' },
			},
		]),
	).toEqual({
		id: 'kotlin',
		command: ['kotlin-language-server'],
		install: { kind: 'manual', command: 'install kotlin-language-server' },
	});
	expect(
		resolveServer('typescript', {}, [
			{ id: 'custom-typescript', command: ['custom-ts'], filetypes: ['typescript'] },
		])?.id,
	).toBe('typescript');
	expect(
		resolveServers('typescript', {}, [
			{
				id: 'eslint',
				command: ['vscode-eslint-language-server', '--stdio'],
				filetypes: ['typescript'],
			},
		]).map((server) => server.id),
	).toEqual(['typescript', 'eslint']);
	expect(
		serverSpecs([{ id: 'typescript', command: ['custom-ts'], filetypes: ['typescript'] }]),
	).toHaveLength(serverSpecs().length);
	expect(installHint({ kind: 'manual', command: 'rustup component add rust-analyzer' })).toBe(
		'rustup component add rust-analyzer',
	);
	expect(installHint({ kind: 'npm', packages: ['pyright'] })).toBe('npm i -g pyright');
	expect(installHint({ kind: 'download', url: 'https://example.test/expert' })).toBe(
		'Download it from https://example.test/expert',
	);
});

test('LSP settings parse and appear in settings rows', () => {
	let lspEditorOpened = false;
	let tsdkEditorOpened = false;
	const rows = settingsRows(
		{
			...DEFAULTS,
			lsp: true,
			lspCompletion: false,
			lspInline: false,
			lspAutoInstall: false,
			typescriptTsdk: '/opt/typescript/lib',
			lspServers: { typescript: ['deno', 'lsp'] },
			gitPanelView: 'list',
		},
		[],
		{
			applyTheme: () => {},
			applyThemeSlot: () => {},
			applyTabSize: () => {},
			applyVim: () => {},
			editFormatter: () => {},
			editLspServer: () => (lspEditorOpened = true),
			editTypescriptTsdk: () => (tsdkEditorOpened = true),
			editKeybinding: () => {},
			editSidebarWidth: () => {},
			toggleThemeSync: () => {},
			toggleAutoSave: () => {},
			toggleTransparent: () => {},
			toggleDotfiles: () => {},
			toggleGitignored: () => {},
			toggleWrap: () => {},
			toggleFormat: () => {},
			toggleTrim: () => {},
			patchConfig: () => {},
			configScope: () => 'user',
		},
	);

	expect(rows.find((row) => row.label === 'Language servers')?.value).toBe('on');
	expect(rows.find((row) => row.label === 'Autocomplete')?.value).toBe('off');
	expect(rows.find((row) => row.label === 'Inline problem text')?.value).toBe('off');
	expect(rows.find((row) => row.label === 'Offer to install servers')?.value).toBe('off');
	expect(rows.find((row) => row.label === 'TypeScript SDK')?.value).toBe('/opt/typescript/lib');
	expect(rows.find((row) => row.label === 'Changed files')?.value).toBe('flat list');
	const lspRow = rows.find((row) => row.label === 'Add/update language server…');
	const tsdkRow = rows.find((row) => row.label === 'TypeScript SDK');
	expect(lspRow?.value).toBe('1 overridden');
	expect(tsdkRow?.value).toBe('/opt/typescript/lib');
	lspRow?.change(1);
	tsdkRow?.change(1);
	expect(lspEditorOpened).toBe(true);
	expect(tsdkEditorOpened).toBe(true);
	expect(DEFAULTS.lsp).toBe(false);
});

test('LSP server setting input parses add, disable, remove and invalid forms', () => {
	expect(parseLspServerEdit('typescript = deno lsp')).toEqual({
		ok: true,
		id: 'typescript',
		command: ['deno', 'lsp'],
	});
	expect(parseLspServerEdit('typescript = none')).toEqual({
		ok: true,
		id: 'typescript',
		command: [],
	});
	expect(parseLspServerEdit('typescript =')).toEqual({
		ok: true,
		id: 'typescript',
		command: null,
	});
	expect(parseLspServerEdit('typescript')).toEqual({
		ok: false,
		error: 'LSP override syntax: server = command',
	});
});

test('LSP settings parse from project config', () => {
	const dir = fixture({
		'a.ts': 'const a = 1\n',
		'.dune/settings.json': JSON.stringify({
			lsp: true,
			lspCompletion: false,
			lspInline: false,
			lspAutoInstall: false,
			typescriptTsdk: '/workspace/typescript/lib',
			gitPanelView: 'list',
			lspServers: { typescript: ['deno', 'lsp'], bogus: [1] },
		}),
	});

	expect(loadProjectConfig(dir)).toMatchObject({
		lsp: true,
		lspCompletion: false,
		lspInline: false,
		lspAutoInstall: false,
		typescriptTsdk: '/workspace/typescript/lib',
		gitPanelView: 'list',
		lspServers: { typescript: ['deno', 'lsp'] },
	});
});

test('language server resolution prefers project-local executables', () => {
	const dir = project({
		'node_modules/.bin/typescript-language-server': '',
		'node_modules/typescript/package.json': '{"version":"5.9.2"}',
	});

	expect(typescriptMajor(dir)).toBe(5);
	expect(projectCommand('typescript', ['typescript-language-server', '--stdio'], dir)).toEqual([
		join(dir, 'node_modules', '.bin', 'typescript-language-server'),
		'--stdio',
	]);
});

test('typescript 7 projects use tsc as the language server', () => {
	const dir = project({
		'node_modules/.bin/tsc': '',
		'node_modules/.bin/typescript-language-server': '',
		'node_modules/typescript/package.json': '{"version":"7.0.2"}',
	});

	expect(typescriptMajor(dir)).toBe(7);
	expect(projectCommand('typescript', ['typescript-language-server', '--stdio'], dir)).toEqual([
		join(dir, 'node_modules', '.bin', 'tsc'),
		'--lsp',
		'--stdio',
	]);
});

test('typescript 5 projects do not use tsc as the language server', () => {
	const dir = project({
		'node_modules/.bin/tsc': '',
		'node_modules/typescript/package.json': '{"version":"5.9.2"}',
	});

	expect(projectCommand('typescript', ['typescript-language-server', '--stdio'], dir)).toBeNull();
});

test('installed language server commands resolve from dune data root', () => {
	const dir = project({ 'node_modules/.bin/pyright-langserver': '', 'bin/expert': '' });
	expect(installedCommand(['pyright-langserver', '--stdio'], dir)).toEqual([
		join(dir, 'node_modules', '.bin', 'pyright-langserver'),
		'--stdio',
	]);
	expect(installedCommand(['expert', '--stdio'], dir)).toEqual([
		join(dir, 'bin', 'expert'),
		'--stdio',
	]);
	expect(installedCommand(['missing-language-server'], dir)).toBeNull();
});

test('downloaded language servers are written to the Dune data root', async () => {
	const dir = project({});
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		return new Response(url.endsWith('/expert') ? 'server' : null, {
			status: url.endsWith('/expert') ? 200 : 404,
		});
	}) as typeof fetch;
	try {
		expect(await downloadServer('https://example.test/expert', 'expert', dir)).toBeNull();
		expect(installedCommand(['expert', '--stdio'], dir)).toEqual([
			join(dir, 'bin', 'expert'),
			'--stdio',
		]);
		expect(await downloadServer('https://example.test/missing', 'expert', dir)).toBe('HTTP 404');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

function project(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-project-'));
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(join(path, '..'), { recursive: true });
		writeFileSync(path, content);
	}
	return dir;
}
