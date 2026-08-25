import { createMemo } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { ProblemsScope } from './lsp/view';
import type { Conflict, PickerState, Prompt, SearchState } from './types';

export function isOverlayOpen(deps: {
	prompt: Accessor<Prompt>;
	palette: Accessor<boolean>;
	conflict: Accessor<Conflict | null>;
	mergeConflictChoice: Accessor<unknown>;
	help: Accessor<boolean>;
	search: Accessor<SearchState>;
	settingsPage: Accessor<boolean>;
	appearancePluginsOpen: Accessor<boolean>;
	lspStatusOpen: Accessor<boolean>;
	diff: Accessor<unknown>;
	update: Accessor<unknown>;
	picker: Accessor<PickerState>;
	problemsOpen: Accessor<ProblemsScope | false>;
	commitFiles: Accessor<unknown>;
	comparisonBase: Accessor<unknown>;
}) {
	return !!(
		deps.prompt() ||
		deps.palette() ||
		deps.conflict() ||
		deps.mergeConflictChoice() ||
		deps.help() ||
		deps.search() ||
		deps.settingsPage() ||
		deps.appearancePluginsOpen() ||
		deps.lspStatusOpen() ||
		deps.diff() ||
		deps.update() ||
		deps.picker() ||
		deps.problemsOpen() ||
		deps.commitFiles() ||
		deps.comparisonBase()
	);
}

export function createOverlayOpen(deps: Parameters<typeof isOverlayOpen>[0]) {
	return createMemo(() => isOverlayOpen(deps));
}
