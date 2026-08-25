import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, setDefaultTimeout, test } from 'bun:test';

import { git as runGit } from '../git-fixture';
import { launch, press, runCommand, until } from '../helpers';

setDefaultTimeout(10_000);

/**
 * A bare "remote" plus a clone that both pushed history the remote does not have
 * (Outgoing) and fetched history it has not merged (Incoming), so the panel's
 * two sync sections both have a real commit to list.
 */
function divergedRepo() {
	const base = mkdtempSync(join(tmpdir(), 'dune-sync-panel-'));
	const origin = join(base, 'origin.git');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);

	const clone = (name: string) => {
		const dir = join(base, name);
		execFileSync('git', ['clone', '-q', origin, dir]);
		runGit(dir, 'config', 'user.email', `${name}@example.com`);
		runGit(dir, 'config', 'user.name', name);
		return dir;
	};

	const mine = clone('mine');
	writeFileSync(join(mine, 'a.ts'), 'const a = 1\n');
	runGit(mine, 'add', '.');
	runGit(mine, 'commit', '-qm', 'first');
	runGit(mine, 'push', '-q', '-u', 'origin', 'main');

	const theirs = clone('theirs');
	writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n');
	runGit(theirs, 'add', '.');
	runGit(theirs, 'commit', '-qm', 'remote change');
	runGit(theirs, 'push', '-q');

	writeFileSync(join(mine, 'local.ts'), 'const l = 1\n');
	runGit(mine, 'add', '.');
	runGit(mine, 'commit', '-qm', 'local change');
	// Fetch without merging: origin/main moves for "remote change" while mine's
	// branch stays put, so it is behind and ahead at the same time.
	runGit(mine, 'fetch', '-q', 'origin');

	return { mine, origin };
}

test('the source control panel lists Incoming and Outgoing commits when diverged', async () => {
	const { mine } = divergedRepo();

	const t = await launch(mine);
	await runCommand(t, 'Source Control');

	const frame = t.captureCharFrame();
	expect(frame).toContain('Incoming');
	expect(frame).toContain('remote change');
	expect(frame).toContain('Outgoing');
	expect(frame).toContain('local change');
	expect(frame).toContain('· sync');
});

test('s syncs the branch: merges the incoming commit and pushes the outgoing one', async () => {
	const { mine, origin } = divergedRepo();

	const t = await launch(mine);
	await runCommand(t, 'Source Control');
	await press(t, (input) => void input.typeText('s'));

	await until(
		t,
		() =>
			execFileSync('git', ['log', '-1', '--format=%s', 'main'], { cwd: origin })
				.toString()
				.trim() === 'local change',
	);
	expect(runGit(mine, 'log', '--format=%s').toString()).toContain('remote change');
});

test('a branch with no upstream shows publish instead of sync', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dune-sync-publish-'));
	runGit(dir, 'init', '-q', '-b', 'main');
	runGit(dir, 'config', 'user.email', 'test@example.com');
	runGit(dir, 'config', 'user.name', 'Test');
	writeFileSync(join(dir, 'a.ts'), 'one\n');
	runGit(dir, 'add', '.');
	runGit(dir, 'commit', '-q', '-m', 'init');

	const t = await launch(dir);
	await runCommand(t, 'Source Control');

	expect(t.captureCharFrame()).toContain('· publish');
});
