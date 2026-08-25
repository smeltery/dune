import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '../..');
const dist = mkdtempSync(join(tmpdir(), 'dune-formula-'));
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const;
const TAGS = ['arm64_ventura', 'ventura', 'arm64_linux', 'x86_64_linux'] as const;

function run(script: string, args: string[] = []) {
	const result = Bun.spawnSync({
		cmd: [process.execPath, 'run', `scripts/${script}`, ...args],
		cwd: root,
		env: { ...process.env, DUNE_DIST: dist },
		stdout: 'pipe',
		stderr: 'pipe',
	});
	expect(result.stderr.toString()).toBe('');
	expect(result.exitCode).toBe(0);
}

test('the formula pours bottles for every Homebrew target', () => {
	for (const target of TARGETS) {
		mkdirSync(join(dist, target), { recursive: true });
		writeFileSync(join(dist, target, 'dune'), `test binary ${target}`);
	}
	run('release.ts', [...TARGETS]);
	run('formula.ts');

	const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
		version: string;
	};
	const formula = readFileSync(join(dist, 'release/dune.rb'), 'utf8');
	expect(formula).toContain(
		`root_url "https://github.com/smeltery/dune/releases/download/v${version}"`,
	);

	for (const tag of TAGS) {
		const path = join(dist, 'release', `dune-${version}.${tag}.bottle.tar.gz`);
		expect(existsSync(path)).toBe(true);
		const sum = createHash('sha256').update(readFileSync(path)).digest('hex');
		expect(formula).toContain(`sha256 cellar: :any_skip_relocation, ${tag}: "${sum}"`);

		const listed = Bun.spawnSync({ cmd: ['tar', '-tzf', path] }).stdout.toString();
		expect(listed).toContain(`dune/${version}/bin/dune`);
		expect(listed).not.toContain('._dune');
	}

	const contents = TAGS.map((tag) =>
		Bun.spawnSync({
			cmd: [
				'tar',
				'-xzOf',
				join(dist, 'release', `dune-${version}.${tag}.bottle.tar.gz`),
				`dune/${version}/bin/dune`,
			],
		}).stdout.toString(),
	);
	expect(contents).toEqual(TARGETS.map((target) => `test binary ${target}`));
	expect(existsSync(join(dist, 'bottle'))).toBe(false);
});
