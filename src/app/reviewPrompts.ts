import { NOTE_KINDS } from '../core/review';
import type { NoteKind } from '../core/review';
import type { Prompt } from './types';

export function reviewLineTarget(
	activePath: () => string | null,
	cursorLine: () => number,
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void,
): Extract<Prompt, { kind: 'reviewKind' }> | null {
	const path = activePath();
	if (!path) {
		say('No file to review', 'warn');
		return null;
	}
	const line = cursorLine();
	return { kind: 'reviewKind', path, line, endLine: line };
}

export function reviewNotePrompt(
	target: Extract<Prompt, { kind: 'reviewKind' }>,
	kind: NoteKind,
): Extract<Prompt, { kind: 'reviewNote' }> {
	return {
		kind: 'reviewNote',
		noteKind: kind,
		path: target.path,
		line: target.line,
		endLine: target.endLine,
	};
}

export function parseReviewKind(kind: string): NoteKind | null {
	return NOTE_KINDS.includes(kind as NoteKind) ? (kind as NoteKind) : null;
}
