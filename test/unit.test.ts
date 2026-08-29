import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCommands, flattenCommands } from '../src/app/commands';
import type { CommandActions } from '../src/app/commands';
import { createSidebarSizing } from '../src/app/sidebarSizing';
import { settingsRows } from '../src/app/settingsRows';
import { DEFAULTS } from '../src/core/config';
import type { Config } from '../src/core/config';
import { unifiedDiff } from '../src/core/diff';
import { readFile } from '../src/core/fs';
import { defaultBranch, failureLine, PUSH_REJECTED } from '../src/core/git';
import { branchDiffFiles } from '../src/core/gitDiff';
import { loadIconThemes } from '../src/core/iconThemes';
import { searchProject, searchText } from '../src/core/search';
import { isNewer } from '../src/core/update';
import { discoverRepos } from '../src/core/vcs/repos';
import { THEMES } from '../src/themes';
import { git as runGit } from './git-fixture';

const hexChannels = (hex: string) =>
	[0, 2, 4].map((i) => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16));

const gitRepo = (initial = 'trunk') => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-default-branch-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	git('init', '-q', '-b', initial);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(join(dir, 'seed.txt'), 'seed\n');
	git('add', '.');
	git('commit', '-q', '-m', 'seed');
	return { dir, git };
};

describe('search', () => {
	const text = 'const alpha = 1\nlet beta = 2\n// alpha again\n';

	test('finds every occurrence with line and column', () => {
		expect(searchText(text, 'alpha', 'a.ts').map((m) => [m.line, m.col])).toEqual([
			[0, 6],
			[2, 3],
		]);
	});

	test('is case-insensitive', () => {
		expect(searchText(text, 'ALPHA', 'a.ts')).toHaveLength(2);
	});

	test('walks subdirectories but skips node_modules', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-'));
		mkdirSync(join(dir, 'sub'));
		mkdirSync(join(dir, 'node_modules'));
		writeFileSync(join(dir, 'a.ts'), 'alpha\n');
		writeFileSync(join(dir, 'sub/b.ts'), 'alpha\n');
		writeFileSync(join(dir, 'node_modules/c.ts'), 'alpha\n');

		const hits = searchProject(dir, 'alpha').map((m) => m.path.replace(`${dir}/`, ''));
		expect(hits).toEqual(['a.ts', 'sub/b.ts']);
	});
});

describe('files', () => {
	test('refuses binary content', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-'));
		writeFileSync(join(dir, 'bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
		expect(() => readFile(join(dir, 'bin'))).toThrow('binary file');
	});
});

describe('diffs', () => {
	test('line insertions do not turn the rest of the file into a rewrite', () => {
		const diff = unifiedDiff('a.ts', 'one\ntwo\nthree\n', 'one\ninserted\ntwo\nthree\n');

		expect(diff.adds).toBe(1);
		expect(diff.dels).toBe(0);
		expect(diff.patch).toContain('+inserted');
		expect(diff.patch).toContain(' two');
		expect(diff.patch).not.toContain('-two');
	});
});

describe('git defaults', () => {
	test('follows configured remote HEAD before local fallback', () => {
		const { dir, git } = gitRepo('trunk');
		git('config', 'init.defaultBranch', 'main');
		git('remote', 'add', 'origin', dir);
		git('fetch', '-q', 'origin');
		git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
		expect(defaultBranch(dir)).toBe('origin/trunk');
	});

	test('uses existing init.defaultBranch and otherwise returns null', () => {
		const local = gitRepo('trunk');
		local.git('config', 'init.defaultBranch', 'trunk');
		expect(defaultBranch(local.dir)).toBe('trunk');
		expect(defaultBranch(gitRepo('topic').dir)).toBeNull();
	});
});

describe('sidebar sizing', () => {
	test('resizeSidebar reads the pointer directly when the sidebar is on the left', () => {
		let saved: Partial<Config> = {};
		const { resizeSidebar } = createSidebarSizing({
			config: { ...DEFAULTS, sidebarPosition: 'left' },
			width: () => 80,
			patchConfig: (patch) => {
				saved = patch;
			},
		});
		resizeSidebar(30);
		expect(saved.sidebarWidth).toBe(30);
	});

	test('resizeSidebar measures from the right edge when the sidebar is on the right', () => {
		let saved: Partial<Config> = {};
		const { resizeSidebar } = createSidebarSizing({
			config: { ...DEFAULTS, sidebarPosition: 'right' },
			width: () => 80,
			patchConfig: (patch) => {
				saved = patch;
			},
		});
		// Pointer on the divider at column 60 of 80: 19 columns sit to its right.
		resizeSidebar(60);
		expect(saved.sidebarWidth).toBe(19);
	});

	test('nudgeSidebar applies the delta directly regardless of sidebar position', () => {
		let saved: Partial<Config> = {};
		const { nudgeSidebar } = createSidebarSizing({
			config: { ...DEFAULTS, sidebarPosition: 'right', sidebarWidth: 30 },
			width: () => 80,
			patchConfig: (patch) => {
				saved = patch;
			},
		});
		// A width already, not a pointer column — must not go through the right-side
		// pointer-to-width conversion a second time.
		nudgeSidebar(1);
		expect(saved.sidebarWidth).toBe(31);
	});
});

describe('nested repo discovery', () => {
	test('gitScanDepth bounds how far discoverRepos descends', () => {
		const root = mkdtempSync(join(tmpdir(), 'dune-scan-'));
		const shallow = join(root, 'a');
		const deep = join(root, 'x', 'y', 'z');
		mkdirSync(shallow, { recursive: true });
		mkdirSync(deep, { recursive: true });
		execFileSync('git', ['init', '-q', shallow]);
		execFileSync('git', ['init', '-q', deep]);

		expect(discoverRepos(root, 0)).toEqual([]);
		expect(discoverRepos(root, 1)).toEqual([shallow]);
		expect(discoverRepos(root, 3).toSorted()).toEqual([shallow, deep].toSorted());
	});
});

describe('git branch diffs', () => {
	test('preserves renamed file status and old path', () => {
		const { dir, git } = gitRepo('main');
		writeFileSync(join(dir, 'old-name.txt'), 'one\ntwo\nthree\nfour\nfive\n');
		git('add', '.');
		git('commit', '-q', '-m', 'old name');
		git('switch', '-q', '-c', 'feature');
		execFileSync('git', ['mv', 'old-name.txt', 'renamed.txt'], { cwd: dir });
		writeFileSync(join(dir, 'renamed.txt'), 'ONE\ntwo\nthree\nfour\nfive\n');
		git('add', '.');
		git('commit', '-q', '-m', 'rename file');

		const files = branchDiffFiles(dir, 'main');
		expect(files).toHaveLength(1);
		expect(files[0]).toMatchObject({
			rel: 'renamed.txt',
			oldRel: 'old-name.txt',
			status: 'renamed',
			oldText: 'one\ntwo\nthree\nfour\nfive\n',
			newText: 'ONE\ntwo\nthree\nfour\nfive\n',
		});
	});

	test('marks binary file comparisons without text counts', () => {
		const { dir, git } = gitRepo('main');
		git('switch', '-q', '-c', 'feature');
		writeFileSync(join(dir, 'image.bin'), new Uint8Array([0, 1, 2]));
		git('add', '.');
		git('commit', '-q', '-m', 'binary file');

		const files = branchDiffFiles(dir, 'main');
		expect(files).toHaveLength(1);
		expect(files[0]).toMatchObject({
			rel: 'image.bin',
			status: 'added',
			binary: true,
		});
	});
});

describe('git failures', () => {
	test('rejected push output names the useful recovery', () => {
		const rejected = [
			'To https://github.com/user/repo',
			' ! [rejected]        main -> main (non-fast-forward)',
			"error: failed to push some refs to 'https://github.com/user/repo'",
			'hint: Updates were rejected because the tip of your current branch is behind',
		].join('\n');

		expect(failureLine(rejected)).toBe('! [rejected]        main -> main (non-fast-forward)');
		expect(PUSH_REJECTED).toBe("origin has commits you don't - pull first, then push");
	});
});

describe('updates', () => {
	test('compares versions numerically', () => {
		expect(isNewer('0.3.0', '0.2.0')).toBe(true);
		expect(isNewer('0.10.0', '0.9.0')).toBe(true);
		expect(isNewer('0.2.0', '0.2.0')).toBe(false);
		expect(isNewer('0.2.0', '0.3.0')).toBe(false);
	});

	test('a release is newer than its own prereleases', () => {
		expect(isNewer('1.0.0', '1.0.0-beta.1')).toBe(true);
		expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
		expect(isNewer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true);
	});

	test('garbage from the registry is not an update', () => {
		expect(isNewer('not-a-version', '0.2.0')).toBe(false);
	});
});

describe('registries', () => {
	test('icon theme plugins reject wide glyphs', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-icon-theme-'));
		const plugin = join(dir, 'plugins');
		mkdirSync(plugin);
		writeFileSync(
			join(plugin, 'wide.json'),
			JSON.stringify({
				icons: [{ id: 'wide', name: 'Wide', file: '🚀', folder: '▸', folderOpen: '▾' }],
			}),
		);

		const load = loadIconThemes(dir, plugin);
		expect(load.themes).toHaveLength(0);
		expect(load.problems[0]?.reason).toBe('invalid icon theme');
	});

	test('icon theme plugins accept private-plane nerd font glyphs', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-icon-theme-'));
		const plugin = join(dir, 'plugins');
		mkdirSync(plugin);
		writeFileSync(
			join(plugin, 'nerd.json'),
			JSON.stringify({
				icons: [
					{
						id: 'nerd',
						name: 'Nerd',
						file: '󰈔',
						folder: '▸',
						folderOpen: '▾',
					},
				],
			}),
		);

		const load = loadIconThemes(dir, plugin);
		expect(load.problems).toEqual([]);
		expect(load.themes[0]?.file.glyph).toBe('󰈔');
	});

	test('icon theme definitions can be reused by file and folder maps', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-icon-theme-'));
		const plugin = join(dir, 'plugins');
		mkdirSync(plugin);
		writeFileSync(
			join(plugin, 'defs.json'),
			JSON.stringify({
				icons: [
					{
						id: 'defs',
						name: 'Definitions',
						definitions: {
							ts: { glyph: 't', color: '#3178c6' },
							src: { glyph: 's', open: 'S' },
						},
						file: '·',
						folder: '▸',
						folderOpen: '▾',
						extensions: { '.ts': 'ts' },
						folders: { src: 'src' },
					},
				],
			}),
		);

		const theme = loadIconThemes(dir, plugin).themes[0]!;
		expect(theme.extensions.ts).toEqual({ glyph: 't', color: '#3178c6' });
		expect(theme.folders.src).toEqual({ glyph: 's' });
		expect(theme.foldersOpen.src).toEqual({ glyph: 'S' });
	});

	test('every command leaf is runnable, unique, and reachable', () => {
		const ran: string[] = [];
		const actions = new Proxy({} as CommandActions, {
			get: (_t, name: string) => () => ran.push(name),
		});
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
		const leaves = flattenCommands(tree);

		expect(leaves.length).toBeGreaterThan(10);
		for (const { command } of leaves) expect(typeof command.run).toBe('function');

		const ids = leaves.map((l) => l.command.id);
		expect(new Set(ids).size).toBe(ids.length);

		// Running every leaf must not throw and must reach an action.
		for (const { command } of leaves) command.run?.();
		expect(ran.length).toBe(leaves.length);
	});

	test('appearance market commands include a searchable description', () => {
		const actions = new Proxy({} as CommandActions, {
			get: () => () => {},
		});
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
			marketPlugins: [
				{
					id: 'mono',
					name: 'Mono',
					version: '1.0.0',
					description: 'quiet monochrome icons for focused editing',
				},
			],
			installedPlugins: [],
		});
		const leaves = flattenCommands(tree);

		expect(leaves.map((leaf) => leaf.command.label)).toContain(
			'Install Mono 1.0.0 - quiet monochrome icons for focused editing',
		);
	});

	test('plugin commands can disable and enable installed plugins', () => {
		const actions = new Proxy({} as CommandActions, {
			get: () => () => {},
		});
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
			installedPlugins: [
				{ id: 'mono', version: '1.0.0', disabled: false },
				{ id: 'paper', version: '2.0.0', disabled: true },
			],
		});
		const labels = flattenCommands(tree).map((leaf) => leaf.command.label);

		expect(labels).toContain('Disable mono 1.0.0');
		expect(labels).toContain('Enable paper 2.0.0');
	});

	test('settings expose plugin update checks', () => {
		const rows = settingsRows(DEFAULTS, [], {
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
			configScope: () => 'user',
		});

		expect(rows.find((row) => row.label === 'Plugin update checks')?.value).toBe('on');
	});

	test('repo scan depth cycles through 0-5 and wraps', () => {
		let patched: Partial<Config> = {};
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
			patchConfig: (patch: Partial<Config>) => {
				patched = patch;
			},
			configScope: () => 'user' as const,
		};
		const scanDepthRow = (gitScanDepth: number) =>
			settingsRows({ ...DEFAULTS, gitScanDepth }, [], actions).find(
				(r) => r.label === 'Repo scan depth',
			);

		expect(scanDepthRow(DEFAULTS.gitScanDepth)?.value).toBe(`${DEFAULTS.gitScanDepth}`);
		scanDepthRow(DEFAULTS.gitScanDepth)?.change(1);
		expect(patched.gitScanDepth).toBe(DEFAULTS.gitScanDepth + 1);

		scanDepthRow(0)?.change(-1);
		expect(patched.gitScanDepth).toBe(5);

		scanDepthRow(5)?.change(1);
		expect(patched.gitScanDepth).toBe(0);
	});

	// Missing/extra ui keys are a tsc error, so only the values are worth asserting.
	test('every theme tints the current line instead of filling it', () => {
		for (const [id, theme] of Object.entries(THEMES)) {
			const [bg, line] = [hexChannels(theme.ui.bg), hexChannels(theme.ui.currentLine)];
			const delta = Math.max(...bg.map((v, i) => Math.abs(v - line[i]!)));
			// Visible as a band, never a block that competes with the code on it.
			expect(`${id}:${delta > 0 && delta <= 20}`).toBe(`${id}:true`);
		}
	});
});
