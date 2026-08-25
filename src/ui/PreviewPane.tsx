import { basename } from 'node:path';
import { statSync } from 'node:fs';

import type { ScrollBoxRenderable, TreeSitterClient } from '@opentui/core';
import { createEffect, createMemo, createSignal, on, onMount, Show } from 'solid-js';

import { BinaryFileError, readFile } from '../core/fs';
import { isImagePath } from '../core/image';
import { isPdfPath } from '../core/pdf';
import { filetypeForPath, getSyntaxStyle, highlightClient } from '../languages/highlight';
import { ui } from '../themes';
import { ImageView } from './ImageView';

export interface PreviewPaneProps {
	path: string;
	isDir: boolean;
	buffer?: string;
	width: number;
	height: number;
	scroll: { pages: number; at: number } | null;
	onFocus: () => void;
}

const MAX_PREVIEW_BYTES = 512 * 1024;

type Shown = { kind: 'text'; text: string } | { kind: 'image' } | { kind: 'note'; note: string };

const sizeOf = (path: string) => {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
};

const sizeLabel = (bytes: number) =>
	bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.round(bytes / 1024)} KB`;

const cut = (text: string, width: number) => {
	if (width <= 0) return '';
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
};

export function PreviewPane(props: PreviewPaneProps) {
	const [client, setClient] = createSignal<TreeSitterClient | null | undefined>(undefined);
	onMount(() => void highlightClient().then((c) => setClient(c)));

	const style = createMemo(() => getSyntaxStyle());

	let box: ScrollBoxRenderable | undefined;
	const page = () => Math.max(1, props.height - 2);

	createEffect(
		on(
			() => props.scroll,
			(request) => {
				if (box && request) box.scrollTop = Math.max(0, box.scrollTop + request.pages * page());
			},
			{ defer: true },
		),
	);

	createEffect(
		on(
			() => props.path,
			() => {
				if (box) box.scrollTop = 0;
			},
			{ defer: true },
		),
	);

	const shown = createMemo<Shown>(() => {
		if (props.isDir) return { kind: 'note', note: 'Folder — → opens it' };
		if (isImagePath(props.path)) return { kind: 'image' };
		if (isPdfPath(props.path)) return { kind: 'note', note: 'PDF — Enter opens the viewer' };
		if (props.buffer !== undefined) return { kind: 'text', text: props.buffer };
		const bytes = sizeOf(props.path);
		if (bytes > MAX_PREVIEW_BYTES) {
			return { kind: 'note', note: `${sizeLabel(bytes)} — too big to preview; Enter opens it` };
		}
		try {
			return { kind: 'text', text: readFile(props.path) };
		} catch (e) {
			return {
				kind: 'note',
				note:
					e instanceof BinaryFileError
						? `Binary — ${sizeLabel(bytes)}, nothing to show`
						: (e as Error).message,
			};
		}
	});

	const note = createMemo(() => {
		const what = shown();
		return what.kind === 'note' ? what.note : null;
	});
	const text = createMemo(() => {
		const what = shown();
		return what.kind === 'text' ? what.text : null;
	});

	const hints = () => {
		const full = ' preview · Enter opens · Space closes ';
		return full.length + 12 <= props.width ? full : ' preview · Esc ';
	};

	const name = () => cut(basename(props.path), Math.max(0, props.width - hints().length - 2));

	return (
		<box
			width="100%"
			height="100%"
			flexDirection="column"
			backgroundColor={ui.bg}
			onMouseDown={() => props.onFocus()}
		>
			<box flexDirection="row" backgroundColor={ui.barBg}>
				<text fg={ui.text} bg={ui.barBg} flexShrink={0} wrapMode="none" content={` ${name()}`} />
				<box flexGrow={1} backgroundColor={ui.barBg} />
				<text fg={ui.dim} bg={ui.barBg} flexShrink={0} wrapMode="none" content={hints()} />
			</box>

			<Show when={shown().kind === 'image'}>
				<ImageView
					path={props.path}
					width={props.width}
					height={props.height - 1}
					onFocus={props.onFocus}
				/>
			</Show>
			<Show when={note()}>
				{(what: () => string) => <text fg={ui.dim} bg={ui.bg} content={`  ${what()}`} />}
			</Show>
			<Show when={text() !== null}>
				<scrollbox
					ref={(el: ScrollBoxRenderable) => (box = el)}
					flexGrow={1}
					backgroundColor={ui.bg}
					paddingLeft={1}
					scrollbarOptions={{
						trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.bg },
					}}
				>
					<code
						content={text() ?? ''}
						filetype={filetypeForPath(props.path)}
						syntaxStyle={style()}
						treeSitterClient={client() ?? undefined}
						wrapMode="word"
						fg={ui.text}
						bg={ui.bg}
					/>
				</scrollbox>
			</Show>
		</box>
	);
}
