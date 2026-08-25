export interface UnifiedDiff {
	patch: string;
	adds: number;
	dels: number;
	/** Rows in `patch`, so a caller can budget screen space without splitting it. */
	lines: number;
	/** `patch` stops at `maxLines`; the rest of the change is not in it. */
	truncated: boolean;
}

interface Edit {
	kind: 'same' | 'del' | 'add';
	oldIndex: number;
	newIndex: number;
}

const CONTEXT = 3;
const MAX_EDIT_DISTANCE = 2000;

export function splitText(text: string): string[] {
	if (text.length === 0) return [];
	const lines = text.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

function lineEdits(oldLines: string[], newLines: string[]): Edit[] {
	let start = 0;
	while (
		start < oldLines.length &&
		start < newLines.length &&
		oldLines[start] === newLines[start]
	) {
		start++;
	}
	let oldEnd = oldLines.length;
	let newEnd = newLines.length;
	while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
		oldEnd--;
		newEnd--;
	}

	const edits: Edit[] = [];
	for (let i = 0; i < start; i++) edits.push({ kind: 'same', oldIndex: i, newIndex: i });
	edits.push(...myers(oldLines.slice(start, oldEnd), newLines.slice(start, newEnd), start, start));
	for (let i = oldEnd; i < oldLines.length; i++) {
		edits.push({ kind: 'same', oldIndex: i, newIndex: i - oldEnd + newEnd });
	}
	return edits;
}

function myers(a: string[], b: string[], oldBase: number, newBase: number): Edit[] {
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];

	const max = Math.min(n + m, MAX_EDIT_DISTANCE);
	const offset = max;
	const v = new Int32Array(2 * max + 2);
	const trace: Int32Array[] = [];
	let found = -1;

	for (let d = 0; d <= max && found < 0; d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
					? v[k + 1 + offset]!
					: v[k - 1 + offset]! + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[k + offset] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
	}
	if (found < 0) return rewrite(n, m, oldBase, newBase);

	const edits: Edit[] = [];
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const prev = trace[d]!;
		const k = x - y;
		const fromK =
			k === -d || (k !== d && prev[k - 1 + offset]! < prev[k + 1 + offset]!) ? k + 1 : k - 1;
		const prevX = prev[fromK + offset]!;
		const prevY = prevX - fromK;
		while (x > prevX && y > prevY) {
			edits.push({ kind: 'same', oldIndex: oldBase + --x, newIndex: newBase + --y });
		}
		if (x === prevX) edits.push({ kind: 'add', oldIndex: -1, newIndex: newBase + --y });
		else edits.push({ kind: 'del', oldIndex: oldBase + --x, newIndex: -1 });
	}
	while (x > 0 && y > 0)
		edits.push({ kind: 'same', oldIndex: oldBase + --x, newIndex: newBase + --y });
	return edits.toReversed();
}

function rewrite(n: number, m: number, oldBase: number, newBase: number): Edit[] {
	const edits: Edit[] = [];
	for (let i = 0; i < n; i++) edits.push({ kind: 'del', oldIndex: oldBase + i, newIndex: -1 });
	for (let i = 0; i < m; i++) edits.push({ kind: 'add', oldIndex: -1, newIndex: newBase + i });
	return edits;
}

export function unifiedDiff(
	rel: string,
	oldText: string,
	newText: string,
	/** Rows the patch may use. A rewritten lockfile is otherwise one screenful per
	 * thousand lines, which the stacked all-changes page would try to lay out. */
	maxLines = Number.MAX_SAFE_INTEGER,
): UnifiedDiff {
	const oldLines = splitText(oldText);
	const newLines = splitText(newText);
	const edits = lineEdits(oldLines, newLines);
	const hunks: { from: number; to: number }[] = [];
	for (let i = 0; i < edits.length; i++) {
		if (edits[i]!.kind === 'same') continue;
		const last = hunks.at(-1);
		if (last && i - last.to <= CONTEXT * 2) last.to = i;
		else hunks.push({ from: i, to: i });
	}
	if (hunks.length === 0) return { patch: '', adds: 0, dels: 0, lines: 0, truncated: false };

	let adds = 0;
	let dels = 0;
	const out = [
		`--- ${oldLines.length === 0 ? '/dev/null' : `a/${rel}`}`,
		`+++ ${newLines.length === 0 ? '/dev/null' : `b/${rel}`}`,
	];
	let oldPos = 0;
	let newPos = 0;
	let at = 0;
	const advance = (edit: Edit) => {
		if (edit.kind !== 'add') oldPos++;
		if (edit.kind !== 'del') newPos++;
	};
	for (const hunk of hunks) {
		const from = Math.max(0, hunk.from - CONTEXT);
		const to = Math.min(edits.length - 1, hunk.to + CONTEXT);
		while (at < from) advance(edits[at++]!);
		const oldStart = oldPos;
		const newStart = newPos;
		let oldCount = 0;
		let newCount = 0;
		const body: string[] = [];
		while (at <= to) {
			const edit = edits[at++]!;
			if (edit.kind === 'same') {
				body.push(` ${oldLines[edit.oldIndex]!}`);
				oldCount++;
				newCount++;
			} else if (edit.kind === 'del') {
				body.push(`-${oldLines[edit.oldIndex]!}`);
				oldCount++;
				dels++;
			} else {
				body.push(`+${newLines[edit.newIndex]!}`);
				newCount++;
				adds++;
			}
			advance(edit);
		}
		out.push(
			`@@ -${oldCount === 0 ? oldStart : oldStart + 1},${oldCount} +${newCount === 0 ? newStart : newStart + 1},${newCount} @@`,
			...body,
		);
	}
	// Counted after the walk, not during it: `adds`/`dels` describe the whole
	// change, and a caller that shows a cut patch still wants the real totals.
	const truncated = out.length > maxLines;
	const rows = truncated ? out.slice(0, maxLines) : out;
	return { patch: `${rows.join('\n')}\n`, adds, dels, lines: rows.length, truncated };
}
