import { expect, test } from 'bun:test';

import type { CompletionMatch } from '../src/lsp/completion';
import { kindInfo } from '../src/lsp/completion';
import { completionInfo, completionMenuLayout } from '../src/ui/completionLayout';

const match = (label: string, detail?: string): CompletionMatch => ({
	item: { label, detail },
	score: 0,
	positions: [],
});

test('completion item kinds map to stable menu groups', () => {
	expect(kindInfo(3)).toEqual({ glyph: 'ƒ', group: 'fn' });
	expect(kindInfo(6)).toEqual({ glyph: 'ν', group: 'var' });
	expect(kindInfo(7)).toEqual({ glyph: '◆', group: 'type' });
	expect(kindInfo(14)).toEqual({ glyph: 'κ', group: 'keyword' });
	expect(kindInfo(undefined)).toEqual({ glyph: '·', group: 'text' });
	expect(kindInfo(999)).toEqual({ glyph: '·', group: 'text' });
});

test('completion menu width accounts for labels and details within caps', () => {
	expect(completionMenuLayout([], null, { width: 100, height: 30 }, false).width).toBe(22);
	expect(
		completionMenuLayout([match('map').item], null, { width: 100, height: 30 }, false).width,
	).toBe(22);
	expect(
		completionMenuLayout(
			[match('createLanguageServerClient', '(root: string) => Client').item],
			null,
			{ width: 100, height: 30 },
			false,
		).width,
	).toBe(58);
	expect(
		completionMenuLayout(
			[match('x'.repeat(80), 'y'.repeat(80)).item],
			null,
			{
				width: 100,
				height: 30,
			},
			false,
		).width,
	).toBe(76);
});

test('completion detail panel wraps signature, documentation, and origin', () => {
	const item = {
		label: 'draw',
		detail: 'const draw: <Value extends number>(props: Props<Value>) => Element',
		documentation: 'Draws the current value.',
		labelDetails: { description: 'dune/fake' },
	};
	const info = completionInfo(item)!;
	const layout = completionMenuLayout([item], info, { width: 80, height: 30 }, true);

	expect(layout.width).toBeGreaterThanOrEqual(56);
	expect(layout.signature.length).toBeGreaterThan(1);
	for (const line of layout.signature) {
		expect(info.detail.slice(line.start, line.start + line.text.length)).toBe(line.text);
	}
	expect(layout.documentation).toContain('Draws the current value.');
	expect(layout.origin).toBe('dune/fake');
});

test('completionInfo marks deprecated items from the flag or the Deprecated tag', () => {
	expect(completionInfo({ label: 'a' })!.deprecated).toBe(false);
	expect(completionInfo({ label: 'a', deprecated: true })!.deprecated).toBe(true);
	expect(completionInfo({ label: 'a', tags: [1] })!.deprecated).toBe(true);
	expect(completionInfo({ label: 'a', tags: [2] })!.deprecated).toBe(false);
});
