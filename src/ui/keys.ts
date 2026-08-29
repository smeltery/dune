/**
 * Every keybinding dune advertises, in one table. The status-bar hints, the
 * help overlay and the Ctrl+K peek strip all render from here — a key added
 * anywhere else is a key one of them will not know about. The real handlers
 * live in App and EditorPane; `test/hotkeys.test.tsx` sweeps the two together.
 *
 * Entries sit grouped by `section`, which is what the help overlay renders
 * under headings — a new entry belongs beside its section mates, not at the end.
 */
import { isDisabledShortcut } from '../core/keybindings';

type Pane = 'tree' | 'editor';

/** The panes plus the sidebar's other views: the source-control, review and
 * plugins panels replace the tree's keys while they show, so the peek strip
 * and the tooltip chrome have to tell them apart. */
export type KeyScope = Pane | 'git' | 'review' | 'plugins';

/** What the key next to the space bar is called on this machine's keyboard. */
export const ALT = process.platform === 'darwin' ? 'Opt' : 'Alt';

export interface KeyInfo {
	key: string;
	label: string;
	/** Heading the help overlay files this under. */
	section: string;
	/** Scope(s) the key is alive in; 'help' rows show in the help table only. */
	where: KeyScope | 'all' | 'help';
	/** Footer advertisement: which scope shows it, as what, in what order.
	 * `key` overrides the display key where the full spelling is too wide. */
	hint?: { pane: KeyScope | 'all'; label: string; rank: number; key?: string };
	/** Empty editor prompt, ordered by usefulness. */
	welcome?: { rank: number; label?: string; key?: string };
}

export const KEYS: KeyInfo[] = [
	{
		key: `F1 · Ctrl+P · Ctrl+${ALT}+P`,
		label: 'Command palette (+ themes)',
		section: 'General',
		where: 'all',
		hint: { pane: 'all', label: 'commands', rank: 0, key: 'F1' },
		welcome: { rank: 1, key: 'F1', label: 'command palette' },
	},
	{
		key: 'Ctrl+K',
		label: 'Peek at every key for this pane',
		section: 'General',
		where: 'all',
		hint: { pane: 'all', label: 'keys', rank: 1 },
		welcome: { rank: 2, label: 'peek shortcuts' },
	},
	{
		key: 'Ctrl+O',
		label: 'Open file (fuzzy)',
		section: 'General',
		where: 'all',
		welcome: { rank: 0, label: 'open file' },
	},
	{ key: 'Ctrl+G', label: 'Go to line', section: 'General', where: 'all' },
	{
		key: `F12 / Ctrl+${ALT}+O`,
		label: 'Definition / file under cursor',
		section: 'General',
		where: 'editor',
	},
	{ key: `Ctrl+${ALT}+G`, label: 'Source control', section: 'General', where: 'all' },
	{ key: `Ctrl+${ALT}+X`, label: 'Plugins panel', section: 'General', where: 'all' },
	{ key: `Ctrl+${ALT}+I`, label: 'Show problem at cursor', section: 'General', where: 'editor' },
	{ key: 'Ctrl+Q', label: 'Quit', section: 'General', where: 'all' },
	{ key: 'Mouse', label: 'Click tabs, tree rows, editor', section: 'General', where: 'help' },

	{ key: `Ctrl+${ALT}+R`, label: 'Review panel', section: 'Review', where: 'all' },
	{
		key: `Ctrl+${ALT}+A`,
		label: 'Note this line for a review',
		section: 'Review',
		where: 'editor',
	},
	{
		key: '↑↓ · Enter · f/r/⌫',
		label: 'Move · jump/open · fetch/reply/drop (in review)',
		section: 'Review',
		where: 'review',
	},

	{
		key: 'Ctrl+S',
		label: 'Save file',
		section: 'Editing',
		where: 'editor',
		hint: { pane: 'editor', label: 'save', rank: 2 },
	},
	{ key: 'Ctrl+Z / Ctrl+Y', label: 'Undo / redo', section: 'Editing', where: 'editor' },
	{ key: 'Ctrl+A', label: 'Select all', section: 'Editing', where: 'editor' },
	{ key: 'Ctrl+C', label: 'Copy selection — quits if none', section: 'Editing', where: 'all' },
	{ key: 'Ctrl+X / Ctrl+V', label: 'Cut / paste', section: 'Editing', where: 'editor' },
	{ key: 'Ctrl+/ · Ctrl+L', label: 'Toggle comment', section: 'Editing', where: 'editor' },
	{
		key: `Ctrl+${ALT}+S`,
		label: 'Fold block at cursor',
		section: 'Editing',
		where: 'editor',
	},
	{
		key: `Ctrl+${ALT}+E`,
		label: 'Unfold block at cursor',
		section: 'Editing',
		where: 'editor',
	},
	{ key: `${ALT}+↑ / ↓`, label: 'Move line or selection', section: 'Editing', where: 'editor' },
	{
		key: 'PgUp/PgDn · ^U/^D',
		label: 'Page the editor',
		section: 'Editing',
		where: 'editor',
	},
	{
		key: `${ALT}+Shift+↑ / ↓`,
		label: 'Duplicate line or selection',
		section: 'Editing',
		where: 'editor',
	},
	{ key: `Ctrl+${ALT}+B`, label: 'Go to beginning of line', section: 'Editing', where: 'editor' },
	{ key: `Ctrl+${ALT}+L`, label: 'Format document', section: 'Editing', where: 'editor' },
	{ key: 'Shift+Tab', label: 'Outdent', section: 'Editing', where: 'editor' },

	{
		key: 'Ctrl+F',
		label: 'Find in file (Tab to replace)',
		section: 'Search & replace',
		where: 'editor',
		hint: { pane: 'editor', label: 'find', rank: 3 },
		welcome: { rank: 3, label: 'find in file' },
	},
	{ key: 'Ctrl+R', label: 'Find in project', section: 'Search & replace', where: 'all' },
	{
		key: 'Enter / Ctrl+A',
		label: 'Replace this match / all (in replace)',
		section: 'Search & replace',
		where: 'help',
	},
	{
		key: `Ctrl+C / W / R`,
		label: 'Case / whole word / regex (in search)',
		section: 'Search & replace',
		where: 'help',
	},

	{
		key: 'Ctrl+N',
		label: 'New file',
		section: 'Files & tabs',
		where: 'all',
		hint: { pane: 'tree', label: 'new file', rank: 10 },
	},
	{ key: `Ctrl+${ALT}+N`, label: 'New folder', section: 'Files & tabs', where: 'all' },
	{ key: `Ctrl+${ALT}+C`, label: 'Copy path of this file', section: 'Files & tabs', where: 'all' },
	{ key: 'Ctrl+W', label: 'Close tab', section: 'Files & tabs', where: 'all' },
	{ key: `Ctrl+${ALT}+T`, label: 'Reopen closed tab', section: 'Files & tabs', where: 'all' },
	{ key: 'Ctrl+T', label: 'Switch to open tab', section: 'Files & tabs', where: 'all' },
	{ key: `Ctrl+${ALT}+Z / Y`, label: 'Go back / forward', section: 'Files & tabs', where: 'all' },
	{ key: `Ctrl+${ALT}+← / →`, label: 'Previous / next tab', section: 'Files & tabs', where: 'all' },

	{
		key: 'Enter',
		label: 'Open file / toggle folder',
		section: 'File tree',
		where: 'tree',
		hint: { pane: 'tree', label: 'open', rank: 2 },
	},
	{
		key: '↑↓',
		label: 'Move in tree / popup',
		section: 'File tree',
		where: 'tree',
		hint: { pane: 'tree', label: 'move', rank: 4 },
	},
	{ key: 'Shift+↑ / ↓', label: 'Select a range (in tree)', section: 'File tree', where: 'tree' },
	{ key: '→ / ←', label: 'Expand / collapse folder', section: 'File tree', where: 'tree' },
	// Bindable as view.preview, but Space here is tree-local — no global chord replaces it.
	{
		key: 'Space · PgUp/Dn',
		label: 'Preview file, no tab · scroll it',
		section: 'File tree',
		where: 'tree',
		hint: { pane: 'tree', label: 'preview', rank: 3, key: 'Space' },
	},
	{ key: 'a / A', label: 'New file / folder (in tree)', section: 'File tree', where: 'tree' },
	{
		key: 'r / d',
		label: 'Rename / delete (in tree)',
		section: 'File tree',
		where: 'tree',
		hint: { pane: 'tree', label: 'rename/delete', rank: 5 },
	},
	{
		key: 'x / c / p',
		label: 'Cut / copy / paste here (in tree)',
		section: 'File tree',
		where: 'tree',
		hint: { pane: 'tree', label: 'move/copy', rank: 6 },
	},
	{
		key: '[ / ]',
		label: 'Narrow / widen sidebar (in tree)',
		section: 'File tree',
		where: 'tree',
		hint: { pane: 'tree', label: 'width', rank: 7 },
	},

	{
		key: '↑↓ · Enter · ←→',
		label: 'Move · diff/open · fold (in git)',
		section: 'Source control',
		where: 'git',
	},
	{
		key: 'Space c d p b B /',
		label: 'Stage/commit/discard/push/branch/compare/filter',
		section: 'Source control',
		where: 'git',
	},

	{
		key: '↑↓ · Enter · ⌫',
		label: 'Move · install/toggle · uninstall (in plugins)',
		section: 'Plugins',
		where: 'plugins',
	},
	{
		key: '/ · u · r',
		label: 'Find · update all · recheck (in plugins)',
		section: 'Plugins',
		where: 'plugins',
	},

	{
		key: 'Ctrl+B',
		label: 'Show / hide sidebar',
		section: 'View',
		where: 'all',
	},
	{
		key: `Ctrl+${ALT}+M`,
		label: 'Markdown: rendered / source',
		section: 'View',
		where: 'all',
	},
	{
		key: 'Tab',
		label: 'Tree → editor · indent in editor',
		section: 'View',
		where: 'all',
		hint: { pane: 'tree', label: 'editor', rank: 8 },
	},
	{
		key: 'Esc',
		label: 'Editor → tree',
		section: 'View',
		where: 'editor',
		hint: { pane: 'editor', label: 'tree', rank: 4 },
	},
];

/** The help table: every row, key and long label. */
export const ROWS: [string, string][] = KEYS.map((info) => [info.key, info.label]);

export interface HelpSection {
	title: string;
	rows: [string, string][];
}

/** The table split at its section boundaries, for the help overlay's headings. */
export const SECTIONS: HelpSection[] = KEYS.reduce<HelpSection[]>((out, info) => {
	if (out.at(-1)?.title !== info.section) out.push({ title: info.section, rows: [] });
	out.at(-1)!.rows.push([info.key, info.label]);
	return out;
}, []);

/** Footer hints for `pane`, most useful first. */
export function hintsFor(pane: KeyScope): ReadonlyArray<readonly [string, string]> {
	return KEYS.filter((info) => info.hint && (info.hint.pane === pane || info.hint.pane === 'all'))
		.toSorted((a, b) => a.hint!.rank - b.hint!.rank)
		.map((info) => [info.hint!.key ?? info.key, info.hint!.label] as const);
}

/** Rows for the empty editor prompt, most useful first. */
export function welcomeKeys(): ReadonlyArray<readonly [string, string]> {
	return KEYS.filter((info) => info.welcome)
		.toSorted((a, b) => a.welcome!.rank - b.welcome!.rank)
		.map((info) => [info.welcome!.key ?? info.key, info.welcome!.label ?? info.label] as const);
}

/** Everything alive in `pane`, for the peek strip. */
export function keysFor(pane: KeyScope): KeyInfo[] {
	return KEYS.filter((info) => info.where === pane || info.where === 'all');
}

/**
 * The shortcut text for a bindable command id: the user's override — '' if
 * they disabled it with `none` — or `fallback` where nothing was set. Shared
 * by every control that draws a tooltip or a footer label off
 * `config.keybindings`, so a rebound command reads the same everywhere.
 */
export function effectiveShortcut(
	keybindings: Record<string, string>,
	id: string,
	fallback = '',
): string {
	const custom = keybindings[id];
	if (custom === undefined) return fallback;
	return isDisabledShortcut(custom) ? '' : custom;
}
