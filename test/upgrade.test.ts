import { describe, expect, test } from 'bun:test';

import { HELP } from '../src/core/cli';
import { updateCommand } from '../src/core/update';
import { detectInstall, runUpgrade, upgradeCommand } from '../src/core/upgrade';

const HOME = '/Users/dev';
const detect = (execPath: string, scriptPath = '') => detectInstall(execPath, scriptPath, HOME);

describe('working out how dune was installed', () => {
	test('Homebrew, from either prefix', () => {
		expect(detect('/opt/homebrew/bin/dune')).toEqual({ kind: 'brew' });
		expect(detect('/usr/local/Cellar/dune/1.2.0/bin/dune')).toEqual({ kind: 'brew' });
		expect(detect('/home/linuxbrew/.linuxbrew/bin/dune')).toEqual({ kind: 'brew' });
	});

	test('the curl installer, which owns ~/.dune', () => {
		expect(detect(`${HOME}/.dune/bin/dune`)).toEqual({ kind: 'script' });
	});

	test('each package manager, from the path it installs into', () => {
		expect(detect(`${HOME}/Library/pnpm/dune`)).toMatchObject({ manager: 'pnpm' });
		expect(detect(`${HOME}/.bun/bin/dune`)).toMatchObject({ manager: 'bun' });
		expect(detect(`${HOME}/.yarn/bin/dune`)).toMatchObject({ manager: 'yarn' });
		expect(detect('/usr/local/lib/node_modules/dune/bin/dune.js')).toMatchObject({
			manager: 'npm',
		});
	});

	test('the shim is what names the manager, not the runtime that runs it', () => {
		// `dune` from npm is a script node executes: execPath is node, and only
		// argv[1] says where the package lives.
		const install = detect('/usr/local/bin/node', `${HOME}/Library/pnpm/global/dune/bin/dune.mjs`);
		expect(install).toEqual({ kind: 'package', manager: 'pnpm' });
	});

	test('an unrecognised path assumes npm rather than refusing to help', () => {
		expect(detect('/somewhere/odd/dune')).toEqual({ kind: 'package', manager: 'npm' });
	});
});

describe('the command each install is upgraded with', () => {
	test('brew upgrades the tap formula', () => {
		expect(upgradeCommand({ kind: 'brew' })).toBe('brew upgrade smeltery/tap/dune');
	});

	test('the script install re-runs the installer', () => {
		expect(upgradeCommand({ kind: 'script' })).toContain('curl -fsSL');
	});

	test('a package install asks nypm, so each manager gets its own syntax', () => {
		expect(upgradeCommand({ kind: 'package', manager: 'npm' })).toBe('npm install -g dune@latest');
		expect(upgradeCommand({ kind: 'package', manager: 'pnpm' })).toBe('pnpm add -g dune@latest');
		expect(upgradeCommand({ kind: 'package', manager: 'yarn' })).toBe(
			'yarn global add dune@latest',
		);
		expect(upgradeCommand({ kind: 'package', manager: 'bun' })).toBe('bun add -g dune@latest');
	});

	test('every command names dune@latest, never a bare install', () => {
		for (const install of [
			{ kind: 'package', manager: 'npm' },
			{ kind: 'package', manager: 'pnpm' },
			{ kind: 'package', manager: 'bun' },
		] as const) {
			expect(upgradeCommand(install)).toContain('dune@latest');
		}
	});
});

describe('the banner and the command agree', () => {
	test('the suggestion shown in the editor is what `dune update` runs', () => {
		// One detection, two callers: a banner telling a Homebrew user to run npm
		// sends them off to install a second dune their PATH may not find.
		for (const path of [
			'/opt/homebrew/bin/dune',
			`${HOME}/.dune/bin/dune`,
			`${HOME}/.bun/bin/dune`,
		])
			expect(updateCommand(path, HOME, '')).toBe(upgradeCommand(detect(path)));
	});
});

describe('running it', () => {
	test('says what it detected and shows the command before running it', async () => {
		const written: string[] = [];
		await runUpgrade(
			(text) => written.push(text),
			async () => 0,
		);
		const output = written.join('');

		// The guess is stated so a wrong one is obvious before anything is installed.
		expect(output).toMatch(/Updating|Re-running/);
		expect(output).toContain('$ ');
	});
});

describe('the help', () => {
	test('lists update as a command', () => {
		expect(HELP).toContain('dune update');
		expect(HELP).toContain('upgrade dune itself');
	});
});
