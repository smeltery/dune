/**
 * Tooltips: the key that does what a chrome button does, and nothing else.
 *
 * A terminal has no hover layer, so dune draws a button's affordance on the row
 * the cursor is on. That leaves the mouse user knowing what the buttons do and
 * never learning the keys — which is what this is for. A tooltip is therefore a
 * chord and no words: a control that already carries its own glyph or label
 * gets a chip that says only the shortcut, not a repeat of what is beside it.
 * Two ways in, showing the same thing:
 *
 * - Resting the pointer on one control gives that control's chord.
 * - Holding Ctrl (or Cmd) for half a second lights every control's chord at once.
 *
 * Both halves are a *pause*: a chip that appeared the instant the pointer
 * crossed a control would flash chord after chord as the mouse travelled the
 * tab strip on its way to the editor.
 *
 * It follows that a control with no chord to show has no tooltip at all.
 *
 * The peek half needs the terminal to report a modifier key as an event of its
 * own, which only the kitty keyboard protocol does. Where the terminal has no
 * protocol nothing arrives and nothing happens, which is the right failure:
 * hover still works.
 *
 * Registration is module state rather than a context, the way `keys.ts` holds
 * its table: `TooltipLayer` draws every registered target wherever it is in the
 * tree, and a context would have to be threaded through components that have no
 * other reason to know about it.
 */
import type { KeyEvent } from '@opentui/core';
import { onBlur, useKeyboard } from '@opentui/solid';
import { createSignal, onCleanup } from 'solid-js';

import type { TooltipAnchor, TooltipObstacle } from './tooltipLayout';

/** The box a target lives in, as much of a renderable as this needs. */
interface TargetBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface Target {
	id: number;
	/** The chord this control advertises; '' draws no tooltip for it. */
	chord: () => string;
	box: () => TargetBox | null;
}

const targets = new Map<number, Target>();
let nextId = 1;

/**
 * Bumped as targets come and go. The layer reads the boxes imperatively off the
 * renderables — they are laid out by then, and nothing about a renderable is a
 * signal — so without this a tooltip'd control that mounts while the peek is up
 * would not appear until something else changed.
 */
const [version, bump] = createSignal(0);
const [hovered, setHovered] = createSignal<number | null>(null);
const [held, setHeld] = createSignal(false);

/** How long the pointer has to rest on a control before its chord is drawn. */
export const TOOLTIP_DWELL_MS = 400;

/**
 * The last target whose dwell counted out. Paired with `hovered` rather than
 * read alone — see `resting`.
 */
const [dwelled, setDwelled] = createSignal<number | null>(null);
let dwell: ReturnType<typeof setTimeout> | null = null;

const clearDwell = () => {
	if (dwell) clearTimeout(dwell);
	dwell = null;
};

/**
 * The target to annotate: the pointer is on it *and* it has counted out there.
 * Two signals rather than one because leaving has to hide the chip at once
 * while the count it earned outlives the turn — see `leave`.
 */
const resting = () => {
	const at = hovered();
	return at !== null && at === dwelled() ? at : null;
};

function enter(id: number) {
	if (hovered() === id) return;
	clearDwell();
	setHovered(id);
	// The pointer that never really left this control (below) keeps the chord
	// it already earned rather than counting a second time under a reader's eyes.
	if (dwelled() === id) return;
	setDwelled(null);
	dwell = setTimeout(() => {
		dwell = null;
		setDwelled(id);
	}, TOOLTIP_DWELL_MS);
}

/**
 * Conditional: crossing onto the next control can deliver its `over` before
 * this one's `out`, and clearing unconditionally would erase the new state —
 * the pending dwell along with it.
 *
 * The count is forgotten a turn later rather than here. Moving the pointer
 * between two children of one control delivers an `out` and the next `over` in
 * the same turn, and forgetting synchronously would blink the chip away and
 * start it counting again mid-control; a microtask lands after both, so only a
 * pointer that is still off every target forgets.
 */
function leave(id: number) {
	if (hovered() !== id) return;
	clearDwell();
	setHovered(null);
	queueMicrotask(() => {
		if (hovered() === null) setDwelled(null);
	});
}

/**
 * The `tooltips` setting, pushed in by `AppView`. It lives here rather than
 * staying a prop on the layer because the peek is more than the boxes: nothing
 * lights up with it either, and a component asking "am I lit?" must get
 * `false` from the same switch that stops the boxes being drawn.
 */
const [enabled, setEnabled] = createSignal(true);

export { setEnabled as setTooltipsEnabled };

/** The peek as the rest of the editor sees it — off entirely while turned off. */
const peeking = () => enabled() && held();

/**
 * Register one control, by the chord it advertises. `chord` may be a plain
 * string for a fixed key or a function for one that depends on a user's
 * keybinding override; both take the same shape as `enter`/`leave`/`ref` so
 * callers can wire it up alongside `onMouseOver`/`onMouseOut` without branching.
 *
 * An empty chord registers a control that draws no tooltip — the placement
 * still has to know its cells are spoken for, so the peek does not draw a
 * neighbour's chip over it.
 */
export function useTooltip(chord: string | (() => string) | undefined) {
	const id = nextId++;
	let box: TargetBox | null = null;
	const chordOf = typeof chord === 'function' ? chord : () => chord ?? '';

	targets.set(id, { id, chord: chordOf, box: () => box });
	bump((at) => at + 1);

	onCleanup(() => {
		targets.delete(id);
		leave(id);
		bump((at) => at + 1);
	});

	return {
		hovered: () => hovered() === id,
		/**
		 * Whether to paint this control as live: under the pointer, or lit by a
		 * peek. Not delayed the way the chip is — the tint is the control
		 * answering the pointer, and one that takes half a second to admit it
		 * reads as a dead cell.
		 */
		lit: () => hovered() === id || (peeking() && chordOf() !== ''),
		enter: () => enter(id),
		leave: () => leave(id),
		ref: (node: TargetBox) => {
			box = node;
		},
	};
}

/**
 * What to draw now: nothing unless the pointer has rested on a target or the
 * peek is up, and nothing for a control with no chord — a tooltip is all a
 * chip ever says, so with nothing to say there is nothing to draw.
 */
export function tooltipAnchors(): TooltipAnchor[] {
	version();
	if (!enabled()) return [];
	const at = resting();
	const peek = peeking();
	const anchors: TooltipAnchor[] = [];

	for (const target of targets.values()) {
		if (!peek && target.id !== at) continue;
		const chord = target.chord();
		if (!chord) continue;
		const box = target.box();
		if (!box) continue;
		anchors.push({
			id: target.id,
			text: ` ${chord} `,
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height,
		});
	}

	return anchors;
}

/**
 * Every registered control's cells — what the peek must not draw over. Hover
 * returns none: a single chip sits against its control, and a tooltip must
 * still reach for the nearest free row even when it happens to belong to a
 * neighbour.
 */
export function tooltipObstacles(): TooltipObstacle[] {
	version();
	if (!enabled() || !peeking()) return [];
	const boxes: TooltipObstacle[] = [];
	for (const target of targets.values()) {
		const box = target.box();
		if (box) boxes.push({ x: box.x, y: box.y, width: box.width, height: box.height });
	}
	return boxes;
}

/** How long Ctrl has to be held down before the keys light up. */
const HOLD_MS = 500;

/**
 * The peek cannot outlive this, however the hold ended. A terminal that drops
 * the release — the window loses focus mid-hold on some of them — would
 * otherwise leave the keys on screen for the rest of the session.
 */
const MAX_MS = 10_000;

/**
 * Modifiers worth holding. Ctrl is the one every chord here starts with; Cmd is
 * what a macOS user reaches for out of habit, and it costs nothing to answer.
 * Alt is deliberately absent: it is half of Ctrl+Opt, so holding it while
 * reaching for one of those chords would flash the keys mid-shortcut.
 */
const PEEK_KEYS = new Set([
	'leftctrl',
	'rightctrl',
	'leftsuper',
	'rightsuper',
	'leftmeta',
	'rightmeta',
]);

/**
 * Watch for the hold. Mounted once, by `AppView`.
 *
 * `useKeyboard(..., { release: true })` puts presses and releases through one
 * handler; releases reach no other listener in the editor, so turning the
 * protocol's event reporting on costs the existing key handling nothing.
 *
 * The one place that subscribes to OpenTUI directly rather than through the
 * app's own keyboard handlers: a modifier's own name has no need of the Latin
 * remapping those do, and they cannot ask for release events at all.
 */
export function useTooltipPeek(): void {
	let hold: ReturnType<typeof setTimeout> | null = null;
	let expiry: ReturnType<typeof setTimeout> | null = null;

	const stop = () => {
		if (hold) clearTimeout(hold);
		if (expiry) clearTimeout(expiry);
		hold = null;
		expiry = null;
		setHeld(false);
	};

	useKeyboard(
		(key: KeyEvent) => {
			const modifier = PEEK_KEYS.has(key.name);
			if (key.eventType === 'release') {
				if (modifier) stop();
				return;
			}
			// Any real key ends it: Ctrl held on the way to Ctrl+S is not a request
			// to read the keys, and the peek must be gone before the chord runs.
			if (!modifier) {
				stop();
				return;
			}
			if (key.repeated || hold || held()) return;
			hold = setTimeout(() => {
				hold = null;
				setHeld(true);
				expiry = setTimeout(stop, MAX_MS);
			}, HOLD_MS);
		},
		{ release: true },
	);

	// A terminal sends no release for a key the window lost focus while holding.
	onBlur(stop);
	onCleanup(stop);
}
