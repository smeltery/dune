import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { saveSession } from '../src/core/session';
import { resolvedPath, shortenHome, workspaceEntries } from '../src/core/workspaces';
import { fixture } from './helpers';
import { git } from './git-fixture';

test('workspace entries include worktrees, recents and the current folder first', () => {
	const repo = fixture({ 'a.txt': 'a\n' });
	git(repo, 'init');
	git(repo, 'config', 'user.email', 'test@example.com');
	git(repo, 'config', 'user.name', 'Test User');
	git(repo, 'add', '.');
	git(repo, 'commit', '-m', 'initial');
	git(repo, 'branch', 'feature');
	const other = mkdtempSync(join(tmpdir(), 'dune-worktree-'));
	git(repo, 'worktree', 'add', other, 'feature');

	const recent = fixture({ 'b.txt': 'b\n' });
	saveSession(recent, { tabs: [], activePath: null, expanded: [], sidebar: true }, 1);

	const entries = workspaceEntries(repo, [repo]);
	expect(entries[0]?.path).toBe(resolvedPath(repo));
	expect(
		entries.some((entry) => entry.path === resolvedPath(other) && entry.branch === 'feature'),
	).toBe(true);
	expect(
		entries.some((entry) => entry.path === resolvedPath(recent) && entry.source === 'recent'),
	).toBe(true);
});

test('shortenHome keeps unrelated paths intact', () => {
	mkdirSync('/tmp/dune-home', { recursive: true });
	expect(shortenHome('/tmp/dune-home/project', '/tmp/dune-home')).toBe('~/project');
	expect(shortenHome('/tmp/other/project', '/tmp/dune-home')).toBe('/tmp/other/project');
});
