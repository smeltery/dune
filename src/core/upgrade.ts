/**
 * `dune update` — upgrading the copy that is running, however it was installed.
 *
 * There are three ways to get dune and they are upgraded in three different ways.
 * Running the wrong one is worse than doing nothing: `npm install -g dune` on a
 * Homebrew install puts a second dune somewhere the user's `PATH` may not even
 * look, and then neither copy is obviously the one that runs.
 *
 * So the install is identified from where the running executable sits, and the
 * package-manager case asks nypm for the right command rather than assuming npm.
 */
import { homedir } from 'node:os';

import { addDependencyCommand } from 'nypm';
import type { PackageManagerName } from 'nypm';

export type InstallKind = 'brew' | 'script' | 'package';

export interface Install {
	kind: InstallKind;
	/** Which manager owns it, when `kind` is 'package'. */
	manager?: PackageManagerName;
}

/** Path fragments each manager puts its global binaries under. */
const MANAGER_PATHS: ReadonlyArray<readonly [PackageManagerName, RegExp]> = [
	['pnpm', /[/\\](?:\.?pnpm|pnpm-global)[/\\]/],
	['bun', /[/\\]\.bun[/\\]/],
	['yarn', /[/\\]\.?yarn[/\\]/],
	['deno', /[/\\]\.deno[/\\]/],
	['npm', /[/\\](?:npm|node_modules)[/\\]/],
];

/**
 * Which install is running, from the path of the executable and of the script it
 * was started with. Both matter: a compiled binary is its own `execPath`, while
 * the npm package is a shim that node or bun runs, so only `argv[1]` names it.
 */
export function detectInstall(
	execPath: string,
	scriptPath: string,
	home: string,
	fallback: PackageManagerName = 'npm',
): Install {
	const paths = `${execPath}\n${scriptPath}`;
	if (/[/\\](?:Cellar|homebrew|linuxbrew)[/\\]/.test(paths)) return { kind: 'brew' };
	// Where the curl installer puts it; nothing else owns that directory.
	if (paths.includes(`${home}/.dune`)) return { kind: 'script' };

	for (const [manager, pattern] of MANAGER_PATHS) {
		if (pattern.test(paths)) return { kind: 'package', manager };
	}
	return { kind: 'package', manager: fallback };
}

/** The shell command that upgrades this install, ready to print and to run. */
export function upgradeCommand(install: Install): string {
	if (install.kind === 'brew') return 'brew upgrade smeltery/tap/dune';
	if (install.kind === 'script') return 'curl -fsSL https://dune.smeltery.dev/install | bash';
	return addDependencyCommand(install.manager ?? 'npm', 'dune@latest', { global: true });
}

/** What was detected, said plainly, so a wrong guess is obvious before it runs. */
const DESCRIPTION: Record<InstallKind, (install: Install) => string> = {
	brew: () => 'Updating the Homebrew install.',
	script: () => 'Re-running the install script.',
	package: (install) => `Updating the global ${install.manager ?? 'npm'} install.`,
};

/**
 * Run the upgrade, with the child's output going straight to the terminal — the
 * package managers and brew both report progress, and hiding it behind a spinner
 * of our own would only make a slow step look like a hang.
 *
 * Returns the exit code to leave with.
 */
export async function runUpgrade(
	write: (text: string) => void = (text) => process.stdout.write(text),
	run: (command: string) => Promise<number> = async (command) => {
		// No `sh` on Windows, where dune ships too.
		const shell = process.platform === 'win32' ? ['cmd', '/c'] : ['sh', '-c'];
		const child = Bun.spawn([...shell, command], { stdout: 'inherit', stderr: 'inherit' });
		return child.exited;
	},
): Promise<number> {
	const install = detectInstall(process.execPath, process.argv[1] ?? '', homedir());
	const command = upgradeCommand(install);

	write(`${DESCRIPTION[install.kind](install)}\n$ ${command}\n\n`);
	try {
		const code = await run(command);
		if (code !== 0) write(`\ndune: update failed (exit ${code})\n`);
		return code;
	} catch (error) {
		// No shell to run it with. Report the command so it can be run by hand,
		// rather than letting a spawn failure print a stack trace and exit 0.
		write(`\ndune: could not run the update — ${(error as Error).message}\n`);
		return 1;
	}
}
