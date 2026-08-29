import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NODE_BIN = ['node_modules', '.bin'];
const NATIVE_TYPESCRIPT_MAJOR = 7;

function nodeBin(rootDir: string): string {
	return join(rootDir, ...NODE_BIN);
}

export function typescriptMajor(rootDir: string): number | null {
	try {
		const raw = readFileSync(join(rootDir, 'node_modules', 'typescript', 'package.json'), 'utf8');
		const version = (JSON.parse(raw) as { version?: unknown }).version;
		if (typeof version !== 'string') return null;
		const major = Number.parseInt(version, 10);
		return Number.isNaN(major) ? null : major;
	} catch {
		return null;
	}
}

export function projectCommand(id: string, command: string[], rootDir: string): string[] | null {
	if (id === 'typescript') {
		const major = typescriptMajor(rootDir);
		if (major !== null && major >= NATIVE_TYPESCRIPT_MAJOR) {
			const tsc = join(nodeBin(rootDir), 'tsc');
			if (existsSync(tsc)) return [tsc, '--lsp', '--stdio'];
		}
	}

	const [program, ...args] = command;
	if (!program) return null;
	const local = join(nodeBin(rootDir), program);
	return existsSync(local) ? [local, ...args] : null;
}

/** The npm package that teaches a tsserver to read a single-file component. */
export const VUE_TYPESCRIPT_PLUGIN = '@vue/typescript-plugin';

/**
 * A directory a tsserver can resolve `@vue/typescript-plugin` from: the
 * project's own copy first, then dune's install prefix. Null when neither holds
 * one — better than naming a path the plugin is not at.
 *
 * A *prefix*, not the package directory: tsserver resolves a plugin the way
 * node resolves a module, so what it wants is the directory `node_modules` sits in.
 */
export function vuePluginLocation(rootDir: string, installRoot: string): string | null {
	const prefixes = [rootDir, installRoot];
	return (
		prefixes.find((prefix) => existsSync(join(prefix, 'node_modules', VUE_TYPESCRIPT_PLUGIN))) ??
		null
	);
}
