import { run } from '../process';
import type { ProcessResult } from '../process';

export type ComparisonFileStatus =
	| 'added'
	| 'modified'
	| 'deleted'
	| 'renamed'
	| 'copied'
	| 'typeChanged';

export interface ComparisonRef {
	name: string;
	oid: string;
}

export interface ComparisonFile {
	path: string;
	oldPath: string | null;
	status: ComparisonFileStatus;
	/** `R100`, `C75`: how much of the old file the new one still is. */
	similarity: number | null;
	binary: boolean;
	additions: number | null;
	deletions: number | null;
	oldOid: string | null;
	newOid: string | null;
}

export interface ComparisonCommit {
	oid: string;
	shortOid: string;
	subject: string;
	authorName: string;
	authorEmail: string;
	authoredAt: string;
	parents: string[];
}

export interface ComparisonStats {
	files: number;
	additions: number;
	deletions: number;
	binaryFiles: number;
}

export interface ComparisonIdentity {
	base: ComparisonRef;
	compare: ComparisonRef;
	mergeBase: string;
	ahead: number;
	behind: number;
}

export interface BranchComparison extends ComparisonIdentity {
	files: ComparisonFile[];
	commits: ComparisonCommit[];
	stats: ComparisonStats;
}

export type ComparisonFailure =
	| 'notRepository'
	| 'detachedHead'
	| 'unbornBranch'
	| 'invalidBase'
	| 'invalidCompare'
	| 'noMergeBase'
	| 'gitError'
	| 'timeout';

export type ComparisonResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: ComparisonFailure; detail: string };

export type ComparisonContent =
	| { binary: true }
	| { binary: false; oldText: string; newText: string };

export interface ComparisonCommitDetail {
	commit: ComparisonCommit;
	files: ComparisonFile[];
	stats: ComparisonStats;
}

/** As in core/git.ts: `spawnSync`'s 1 MB default would silently drop files. */
const MAX_OUTPUT = 128 * 1024 * 1024;

function git(cwd: string, args: string[], timeout = 10_000): Promise<ProcessResult> {
	return run('git', args, { cwd, timeout, maxOutput: MAX_OUTPUT });
}

function fail(reason: ComparisonFailure, detail: string): ComparisonResult<never> {
	return { ok: false, reason, detail };
}

function failed(result: ProcessResult, fallback: string): ComparisonResult<never> {
	if (result.timedOut) return fail('timeout', `${fallback} timed out`);
	if (result.overflow) return fail('gitError', `${fallback} produced too much output`);
	return fail('gitError', result.stderr.trim() || fallback);
}

/** A non-zero exit git chose, as opposed to a kill or a spawn failure. */
const refused = (result: ProcessResult) =>
	result.status !== null && result.status !== 0 && !result.timedOut && !result.overflow;

/**
 * Resolve the two branch tips and their history relationship before any file
 * metadata is loaded. Explicit OIDs make every later query a stable snapshot
 * even if a ref moves while it is running.
 */
export async function resolveComparison(
	cwd: string,
	baseName: string,
	compareName?: string,
): Promise<ComparisonResult<ComparisonIdentity>> {
	if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'], 3000)).stdout.trim() !== 'true') {
		return fail('notRepository', 'Not a git repository');
	}

	let compare = compareName;
	if (!compare) {
		const symbolic = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 3000);
		if (symbolic.status !== 0) {
			return fail('detachedHead', 'Branch comparison needs a checked-out branch');
		}
		compare = symbolic.stdout.trim();
	}

	const [baseRun, compareRun] = await Promise.all([
		git(cwd, ['rev-parse', '--verify', `${baseName}^{commit}`]),
		git(cwd, ['rev-parse', '--verify', `${compare}^{commit}`]),
	]);
	if (compareRun.status !== 0) {
		if (!refused(compareRun)) return failed(compareRun, `Could not resolve ${compare}`);
		return compareName
			? fail('invalidCompare', `Compare branch "${compare}" does not exist`)
			: fail('unbornBranch', `Branch "${compare}" has no commits yet`);
	}
	if (baseRun.status !== 0) {
		if (!refused(baseRun)) return failed(baseRun, `Could not resolve ${baseName}`);
		return fail('invalidBase', `Base branch "${baseName}" does not exist`);
	}

	const baseOid = baseRun.stdout.trim();
	const compareOid = compareRun.stdout.trim();
	const mergeBase = await git(cwd, ['merge-base', baseOid, compareOid]);
	if (mergeBase.status !== 0) {
		if (!refused(mergeBase)) return failed(mergeBase, 'Could not find the merge base');
		return fail('noMergeBase', 'The branches have no common ancestor');
	}

	const counts = await git(cwd, [
		'rev-list',
		'--left-right',
		'--count',
		`${baseOid}...${compareOid}`,
	]);
	if (counts.status !== 0) return failed(counts, 'Could not count branch commits');
	const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map(Number);

	return {
		ok: true,
		value: {
			base: { name: baseName, oid: baseOid },
			compare: { name: compare, oid: compareOid },
			mergeBase: mergeBase.stdout.trim(),
			ahead,
			behind,
		},
	};
}

const COMPARISON_STATUS: Record<string, ComparisonFileStatus | undefined> = {
	A: 'added',
	M: 'modified',
	D: 'deleted',
	R: 'renamed',
	C: 'copied',
	T: 'typeChanged',
};

const pairKey = (oldPath: string | null, path: string) => `${oldPath ?? ''}\0${path}`;

const COMMIT_FORMAT = '%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P';
const COMMIT_FIELDS = 7;

/** `git log -z --format=COMMIT_FORMAT` output: seven NUL-separated fields each. */
function parseCommits(text: string): ComparisonCommit[] | null {
	const fields = text.split('\0');
	if (fields.at(-1) === '') fields.pop();
	if (fields.length % COMMIT_FIELDS !== 0) return null;
	const commits: ComparisonCommit[] = [];
	for (let at = 0; at < fields.length; at += COMMIT_FIELDS) {
		commits.push({
			oid: fields[at]!,
			shortOid: fields[at + 1]!,
			subject: fields[at + 2]!,
			authorName: fields[at + 3]!,
			authorEmail: fields[at + 4]!,
			authoredAt: fields[at + 5]!,
			parents: fields[at + 6]!.split(' ').filter(Boolean),
		});
	}
	return commits;
}

/** git's own name for "nothing", so a root commit needs no special case. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Both halves of `changedFiles` need these, and must agree on them. */
const RENAMES = ['--find-renames', '--find-copies'];

interface LineTotals {
	binary: boolean;
	additions: number | null;
	deletions: number | null;
}

/** All-zero is git's "this side does not exist", not an object to read. */
const blobOid = (field: string | undefined) => (field && !/^0+$/.test(field) ? field : null);

/**
 * `--numstat -z` totals, keyed by path pair. A record is `adds\tdels\tpath`,
 * except for a rename or a copy, whose path field is empty and whose two paths
 * follow as records of their own. Null if a record is truncated — every parse
 * here refuses partial output rather than dropping a row, because a dropped row
 * would read as "this file did not change".
 */
function parseNumstat(text: string): Map<string, LineTotals> | null {
	const totals = new Map<string, LineTotals>();
	const records = text.split('\0');
	if (records.at(-1) === '') records.pop();
	for (let at = 0; at < records.length; at++) {
		const record = records[at]!;
		const firstTab = record.indexOf('\t');
		const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1);
		if (secondTab < 0) return null;
		const inlinePath = record.slice(secondTab + 1);
		let oldPath: string | null = null;
		let path = inlinePath;
		if (inlinePath.length === 0) {
			if (at + 2 >= records.length) return null;
			oldPath = records[at + 1]!;
			path = records[at + 2]!;
			at += 2;
		}
		const count = (value: string) => (value === '-' ? null : Number(value));
		const additions = count(record.slice(0, firstTab));
		const deletions = count(record.slice(firstTab + 1, secondTab));
		totals.set(pairKey(oldPath, path), {
			// git spends a `-` on each count of a file it will not diff as text.
			binary: additions === null || deletions === null,
			additions,
			deletions,
		});
	}
	return totals;
}

type RawFile = Omit<ComparisonFile, keyof LineTotals>;

/**
 * `--raw -z` records: `:oldMode newMode oldOid newOid STATUS`, then the path —
 * or two paths when the status is a rename or a copy. `-z` is what keeps a path
 * containing a tab, a newline or a non-ASCII byte intact; the default output
 * C-quotes those, and unquoting them by hand loses the original spelling.
 */
function parseRaw(text: string): RawFile[] | null {
	const files: RawFile[] = [];
	const tokens = text.split('\0');
	if (tokens.at(-1) === '') tokens.pop();
	for (let at = 0; at < tokens.length; at++) {
		const header = tokens[at]!;
		if (!header.startsWith(':')) return null;
		const fields = header.slice(1).split(' ');
		const spec = fields[4] ?? '';
		const status = COMPARISON_STATUS[spec[0] ?? ''];
		if (!status) return null;
		const pathCount = status === 'renamed' || status === 'copied' ? 2 : 1;
		if (at + pathCount > tokens.length - 1) return null;
		const paths = tokens.slice(at + 1, at + 1 + pathCount);
		at += pathCount;
		files.push({
			path: paths.at(-1)!,
			oldPath: pathCount === 2 ? paths[0]! : null,
			status,
			similarity: spec.length > 1 ? Number(spec.slice(1)) : null,
			oldOid: blobOid(fields[2]),
			newOid: blobOid(fields[3]),
		});
	}
	return files;
}

/**
 * The files that differ between two commit-ish, with their line totals. Two
 * passes because no single git command carries both: `--raw` has the status,
 * the paths and the blob OIDs a lazy diff needs, `--numstat` has the counts.
 * Both are given the same rename flags, so they agree on which pairs exist.
 */
async function changedFiles(
	cwd: string,
	from: string,
	to: string,
): Promise<ComparisonResult<{ files: ComparisonFile[]; stats: ComparisonStats }>> {
	const [rawRun, numstatRun] = await Promise.all([
		git(cwd, ['diff', '--raw', '-z', '--abbrev=64', ...RENAMES, from, to]),
		git(cwd, ['diff', '--numstat', '-z', ...RENAMES, from, to]),
	]);
	if (rawRun.status !== 0) return failed(rawRun, 'Could not read changed files');
	if (numstatRun.status !== 0) return failed(numstatRun, 'Could not read line totals');

	const raw = parseRaw(rawRun.stdout);
	const totals = parseNumstat(numstatRun.stdout);
	if (!raw || !totals) return fail('gitError', 'Git returned incomplete comparison metadata');

	const files: ComparisonFile[] = [];
	const stats: ComparisonStats = { files: 0, additions: 0, deletions: 0, binaryFiles: 0 };
	for (const file of raw) {
		const total = totals.get(pairKey(file.oldPath, file.path));
		if (!total) return fail('gitError', `Git reported no line totals for ${file.path}`);
		files.push({ ...file, ...total });
		stats.files++;
		if (total.binary) stats.binaryFiles++;
		else {
			stats.additions += total.additions ?? 0;
			stats.deletions += total.deletions ?? 0;
		}
	}
	return {
		ok: true,
		value: { files: files.toSorted((a, b) => a.path.localeCompare(b.path)), stats },
	};
}

/**
 * A resolved comparison's files and commits. Contents stay unread: the OIDs in
 * `identity` make this a snapshot, so a blob can be fetched when its row is
 * opened without the list underneath having moved.
 */
export async function loadResolvedComparison(
	cwd: string,
	identity: ComparisonIdentity,
): Promise<ComparisonResult<BranchComparison>> {
	// `mergeBase..compare` for the files and `base..compare` for the commits: both
	// leave out what only the base has, which is what makes this the branch's own
	// work rather than a tip-to-tip diff.
	const [changed, logRun] = await Promise.all([
		changedFiles(cwd, identity.mergeBase, identity.compare.oid),
		git(cwd, [
			'log',
			'-z',
			`--format=${COMMIT_FORMAT}`,
			`${identity.base.oid}..${identity.compare.oid}`,
		]),
	]);
	if (!changed.ok) return changed;
	if (logRun.status !== 0) return failed(logRun, 'Could not read comparison commits');
	const commits = parseCommits(logRun.stdout);
	if (!commits) return fail('gitError', 'Git returned incomplete commit metadata');
	return { ok: true, value: { ...identity, ...changed.value, commits } };
}

export async function loadBranchComparison(
	cwd: string,
	baseName: string,
	compareName?: string,
): Promise<ComparisonResult<BranchComparison>> {
	const identity = await resolveComparison(cwd, baseName, compareName);
	return identity.ok ? loadResolvedComparison(cwd, identity.value) : identity;
}

/** The two textual sides of one comparison row, fetched only when it is opened. */
export async function comparisonFileContent(
	cwd: string,
	file: ComparisonFile,
): Promise<ComparisonResult<ComparisonContent>> {
	if (file.binary) return { ok: true, value: { binary: true } };

	const read = (oid: string | null) =>
		oid ? git(cwd, ['cat-file', 'blob', oid]) : Promise.resolve<ProcessResult | null>(null);
	const [oldRun, newRun] = await Promise.all([read(file.oldOid), read(file.newOid)]);
	if (oldRun && oldRun.status !== 0) return failed(oldRun, `Could not read ${file.oldPath}`);
	if (newRun && newRun.status !== 0) return failed(newRun, `Could not read ${file.path}`);
	return {
		ok: true,
		value: { binary: false, oldText: oldRun?.stdout ?? '', newText: newRun?.stdout ?? '' },
	};
}

/** Metadata and first-parent file changes for one commit. */
export async function comparisonCommitDetail(
	cwd: string,
	oid: string,
): Promise<ComparisonResult<ComparisonCommitDetail>> {
	const metadata = await git(cwd, ['log', '-1', '-z', `--format=${COMMIT_FORMAT}`, oid]);
	if (metadata.status !== 0) return failed(metadata, 'Could not read commit metadata');
	const commits = parseCommits(metadata.stdout);
	const commit = commits?.length === 1 ? commits[0]! : null;
	if (!commit) return fail('invalidCompare', `Commit "${oid}" does not exist`);

	// First parent for a merge, as `git show` reads one — a combined diff is not
	// something the diff renderer can draw. The empty tree stands in for the
	// parent a root commit does not have.
	const changed = await changedFiles(cwd, commit.parents[0] ?? EMPTY_TREE, commit.oid);
	return changed.ok ? { ok: true, value: { commit, ...changed.value } } : changed;
}
