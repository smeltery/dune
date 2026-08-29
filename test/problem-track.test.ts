import { describe, expect, test } from 'bun:test';

import { problemRows } from '../src/editor/problems';
import { activeProblemLines, tabSeverityOf } from '../src/app/lsp/view';
import type { Problem } from '../src/app/lsp/index';
import type { ProblemSeverity } from '../src/lsp/protocol';

const problem = (over: Partial<Problem>): Problem => ({
	path: '/a.ts',
	line: 0,
	col: 0,
	endLine: 0,
	endCol: 0,
	severity: 'error',
	unnecessary: false,
	deprecated: false,
	message: 'boom',
	...over,
});

const marks = (entries: Array<[number, ProblemSeverity]>) =>
	new Map(entries.map(([line, severity]) => [line, { severity }]));

describe('diagnostics down the track', () => {
	test('a problem marks the row that stands for its line', () => {
		const rows = problemRows(marks([[0, 'error']]), 100, 10);

		expect(rows[0]).toBe('error');
		expect(rows.filter(Boolean)).toHaveLength(1);
	});

	test('the whole file is covered, not just the visible part', () => {
		const rows = problemRows(marks([[950, 'error']]), 1000, 20);

		expect(rows.at(-1)).toBe('error');
		expect(rows[0]).toBeUndefined();
	});

	test('the worst severity wins when a row covers several lines', () => {
		const rows = problemRows(
			marks([
				[0, 'warning'],
				[1, 'error'],
				[2, 'warning'],
			]),
			30,
			10,
		);

		expect(rows[0]).toBe('error');
	});

	test('info and hint stay off the track', () => {
		const rows = problemRows(
			marks([
				[0, 'info'],
				[40, 'hint'],
			]),
			100,
			10,
		);

		expect(rows.some(Boolean)).toBe(false);
	});

	test('lines outside the file are ignored rather than clamped onto a row', () => {
		expect(problemRows(marks([[500, 'error']]), 100, 10).some(Boolean)).toBe(false);
	});

	test('nothing to draw on is an empty result, not a crash', () => {
		expect(problemRows(marks([[1, 'error']]), 100, 0)).toEqual([]);
		expect(problemRows(marks([[1, 'error']]), 0, 10).some(Boolean)).toBe(false);
	});
});

describe('lines a diagnostic covers', () => {
	test('a single-line diagnostic marks just that line', () => {
		const lines = activeProblemLines([problem({ line: 4, endLine: 4 })]);
		expect([...lines.keys()]).toEqual([4]);
	});

	test('a range crossing lines marks every line it covers, not only the first', () => {
		const lines = activeProblemLines([problem({ line: 4, endLine: 7 })]);
		expect([...lines.keys()].toSorted((a, b) => a - b)).toEqual([4, 5, 6, 7]);
	});

	test('the worse severity wins where two diagnostics overlap', () => {
		const lines = activeProblemLines([
			problem({ line: 0, endLine: 3, severity: 'warning' }),
			problem({ line: 2, endLine: 2, severity: 'error' }),
		]);
		expect(lines.get(1)?.severity).toBe('warning');
		expect(lines.get(2)?.severity).toBe('error');
	});

	test('an unreasonably large range is capped rather than filling the whole map', () => {
		const lines = activeProblemLines([problem({ line: 50, endLine: 1_000_000 })]);
		expect(lines.has(50)).toBe(true);
		expect(lines.has(50 + 2000)).toBe(true);
		expect(lines.has(50 + 2001)).toBe(false);
		expect(lines.size).toBe(2001);
	});

	test('an inverted range still marks its own start line', () => {
		const lines = activeProblemLines([problem({ line: 5, endLine: 2 })]);
		expect([...lines.keys()]).toEqual([5]);
	});
});

describe('tab severity marks', () => {
	test('an error outranks a warning', () => {
		expect(
			tabSeverityOf([
				problem({ severity: 'warning' }),
				problem({ severity: 'error' }),
				problem({ severity: 'info' }),
			]),
		).toBe('error');
	});

	test('info and hints never mark a tab', () => {
		expect(
			tabSeverityOf([problem({ severity: 'info' }), problem({ severity: 'hint' })]),
		).toBeNull();
	});

	test('a warning alone marks the tab', () => {
		expect(tabSeverityOf([problem({ severity: 'warning' })])).toBe('warning');
	});
});
