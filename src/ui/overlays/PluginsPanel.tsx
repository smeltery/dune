import { TextAttributes, type KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { For, Show } from 'solid-js';

import type { PluginRow } from '../../app/appearance/pluginsPanel';
import { ui } from '../../themes';

const cut = (text: string, width: number) =>
	width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

const rowBg = (active: boolean, focused: boolean) =>
	active ? (focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg;

const sectionRow = (row: PluginRow) => (row.kind === 'section' ? row : undefined);
const installedRow = (row: PluginRow) => (row.kind === 'installed' ? row : undefined);

export interface PluginsPanelProps {
	rows: PluginRow[];
	cursor: number;
	installedCount: number;
	query: string | null;
	focused: boolean;
	width: number;
	onFocus: () => void;
	onActivate: (index: number) => void;
	onMove: (delta: number) => void;
	onRemove: () => void;
	onCheck: () => void;
	onUpdateAll: () => void;
	onOpenSearch: () => void;
	onCloseSearch: () => void;
	onSearch: (value: string) => void;
	onClose: () => void;
}

export function PluginsPanel(props: PluginsPanelProps) {
	const cursor = () => Math.max(0, Math.min(props.cursor, Math.max(0, props.rows.length - 1)));

	const version = (row: PluginRow) => {
		if (row.kind === 'available') return row.version;
		if (row.kind !== 'installed') return '';
		return row.update ? `→ ${row.update}` : row.version;
	};

	useKeyboard((key: KeyEvent) => {
		if (!props.focused) return;
		if (props.query !== null) {
			if (key.name === 'escape') {
				props.onCloseSearch();
				key.preventDefault();
				return;
			}
			if (key.name === 'return' || key.name === 'enter') {
				props.onActivate(cursor());
				key.preventDefault();
				return;
			}
			if (key.name === 'backspace') {
				props.onSearch(props.query.slice(0, -1));
				key.preventDefault();
				return;
			}
			if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
				props.onSearch(props.query + key.sequence);
				key.preventDefault();
				return;
			}
			return;
		}
		if (key.name === 'up') props.onMove(-1);
		else if (key.name === 'down') props.onMove(1);
		else if (key.name === 'return' || key.name === 'enter') props.onActivate(cursor());
		else if (key.name === 'backspace') props.onRemove();
		else if (key.name === 'escape') props.onClose();
		else if (key.sequence === '/') props.onOpenSearch();
		else if (key.sequence === 'u') props.onUpdateAll();
		else if (key.sequence === 'r') props.onCheck();
		else return;
		key.preventDefault();
	});

	return (
		<box
			width={props.width}
			flexDirection="column"
			backgroundColor={ui.panelBg}
			flexShrink={0}
			flexGrow={1}
			flexBasis={0}
			onMouseDown={() => props.onFocus()}
		>
			<box
				height={1}
				flexDirection="row"
				backgroundColor={ui.panelBg}
				paddingLeft={2}
				paddingRight={1}
			>
				<text
					fg={props.focused ? ui.text : ui.dim}
					bg={ui.panelBg}
					flexShrink={1}
					wrapMode="none"
					content={`${props.installedCount} installed`}
					attributes={TextAttributes.BOLD}
				/>
				<box flexGrow={1} backgroundColor={ui.panelBg} />
				<text fg={ui.faint} bg={ui.panelBg} flexShrink={0} wrapMode="none" content=" plugins" />
			</box>
			<box
				height={1}
				flexDirection="row"
				backgroundColor={ui.panelBg}
				paddingLeft={1}
				onMouseDown={() => props.onOpenSearch()}
			>
				<text fg={ui.faint} bg={ui.panelBg} flexShrink={0} content="/ " />
				<text
					fg={ui.faint}
					bg={ui.panelBg}
					wrapMode="none"
					content={
						props.query === null
							? 'name, theme, lsp…'
							: props.query.length > 0
								? props.query
								: 'name, theme, lsp…'
					}
				/>
			</box>
			<Show
				when={props.rows.length > 0}
				fallback={
					<box flexGrow={1} backgroundColor={ui.panelBg} paddingLeft={2}>
						<text fg={ui.faint} bg={ui.panelBg} content="nothing matches" />
					</box>
				}
			>
				<box flexGrow={1} flexDirection="column" backgroundColor={ui.panelBg}>
					<For each={props.rows}>
						{(row, at) => {
							const bg = () => rowBg(at() === cursor(), props.focused);
							return (
								<box
									height={1}
									flexDirection="row"
									backgroundColor={bg()}
									onMouseDown={() => props.onActivate(at())}
								>
									<Show when={sectionRow(row)}>
										{(section: () => PluginRow & { kind: 'section' }) => (
											<>
												<text
													fg={ui.dim}
													bg={bg()}
													flexShrink={0}
													content={` ${section().collapsed ? '▸' : '▾'} `}
												/>
												<box flexGrow={1} backgroundColor={bg()}>
													<text
														wrapMode="none"
														fg={ui.folder}
														bg={bg()}
														content={section().label}
														attributes={TextAttributes.BOLD}
													/>
												</box>
												<text
													fg={ui.faint}
													bg={bg()}
													flexShrink={0}
													content={`${section().count} `}
												/>
											</>
										)}
									</Show>
									<Show when={row.kind === 'note'}>
										<text
											wrapMode="none"
											fg={ui.faint}
											bg={bg()}
											content={`   ${cut(row.label, props.width - 4)}`}
										/>
									</Show>
									<Show when={row.kind === 'installed' || row.kind === 'available'}>
										<text
											fg={row.kind === 'installed' && row.disabled ? ui.faint : ui.accent}
											bg={bg()}
											flexShrink={0}
											content={
												row.kind === 'installed' ? `   ${row.disabled ? '✗' : '✓'} ` : '   + '
											}
										/>
										<text
											wrapMode="none"
											fg={row.kind === 'installed' && row.disabled ? ui.dim : ui.text}
											bg={bg()}
											flexShrink={1}
											content={cut(row.label, Math.max(4, props.width - 14))}
										/>
										<Show
											when={
												(row.kind === 'installed' || row.kind === 'available') &&
												row.categories.length > 0
											}
										>
											<text
												fg={ui.faint}
												bg={bg()}
												flexShrink={0}
												content={`  ${row.kind === 'installed' || row.kind === 'available' ? row.categories.join(' ') : ''}`}
											/>
										</Show>
										<box flexGrow={1} backgroundColor={bg()} />
										<text
											fg={installedRow(row)?.update ? ui.accent : ui.faint}
											bg={bg()}
											flexShrink={0}
											content={`${version(row)} `}
										/>
									</Show>
								</box>
							);
						}}
					</For>
				</box>
			</Show>
			<box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
				<text fg={ui.faint} bg={ui.panelBg} content="↑↓ · Enter · Bksp · / search" />
			</box>
		</box>
	);
}
