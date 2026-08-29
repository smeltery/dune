import type { LspClient } from '../../lsp/client';
import type { ServerSpec } from '../../lsp/servers';

export const VUE_TYPESCRIPT = 'vue-typescript';

/** What typescript-language-server / vtsls expose for raw tsserver RPCs. */
export const TSSERVER_REQUEST = 'typescript.tsserverRequest';

/**
 * How long a relayed request waits for the sibling that can answer it. Vue asks
 * as soon as a `.vue` opens, while the tsserver beside it is still handshaking.
 */
const RELAY_WAIT_MS = 20_000;

/**
 * Other servers registered for a filetype `from` also serves — the only ones
 * that hold the same documents, so the only ones a relayed request may reach.
 */
export function siblingIds(from: string, specs: readonly ServerSpec[]): Set<string> {
	const filetypes = new Set(specs.find((spec) => spec.id === from)?.filetypes ?? []);
	return new Set(
		specs
			.filter((spec) => spec.id !== from && spec.filetypes.some((type) => filetypes.has(type)))
			.map((spec) => spec.id),
	);
}

/**
 * Put one server's `tsserver/request` to the sibling that drives a tsserver.
 * Returns null when nobody can answer — the Vue server still needs a response.
 */
export async function relayTsserverRequest(
	from: string,
	command: string,
	args: unknown,
	clients: Map<string, LspClient | null>,
	specs: readonly ServerSpec[],
): Promise<unknown> {
	const siblings = siblingIds(from, specs);
	const deadline = Date.now() + RELAY_WAIT_MS;
	for (;;) {
		const others = [...clients.entries()]
			.filter(([id, client]) => client !== null && siblings.has(id))
			.map(([, client]) => client!);
		const target = others.find((client) => client.supportsCommand(TSSERVER_REQUEST));
		if (target) {
			const reply = (await target.executeCommand(TSSERVER_REQUEST, [command, args])) as {
				body?: unknown;
			} | null;
			return reply?.body ?? null;
		}
		if (!others.some((client) => !client.ready() && client.state() !== 'dead')) return null;
		if (Date.now() >= deadline) return null;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
