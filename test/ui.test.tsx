import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BaseRenderable, TextareaRenderable } from '@opentui/core';
import { testRender } from '@opentui/solid';

import { summarizeAppearancePlugins } from '../src/app/appearance/reload';
import { buildCommands } from '../src/app/commands';
import type { Command, CommandActions } from '../src/app/commands';
import { settingsRows } from '../src/app/settingsRows';
import { CONFIG_FILE, DEFAULTS } from '../src/core/config';
import type { CursorStyle } from '../src/core/config';
import { CommandPalette } from '../src/ui/CommandPalette';
import { fixture, launch, press, pressEscape, runCommand } from './helpers';
import type { Harness } from './helpers';

setDefaultTimeout(60_000);

/** Row index of a top-level command, so tests survive new commands. */
function rowOf(label: string): number {
	const actions = new Proxy({} as CommandActions, { get: () => () => {} });
	const tree = buildCommands(actions, {
		vimEnabled: false,
		activeTheme: 'dark',
		activeIconTheme: 'none',
		iconThemes: [
			{ id: 'none', name: 'none' },
			{ id: 'unicode', name: 'Unicode shapes' },
		],
		tabSize: 2,
		wrap: true,
		trimOnSave: false,
		formatOnSave: false,
		autoSaveOnBlur: false,
		showDotfiles: true,
		respectGitignore: false,
		marketPlugins: [],
		installedPlugins: [],
	});
	return tree.findIndex((command) => command.label === label);
}

/** Row index of a settings entry, so tests survive new settings. */
function settingsRowOf(label: string): number {
	const actions = {
		applyTheme: () => {},
		applyThemeSlot: () => {},
		applyTabSize: () => {},
		applyVim: () => {},
		editFormatter: () => {},
		editLspServer: () => {},
		editTypescriptTsdk: () => {},
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
		configScope: () => 'user' as const,
	};
	return settingsRows(DEFAULTS, [], actions).findIndex((row) => row.label === label);
}

const saved = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;

test('summarizes loaded local plugins', () => {
	expect(
		summarizeAppearancePlugins({ themes: [], iconThemes: [], plugins: [], problems: [] }),
	).toBe('No local plugins');
	expect(
		summarizeAppearancePlugins({
			themes: [{ id: 'project-theme', theme: {} as never }],
			iconThemes: [{ id: 'project-icons', name: 'Project Icons' } as never],
			plugins: [
				{
					id: 'pack',
					name: 'Pack',
					version: '1.0.0',
					detail: 'themes: project-theme / icons: project-icons',
					source: 'plugin.json',
					disabled: false,
				},
			],
			problems: [{ source: 'plugin.json', reason: 'invalid theme' }],
		}),
	).toBe('Local plugins: 1 theme, 1 icon theme, pack 1.0.0, 1 problem');
});

function findTextarea(node: BaseRenderable): TextareaRenderable | null {
	if (node instanceof TextareaRenderable) return node;
	for (const child of node.getChildren()) {
		const found = findTextarea(child);
		if (found) return found;
	}
	return null;
}

function editorCursorStyle(t: Harness): CursorStyle {
	const textarea = findTextarea(t.renderer.root);
	if (!textarea) throw new Error('textarea not found');
	return textarea.cursorStyle.style as CursorStyle;
}

async function gotoSettingsRow(t: Harness, label: string) {
	for (let step = 0; step < 50; step++) {
		const row = t
			.captureCharFrame()
			.split('\n')
			.find((line) => line.includes(label));
		if (row?.includes('▌')) return row;
		await press(t, (input) => input.pressArrow('down'));
	}
	throw new Error(`row not reached: ${label}`);
}

const PROJECT = {
	'src/main.ts': 'const a = 1\nconst b = 2\n',
	'notes.md': '# hi\n',
};
const SETTINGS_PROJECT = { 'main.ts': 'const value = 1\n', '.env': 'A=1\n' };
const ICON_PLUGIN = JSON.stringify({
	id: 'project-pack',
	name: 'Project Pack',
	version: '1.0.0',
	icons: [
		{
			id: 'project-icons',
			name: 'Project Icons',
			file: '•',
			folder: '▹',
			folderOpen: '▿',
			extensions: { ts: { glyph: 'T', color: '#3178c6' }, md: 'M' },
			names: { 'package.json': 'P' },
			folders: { src: 'S' },
		},
	],
});
const THEME_PLUGIN = JSON.stringify({
	id: 'project-theme-pack',
	name: 'Project Theme Pack',
	version: '1.0.0',
	themes: [
		{
			id: 'project-theme',
			name: 'Project Theme',
			ui: {
				bg: '#101418',
				panelBg: '#151b22',
				barBg: '#0d1117',
				statusBg: '#2f81f7',
				statusFg: '#ffffff',
				text: '#e6edf3',
				dim: '#8b949e',
				faint: '#6e7681',
				accent: '#2f81f7',
				activeTabFg: '#e6edf3',
				inactiveTabFg: '#8b949e',
				treeSelectedBg: '#1f6feb',
				treeFocusBg: '#1b2633',
				dirty: '#d29922',
				error: '#f85149',
				folder: '#79c0ff',
				cursor: '#ffffff',
				scrollbar: '#30363d',
				gutter: '#6e7681',
				currentLine: '#161b22',
				indentGuide: '#21262d',
				gitAdded: '#3fb950',
				gitModified: '#d29922',
				gitDeleted: '#f85149',
			},
			syntax: { keyword: { fg: '#ff7b72' }, comment: { fg: '#8b949e', italic: true } },
		},
	],
});

/** Expand src/ and open src/main.ts from the tree. */
async function openMain(t: Harness) {
	await press(t, (i) => i.pressArrow('down')); // src/
	await press(t, (i) => i.pressEnter());
	await press(t, (i) => i.pressArrow('down')); // src/main.ts
	await press(t, (i) => i.pressEnter());
}

describe('editor', () => {
	test('shows the tree on start', async () => {
		const t = await launch(fixture(PROJECT));
		const frame = t.captureCharFrame();
		expect(frame).toContain('explorer');
		expect(frame).toContain('src');
		expect(frame).toContain('notes.md');
	});

	test('can draw unicode file icons in the tree', async () => {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n', 'notes.md': '# hi\n' }), {
			iconTheme: 'unicode',
		});
		const frame = t.captureCharFrame();

		expect(frame).toContain('◆ a.ts');
		expect(frame).toContain('¶ notes.md');
		expect(frame).not.toContain('· a.ts');
	});

	test('can draw project icon plugin themes in the tree', async () => {
		const t = await launch(
			fixture({
				'src/a.ts': 'const a = 1\n',
				'notes.md': '# hi\n',
				'package.json': '{}\n',
				'.dune/settings.json': JSON.stringify({ iconTheme: 'project-icons' }),
				'.dune/plugins/project/plugin.json': ICON_PLUGIN,
			}),
		);
		const frame = t.captureCharFrame();

		expect(frame).toContain('S src');
		expect(frame).toContain('M notes.md');
		expect(frame).toContain('P package.json');
	});

	test('opens a file with content, tab and line numbers', async () => {
		const t = await launch(fixture(PROJECT));
		await openMain(t);
		const frame = t.captureCharFrame();
		expect(frame).toContain('const a = 1');
		expect(frame).toContain('main.ts');
		expect(frame).toContain(' 1 '); // gutter
		// The status bar, not the tab — 'main.ts' up there matches 'ts' on its own.
		// The frame ends with a newline, so the bar is the last row but one.
		expect(frame.split('\n').at(-2)).toContain('ts');
	});

	test('typing then Ctrl+S writes to disk', async () => {
		const dir = fixture(PROJECT);
		const t = await launch(dir);
		await openMain(t);
		await press(t, (i) => void i.typeText('X'));
		await press(t, (i) => i.pressKey('s', { ctrl: true }));
		expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe('Xconst a = 1\nconst b = 2\n');
	});
});

describe('command palette', () => {
	test('nests into submenus and applies a theme', async () => {
		const t = await launch(fixture(PROJECT));
		await press(t, (i) => i.pressKey('p', { ctrl: true }));
		// `›`, the same glyph the title trail and the README use for nesting.
		expect(t.captureCharFrame()).toContain('Themes ›');

		for (let i = 0; i < rowOf('Themes'); i++) await press(t, (input) => input.pressArrow('down'));
		await press(t, (i) => i.pressEnter());
		const frame = t.captureCharFrame();
		expect(frame).toContain('GitHub Dark');
		expect(frame).toContain('GitHub Light');
	});

	test('typing filters across levels with breadcrumbs', async () => {
		const t = await launch(fixture(PROJECT));
		await press(t, (i) => i.pressKey('p', { ctrl: true }));
		await press(t, (i) => void i.typeText('light'));
		expect(t.captureCharFrame()).toMatch(/Themes ›\s+\*?\s*GitHub Light/);
	});

	test('previews the selected row and cancels when dismissed', async () => {
		const events: string[] = [];
		const commands: Command[] = [
			{
				id: 'dark',
				label: 'Dark',
				preview: () => events.push('preview dark'),
				cancelPreview: () => events.push('cancel dark'),
				run: () => events.push('run dark'),
			},
			{
				id: 'light',
				label: 'Light',
				preview: () => events.push('preview light'),
				cancelPreview: () => events.push('cancel light'),
				run: () => events.push('run light'),
			},
			{ id: 'plain', label: 'Plain', run: () => events.push('run plain') },
		];

		const t = await testRender(() => (
			<CommandPalette commands={commands} onClose={() => events.push('close')} />
		));
		await t.flush();
		expect(events).toEqual(['preview dark']);

		await press(t, (input) => void input.typeText('light'));
		expect(events).toEqual(['preview dark', 'cancel dark', 'preview light']);

		await press(t, (input) => void input.typeText('zzzz'));
		expect(events).toEqual(['preview dark', 'cancel dark', 'preview light', 'cancel light']);

		await pressEscape(t);
		expect(events).toEqual([
			'preview dark',
			'cancel dark',
			'preview light',
			'cancel light',
			'close',
		]);
	});

	test('keeps a confirmed preview', async () => {
		const events: string[] = [];
		const commands: Command[] = [
			{
				id: 'dark',
				label: 'Dark',
				preview: () => events.push('preview dark'),
				cancelPreview: () => events.push('cancel dark'),
				run: () => events.push('run dark'),
			},
		];

		const t = await testRender(() => (
			<CommandPalette commands={commands} onClose={() => events.push('close')} />
		));
		await t.flush();
		await press(t, (input) => input.pressEnter());

		expect(events).toEqual(['preview dark', 'close', 'run dark']);
	});

	test('opens settings and applies rows immediately', async () => {
		const t = await launch(fixture(SETTINGS_PROJECT), { tabSize: 4, showDotfiles: false });
		expect(t.captureCharFrame()).not.toContain('.env');

		await runCommand(t, 'Settings');
		expect(t.captureCharFrame()).toContain('File icons');
		expect(t.captureCharFrame()).toContain('none');

		for (let i = 0; i < settingsRowOf('Show dotfiles'); i++) {
			await press(t, (input) => input.pressArrow('down'));
		}
		await press(t, (input) => input.pressArrow('right'));
		expect(t.captureCharFrame()).toContain('.env');

		await pressEscape(t);
		expect(t.captureCharFrame()).not.toContain('Settings');
	}, 60_000);

	test('configured cursor style reaches the editor', async () => {
		const dir = fixture({ 'a.ts': 'const a = 1\n' });
		const t = await launch(dir, { cursorStyle: 'underline' }, {}, { openFile: join(dir, 'a.ts') });

		expect(editorCursorStyle(t)).toBe('underline');
	});

	test('settings can cycle and persist the cursor style', async () => {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
		await runCommand(t, 'Settings');
		await gotoSettingsRow(t, 'Cursor');
		await press(t, (input) => input.pressArrow('right'));

		expect(t.captureCharFrame()).toContain('Cursor');
		expect(t.captureCharFrame()).toContain('line');
		expect(saved().cursorStyle).toBe('line');
	});

	test('settings can cycle and persist file icons', async () => {
		const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
		await runCommand(t, 'Settings');
		await gotoSettingsRow(t, 'File icons');
		await press(t, (input) => input.pressArrow('right'));

		expect(t.captureCharFrame()).toContain('Unicode shapes');
		expect(saved().iconTheme).toBe('unicode');
	});

	test('settings can cycle to a project icon plugin theme', async () => {
		const t = await launch(
			fixture({
				'a.ts': 'const a = 1\n',
				'.dune/plugins/project/plugin.json': ICON_PLUGIN,
			}),
			{ iconTheme: 'unicode' },
		);
		await runCommand(t, 'Settings');
		await gotoSettingsRow(t, 'File icons');
		await press(t, (input) => input.pressArrow('right'));

		expect(t.captureCharFrame()).toContain('Project Icons');
		expect(saved().iconTheme).toBe('project-icons');
	});

	test('reloading plugins refreshes settings choices', async () => {
		const dir = fixture({ 'a.ts': 'const a = 1\n' });
		const pluginDir = join(dir, '.dune/plugins/project');
		mkdirSync(pluginDir, { recursive: true });
		const t = await launch(dir, { iconTheme: 'unicode' });

		writeFileSync(join(pluginDir, 'plugin.json'), ICON_PLUGIN);
		await runCommand(t, 'Reload local plugins');
		await runCommand(t, 'Settings');
		await gotoSettingsRow(t, 'File icons');
		await press(t, (input) => input.pressArrow('right'));

		expect(t.captureCharFrame()).toContain('Project Icons');
		expect(saved().iconTheme).toBe('project-icons');
	});

	test('can list local plugins from the palette', async () => {
		const t = await launch(
			fixture({
				'a.ts': 'const a = 1\n',
				'.dune/plugins/project-icons/plugin.json': ICON_PLUGIN,
				'.dune/plugins/project-theme/plugin.json': THEME_PLUGIN,
			}),
		);

		await runCommand(t, 'List local plugins');

		expect(t.captureCharFrame()).toContain('Local plugins: 1 theme, 1 icon theme');
	});

	test('settings can cycle to a project theme plugin theme', async () => {
		const t = await launch(
			fixture({
				'a.ts': 'const a = 1\n',
				'.dune/plugins/project-theme/plugin.json': THEME_PLUGIN,
			}),
			{ theme: 'vesper', themeSync: false },
		);
		await runCommand(t, 'Settings');
		await gotoSettingsRow(t, 'Theme');
		await press(t, (input) => input.pressArrow('right'));

		expect(t.captureCharFrame()).toContain('Project Theme');
		expect(saved().theme).toBe('project-theme');
	}, 60_000);

	test('vim mode overrides the configured cursor style until disabled', async () => {
		const dir = fixture({ 'a.ts': 'const a = 1\n' });
		const t = await launch(
			dir,
			{ vim: true, cursorStyle: 'underline' },
			{},
			{ openFile: join(dir, 'a.ts') },
		);

		expect(editorCursorStyle(t)).toBe('block');

		await runCommand(t, 'Settings');
		const row = await gotoSettingsRow(t, 'Cursor');
		expect(row).toContain('vim overrides');

		await gotoSettingsRow(t, 'Vim mode');
		await press(t, (input) => input.pressEnter());

		expect(editorCursorStyle(t)).toBe('underline');
		expect(existsSync(CONFIG_FILE)).toBe(true);
		expect(saved().vim).toBe(false);
	}, 60_000);
});

describe('search', () => {
	test('finds a match in the open file and jumps to it', async () => {
		const dir = fixture(PROJECT);
		const t = await launch(dir);
		await openMain(t);
		await press(t, (i) => i.pressKey('f', { ctrl: true }));
		await press(t, (i) => void i.typeText('const b'));
		expect(t.captureCharFrame()).toContain('1 of 1');

		await press(t, (i) => i.pressEnter());
		await press(t, (i) => void i.typeText('Z'));
		await press(t, (i) => i.pressKey('s', { ctrl: true }));
		expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe('const a = 1\nZconst b = 2\n');
	}, 60_000);
});

test('the status bar tracks the cursor, on vertical-only moves too', async () => {
	const t = await launch(fixture({ 'a.ts': 'one\ntwo\nthree\nfour\n' }));
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressEnter());
	expect(t.captureCharFrame()).toContain('Ln 1, Col 1');

	// Arrow-down emits no cursor-change event, so this only holds while the
	// readout is refreshed after the key rather than from the event payload.
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressArrow('down'));
	expect(t.captureCharFrame()).toContain('Ln 3, Col 1');

	await press(t, (i) => i.pressArrow('up'));
	expect(t.captureCharFrame()).toContain('Ln 2, Col 1');

	await press(t, (i) => i.pressArrow('right'));
	expect(t.captureCharFrame()).toContain('Ln 2, Col 2');
}, 60_000);
