import { createEffect, createMemo } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type { ProblemSeverity } from '../../lsp/protocol';
import { SEVERITY_RANK } from '../../lsp/protocol';
import type { ProblemEntry } from '../../ui/overlays/ProblemsModal';
import type { Focus } from '../types';
import type { Problem } from './index';

export type ProblemLine = { severity: ProblemSeverity; message: string };
export type ProblemChoice = Pick<
	Problem,
	'path' | 'line' | 'col' | 'message' | 'severity' | 'source'
>;

/**
 * A range crossing lines used to mark only its start line, so a multi-line diagnostic (a
 * missing brace, an unclosed type) left every line but the first looking clean. Capped so
 * one diagnostic spanning an unreasonable number of lines can't blow up this map — VS Code
 * has the same practical limit on how much of a giant range it bothers to mark.
 */
const MAX_PROBLEM_LINES = 2000;

export function activeProblemLines(problems: readonly Problem[] | undefined) {
	const lines = new Map<number, ProblemLine>();
	for (const problem of problems ?? []) {
		const end = Math.max(problem.line, Math.min(problem.endLine, problem.line + MAX_PROBLEM_LINES));
		for (let line = problem.line; line <= end; line++) {
			const held = lines.get(line);
			if (!held || SEVERITY_RANK[problem.severity] < SEVERITY_RANK[held.severity]) {
				lines.set(line, { severity: problem.severity, message: problem.message });
			}
		}
	}
	return lines;
}

export function problemCounts(problems: readonly Problem[] | undefined) {
	let errors = 0;
	let warnings = 0;
	for (const problem of problems ?? []) {
		if (problem.severity === 'error') errors++;
		else if (problem.severity === 'warning') warnings++;
	}
	return { errors, warnings };
}

/** Worst diagnostic a tab should wear. Info and hints stay off the strip. */
export type TabSeverity = 'error' | 'warning';

export function tabSeverityOf(problems: readonly Problem[] | undefined): TabSeverity | null {
	let worst: TabSeverity | null = null;
	for (const problem of problems ?? []) {
		if (problem.severity === 'error') return 'error';
		if (problem.severity === 'warning') worst = 'warning';
	}
	return worst;
}

export function openProblemRows(paths: readonly string[], problems: Record<string, Problem[]>) {
	return paths.flatMap((path) =>
		(problems[path] ?? []).map((problem) => ({
			path,
			line: problem.line,
			col: problem.col,
			severity: problem.severity,
			message: problem.message,
			source: problem.source,
		})),
	);
}

export function problemEntries(rootDir: string, rows: readonly ProblemChoice[]): ProblemEntry[] {
	return rows.map((problem) => ({
		...problem,
		rel: problem.path.startsWith(`${rootDir}/`)
			? problem.path.slice(rootDir.length + 1)
			: problem.path,
	}));
}

export type ProblemsScope = 'all' | 'cursor';

export function problemsOn(list: readonly Problem[], line: number): Problem[] {
	return list
		.filter((problem) => problem.line === line)
		.toSorted((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.col - b.col);
}

export function createProblemUi(deps: {
	rootDir: string;
	problems: Record<string, Problem[]>;
	tabs: Accessor<string[]>;
	activePath: Accessor<string | null>;
	cursor: Accessor<{ line: number; col: number }>;
	problemsOpen: Accessor<ProblemsScope | false>;
	setProblemsOpen: Setter<ProblemsScope | false>;
	setGoto: Setter<{ line: number; col: number; key: number } | null>;
	setFocus: Setter<Focus>;
	openFile: (path: string) => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	nextFrom: (
		list: readonly Problem[],
		line: number,
		col: number,
		direction: 1 | -1,
	) => Problem | null;
}) {
	const rows = createMemo(() => openProblemRows(deps.tabs(), deps.problems));
	const scopedRows = createMemo(() => {
		if (deps.problemsOpen() !== 'cursor') return rows();
		const path = deps.activePath();
		const list = path ? deps.problems[path] : undefined;
		if (!list) return [];
		return problemsOn(list, deps.cursor().line).map((problem) => ({
			path: path!,
			line: problem.line,
			col: problem.col,
			severity: problem.severity,
			message: problem.message,
			source: problem.source,
		}));
	});
	const lines = createMemo(() => {
		const path = deps.activePath();
		return activeProblemLines(path ? deps.problems[path] : undefined);
	});
	const counts = createMemo(() => {
		const path = deps.activePath();
		return problemCounts(path ? deps.problems[path] : undefined);
	});
	const entries = createMemo(() => problemEntries(deps.rootDir, scopedRows()));

	createEffect(() => {
		if (deps.problemsOpen() && scopedRows().length === 0) deps.setProblemsOpen(false);
	});

	const jumpTo = (problem: ProblemChoice) => {
		if (problem.path !== deps.activePath()) deps.openFile(problem.path);
		deps.setGoto((prev) => ({ line: problem.line, col: problem.col, key: (prev?.key ?? 0) + 1 }));
		deps.setFocus('editor');
		deps.say(problem.message, 'warn');
	};
	const list = () => {
		if (rows().length === 0) return deps.say('No problems');
		deps.setProblemsOpen('all');
	};
	const atCursor = () => {
		const path = deps.activePath();
		const fileProblems = path ? deps.problems[path] : undefined;
		if (!fileProblems || problemsOn(fileProblems, deps.cursor().line).length === 0) {
			return deps.say('No problem on this line');
		}
		deps.setProblemsOpen('cursor');
	};
	const next = (direction: 1 | -1) => {
		const path = deps.activePath();
		const problems = path ? deps.problems[path] : undefined;
		const cursor = deps.cursor();
		const target = problems ? deps.nextFrom(problems, cursor.line, cursor.col, direction) : null;
		if (!target) return deps.say('No problems in this file');
		jumpTo(target);
	};
	const pick = (problem: ProblemChoice) => {
		deps.setProblemsOpen(false);
		jumpTo(problem);
	};

	return { lines, counts, entries, scope: deps.problemsOpen, list, atCursor, next, pick };
}
