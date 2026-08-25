import type { LineChange } from '../core/git';
import type { ProblemSeverity } from '../lsp/protocol';
import { ui } from '../themes';

const SIGN_GLYPH: Record<LineChange, string> = { added: '▎', modified: '▎', deleted: '▁' };

/** A filled lozenge for a draft note; hollow for a forge comment. */
export const REVIEW_GLYPH = { draft: '◆', fetched: '◇' } as const;

export type ReviewMark = { draft: boolean; label: string; text: string };

export const problemColor = (severity: ProblemSeverity) =>
	severity === 'error' ? ui.error : severity === 'warning' ? ui.dirty : ui.dim;

export const problemGlyph = (severity: ProblemSeverity | undefined) =>
	severity === 'error' ? '●' : severity === 'warning' ? '▲' : ' ';

export const reviewColor = (draft: boolean) => (draft ? ui.accent : ui.folder);

/** Softer than the gutter mark — annotates rather than shouts. */
export const reviewNoteColor = (draft: boolean) => (draft ? ui.accent : ui.dim);

export function editorLineSigns(
	gitLines: Map<number, LineChange>,
	reviews: Map<number, ReviewMark>,
	problems: Map<number, { severity: ProblemSeverity }>,
) {
	const gitColor: Record<LineChange, string> = {
		added: ui.gitAdded,
		modified: ui.gitModified,
		deleted: ui.gitDeleted,
	};
	const signs = new Map<number, { before?: string; beforeColor?: string }>();
	for (const [line, change] of gitLines) {
		signs.set(line, { before: SIGN_GLYPH[change], beforeColor: gitColor[change] });
	}
	for (const [line, mark] of reviews) {
		signs.set(line, {
			before: mark.draft ? REVIEW_GLYPH.draft : REVIEW_GLYPH.fetched,
			beforeColor: reviewColor(mark.draft),
		});
	}
	for (const [line, problem] of problems) {
		signs.set(line, { before: '●', beforeColor: problemColor(problem.severity) });
	}
	return signs;
}

/**
 * Buffer-row annotations for the after-line text. Reviews first so a diagnostic
 * on the same line wins — the break is more urgent than the remark.
 */
export function buildInlineAnnotations(args: {
	reviews: Map<number, ReviewMark>;
	reviewText: boolean;
	problems: Map<number, { severity: ProblemSeverity; message: string }>;
	problemText: boolean;
	displayOf: (line: number) => number;
}): Map<number, { text: string; color: string }> {
	const wanted = new Map<number, { text: string; color: string }>();
	if (args.reviewText) {
		for (const [line, mark] of args.reviews) {
			const row = args.displayOf(line);
			if (row < 0) continue;
			wanted.set(row, {
				text: `${mark.label}: ${mark.text}`,
				color: reviewNoteColor(mark.draft),
			});
		}
	}
	if (args.problemText) {
		for (const [line, problem] of args.problems) {
			const row = args.displayOf(line);
			if (row < 0) continue;
			wanted.set(row, {
				text: problem.message.replaceAll(/\s+/g, ' '),
				color: problemColor(problem.severity),
			});
		}
	}
	return wanted;
}
