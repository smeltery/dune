import { afterAll, expect, test } from 'bun:test';

import { getSyntaxStyle, invalidateSyntaxStyle } from '../src/languages/highlight';
import { activeTheme, setTheme, syntaxTheme, THEME_ENTRIES, THEMES } from '../src/themes';
import type { ThemeName } from '../src/themes';
import type { ThemeUi } from '../src/themes/types';
import { fixture, launch, press } from './helpers';
import type { Harness } from './helpers';
import { allSegments } from './syntax';

const spanRgb = (c?: { buffer: Record<string, number> }) =>
	c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : '';

/** Every distinct background/foreground currently on screen, as "r,g,b". */
function colors(t: Harness) {
	const capture = t.captureSpans() as unknown as {
		lines: {
			spans: {
				text: string;
				fg?: { buffer: Record<string, number> };
				bg?: { buffer: Record<string, number> };
			}[];
		}[];
	};
	const seen = new Set<string>();
	for (const line of capture.lines) {
		for (const span of line.spans) {
			if (span.bg) seen.add(spanRgb(span.bg));
			if (span.fg && span.text.trim()) seen.add(spanRgb(span.fg));
		}
	}
	return seen;
}

// These tests drive the module-global theme; leaving it changed would make every
// later test file depend on the order bun happened to run them in.
afterAll(() => {
	setTheme('dark');
	invalidateSyntaxStyle();
});

const hexToRgb = (hex: string) => {
	const h = hex.replace('#', '');
	return `${Number.parseInt(h.slice(0, 2), 16)},${Number.parseInt(h.slice(2, 4), 16)},${Number.parseInt(h.slice(4, 6), 16)}`;
};

const themeIds = () => Object.keys(THEMES) as ThemeName[];

const luminance = (hex: string) => {
	const h = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

async function switchTheme(t: Harness, query: string) {
	await press(t, (i) => i.pressKey('p', { ctrl: true }));
	await press(t, (i) => void i.typeText(query));
	await press(t, (i) => i.pressEnter());
}

test('switching theme repaints chrome and syntax', async () => {
	const t = await launch(fixture({ 'a.ts': 'const x = 1 // c\n' }));
	await press(t, (i) => i.pressArrow('down'));
	await press(t, (i) => i.pressEnter());

	await switchTheme(t, 'latte');
	const latte = colors(t);
	expect(latte).toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg));
	expect(latte).not.toContain(hexToRgb(THEMES.dark.ui.bg));

	await switchTheme(t, 'mocha');
	expect(colors(t)).toContain(hexToRgb(THEMES['catppuccin-mocha'].ui.bg));
});

test('setTheme publishes the currently painted theme', () => {
	setTheme('catppuccin-latte');
	expect(activeTheme()).toBe('catppuccin-latte');

	setTheme('catppuccin-mocha');
	expect(activeTheme()).toBe('catppuccin-mocha');
});

test("switching themes never leaves a previous theme's colors behind", async () => {
	// A merge instead of a replace used to keep groups the new theme omits, which
	// renders as invisible text whenever the switch flips light/dark.
	for (const name of themeIds()) {
		setTheme(name);
		invalidateSyntaxStyle();
		const theme = THEMES[name]!;
		expect(Object.keys(syntaxTheme).toSorted()).toEqual(Object.keys(theme.syntax).toSorted());
	}
});

test('plain identifiers stay readable against the background in every theme', async () => {
	const source = 'export const config = {\n  someKey: 1,\n}\n';

	for (const name of themeIds()) {
		setTheme(name);
		invalidateSyntaxStyle();
		const segments = await allSegments(source, 'typescript', 2);
		const style = getSyntaxStyle();
		const groups = [
			...(style as unknown as { getAllStyles: () => Map<string, unknown> }).getAllStyles().keys(),
		];
		const theme = THEMES[name]!;

		const bg = luminance(theme.ui.bg);
		for (const segment of segments) {
			const group = groups.find((g) => style.getStyleId(g) === segment.styleId);
			const fg = group ? (theme.syntax[group] as { fg?: string })?.fg : undefined;
			if (!fg) continue;
			expect(`${name}/${group}:${Math.abs(luminance(fg) - bg) > 0.08}`).toBe(
				`${name}/${group}:true`,
			);
		}
	}
}, 60_000);

test('theme registry exposes every palette with stable chrome keys', () => {
	const uiKeys = Object.keys(THEMES.dark.ui).toSorted() as (keyof ThemeUi)[];
	expect(themeIds()).toContain('0x96f');
	expect(themeIds()).toContain('hearth-dark');
	expect(themeIds()).toContain('hearth-light-teal');
	expect(themeIds()).toContain('iceberg-dark');
	expect(themeIds()).toContain('iceberg-light');
	expect(themeIds()).toContain('monokai');
	expect(themeIds()).toContain('night-owl');

	for (const name of themeIds()) {
		const theme = THEMES[name]!;
		expect(`${name}:${Object.keys(theme.ui).toSorted().join(',')}`).toBe(
			`${name}:${uiKeys.join(',')}`,
		);
		expect(theme.name.length).toBeGreaterThan(0);
	}
});

test('theme entries are the ordered source of truth for the theme map', () => {
	const ids = THEME_ENTRIES.map(([id]) => id);
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids).toEqual(themeIds());

	for (const [id, theme] of THEME_ENTRIES) expect(THEMES[id]).toBe(theme);
});

test('Catppuccin flavors share one generated syntax surface', () => {
	const flavors = [
		'catppuccin-mocha',
		'catppuccin-macchiato',
		'catppuccin-frappe',
		'catppuccin-latte',
	] as const;
	const syntaxKeys = Object.keys(THEMES[flavors[0]].syntax).toSorted();

	for (const flavor of flavors) {
		expect(`${flavor}:${Object.keys(THEMES[flavor].syntax).toSorted().join(',')}`).toBe(
			`${flavor}:${syntaxKeys.join(',')}`,
		);
	}
});
