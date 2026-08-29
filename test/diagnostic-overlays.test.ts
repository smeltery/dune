import { describe, expect, test } from 'bun:test';

import { DEPRECATED_GROUP, styleIdForGroup, styleIdOver } from '../src/languages/highlight';
import { isDeprecated, isUnnecessary, severityOf } from '../src/lsp/protocol';
import type { Diagnostic } from '../src/lsp/protocol';

describe('diagnostic span styles', () => {
	const at = (line: number, col: number): Diagnostic => ({
		range: { start: { line, character: col }, end: { line, character: col } },
		message: 'm',
	});

	test('severity defaults to error and maps the four levels', () => {
		expect(severityOf(at(0, 0))).toBe('error');
		expect(severityOf({ ...at(0, 0), severity: 2 })).toBe('warning');
		expect(severityOf({ ...at(0, 0), severity: 3 })).toBe('info');
		expect(severityOf({ ...at(0, 0), severity: 4 })).toBe('hint');
	});

	test('span styles are registered for every severity and tag', () => {
		for (const severity of ['error', 'warning', 'info', 'hint']) {
			expect(styleIdForGroup(`dune.problem.${severity}`)).not.toBeNull();
		}
		expect(styleIdForGroup('dune.problem.unnecessary')).not.toBeNull();
		expect(styleIdForGroup(DEPRECATED_GROUP)).not.toBeNull();
	});

	test('a severity tint over a token is its own style, not the bare tint', () => {
		const keyword = styleIdForGroup('keyword');
		const tint = styleIdForGroup('dune.problem.error');
		expect(keyword).not.toBeNull();
		const combined = styleIdOver('dune.problem.error', keyword);
		expect(combined).not.toBeNull();
		expect(combined).not.toBe(tint);
		expect(combined).not.toBe(keyword);
		expect(styleIdOver('dune.problem.error', keyword)).toBe(combined);
		expect(styleIdOver('dune.problem.error', null)).toBe(tint);
	});

	test('Unnecessary and Deprecated tags are recognised', () => {
		expect(isUnnecessary(at(0, 0))).toBe(false);
		expect(isUnnecessary({ ...at(0, 0), tags: [2] })).toBe(false);
		expect(isUnnecessary({ ...at(0, 0), tags: [1] })).toBe(true);
		expect(isUnnecessary({ ...at(0, 0), tags: [2, 1] })).toBe(true);

		expect(isDeprecated(at(0, 0))).toBe(false);
		expect(isDeprecated({ ...at(0, 0), tags: [1] })).toBe(false);
		expect(isDeprecated({ ...at(0, 0), tags: [2] })).toBe(true);
		expect(isDeprecated({ ...at(0, 0), tags: [1, 2] })).toBe(true);
	});
});
