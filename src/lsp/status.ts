/**
 * The shapes the LSP status page renders. Kept in `lsp/` rather than `app/lsp/`
 * because `ui/overlays/LspStatusView` needs them and nothing in `ui/` may
 * import from `app/` — the store that fills them still lives in
 * `app/lsp/index.ts`.
 */

export type ServerState = 'starting' | 'ready' | 'stopped' | 'disabled' | 'failed';

/** One line of a server's log — a stderr line, a window/logMessage, or a lifecycle event. */
export interface ServerLogLine {
	/** HH:MM:SS, stamped when the line arrived. */
	time: string;
	kind: 'stderr' | 'server' | 'event';
	text: string;
}

export interface LspStatusRow {
	id: string;
	filetypes: string[];
	command: string;
	state: ServerState;
	problems: number;
	/** Why the server is `failed`, or null otherwise. */
	error: string | null;
	logs: ServerLogLine[];
}
