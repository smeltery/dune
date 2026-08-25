import { createMemo, createSignal } from 'solid-js';

import {
	comparisonCommitDetail,
	comparisonFileContent,
	loadResolvedComparison,
	resolveComparison,
} from '../../core/git/compare';
import type {
	BranchComparison,
	ComparisonCommitDetail,
	ComparisonContent,
	ComparisonFile,
} from '../../core/git/compare';
import { currentBranch, defaultBranch, inRepository, listBranches } from '../../core/git';
import type { Branch } from '../../core/git';
import { fuzzyScore } from '../../core/search';
import type { Tone } from '../../ui/StatusBar';

export type ComparisonMode = 'files' | 'commits';
export type ComparisonState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/** Insert, dropping the oldest entry once the cache is over `limit`. */
function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
	cache.set(key, value);
	if (cache.size > limit) cache.delete(cache.keys().next().value!);
}

const contentKey = (file: ComparisonFile) => `${file.oldOid ?? ''}:${file.newOid ?? ''}`;

/**
 * Read-only branch comparison state. Deliberately separate from the editor-wide
 * `diffBase`, which retargets the working-tree diffs the source-control panel
 * and the gutter show: a comparison is a snapshot of two branch tips, and
 * changing it must not move what staging or discarding acts on.
 */
export function createComparison(deps: {
	rootDir: string;
	activeRepo: () => string | null;
	branch: () => string | null;
	diffBase: () => string | null;
	say: (msg: string, tone?: Tone) => void;
}) {
	const [active, setActive] = createSignal(false);
	const [state, setState] = createSignal<ComparisonState>('idle');
	const [result, setResult] = createSignal<BranchComparison | null>(null);
	const [error, setError] = createSignal('');
	const [mode, setMode] = createSignal<ComparisonMode>('files');
	const [filter, setFilterValue] = createSignal('');
	const [filtering, setFiltering] = createSignal(false);
	const [fileCursor, setFileCursor] = createSignal(0);
	const [commitCursor, setCommitCursor] = createSignal(0);
	const [basePick, setBasePick] = createSignal<Branch[] | null>(null);
	const [chosenBase, setChosenBase] = createSignal<string | null>(null);
	const [selectedFile, setSelectedFile] = createSignal<ComparisonFile | null>(null);
	const [selectedCommit, setSelectedCommit] = createSignal<ComparisonCommitDetail | null>(null);
	const [selectedContent, setSelectedContent] = createSignal<ComparisonContent | null>(null);
	const [detailFileCursor, setDetailFileCursor] = createSignal(0);

	/**
	 * Repository the open comparison is of, pinned when it opens: the active one
	 * moves with the active tab, and every oid, path and cached blob here belongs
	 * to the repository it was resolved in.
	 */
	let repoDir = deps.rootDir;

	const comparisons = new Map<string, BranchComparison>();
	const commits = new Map<string, ComparisonCommitDetail>();
	const contents = new Map<string, ComparisonContent>();
	let requestGeneration = 0;
	let detailGeneration = 0;

	const filteredFiles = createMemo(() => {
		const query = filter().trim();
		const source = result()?.files ?? [];
		if (!query) return source;
		return source.filter(
			(file) =>
				fuzzyScore(file.path, query) !== null ||
				(file.oldPath !== null && fuzzyScore(file.oldPath, query) !== null),
		);
	});

	const filteredCommits = createMemo(() => {
		const query = filter().trim();
		const source = result()?.commits ?? [];
		if (!query) return source;
		return source.filter(
			(commit) =>
				fuzzyScore(commit.subject, query) !== null ||
				fuzzyScore(commit.shortOid, query) !== null ||
				fuzzyScore(commit.authorName, query) !== null,
		);
	});

	const fail = (detail: string) => {
		setError(detail);
		setState('error');
		deps.say(detail, 'error');
	};

	const show = (comparison: BranchComparison) => {
		setResult(comparison);
		setState(comparison.files.length === 0 && comparison.commits.length === 0 ? 'empty' : 'ready');
		setError('');
		setFileCursor(0);
		setCommitCursor(0);
	};

	const load = async (base: string) => {
		const generation = ++requestGeneration;
		setState('loading');
		setError('');
		setResult(null);
		const compare = deps.branch() ?? currentBranch(repoDir) ?? undefined;
		const identity = await resolveComparison(repoDir, base, compare);
		if (generation !== requestGeneration) return;
		if (!identity.ok) return fail(identity.detail);

		const key = `${identity.value.base.oid}:${identity.value.compare.oid}`;
		const cached = comparisons.get(key);
		if (cached) {
			show({ ...cached, base: identity.value.base, compare: identity.value.compare });
			return;
		}

		const loaded = await loadResolvedComparison(repoDir, identity.value);
		if (generation !== requestGeneration) return;
		if (!loaded.ok) return fail(loaded.detail);
		remember(comparisons, key, loaded.value, 8);
		show(loaded.value);
	};

	const otherBranches = () => {
		const current = deps.branch() ?? currentBranch(repoDir);
		return listBranches(repoDir).filter((branch) => !branch.current && branch.name !== current);
	};

	const open = () => {
		setActive(true);
		setMode('files');
		setFilterValue('');
		setFiltering(false);
		closeDetail();
		const repo = deps.activeRepo() ?? (inRepository(deps.rootDir) ? deps.rootDir : null);
		if (repo === null) return fail('Not a git repository');
		repoDir = repo;
		// The editor-wide comparison base, when one is set, is the branch the user
		// has already said they are working against.
		const base = chosenBase() ?? deps.diffBase() ?? defaultBranch(repoDir);
		if (base) return void load(base);
		const branches = otherBranches();
		if (branches.length === 0) return fail('No comparison base exists');
		setState('idle');
		setBasePick(branches);
		deps.say('Choose a base branch');
	};

	const close = () => {
		requestGeneration++;
		setActive(false);
		setState('idle');
		setBasePick(null);
		setFiltering(false);
		closeDetail();
	};

	const openBasePicker = () => {
		const branches = otherBranches();
		if (branches.length === 0) return deps.say('No other branch to compare against', 'warn');
		setBasePick(branches);
	};

	const chooseBase = (name: string) => {
		setBasePick(null);
		setChosenBase(name);
		void load(name);
	};

	const setFilter = (value: string) => {
		setFilterValue(value);
		setFileCursor(0);
		setCommitCursor(0);
	};

	const toggleMode = () => {
		setMode((value) => (value === 'files' ? 'commits' : 'files'));
		closeDetail();
	};

	const move = (delta: number) => {
		if (mode() === 'files') {
			const last = Math.max(0, filteredFiles().length - 1);
			setFileCursor((value) => Math.max(0, Math.min(last, value + delta)));
		} else {
			const last = Math.max(0, filteredCommits().length - 1);
			setCommitCursor((value) => Math.max(0, Math.min(last, value + delta)));
		}
	};

	const loadContent = async (file: ComparisonFile, generation: number) => {
		const key = contentKey(file);
		const cached = contents.get(key);
		if (cached) {
			if (generation === detailGeneration) setSelectedContent(cached);
			return;
		}
		const loaded = await comparisonFileContent(repoDir, file);
		if (generation !== detailGeneration) return;
		if (!loaded.ok) return fail(loaded.detail);
		remember(contents, key, loaded.value, 64);
		setSelectedContent(loaded.value);
	};

	const openSelection = () => {
		const generation = ++detailGeneration;
		setSelectedContent(null);
		if (mode() === 'files') {
			const file = filteredFiles()[fileCursor()];
			if (!file) return;
			setSelectedCommit(null);
			setDetailFileCursor(0);
			setSelectedFile(file);
			void loadContent(file, generation);
			return;
		}

		const commit = filteredCommits()[commitCursor()];
		if (!commit) return;
		setSelectedFile(null);
		const cached = commits.get(commit.oid);
		const loadCommit = cached
			? Promise.resolve({ ok: true as const, value: cached })
			: comparisonCommitDetail(repoDir, commit.oid);
		void (async () => {
			const loaded = await loadCommit;
			if (generation !== detailGeneration) return;
			if (!loaded.ok) return fail(loaded.detail);
			remember(commits, commit.oid, loaded.value, 32);
			setSelectedCommit(loaded.value);
			setDetailFileCursor(0);
			const file = loaded.value.files[0];
			if (!file) return;
			setSelectedFile(file);
			void loadContent(file, generation);
		})();
	};

	function closeDetail() {
		detailGeneration++;
		setSelectedFile(null);
		setSelectedCommit(null);
		setSelectedContent(null);
		setDetailFileCursor(0);
	}

	const moveDetail = (delta: number) => {
		const detail = selectedCommit();
		if (!detail) return;
		const next = Math.max(0, Math.min(detail.files.length - 1, detailFileCursor() + delta));
		if (next === detailFileCursor()) return;
		const file = detail.files[next];
		if (!file) return;
		const generation = ++detailGeneration;
		setDetailFileCursor(next);
		setSelectedFile(file);
		setSelectedContent(null);
		void loadContent(file, generation);
	};

	const refresh = () => {
		const comparison = result();
		if (!active() || !comparison) return;
		const generation = requestGeneration;
		void (async () => {
			const identity = await resolveComparison(repoDir, comparison.base.name);
			if (!active() || generation !== requestGeneration) return;
			if (!identity.ok) return fail(identity.detail);
			if (
				identity.value.base.oid !== comparison.base.oid ||
				identity.value.compare.oid !== comparison.compare.oid
			) {
				void load(comparison.base.name);
			}
		})();
	};

	/**
	 * A detail page is up. A commit with an empty first-parent diff has no file,
	 * and still owns the editor slot and Esc.
	 */
	const detailOpen = () => selectedFile() !== null || selectedCommit() !== null;

	return {
		active,
		detailOpen,
		state,
		result,
		error,
		mode,
		filter,
		filtering,
		filteredFiles,
		filteredCommits,
		fileCursor,
		commitCursor,
		basePick,
		selectedFile,
		selectedCommit,
		selectedContent,
		detailFileCursor,
		open,
		close,
		openBasePicker,
		chooseBase,
		closeBasePicker: () => setBasePick(null),
		openFilter: () => setFiltering(true),
		closeFilter: (clear: boolean) => {
			setFiltering(false);
			if (clear) setFilter('');
		},
		setFilter,
		toggleMode,
		move,
		openSelection,
		closeDetail,
		moveDetail,
		refresh,
	};
}

export type Comparison = ReturnType<typeof createComparison>;
