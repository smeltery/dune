import '../core/assets';
import {
	getTreeSitterClient,
	pathToFiletype,
	resolveRenderLib,
	SyntaxStyle,
	TextAttributes,
} from '@opentui/core';
import type { RGBA, StyleDefinition, StyleDefinitionInput, TreeSitterClient } from '@opentui/core';

import { THEMES, activeTheme, syntaxTheme, ui } from '../themes';
import { languageFor, languageGeneration, localFiletypeForName, vendoredLanguages } from './index';
import type { Language } from './index';

/** Two dots so it outranks any syntax capture on the same whitespace. */
const INDENT_GUIDE = 'indent.guide';

/** The Deprecated tag's span: crossed out, keeping its syntax colour. */
export const DEPRECATED_GROUP = 'dune.problem.deprecated';

let clientDead = false;
let initPromise: Promise<TreeSitterClient | null> | null = null;
let syntaxStyle: SyntaxStyle | null = null;
let registeredGeneration = -1;
/** Seeded ids for styles registered outside `styleDefs` (strikethrough). */
const styleIdByGroup = new Map<string, number>();
/** Memo of `group`+`base` → combined style id. Cleared whenever the table rebuilds. */
const overlaidIds = new Map<string, number>();
let definitionById: Map<number, StyleDefinition> | null = null;

function registerVendoredParsers(client: TreeSitterClient): void {
	registeredGeneration = languageGeneration();
	for (const lang of vendoredLanguages()) {
		try {
			client.addFiletypeParser({
				filetype: lang.id,
				wasm: lang.wasm!,
				queries: { highlights: [lang.query!] },
			});
		} catch {
			// best-effort: the language just stays unhighlighted
		}
	}
}

/** Opaque theme bg for mixing tints — `ui.bg` can be `transparent`. */
function solidBg(): string {
	return THEMES[activeTheme()]?.ui.bg ?? '#000000';
}

function mixColors(base: string, tint: string, t: number): string {
	if (!/^#[0-9a-fA-F]{6}$/.test(base) || !/^#[0-9a-fA-F]{6}$/.test(tint)) return base;
	const channel = (at: number) => {
		const a = Number.parseInt(base.slice(at, at + 2), 16);
		const b = Number.parseInt(tint.slice(at, at + 2), 16);
		return Math.round(a + (b - a) * t)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Register a style whose only mark is a strikethrough — `SyntaxStyle.registerStyle`
 * cannot express it (it drops everything but bold/italic/underline/dim), so the
 * native table is written directly and `styleIdByGroup` is seeded for lookup.
 */
function registerStruckThrough(style: SyntaxStyle, group: string): void {
	const id = struckThroughId(style, group, null);
	if (id != null) styleIdByGroup.set(group, id);
}

function struckThroughId(style: SyntaxStyle, name: string, fg: RGBA | null): number | null {
	try {
		return resolveRenderLib().syntaxStyleRegister(
			style.ptr,
			name,
			fg,
			null,
			TextAttributes.STRIKETHROUGH,
		);
	} catch {
		return null;
	}
}

/** Shared style table used by every editor buffer (built from the active theme). */
export function getSyntaxStyle(): SyntaxStyle {
	if (!syntaxStyle) {
		styleIdByGroup.clear();
		overlaidIds.clear();
		definitionById = null;
		const solid = solidBg();
		syntaxStyle = SyntaxStyle.fromStyles({
			...syntaxTheme,
			[INDENT_GUIDE]: { bg: ui.indentGuide },
			// Background-only severity tints — syntax colour stays; OpenTUI underline
			// would take the text colour and read as a second louder highlight.
			'dune.problem.error': { bg: mixColors(solid, ui.error, 0.16) },
			'dune.problem.warning': { bg: mixColors(solid, ui.dirty, 0.13) },
			'dune.problem.info': { bg: mixColors(solid, ui.dim, 0.1) },
			'dune.problem.hint': { bg: mixColors(solid, ui.dim, 0.1) },
			// Unnecessary fades toward the background instead of gaining a tint.
			'dune.problem.unnecessary': { fg: mixColors(solid, ui.text, 0.4) },
		});
		registerStruckThrough(syntaxStyle, DEPRECATED_GROUP);
	}
	return syntaxStyle;
}

export function invalidateSyntaxStyle(): void {
	syntaxStyle = null;
	styleIdByGroup.clear();
	overlaidIds.clear();
	definitionById = null;
}

/**
 * Style id for painting `group` over whatever `base` is painted in — the token's
 * colour with the overlay's background. The native buffer replaces a cell's style
 * rather than merging, so a bg-only tint without this would erase syntax colour.
 */
export function styleIdOver(group: string, base: number | null): number | null {
	const plain = styleIdForGroup(group);
	if (base == null || plain == null) return plain;
	const key = `${group}${base}`;
	const hit = overlaidIds.get(key);
	if (hit !== undefined) return hit;
	const id = registerOverlaid(group, base) ?? plain;
	overlaidIds.set(key, id);
	return id;
}

function registerOverlaid(group: string, base: number): number | null {
	const ss = getSyntaxStyle();
	const under = definitionForId(base);
	if (!under?.fg) return null;
	const name = `${group}${base}`;
	if (group === DEPRECATED_GROUP) return struckThroughId(ss, name, under.fg);
	const over = ss.getStyle(group);
	if (!over || over.fg || !over.bg) return null;
	return ss.registerStyle(name, { ...under, bg: over.bg });
}

function definitionForId(id: number): StyleDefinition | undefined {
	const ss = getSyntaxStyle();
	if (!definitionById) {
		definitionById = new Map();
		for (const name of ss.getRegisteredNames()) {
			const at = ss.getStyleId(name);
			const def = ss.getStyle(name);
			if (at != null && def) definitionById.set(at, def);
		}
	}
	return definitionById.get(id);
}

/**
 * `.env`, `.env.local`, `.env.production.sample`, `staging.env` — OpenTUI maps
 * none of them, and the extension is not where the name is.
 */
const DOTENV = /^\.env(?:\.[\w.-]+)?$|\.env$/;

/**
 * Files whose name says what they are while their extension does not. `bun.lock`
 * is JSON with comments and trailing commas; the json grammar reads it happily
 * enough to be worth far more than no colour at all.
 */
const BY_NAME: Record<string, string> = {
	'bun.lock': 'json',
};

/** Map a file path to a tree-sitter filetype ("foo.ts" -> "typescript"), if known. */
export function filetypeForPath(path: string): string | undefined {
	// Both separators: dune ships for Windows, where nothing after the last `/`
	// is the file name.
	const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
	if (BY_NAME[name]) return BY_NAME[name];
	const local = localFiletypeForName(name);
	if (local) return local;
	if (DOTENV.test(name)) return 'dotenv';
	if (name.endsWith('.jsonc')) return 'jsonc';
	if (name.endsWith('.tsrx')) return 'tsrx';
	if (name.endsWith('.tf') || name.endsWith('.tfvars')) return 'terraform';
	if (name.endsWith('.hcl')) return 'hcl';
	if (name.endsWith('.sol')) return 'solidity';
	return pathToFiletype(path) ?? undefined;
}

async function ensureClient(): Promise<TreeSitterClient | null> {
	if (clientDead) return null;
	if (!initPromise) {
		initPromise = (async () => {
			try {
				const c = getTreeSitterClient();
				await c.initialize();
				registerVendoredParsers(c);
				return c;
			} catch {
				clientDead = true; // highlighting is best-effort; editor still works
				return null;
			}
		})();
	}
	return initPromise;
}

export function highlightClient(): Promise<TreeSitterClient | null> {
	return ensureClient();
}

/**
 * Resolve a capture group to a style id, walking from the most specific scope
 * ("type.builtin") to the least ("type").
 */
export function styleIdForGroup(group: string): number | null {
	getSyntaxStyle();
	const seeded = styleIdByGroup.get(group);
	if (seeded != null) return seeded;
	const ss = getSyntaxStyle();
	let g = group;
	while (g.length > 0) {
		const id = ss.getStyleId(g);
		if (id != null) return id;
		const dot = g.lastIndexOf('.');
		if (dot < 0) break;
		g = g.slice(0, dot);
	}
	return null;
}

export function styleForId(styleId: number): StyleDefinitionInput | null {
	for (const group of Object.keys(syntaxTheme)) {
		if (styleIdForGroup(group) === styleId) return syntaxTheme[group] ?? null;
	}
	if (styleIdForGroup(INDENT_GUIDE) === styleId) return { bg: ui.indentGuide };
	return null;
}

export interface Segment {
	/** Column within the line, not an offset into the document. */
	start: number;
	end: number;
	styleId: number;
	/** 0-based line. Highlights are stored per line so scrolling can be incremental. */
	line: number;
}

/** More dots = more specific scope: "type.builtin" (2) beats "type" (1). */
function specificity(group: string): number {
	return group.split('.').length;
}

function lineStarts(content: string): number[] {
	const starts = [0];
	for (let i = 0; i < content.length; i++) {
		if (content.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return starts;
}

type RawHighlight = readonly [number, number, string];

/** One tinted column at every indent stop inside a line's leading whitespace. */
function indentGuides(content: string, tabSize: number): RawHighlight[] {
	const guides: RawHighlight[] = [];
	let offset = 0;
	for (const line of content.split('\n')) {
		const indent = line.length - line.trimStart().length;
		for (let column = 0; column < indent; column += tabSize) {
			guides.push([offset + column, offset + column + 1, INDENT_GUIDE]);
		}
		offset += line.length + 1;
	}
	return guides;
}

function highlightWithPatterns(content: string, patterns: NonNullable<Language['patterns']>) {
	const out: RawHighlight[] = [];
	for (const { group, re } of patterns) {
		for (const match of content.matchAll(re)) {
			if (match.index !== undefined) out.push([match.index, match.index + match[0].length, group]);
		}
	}
	return out;
}

function outsideProse(
	content: string,
	overlay: readonly RawHighlight[],
	claimed: ReadonlyArray<readonly [number, number, string, ...unknown[]]>,
): readonly RawHighlight[] {
	if (overlay.length === 0) return overlay;
	const prose = new Uint8Array(content.length);
	for (const [start, end, group] of claimed) {
		if (group.startsWith('comment') || group.startsWith('string')) prose.fill(1, start, end);
	}
	return overlay.filter(([start, end]) =>
		prose.subarray(start, end).every((covered) => covered === 0),
	);
}

const INJECTION = 'injection.';

type RawCapture = readonly [number, number, string, ...unknown[]];

async function resolveInjections(
	client: TreeSitterClient,
	content: string,
	captures: ReadonlyArray<RawCapture>,
): Promise<RawCapture[]> {
	const kept: RawCapture[] = [];
	const spans: { start: number; end: number; filetype: string }[] = [];
	for (const capture of captures) {
		const [start, end, group] = capture;
		if (!group.startsWith(INJECTION)) {
			kept.push(capture);
			continue;
		}
		const filetype = group.slice(INJECTION.length);
		const lang = languageFor(filetype);
		if (lang && (lang.bundled || (lang.wasm && lang.query))) spans.push({ start, end, filetype });
	}
	if (spans.length === 0) return kept;
	const injected = await Promise.all(
		spans.map(async (span) => {
			try {
				const res = await client.highlightOnce(content.slice(span.start, span.end), span.filetype);
				return (res.highlights ?? [])
					.filter((highlight) => !highlight[2].startsWith(INJECTION))
					.map(
						(highlight) =>
							[highlight[0] + span.start, highlight[1] + span.start, highlight[2]] as RawCapture,
					);
			} catch {
				return [];
			}
		}),
	);
	return [...kept, ...injected.flat()];
}

/** Answered instead of segments when `isStale` says the text moved on. */
export const STALE = Symbol('stale');

interface Capture {
	start: number;
	end: number;
	group: string;
}

/**
 * A parsed document, prepared for windowed segmentation. Neither field is derived
 * per window: both `lineStarts` (O(characters)) and the sort (O(captures log n))
 * used to run on every call, which put a floor of ~2ms under segmenting a *single*
 * line of a 20 000-line file — more than painting the whole viewport costs.
 */
export interface Highlighted {
	content: string;
	/** Offset each line starts at, so a line range maps to a slice of the text. */
	starts: number[];
	/**
	 * Captures least-specific-first, so the most specific one wins each character.
	 * `toSorted` is stable, which is what leaves equal-specificity captures in the
	 * order tree-sitter reported them — the tie-break the painter relies on.
	 */
	ordered: Capture[];
}

function prepare(
	content: string,
	raw: ReadonlyArray<readonly [number, number, string, ...unknown[]]>,
): Highlighted {
	const ordered = raw
		.map(([start, end, group]) => ({ start, end, group }))
		.filter((h) => h.end > h.start)
		.toSorted((a, b) => specificity(a.group) - specificity(b.group));
	return { content, starts: lineStarts(content), ordered };
}

export async function computeHighlights(
	content: string,
	filetype: string | undefined,
	tabSize = 2,
	isStale?: () => boolean,
): Promise<Highlighted | typeof STALE> {
	const guides = indentGuides(content, tabSize);
	const lang = filetype ? languageFor(filetype) : undefined;
	const overlay = lang?.patterns ? highlightWithPatterns(content, lang.patterns) : [];
	if (lang?.patterns && !lang.wasm && !lang.bundled) {
		return prepare(content, [...overlay, ...guides]);
	}

	const client = filetype ? await ensureClient() : null;
	if (!client) return prepare(content, [...overlay, ...guides]);
	if (registeredGeneration !== languageGeneration()) registerVendoredParsers(client);
	try {
		const res = await client.highlightOnce(content, filetype!);
		if (isStale?.()) return STALE;
		const highlights = await resolveInjections(client, content, res.highlights ?? []);
		if (isStale?.()) return STALE;
		return prepare(content, [
			...highlights,
			...outsideProse(content, overlay, highlights),
			...guides,
		]);
	} catch {
		return prepare(content, [...overlay, ...guides]);
	}
}

/**
 * Non-overlapping segments for lines `from`..`to` (inclusive) of a parsed document.
 *
 * Two steps:
 *   1. Paint each capture's style onto a per-character array. The captures arrive
 *      least specific first, so the most specific one wins each character — the
 *      same rule OpenTUI's own renderer uses.
 *   2. Merge runs of equal style into segments.
 *
 * Coordinates are per line: the buffer stores highlights against a line index,
 * which lets the editor add and drop them a line at a time while scrolling. Both
 * steps are O(characters in the range), which is why only the viewport is done.
 */
export function segmentsIn(parsed: Highlighted, from: number, to: number): Segment[] {
	const { content, starts, ordered } = parsed;
	const first = Math.max(0, Math.min(from, starts.length - 1));
	const last = Math.max(first, Math.min(to, starts.length - 1));
	const sliceStart = starts[first]!;
	const sliceEnd = last + 1 < starts.length ? starts[last + 1]! - 1 : content.length;

	const styleAt = new Int32Array(Math.max(0, sliceEnd - sliceStart)).fill(-1);
	for (const h of ordered) {
		// Skipped before resolving the group: the style lookup is the expensive part,
		// and most of a file's captures are outside any one window.
		if (h.end <= sliceStart || h.start >= sliceEnd) continue;
		const styleId = styleIdForGroup(h.group);
		if (styleId == null) continue;
		const start = Math.max(h.start, sliceStart);
		const end = Math.min(h.end, sliceEnd);
		for (let i = start; i < end; i++) styleAt[i - sliceStart] = styleId;
	}

	const segments: Segment[] = [];
	let column = 0;
	let line = first;
	let run: Segment | null = null;
	for (let i = sliceStart; i < sliceEnd; i++) {
		if (content.charCodeAt(i) === 10) {
			run = null; // a segment never spans a line break
			line++;
			column = 0;
			continue;
		}
		const styleId = styleAt[i - sliceStart]!;
		if (styleId < 0) {
			run = null;
		} else if (run && run.styleId === styleId) {
			run.end = column + 1;
		} else {
			run = { start: column, end: column + 1, styleId, line };
			segments.push(run);
		}
		column++;
	}
	return segments;
}
