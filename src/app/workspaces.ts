import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

import { isDirectory } from '../core/fs';
import { resolvedPath, workspaceEntries } from '../core/workspaces';
import type { Prompt } from './types';

const expandHome = (path: string): string =>
	path === '~' || path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path;

export function createWorkspaces(deps: {
	rootDir: string;
	repos: () => readonly string[];
	dirtyPaths: () => string[];
	setPrompt: (prompt: Prompt) => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	open?: (dir: string) => void;
}) {
	const pick = () => {
		if (!deps.open) return deps.say('This dune cannot switch workspaces', 'warn');
		deps.setPrompt({
			kind: 'workspacePick',
			entries: workspaceEntries(deps.rootDir, deps.repos()),
		});
	};
	const openPrompt = () => {
		if (!deps.open) return deps.say('This dune cannot switch workspaces', 'warn');
		deps.setPrompt({ kind: 'workspaceOpen' });
	};
	const switchTo = (dir: string, discardUnsaved = false) => {
		if (!deps.open) return deps.say('This dune cannot switch workspaces', 'warn');
		const at = resolve(deps.rootDir, expandHome(dir.trim()));
		if (!isDirectory(at)) return deps.say(`Not a folder: ${dir}`, 'error');
		if (resolvedPath(at) === resolvedPath(deps.rootDir)) {
			return deps.say(`${basename(at)} is already open`);
		}
		const dirty = deps.dirtyPaths();
		if (!discardUnsaved && dirty.length > 0) {
			return deps.setPrompt({
				kind: 'workspaceDirty',
				dir: at,
				names: dirty.map((path) => basename(path)),
			});
		}
		deps.open(at);
	};
	return { pick, openPrompt, switchTo };
}
