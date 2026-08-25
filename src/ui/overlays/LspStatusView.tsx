import type { KeyEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { createEffect, createSignal, For, on, Show } from 'solid-js';

import type { LspStatusRow, ServerState } from '../../lsp/status';
import { ui } from '../../themes';
import { listRows, modalWidth, PAD } from '../modal';
import { Overlay } from '../Overlay';

const STATE_LABEL: Record<ServerState, string> = {
	ready: 'ready',
	starting: 'starting',
	stopped: 'stopped',
	disabled: 'disabled',
	failed: 'failed',
};

const stateColor = (state: ServerState) =>
	state === 'ready'
		? ui.gitAdded
		: state === 'starting'
			? ui.gitModified
			: state === 'failed'
				? ui.error
				: state === 'disabled'
					? ui.dim
					: ui.faint;

export interface LspStatusViewProps {
	rows: LspStatusRow[];
	/** "Restart language servers", one key away from the log that explains why. */
	onRestart: () => void;
	/** Uninstall dune's own copy of a server. The row says so when there is none. */
	onUninstall: (id: string) => void;
	onClose: () => void;
}

export function LspStatusView(props: LspStatusViewProps) {
	const dimensions = useTerminalDimensions();
	const [index, setIndex] = createSignal(0);
	const [logTop, setLogTop] = createSignal(0);
	const width = () => modalWidth(dimensions().width, 0.7, 72, 108);
	const serverRows = () => listRows(dimensions().height, 12, 5);
	const logRows = () => listRows(dimensions().height, 16, 6);
	const selected = () => Math.min(index(), Math.max(0, props.rows.length - 1));
	const windowStart = () => Math.max(0, Math.min(selected() - serverRows() + 1, props.rows.length));
	const visible = () => props.rows.slice(windowStart(), windowStart() + serverRows());
	const current = () => props.rows[selected()] ?? null;
	const currentLogs = () => current()?.logs ?? [];
	const maxLogTop = () => Math.max(0, currentLogs().length - logRows());
	const clampedLogTop = () => Math.min(logTop(), maxLogTop());
	const visibleLogs = () => currentLogs().slice(clampedLogTop(), clampedLogTop() + logRows());

	// The log follows its tail, the way a terminal does — on every new line and
	// when the selection moves to another server's log.
	createEffect(
		on(
			() => [current()?.id, currentLogs().length],
			() => setLogTop(Number.MAX_SAFE_INTEGER),
		),
	);

	useKeyboard((key: KeyEvent) => {
		const count = Math.max(1, props.rows.length);
		if (key.name === 'up') setIndex((selected() - 1 + count) % count);
		else if (key.name === 'down') setIndex((selected() + 1) % count);
		else if (key.name === 'pageup') setLogTop(Math.max(0, clampedLogTop() - logRows()));
		else if (key.name === 'pagedown') setLogTop(clampedLogTop() + logRows());
		else if (key.name === 'r') props.onRestart();
		else if (key.name === 'd') {
			const row = current();
			if (row) props.onUninstall(row.id);
		} else if (key.name === 'escape') props.onClose();
		else return;
		key.preventDefault();
	});

	const hints = () => {
		const full = ' ↑↓ server · PgUp/PgDn log · r restart · d remove · Esc close ';
		return full.length + 18 <= width() ? full : ' Esc close ';
	};

	return (
		<Overlay zIndex={145}>
			<box
				width={width()}
				flexDirection="column"
				backgroundColor={ui.panelBg}
				border
				borderStyle="rounded"
				borderColor={ui.accent}
				title=" Language Servers "
				titleColor={ui.text}
				paddingLeft={PAD}
				paddingRight={PAD}
			>
				<For each={visible()}>
					{(row, i) => {
						const absolute = () => windowStart() + i();
						const active = () => absolute() === selected();
						const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg);
						return (
							<box flexDirection="column" backgroundColor={bg()}>
								<box flexDirection="row" backgroundColor={bg()}>
									<text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
									<box flexGrow={1} backgroundColor={bg()}>
										<text fg={active() ? ui.text : ui.dim} bg={bg()} content={row.id} />
									</box>
									<text
										fg={stateColor(row.state)}
										bg={bg()}
										content={` ${STATE_LABEL[row.state]} `}
									/>
									<text fg={ui.dim} bg={bg()} content={` ${row.problems} problems `} />
								</box>
								<text fg={ui.dim} bg={bg()} content={`   ${row.filetypes.join(', ')}`} />
								<text
									fg={row.error ? ui.error : ui.text}
									bg={bg()}
									content={`   ${row.error ? `${row.command} — ${row.error}` : row.command}`}
								/>
							</box>
						);
					}}
				</For>
				<Show when={props.rows.length === 0}>
					<text fg={ui.dim} bg={ui.panelBg} content="No language servers configured." />
				</Show>
				<Show when={props.rows.length > 0}>
					<text fg={ui.panelBg} bg={ui.panelBg} content="" />
					<text
						fg={ui.dim}
						bg={ui.panelBg}
						content={`Log — ${current()?.id ?? ''}`.slice(0, width() - PAD * 2 - 2)}
					/>
					<For each={visibleLogs()}>
						{(line) => (
							<box flexDirection="row" backgroundColor={ui.panelBg}>
								<text fg={ui.faint} bg={ui.panelBg} flexShrink={0} content={`${line.time} `} />
								<text
									fg={line.kind === 'event' ? ui.accent : line.kind === 'server' ? ui.text : ui.dim}
									bg={ui.panelBg}
									content={line.text.slice(0, width() - PAD * 2 - 11)}
								/>
							</box>
						)}
					</For>
					<Show when={currentLogs().length === 0}>
						<text fg={ui.dim} bg={ui.panelBg} content="No log lines yet." />
					</Show>
				</Show>
				<text fg={ui.dim} bg={ui.panelBg} content={hints()} />
			</box>
		</Overlay>
	);
}
