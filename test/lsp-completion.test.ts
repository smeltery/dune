import { describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'node:url';

import {
	applyCompletion,
	extendsWord,
	filterCompletions,
	fuzzyMatch,
	matchRuns,
	normalizeCompletion,
	stripSnippet,
	wordStart,
} from '../src/lsp/completion';
import { normalizeDefinition } from '../src/lsp/definition';
import type { CompletionItem } from '../src/lsp/protocol';
import { isDeprecated, isUnnecessary, severityOf } from '../src/lsp/protocol';

describe('normalizeCompletion', () => {
	test('normalizes arrays and completion lists', () => {
		expect(normalizeCompletion(null)).toBeNull();
		expect(normalizeCompletion([{ label: 'readFile' }])).toEqual({
			items: [{ label: 'readFile' }],
			isIncomplete: false,
		});
		expect(normalizeCompletion({ isIncomplete: true, items: [{ label: 'writeFile' }] })).toEqual({
			items: [{ label: 'writeFile' }],
			isIncomplete: true,
		});
		expect(normalizeCompletion({ items: 'nope' })).toBeNull();
	});
});

describe('normalizeDefinition', () => {
	test('accepts locations and location links', () => {
		const uri = pathToFileURL('/tmp/dune/def.ts').href;

		expect(
			normalizeDefinition({
				uri,
				range: { start: { line: 3, character: 4 }, end: { line: 3, character: 8 } },
			}),
		).toEqual({ path: '/tmp/dune/def.ts', line: 3, col: 4 });

		expect(
			normalizeDefinition([
				{
					targetUri: uri,
					targetRange: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
					targetSelectionRange: {
						start: { line: 2, character: 6 },
						end: { line: 2, character: 10 },
					},
				},
			]),
		).toEqual({ path: '/tmp/dune/def.ts', line: 2, col: 6 });
	});

	test('rejects non-file targets', () => {
		expect(
			normalizeDefinition({
				uri: 'untitled:buffer',
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			}),
		).toBeNull();
		expect(normalizeDefinition(null)).toBeNull();
	});
});

describe('diagnostic protocol mapping', () => {
	test('maps severities and unnecessary tags', () => {
		const diagnostic = {
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			message: 'x',
		};

		expect(severityOf(diagnostic)).toBe('error');
		expect(severityOf({ ...diagnostic, severity: 2 })).toBe('warning');
		expect(severityOf({ ...diagnostic, severity: 3 })).toBe('info');
		expect(severityOf({ ...diagnostic, severity: 4 })).toBe('hint');
		expect(isUnnecessary(diagnostic)).toBe(false);
		expect(isUnnecessary({ ...diagnostic, tags: [2, 1] })).toBe(true);
	});

	test('maps the Deprecated tag', () => {
		const diagnostic = {
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			message: 'x',
		};
		expect(isDeprecated(diagnostic)).toBe(false);
		expect(isDeprecated({ ...diagnostic, tags: [2] })).toBe(true);
	});
});

describe('completion prefix matching', () => {
	test('finds the word fragment before the cursor', () => {
		expect(wordStart('const file_name', 15)).toBe(6);
		expect(wordStart('client.', 7)).toBe(7);
	});

	test('recognizes when a completion reply still extends the same word', () => {
		expect(extendsWord('duneAlpha', 4, 9)).toBe(true);
		expect(extendsWord('dune(', 4, 5)).toBe(false);
		expect(extendsWord('dune', 4, 2)).toBe(false);
	});

	test('scores tight and boundary matches above scattered ones', () => {
		expect(fuzzyMatch('rf', 'readFile')!.score).toBeGreaterThan(
			fuzzyMatch('rf', 'roughFactor')!.score,
		);
		expect(fuzzyMatch('xyz', 'readFile')).toBeNull();
	});

	test('filters and ranks candidates with server sortText as a tie breaker', () => {
		const labels = filterCompletions(
			[{ label: 'mapValues' }, { label: 'map' }, { label: 'flatMap' }, { label: 'unrelated' }],
			'map',
		).map((match) => match.item.label);
		expect(labels[0]).toBe('map');
		expect(labels).not.toContain('unrelated');

		expect(
			filterCompletions(
				[
					{ label: 'b', sortText: '2' },
					{ label: 'a', sortText: '1' },
				],
				'',
			).map((match) => match.item.label),
		).toEqual(['a', 'b']);
	});

	test('server order wins when prefix quality ties', () => {
		expect(fuzzyMatch('tab', 'table')!.score).toBe(fuzzyMatch('tab', 'tableOfContents')!.score);
		expect(
			filterCompletions(
				[
					{ label: 'TableAliasProxyHandler', sortText: '16' },
					{ label: 'tableName', sortText: '16' },
					{ label: 'table', sortText: '11' },
				],
				'tab',
			).map((match) => match.item.label),
		).toEqual(['table', 'tableName', 'TableAliasProxyHandler']);
	});

	test('filterText can match without pretending label positions are known', () => {
		const [match] = filterCompletions([{ label: '* send', filterText: 'send' }], 'se');
		expect(match?.positions).toEqual([]);
	});
});

describe('completion edits', () => {
	test('strips snippets to inserted text and first tab stop', () => {
		expect(stripSnippet('call(${1:value})')).toEqual({ text: 'call(value)', caret: 5 });
		expect(stripSnippet('${1|red,green|}')).toEqual({ text: 'red', caret: 0 });
		expect(stripSnippet('done$0')).toEqual({ text: 'done', caret: null });
	});

	test('replaces the typed prefix without a server edit range', () => {
		const result = applyCompletion('const x = ma\n', { line: 0, character: 12 }, 10, {
			label: 'map',
		});
		expect(result.content).toBe('const x = map\n');
		expect(result.cursor).toEqual({ line: 0, character: 13 });
	});

	test('honors server edit ranges and extends stale same-line ends to the cursor', () => {
		const item: CompletionItem = {
			label: 'console',
			textEdit: {
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
				newText: 'console',
			},
		};
		expect(applyCompletion('consol\n', { line: 0, character: 6 }, 0, item).content).toBe(
			'console\n',
		);
	});

	test('applies additional edits against the original document', () => {
		const result = applyCompletion('const x = hel\n', { line: 0, character: 13 }, 10, {
			label: 'helper',
			additionalTextEdits: [
				{
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					newText: 'import { helper } from "./helpers"\n',
				},
			],
		});
		expect(result.content).toBe('import { helper } from "./helpers"\nconst x = helper\n');
		expect(result.cursor).toEqual({ line: 1, character: 16 });
	});

	test('snippet caret controls the final cursor', () => {
		const result = applyCompletion('fo\n', { line: 0, character: 2 }, 0, {
			label: 'forEach',
			insertText: 'forEach(${1:item})',
			insertTextFormat: 2,
		});
		expect(result.content).toBe('forEach(item)\n');
		expect(result.cursor).toEqual({ line: 0, character: 8 });
	});

	test('reindents multi-line snippets to the receiving line', () => {
		const result = applyCompletion('  def name() do\n', { line: 0, character: 15 }, 13, {
			label: 'do block',
			textEdit: {
				range: { start: { line: 0, character: 13 }, end: { line: 0, character: 15 } },
				newText: 'do\n  $0\nend',
			},
			insertTextFormat: 2,
		});
		expect(result.content).toBe('  def name() do\n    \n  end\n');
		expect(result.cursor).toEqual({ line: 1, character: 4 });
	});

	test('leaves plain multi-line completion text unchanged', () => {
		const result = applyCompletion('    block\n', { line: 0, character: 9 }, 4, {
			label: 'block',
			insertText: 'one\ntwo',
			insertTextFormat: 1,
		});
		expect(result.content).toBe('    one\ntwo\n');
	});
});

describe('matchRuns', () => {
	test('splits labels into highlighted and plain spans', () => {
		expect(matchRuns('flatMap', [0, 4, 5, 6])).toEqual([
			{ text: 'f', hit: true },
			{ text: 'lat', hit: false },
			{ text: 'Map', hit: true },
		]);
		expect(matchRuns('plain', [])).toEqual([{ text: 'plain', hit: false }]);
	});
});
