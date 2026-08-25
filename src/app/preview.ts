import { createSignal } from 'solid-js';

export interface PreviewTarget {
	path: string;
	isDir: boolean;
}

/** Quick look: the tree cursor's file drawn over the editor slot without opening a tab. */
export function createPreview(deps: {
	sidebar: () => boolean;
	focus: () => 'tree' | 'editor' | 'gitPanel';
	selectedNode: () => { path: string; isDir: boolean } | null;
}) {
	const [on, setOn] = createSignal(false);
	const [scrollRequest, setScrollRequest] = createSignal<{ pages: number; at: number } | null>(
		null,
	);
	let ticket = 0;

	const target = (): PreviewTarget | null => {
		if (!on() || !deps.sidebar() || deps.focus() !== 'tree') return null;
		const node = deps.selectedNode();
		return node ? { path: node.path, isDir: node.isDir } : null;
	};

	return {
		on,
		target,
		open: () => setOn(true),
		close: () => setOn(false),
		toggle: () => setOn((previewing) => !previewing),
		scroll: (pages: number) => setScrollRequest({ pages, at: ++ticket }),
		scrollRequest,
	};
}

export type Preview = ReturnType<typeof createPreview>;
