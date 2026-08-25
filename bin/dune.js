#!/usr/bin/env node
/**
 * Hands off to the platform binary, fetching it first if it is not here yet.
 *
 * This shim is the only JavaScript dune ships: the editor is a self-contained
 * executable that needs neither Bun nor node_modules. See binary.mjs for why the
 * executable arrives from the GitHub release rather than from the package registry.
 */
import { spawnSync } from 'node:child_process';

import { exe, fetchBinary, findBinary, supported, target, version } from './binary.mjs';

let binary = findBinary();

if (!binary) {
	if (!supported) {
		process.stderr.write(`dune: no binary is published for ${target}.\n`);
		process.exit(1);
	}
	// Install skipped its scripts, or had no network then. Say so — this takes seconds
	// and silence would look like a hang.
	process.stderr.write(`dune: fetching the ${target} binary for ${version}…\n`);
	binary = await fetchBinary();
}

if (!binary) {
	process.stderr.write(
		`dune: could not fetch the ${target} binary for ${version}.\n` +
			`Download dune-${target} from https://github.com/smeltery/dune/releases/tag/v${version}\n` +
			`and put it on your PATH as ${exe}, or install with:\n` +
			`  curl -fsSL https://dune.smeltery.dev/install | bash\n`,
	);
	process.exit(1);
}

const { status, signal, error } = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });

if (error) {
	process.stderr.write(`dune: could not run ${binary}: ${error.message}\n`);
	process.exit(1);
}
// Re-raise rather than exit(0): a caller checking why dune stopped has to see the
// signal, and $? for a signalled child is 128 + signum, not 0.
if (signal) process.kill(process.pid, signal);
process.exit(status ?? 1);
