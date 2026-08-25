import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';

import { binaryName } from '../build';
import type { TargetName } from '../build';

/**
 * Packages the binaries built by build.ts:
 *   dist/npm/dune/              the GitHub Packages package, a shim holding no binary
 *   dist/release/dune-<target>.{zip,tar.gz}   the binaries themselves
 *
 * The archives are the only place a binary is distributed: both the install script and
 * the package shim pull them from the GitHub release. There used to be a package per
 * platform, listed as optional dependencies, which is the usual arrangement. One
 * scoped package keeps release permissions simple: GITHUB_TOKEN can publish to
 * GitHub Packages for this repository and upload the matching release assets.
 *
 * So the release must be uploaded *before* the package is published: an install
 * landing in the gap would find no asset to fetch.
 *
 * Run after `bun run build <targets>`; only targets with a built binary are packaged.
 */
const DIST_DIR = process.env.DUNE_DIST ?? './dist';
const NPM_DIR = `${DIST_DIR}/npm`;
const RELEASE_DIR = `${DIST_DIR}/release`;
const NOTICE_FILES = [
	'THIRD_PARTY_NOTICES.md',
	'third_party/PDFIUM_LICENSE',
	'third_party/HYZYLA_PDFIUM_LICENSE',
] as const;

const { version } = await Bun.file('./package.json').json();

const ALL_TARGETS: TargetName[] = [
	'darwin-arm64',
	'darwin-x64',
	'linux-arm64',
	'linux-x64',
	'linux-x64-baseline',
	'windows-x64',
	'windows-x64-baseline',
];

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const publish = process.argv.includes('--publish');

const targets = (requested.length ? (requested as TargetName[]) : ALL_TARGETS).filter((target) =>
	existsSync(`${DIST_DIR}/${target}/${binaryName(target)}`),
);

if (targets.length === 0) {
	process.stderr.write('no built binaries in dist/ — run `bun run build` first\n');
	process.exit(1);
}

await rm(NPM_DIR, { recursive: true, force: true });
await rm(RELEASE_DIR, { recursive: true, force: true });
await mkdir(RELEASE_DIR, { recursive: true });

for (const target of targets) {
	const [os] = target.split('-') as [string, string];
	const exe = binaryName(target);

	const archive = `${RELEASE_DIR}/dune-${target}.${os === 'linux' ? 'tar.gz' : 'zip'}`;
	const from = `${DIST_DIR}/${target}`;
	if (os === 'linux') {
		await Bun.$`tar -czf ${archive} -C ${from} ${exe} -C ${process.cwd()} ${NOTICE_FILES}`;
	} else if (Bun.which('zip')) {
		await Bun.$`zip -qj ${archive} ${`${from}/${exe}`} ${NOTICE_FILES}`;
	} else {
		// Windows has no `zip`, but its bsdtar picks the format from the extension.
		await Bun.$`tar -a -cf ${archive} -C ${from} ${exe} -C ${process.cwd()} ${NOTICE_FILES}`;
	}
	process.stdout.write(`packaged ${target} -> ${archive}\n`);
}

const rootDir = `${NPM_DIR}/dune`;
await mkdir(`${rootDir}/bin`, { recursive: true });
await cp('./bin/dune.js', `${rootDir}/bin/dune.js`);
await cp('./bin/postinstall.mjs', `${rootDir}/bin/postinstall.mjs`);
await cp('./bin/binary.mjs', `${rootDir}/bin/binary.mjs`);
await cp('./README.md', `${rootDir}/README.md`);
await cp('./THIRD_PARTY_NOTICES.md', `${rootDir}/THIRD_PARTY_NOTICES.md`);
await cp('./third_party/PDFIUM_LICENSE', `${rootDir}/PDFIUM_LICENSE`);
await cp('./third_party/HYZYLA_PDFIUM_LICENSE', `${rootDir}/HYZYLA_PDFIUM_LICENSE`);

const rootPkg = await Bun.file('./package.json').json();
await Bun.write(
	`${rootDir}/package.json`,
	`${JSON.stringify(
		{
			...rootPkg,
			// The repo itself is private so a stray publish at the root cannot ship a shim
			// with no binaries behind it; the staged copy is the publishable one.
			'//private': undefined,
			private: undefined,
			bin: { dune: './bin/dune.js' },
			files: ['bin', 'THIRD_PARTY_NOTICES.md', 'PDFIUM_LICENSE', 'HYZYLA_PDFIUM_LICENSE'],
			// Nothing to build or check here; the one script fetches the binary so that
			// the first run does not have to.
			scripts: { postinstall: 'node ./bin/postinstall.mjs' },
			// Node ships `fetch` from 18, which is what pulls the binary down.
			engines: { node: '>=18' },
			os: ['darwin', 'linux', 'win32'],
			cpu: ['arm64', 'x64'],
			devDependencies: undefined,
			// Every dependency is compiled into the binary, and the binary comes from the
			// GitHub release — so the published package holds nothing but the shim.
			dependencies: undefined,
		},
		null,
		2,
	)}\n`,
);
process.stdout.write(`packaged dune -> ${rootDir}\n`);

if (publish) {
	if (targets.length !== ALL_TARGETS.length) {
		const missing = ALL_TARGETS.filter((t) => !targets.includes(t));
		process.stderr.write(
			`refusing to publish without every platform: missing ${missing.join(', ')}\n`,
		);
		process.exit(1);
	}
	// npm refuses a prerelease without an explicit tag, and rightly so: `1.0.0-beta.1`
	// on `latest` would become what every plain install gets. The
	// identifier is the tag, so a beta lands on `beta` and is installed on purpose.
	const tag = /-([a-z][\da-z]*)/i.exec(version)?.[1] ?? 'latest';

	/**
	 * A version already on the registry is skipped rather than retried: npm registries
	 * forbid republishing, so without this a rerun of a release that got as far as
	 * package publication — to fix a later step — could never succeed.
	 */
	const onRegistry = async (name: string) =>
		(
			await Bun.$`npm view ${name}@${version} version --registry=https://npm.pkg.github.com`
				.quiet()
				.nothrow()
		).exitCode === 0;

	if (await onRegistry('@smeltery/dune')) {
		process.stdout.write(`@smeltery/dune@${version} is already published — skipped\n`);
	} else {
		await Bun.$`npm publish --access public --tag ${tag} --registry=https://npm.pkg.github.com`.cwd(
			rootDir,
		);
	}
}
