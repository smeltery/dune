import { expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixture, launch, openFile, press, runCommand, settle } from './helpers';
import { git as runGit } from './git-fixture';
import type { Harness } from './helpers';

setDefaultTimeout(60_000);

function repo(committed: string) {
	const dir = mkdtempSync(join(tmpdir(), 'dune-git-commands-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(join(dir, 'a.ts'), committed);
	git('add', '.');
	git('commit', '-q', '-m', 'init');
	return dir;
}

const subject = (dir: string) =>
	execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim();
const porcelain = (dir: string) =>
	execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();

async function until(t: Harness, cond: () => boolean, ms = 5000) {
	const start = Date.now();
	while (Date.now() - start < ms) {
		try {
			if (cond()) break;
		} catch {
			// Git stash can briefly remove and rewrite a path while the UI is settling.
		}
		await settle(t, 25);
	}
	expect(cond()).toBe(true);
}

test('commit picker commits selected changes', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	writeFileSync(join(dir, 'b.ts'), 'new\n');

	const t = await launch(dir);
	await runCommand(t, 'Commit');
	const picker = t.captureCharFrame();
	expect(picker).toContain('2 of 2 files selected');
	expect(picker).toContain('[x] M a.ts');
	expect(picker).toContain('[x] U b.ts');

	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Commit message');
	await press(t, (input) => void input.typeText('add things'));
	await press(t, (input) => input.pressEnter());

	await until(t, () => subject(dir) === 'add things');
	expect(porcelain(dir)).toBe('');
});

test('commit and push commits then pushes to the remote', async () => {
	const dir = repo('one\n');
	const bare = mkdtempSync(join(tmpdir(), 'dune-commit-push-'));
	runGit(bare, 'init', '-q', '--bare');
	runGit(dir, 'remote', 'add', 'origin', bare);
	runGit(dir, 'push', '-q', '-u', 'origin', 'main');
	writeFileSync(join(dir, 'a.ts'), 'two\n');

	const t = await launch(dir);
	await runCommand(t, 'Commit & push');
	await press(t, (input) => input.pressEnter());
	await press(t, (input) => void input.typeText('push this'));
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['show', 'main:a.ts'], {
				cwd: bare,
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString() === 'two\n',
	);
	expect(subject(dir)).toBe('push this');
});

test('commit and push on a detached HEAD fails without committing', async () => {
	const dir = repo('one\n');
	runGit(dir, 'checkout', '-q', '--detach', 'HEAD');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	const before = subject(dir);

	const t = await launch(dir);
	await runCommand(t, 'Commit & push');
	await press(t, (input) => input.pressEnter());
	await press(t, (input) => void input.typeText('should not land'));
	await press(t, (input) => input.pressEnter());

	await until(t, () => t.captureCharFrame().includes('No branch to push'));
	expect(subject(dir)).toBe(before);
});

test('commit and sync pulls the remote before pushing', async () => {
	const dir = repo('one\n');
	const bare = mkdtempSync(join(tmpdir(), 'dune-commit-sync-'));
	runGit(bare, 'init', '-q', '--bare');
	runGit(dir, 'remote', 'add', 'origin', bare);
	runGit(dir, 'push', '-q', '-u', 'origin', 'main');

	const peer = mkdtempSync(join(tmpdir(), 'dune-commit-sync-peer-'));
	execFileSync('git', ['clone', '-q', '-b', 'main', bare, peer]);
	runGit(peer, 'config', 'user.email', 'test@example.com');
	runGit(peer, 'config', 'user.name', 'Test');
	writeFileSync(join(peer, 'remote.ts'), 'remote\n');
	runGit(peer, 'add', '.');
	runGit(peer, 'commit', '-q', '-m', 'remote change');
	runGit(peer, 'push', '-q');

	writeFileSync(join(dir, 'a.ts'), 'local\n');

	const t = await launch(dir);
	await runCommand(t, 'Commit & sync');
	await press(t, (input) => input.pressEnter());
	await press(t, (input) => void input.typeText('local change'));
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['show', 'main:a.ts'], {
				cwd: bare,
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString() === 'local\n' &&
			execFileSync('git', ['show', 'main:remote.ts'], {
				cwd: bare,
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString() === 'remote\n',
		10_000,
	);
});

test('commit amend replaces the last commit, prefilled with its subject', async () => {
	const dir = repo('one\n');

	const t = await launch(dir);
	await runCommand(t, 'Commit (amend)');
	expect(t.captureCharFrame()).toContain('init');
	await press(t, (input) => void input.typeText(' amended'));
	await press(t, (input) => input.pressEnter());

	await until(t, () => subject(dir) === 'init amended');
	expect(
		execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString().trim().split('\n').length,
	).toBe(1);
});

test('staged paths prefill the commit picker', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	execFileSync('git', ['add', 'a.ts'], { cwd: dir });
	writeFileSync(join(dir, 'b.ts'), 'new\n');

	const t = await launch(dir);
	await runCommand(t, 'Commit');
	const picker = t.captureCharFrame();
	expect(picker).toContain('1 of 2 files selected');
	expect(picker).toContain('[x] M a.ts');
	expect(picker).toContain('[ ] U b.ts');

	await press(t, (input) => input.pressEnter());
	await press(t, (input) => void input.typeText('staged only'));
	await press(t, (input) => input.pressEnter());

	await until(t, () => subject(dir) === 'staged only');
	expect(porcelain(dir)).toContain('?? b.ts');
	expect(porcelain(dir)).not.toContain('a.ts');
});

test('stash reverts the working tree and pop brings it back', async () => {
	const dir = repo('one\ntwo\n');
	writeFileSync(join(dir, 'a.ts'), 'CHANGED\ntwo\n');

	const t = await launch(dir);
	await runCommand(t, 'Stash changes');
	await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'one\ntwo\n');

	await runCommand(t, 'Stash pop');
	await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'CHANGED\ntwo\n');
});

test('the stash list applies a specific, non-latest stash', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'first change\n');
	runGit(dir, 'stash', 'push', '-m', 'first stash');
	writeFileSync(join(dir, 'a.ts'), 'second change\n');
	runGit(dir, 'stash', 'push', '-m', 'second stash');

	const t = await launch(dir);
	await runCommand(t, 'Stashes…');
	const frame = t.captureCharFrame();
	expect(frame).toContain('first stash');
	expect(frame).toContain('second stash');

	// The newest stash lists first; arrow down to the older one and apply it.
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressEnter());

	await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'first change\n');
	expect(
		execFileSync('git', ['stash', 'list'], { cwd: dir }).toString().split('\n').filter(Boolean)
			.length,
	).toBe(2);
});

test('backspace in the stash list drops the selected stash', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'first change\n');
	runGit(dir, 'stash', 'push', '-m', 'first stash');

	const t = await launch(dir);
	await runCommand(t, 'Stashes…');
	await press(t, (input) => input.pressBackspace());

	await until(
		t,
		() => execFileSync('git', ['stash', 'list'], { cwd: dir }).toString().trim().length === 0,
	);
});

test('rejected push offers to merge origin and push again', async () => {
	const dir = repo('one\n');
	const bare = mkdtempSync(join(tmpdir(), 'dune-rejected-push-'));
	const git = (...args: string[]) => runGit(dir, ...args);
	runGit(bare, 'init', '-q', '--bare');
	git('remote', 'add', 'origin', bare);
	git('push', '-q', '-u', 'origin', 'main');

	const peer = mkdtempSync(join(tmpdir(), 'dune-peer-'));
	execFileSync('git', ['clone', '-q', '-b', 'main', bare, peer]);
	runGit(peer, 'config', 'user.email', 'test@example.com');
	runGit(peer, 'config', 'user.name', 'Test');
	writeFileSync(join(peer, 'remote.ts'), 'remote\n');
	runGit(peer, 'add', '.');
	runGit(peer, 'commit', '-q', '-m', 'remote change');
	runGit(peer, 'push', '-q');

	writeFileSync(join(dir, 'local.ts'), 'local\n');
	git('add', '.');
	git('commit', '-q', '-m', 'local change');

	const t = await launch(dir);
	await runCommand(t, 'Push');
	await until(t, () => t.captureCharFrame().includes('Merge origin'));
	expect(t.captureCharFrame()).toContain('merge and push');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['show', 'main:local.ts'], {
				cwd: bare,
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString() === 'local\n' &&
			execFileSync('git', ['show', 'main:remote.ts'], {
				cwd: bare,
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString() === 'remote\n',
		10_000,
	);
});

test('branch switch picker checks out the selected branch', async () => {
	const dir = repo('main\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'a.ts'), 'feature\n');
	git('commit', '-qam', 'feature');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Switch branch');
	expect(t.captureCharFrame()).toContain('Switch to branch');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['branch', '--show-current'], { cwd: dir }).toString().trim() ===
			'feature',
	);
	expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('feature\n');
});

test('branch pickers filter choices as they are typed', async () => {
	const dir = repo('main\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'alpha');
	git('switch', '-q', 'main');
	git('switch', '-q', '-c', 'zebra');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Switch branch');
	expect(t.captureCharFrame()).toContain('alpha');
	expect(t.captureCharFrame()).toContain('zebra');

	await press(t, (input) => void input.typeText('ze'));
	const filtered = t.captureCharFrame();
	expect(filtered).toContain('filter: ze');
	expect(filtered).toContain('zebra');
	expect(filtered).not.toContain('alpha');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['branch', '--show-current'], { cwd: dir }).toString().trim() === 'zebra',
	);
});

test('new branch prompt creates and checks out a branch', async () => {
	const dir = repo('main\n');

	const t = await launch(dir);
	await runCommand(t, 'New branch');
	expect(t.captureCharFrame()).toContain('New branch name');
	await press(t, (input) => void input.typeText('work'));
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['branch', '--show-current'], { cwd: dir }).toString().trim() === 'work',
	);
});

test('merge branch command merges the selected branch after confirmation', async () => {
	const dir = repo('main\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'feature.ts'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Merge branch');
	expect(t.captureCharFrame()).toContain('Merge into current branch');
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Merge branch');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim() ===
			'feature',
	);
	expect(readFileSync(join(dir, 'feature.ts'), 'utf8')).toBe('feature\n');
});

test('branch commit comparison opens a selected commit diff', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	git('commit', '-qam', 'change a');
	const shortOid = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir })
		.toString()
		.trim();

	const t = await launch(dir);
	await runCommand(t, 'Compare branch commits');
	expect(t.captureCharFrame()).toContain('Compare commits against branch');
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('change a');
	await press(t, (input) => input.pressEnter());

	const frame = t.captureCharFrame();
	expect(frame).toContain(`${shortOid} change a by Test`);
	expect(frame).toContain('- one');
	expect(frame).toContain('+ two');
});

test("file history lists the open file's past commits and opens one scoped to it", async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	runGit(dir, 'commit', '-qam', 'change to two');
	writeFileSync(join(dir, 'a.ts'), 'three\n');
	runGit(dir, 'commit', '-qam', 'change to three');
	const middleOid = execFileSync('git', ['log', '--format=%h', '--grep=change to two'], {
		cwd: dir,
	})
		.toString()
		.trim();

	const t = await launch(dir);
	await openFile(t, 'a.ts');
	await runCommand(t, 'File history');
	const frame = t.captureCharFrame();
	expect(frame).toContain('File history');
	expect(frame).toContain('change to two');
	expect(frame).toContain('change to three');

	// Newest lists first; arrow down to the older commit and open its diff.
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => input.pressEnter());

	const diffFrame = t.captureCharFrame();
	expect(diffFrame).toContain(`${middleOid} change to two`);
	expect(diffFrame).toContain('- one');
	expect(diffFrame).toContain('+ two');
});

test('source control comparison opens commits for its base', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'a.ts'), 'two\n');
	git('commit', '-qam', 'change a');

	const t = await launch(dir);
	await runCommand(t, 'Compare against branch');
	await press(t, (input) => input.pressEnter());
	await runCommand(t, 'Source Control');
	await press(t, (input) => void input.typeText('c'));
	expect(t.captureCharFrame()).toContain('change a');
});

test('source control comparison filters changed files', async () => {
	const dir = repo('one\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'feature');
	writeFileSync(join(dir, 'auth.ts'), 'export const auth = true\n');
	writeFileSync(join(dir, 'readme.md'), '# docs\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feature files');

	const t = await launch(dir);
	await runCommand(t, 'Compare against branch');
	await press(t, (input) => input.pressEnter());
	await runCommand(t, 'Source Control');
	expect(t.captureCharFrame()).toContain('readme.md');
	await press(t, (input) => void input.typeText('/auth'));
	const frame = t.captureCharFrame();
	expect(frame).toContain('filter auth');
	expect(frame).toContain('auth.ts');
	expect(frame).not.toContain('readme.md');
});

test('source control panel marks renamed files distinctly', async () => {
	const dir = repo('one\n');
	execFileSync('git', ['mv', 'a.ts', 'renamed.ts'], { cwd: dir });

	const t = await launch(dir);
	await runCommand(t, 'Source Control');

	const row = t
		.captureCharFrame()
		.split('\n')
		.find((line) => line.includes('renamed.ts'))!;
	expect(row).toContain('R');
});

test('discarding a modified file restores it from HEAD', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'a.ts'), 'two\n');

	const t = await launch(dir);
	await runCommand(t, 'Source Control');
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => void input.typeText('d'));
	expect(t.captureCharFrame()).toContain('Discard changes');
	await press(t, (input) => input.pressEnter());

	await until(t, () => readFileSync(join(dir, 'a.ts'), 'utf8') === 'one\n');
});

test('discarding an untracked file deletes it', async () => {
	const dir = repo('one\n');
	writeFileSync(join(dir, 'b.ts'), 'new\n');

	const t = await launch(dir);
	await runCommand(t, 'Source Control');
	await press(t, (input) => input.pressArrow('down'));
	await press(t, (input) => void input.typeText('d'));
	expect(t.captureCharFrame()).toContain('Delete');
	await press(t, (input) => input.pressEnter());

	await until(t, () => !existsSync(join(dir, 'b.ts')));
});

test('rename branch command renames the selected local branch', async () => {
	const dir = repo('main\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'work');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Rename branch');
	expect(t.captureCharFrame()).toContain('Rename branch');
	await press(t, (input) => void input.typeText('work'));
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Rename branch to');
	await press(t, (input) => {
		input.pressBackspace();
		input.pressBackspace();
		input.pressBackspace();
		input.pressBackspace();
		input.typeText('done');
	});
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/done'], { cwd: dir })
				.toString()
				.trim() !== '',
	);
});

test('delete branch command deletes the selected local branch after confirmation', async () => {
	const dir = repo('main\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'work');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Delete branch');
	expect(t.captureCharFrame()).toContain('Delete branch');
	await press(t, (input) => void input.typeText('work'));
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Delete branch');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() => execFileSync('git', ['branch', '--list', 'work'], { cwd: dir }).toString().trim() === '',
	);
});

test('force delete branch command deletes an unmerged branch after confirmation', async () => {
	const dir = repo('main\n');
	const git = (...args: string[]) => runGit(dir, ...args);
	git('switch', '-q', '-c', 'work');
	writeFileSync(join(dir, 'work.ts'), 'work\n');
	git('add', '.');
	git('commit', '-q', '-m', 'work');
	git('switch', '-q', 'main');

	const t = await launch(dir);
	await runCommand(t, 'Delete branch (force)');
	expect(t.captureCharFrame()).toContain('Delete branch (force)');
	await press(t, (input) => void input.typeText('work'));
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Delete branch (force)');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() => execFileSync('git', ['branch', '--list', 'work'], { cwd: dir }).toString().trim() === '',
	);
});

test('create tag command tags HEAD', async () => {
	const dir = repo('one\n');

	const t = await launch(dir);
	await runCommand(t, 'Create tag');
	expect(t.captureCharFrame()).toContain('New tag name');
	await press(t, (input) => void input.typeText('v1.0.0'));
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['tag', '--list', 'v1.0.0'], { cwd: dir }).toString().trim() === 'v1.0.0',
	);
});

test('delete tag command removes the selected tag', async () => {
	const dir = repo('one\n');
	runGit(dir, 'tag', 'v1.0.0');

	const t = await launch(dir);
	await runCommand(t, 'Delete tag');
	expect(t.captureCharFrame()).toContain('v1.0.0');
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Delete tag');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() => execFileSync('git', ['tag', '--list', 'v1.0.0'], { cwd: dir }).toString().trim() === '',
	);
});

test('add remote command asks for a name then a URL', async () => {
	const dir = repo('one\n');

	const t = await launch(dir);
	await runCommand(t, 'Add remote');
	expect(t.captureCharFrame()).toContain('New remote name');
	await press(t, (input) => void input.typeText('upstream'));
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Remote URL for upstream');
	await press(t, (input) => void input.typeText('https://example.test/repo.git'));
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() =>
			execFileSync('git', ['remote', 'get-url', 'upstream'], { cwd: dir }).toString().trim() ===
			'https://example.test/repo.git',
	);
});

test('remove remote command removes the selected remote', async () => {
	const dir = repo('one\n');
	runGit(dir, 'remote', 'add', 'upstream', 'https://example.test/repo.git');

	const t = await launch(dir);
	await runCommand(t, 'Remove remote');
	expect(t.captureCharFrame()).toContain('upstream');
	await press(t, (input) => input.pressEnter());
	expect(t.captureCharFrame()).toContain('Remove remote');
	await press(t, (input) => input.pressEnter());

	await until(
		t,
		() => !execFileSync('git', ['remote'], { cwd: dir }).toString().includes('upstream'),
	);
});

test('outside a repository git commands warn instead of mutating', async () => {
	const t = await launch(fixture({ 'a.ts': 'x\n' }));
	await runCommand(t, 'Commit');
	await until(t, () => t.captureCharFrame().includes('Not a git repository'));
});
