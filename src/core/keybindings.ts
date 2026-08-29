import type { KeyEvent } from '@opentui/core';

export interface Chord {
	ctrl: boolean;
	alt: boolean;
	key: string;
}

export type KeybindingEdit =
	| { ok: true; command: string; shortcut: string | null }
	| { ok: false; error: string };

const MODIFIERS: Record<string, 'ctrl' | 'alt'> = {
	ctrl: 'ctrl',
	control: 'ctrl',
	alt: 'alt',
	opt: 'alt',
	option: 'alt',
	meta: 'alt',
	cmd: 'alt',
	command: 'alt',
	shift: 'alt',
};

const ALIASES: Record<string, string> = {
	'←': 'left',
	'→': 'right',
	'↑': 'up',
	'↓': 'down',
	arrowleft: 'left',
	arrowright: 'right',
	arrowup: 'up',
	arrowdown: 'down',
	esc: 'escape',
	enter: 'return',
	ret: 'return',
	pgup: 'pageup',
	pgdn: 'pagedown',
	pgdown: 'pagedown',
	del: 'delete',
	bksp: 'backspace',
	backsp: 'backspace',
	spc: 'space',
};

const FUNCTION_KEY = /^f([1-9]|1[0-2])$/;
const DISPLAY: Record<string, string> = {
	left: '←',
	right: '→',
	up: '↑',
	down: '↓',
	pageup: 'PgUp',
	pagedown: 'PgDn',
	home: 'Home',
	end: 'End',
	tab: 'Tab',
	space: 'Space',
	return: 'Enter',
	escape: 'Esc',
	backspace: 'Bksp',
	delete: 'Del',
	insert: 'Ins',
};
const NAMED = new Set([
	'left',
	'right',
	'up',
	'down',
	'pageup',
	'pagedown',
	'home',
	'end',
	'tab',
	'space',
	'return',
	'escape',
	'backspace',
	'delete',
	'insert',
]);

const RESERVED_CTRL = new Set(['c', 'i', 'm', 'j', 'h', '[', 'space']);

const keyName = (key: string) =>
	NAMED.has(key) || FUNCTION_KEY.test(key) || (key.length === 1 && key >= '!' && key <= '~');

export function parseChord(spelling: string): Chord | null {
	const parts = spelling
		.split('+')
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) return null;
	const chord: Chord = { ctrl: false, alt: false, key: '' };
	for (const [index, part] of parts.entries()) {
		const lower = part.toLowerCase();
		const last = index === parts.length - 1;
		const modifier = MODIFIERS[lower];
		if (modifier && !last) {
			chord[modifier] = true;
			continue;
		}
		if (!last) return null;
		const key = ALIASES[lower] ?? lower;
		if (!keyName(key)) return null;
		chord.key = key;
	}
	return chord.key ? chord : null;
}

export function bindingProblem(chord: Chord): string | null {
	if (!chord.ctrl && !FUNCTION_KEY.test(chord.key))
		return 'A shortcut needs Ctrl or a function key';
	if (chord.ctrl && !chord.alt && RESERVED_CTRL.has(chord.key)) return 'Reserved terminal chord';
	return null;
}

export function isDisabledShortcut(spelling: string): boolean {
	return spelling.trim().toLowerCase() === 'none';
}

export function formatChord(chord: Chord, altLabel: string): string {
	const key =
		DISPLAY[chord.key] ?? (FUNCTION_KEY.test(chord.key) ? chord.key.toUpperCase() : chord.key);
	return [
		...(chord.ctrl ? ['Ctrl'] : []),
		...(chord.alt ? [altLabel] : []),
		key.length === 1 ? key.toUpperCase() : key,
	].join('+');
}

export function chordId(chord: Chord): string {
	return `${chord.ctrl ? 'c' : ''}${chord.alt ? 'a' : ''}:${chord.key}`;
}

export function parseKeybindingEdit(input: string): KeybindingEdit {
	const at = input.indexOf('=');
	if (at < 0) return { ok: false, error: 'Shortcut syntax: command = key' };
	const command = input.slice(0, at).trim();
	if (!command) return { ok: false, error: 'Shortcut needs a command' };
	const shortcut = input.slice(at + 1).trim();
	return { ok: true, command, shortcut: shortcut || null };
}

export const secondary = (key: KeyEvent) => Boolean(key.option || key.meta || key.shift);

const JCUKEN_TO_QWERTY: Record<string, string> = {
	й: 'q',
	ц: 'w',
	у: 'e',
	к: 'r',
	е: 't',
	н: 'y',
	г: 'u',
	ш: 'i',
	щ: 'o',
	з: 'p',
	х: '[',
	ї: ']',
	ф: 'a',
	і: 's',
	ы: 's',
	в: 'd',
	а: 'f',
	п: 'g',
	р: 'h',
	о: 'j',
	л: 'k',
	д: 'l',
	ж: ';',
	є: "'",
	я: 'z',
	ч: 'x',
	с: 'c',
	м: 'v',
	и: 'b',
	т: 'n',
	ь: 'm',
	б: ',',
	ю: '.',
};

export function latinKey(key: KeyEvent): string {
	if (key.baseCode !== undefined && key.baseCode >= 32 && key.baseCode !== 127) {
		try {
			const base = String.fromCodePoint(key.baseCode);
			return base.length === 1 && base >= 'A' && base <= 'Z' ? base.toLowerCase() : base;
		} catch {}
	}
	if (key.name.length === 1 && key.name >= 'A' && key.name <= 'Z') return key.name.toLowerCase();
	return JCUKEN_TO_QWERTY[key.name.toLowerCase()] ?? key.name;
}

/**
 * What a key prints with Caps Lock on.
 *
 * A terminal speaking the kitty protocol reports Caps Lock as a modifier bit and sends
 * the key's own, lowercase code — `CSI 97;65u` for a caps-locked A. The uppercase
 * character reaches the app only through the protocol's associated-text flag, which is
 * not every terminal's default, so without this the lock does nothing and letters type
 * lowercase.
 *
 * Idempotent, which is what lets it run over every key: a terminal that did send the
 * text already produced this character. Shift reverses the lock, as it does on the OS
 * side, so a caps-locked Shift+A is `a` either way.
 */
export function capsChar(char: string, shift: boolean): string {
	if (char.length !== 1) return char;
	const upper = char.toUpperCase();
	const lower = char.toLowerCase();
	if (upper === lower || upper.length !== 1 || lower.length !== 1) return char;
	return shift ? lower : upper;
}

export function matchesChord(chord: Chord, key: KeyEvent): boolean {
	const actual = latinKey(key);
	const name = actual === 'enter' ? 'return' : actual;
	return name === chord.key && Boolean(key.ctrl) === chord.ctrl && secondary(key) === chord.alt;
}
