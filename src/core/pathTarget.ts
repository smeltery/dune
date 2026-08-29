import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';

const EXTENSIONS = [
	'',
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.vue',
	'.svelte',
	'.astro',
	'.json',
	'.css',
	'.scss',
	'.md',
];
const INDEX_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.vue',
	'.svelte',
	'.astro',
	'.json',
	'.md',
];
const BARE_CHARS = /[A-Za-z0-9_@~./:$+-]/;

export function pathTokenAt(line: string, col: number): string | null {
	const at = Math.max(0, Math.min(col, line.length));
	for (const quote of [`'`, '"', '`']) {
		const start = line.lastIndexOf(quote, at);
		if (start < 0) continue;
		const end = line.indexOf(quote, start + 1);
		if (end >= at && end > start + 1) return line.slice(start + 1, end);
	}

	let start = at;
	while (start > 0 && BARE_CHARS.test(line[start - 1]!)) start--;
	let end = at;
	while (end < line.length && BARE_CHARS.test(line[end]!)) end++;
	const token = line.slice(start, end).replace(/[.,;:!?]+$/, '');
	return token.length > 0 ? token : null;
}

export function resolvePathToken(token: string, fromDir: string, rootDir: string): string | null {
	if (!isIgnoredSpecifier(token)) {
		if (isPathLike(token)) {
			for (const base of baseCandidates(token, fromDir, rootDir)) {
				const found = firstExisting(expandFileCandidates(base));
				if (found) return found;
			}
		}
		for (const base of aliasCandidates(token, rootDir)) {
			const found = firstExisting(expandFileCandidates(base));
			if (found) return found;
		}
	}
	return null;
}

function isIgnoredSpecifier(token: string) {
	return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(token) || token.startsWith('#');
}

function isPathLike(token: string) {
	return (
		token.startsWith('.') ||
		token.startsWith('/') ||
		token.startsWith('~') ||
		token.includes('/') ||
		token.includes('\\')
	);
}

function baseCandidates(token: string, fromDir: string, rootDir: string) {
	const normalized = token.replaceAll('\\', '/');
	if (normalized.startsWith('~/')) return [join(homedir(), normalized.slice(2))];
	if (isAbsolute(normalized)) return [normalized, join(rootDir, normalized.slice(1))];
	if (normalized.startsWith('./') || normalized.startsWith('../'))
		return [resolve(fromDir, normalized)];
	return [resolve(rootDir, normalized)];
}

function expandFileCandidates(path: string) {
	const base = normalize(path);
	const candidates = EXTENSIONS.map((ext) => `${base}${ext}`);
	if (existsSync(base) && statSync(base).isDirectory()) {
		candidates.push(...INDEX_EXTENSIONS.map((ext) => join(base, `index${ext}`)));
	}
	return candidates;
}

function firstExisting(candidates: string[]) {
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

type TsConfig = {
	compilerOptions?: {
		baseUrl?: string;
		paths?: Record<string, string[]>;
	};
	extends?: string;
};

function aliasCandidates(token: string, rootDir: string) {
	const config = readTsConfig(rootDir);
	if (!config) return [];
	const baseUrl = config.compilerOptions?.baseUrl ?? '.';
	const baseDir = resolve(rootDir, baseUrl);
	const candidates: string[] = [];
	for (const [pattern, targets] of Object.entries(config?.compilerOptions?.paths ?? {})) {
		const match = aliasMatch(pattern, token);
		if (match === null) continue;
		for (const target of targets) candidates.push(resolve(baseDir, target.replace('*', match)));
	}
	if (config?.compilerOptions?.baseUrl) candidates.push(resolve(baseDir, token));
	return candidates;
}

function aliasMatch(pattern: string, token: string) {
	const star = pattern.indexOf('*');
	if (star < 0) return pattern === token ? '' : null;
	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);
	if (!token.startsWith(prefix) || !token.endsWith(suffix)) return null;
	return token.slice(prefix.length, token.length - suffix.length);
}

function readTsConfig(rootDir: string): TsConfig | null {
	for (const name of ['tsconfig.json', 'jsconfig.json']) {
		const path = join(rootDir, name);
		if (!existsSync(path)) continue;
		return parseConfigWithExtends(path, new Set());
	}
	return null;
}

function parseConfigWithExtends(path: string, seen: Set<string>): TsConfig | null {
	if (seen.has(path)) return null;
	seen.add(path);
	let own: TsConfig;
	try {
		own = JSON.parse(stripJsonCommentsAndTrailingCommas(readFileSync(path, 'utf8'))) as TsConfig;
	} catch {
		return null;
	}
	const parent = resolveExtends(path, own.extends, seen);
	return {
		...parent,
		...own,
		compilerOptions: {
			...parent?.compilerOptions,
			...own.compilerOptions,
		},
	};
}

function resolveExtends(path: string, specifier: string | undefined, seen: Set<string>) {
	if (!specifier) return null;
	const parentPath = specifier.endsWith('.json') ? specifier : `${specifier}.json`;
	if (!parentPath.startsWith('.') && !isAbsolute(parentPath)) return null;
	return parseConfigWithExtends(resolve(dirname(path), parentPath), seen);
}

function stripJsonCommentsAndTrailingCommas(input: string) {
	return input
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1')
		.replace(/,\s*([}\]])/g, '$1');
}
