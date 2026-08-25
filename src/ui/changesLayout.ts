import type { ChangeSection } from '../core/changeSections';
import { DIFF_MAX_LINES } from '../core/changeSections';
import type { ChangeArea } from '../core/git';
import type { ChangesMeta } from '../core/changeSections';

/**
 * Two rows, so the next file can push a header off one row at a time. A one-row
 * header snaps out of view instead, which is not the sticky bar this is copying.
 */
export const SECTION_HEADER_ROWS = 2;

export interface StickyHeader {
	index: number;
	/** Header rows already pushed off the top. 0 = fully stuck. */
	clipped: number;
}

/**
 * Which in-flow header should be mirrored at the top of the viewport. `ys` are
 * content-space y of each header's first row, in section order. Null when the
 * in-flow header is already at the top — there is nothing to pin — or has been
 * pushed off entirely by the next one.
 */
export function stickyHeader(scrollTop: number, ys: readonly number[]): StickyHeader | null {
	if (ys.length === 0 || ys.some((y) => !Number.isFinite(y))) return null;
	let index = -1;
	for (let i = 0; i < ys.length; i++) {
		if (ys[i]! <= scrollTop) index = i;
		else break;
	}
	if (index < 0) return null;
	if (ys[index]! >= scrollTop) return null;
	let clipped = 0;
	const next = ys[index + 1];
	if (next !== undefined) {
		const room = next - scrollTop;
		if (room <= 0) return null;
		if (room < SECTION_HEADER_ROWS) clipped = SECTION_HEADER_ROWS - room;
	}
	return { index, clipped };
}

/** Header line. When the stack was cut, `+X -Y` is what is showing, not the
 * whole change list. */
export function changesSummary(title: string, shown: number, meta: ChangesMeta): string {
	const counts = `+${meta.adds} -${meta.dels}`;
	const files = `${meta.total} file${meta.total === 1 ? '' : 's'}`;
	if (meta.total > shown) return `${title} · showing ${shown} of ${files} · ${counts}`;
	return `${title} · ${files} · ${counts}`;
}

/** The tail of a path identifies the file, so that is the end to keep. */
export function cutPath(rel: string, room: number): string {
	if (room <= 0) return '';
	if (rel.length <= room) return rel;
	return `…${rel.slice(rel.length - room + 1)}`;
}

export const areaBadge = (area: ChangeArea): string | undefined =>
	area === 'unstaged' ? undefined : area === 'merge' ? 'merge' : 'staged';

export function sectionHeaderMeta(section: ChangeSection): string {
	if (!section.file) return '  binary';
	const bits = [`+${section.adds} -${section.dels}`];
	const badge = areaBadge(section.area);
	if (badge) bits.push(badge);
	if (section.truncated) bits.push(`first ${DIFF_MAX_LINES} lines`);
	return `  ${bits.join(' · ')}`;
}

export function sectionPath(section: ChangeSection): string {
	const old = section.file?.oldRel;
	return old && old !== section.rel ? `${old} -> ${section.rel}` : section.rel;
}
