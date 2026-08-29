import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CompletionItem, Diagnostic, DiagnosticReport, RpcMessage } from './protocol';
import type { ServerLogLine } from './status';
import { createDecoder, encodeMessage } from './transport';

const INITIALIZE_TIMEOUT_MS = 30_000;
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

function trackChild(child: ChildProcess) {
	liveChildren.add(child);
	child.once('exit', () => liveChildren.delete(child));
	if (exitHookInstalled) return;
	exitHookInstalled = true;
	process.on('exit', () => {
		for (const live of liveChildren) {
			try {
				live.kill('SIGKILL');
			} catch {
				// The process may already be gone by the time Node exits.
			}
		}
	});
}

export interface LspClientOptions {
	command: string[];
	rootDir: string;
	onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void;
	onFail: (reason: string, missing: boolean) => void;
	onRefreshDiagnostics?: () => void;
	/**
	 * Answer a `tsserver/request` from a hybrid server (Vue): put the raw
	 * command to a sibling that drives tsserver. Must always resolve — leaving
	 * the request open hangs completion in `.vue` files.
	 */
	onTsserverRequest?: (command: string, args: unknown) => Promise<unknown>;
	/**
	 * A line for the status page's log: a stderr line, a window/logMessage, or a
	 * lifecycle event. Fires whether or not anyone is looking — the page opens
	 * after the interesting part, which is exactly when the log is wanted.
	 */
	onLog?: (entry: Omit<ServerLogLine, 'time'>) => void;
	initializationOptions?: unknown;
	settings?: unknown;
}

/** window/logMessage's MessageType, spelled out. Anything unknown reads as "log". */
const MESSAGE_LEVEL: Record<number, string> = {
	1: 'error',
	2: 'warning',
	3: 'info',
	4: 'log',
	5: 'debug',
};

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
}

export function spawnLspClient(options: LspClientOptions) {
	const [executable, ...args] = options.command;
	if (!executable) throw new Error('language server command is empty');
	const child = spawn(executable, args, {
		cwd: options.rootDir,
		// stderr must be drained: servers chat on it freely, and anything written
		// to an unread pipe would eventually block them mid-request. The listener
		// below consumes it whether or not `onLog` is listening.
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	trackChild(child);

	const log = (kind: ServerLogLine['kind'], text: string) => options.onLog?.({ kind, text });
	log('event', `spawned ${options.command.join(' ')}`);

	let stderrTail = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		const lines = (stderrTail + chunk.toString()).split('\n');
		stderrTail = lines.pop() ?? '';
		for (const line of lines) if (line.trim().length > 0) log('stderr', line);
	});

	let state: 'starting' | 'ready' | 'dead' = 'starting';
	let disposed = false;
	let resolveProvider = false;
	let pullProvider = false;
	let nextId = 1;
	const pending = new Map<number, PendingRequest>();
	const queued: RpcMessage[] = [];
	const versions = new Map<string, number>();
	const pendingPulls = new Set<string>();
	const commands = new Set<string>();

	const send = (message: RpcMessage) => {
		if (child.stdin?.writable) child.stdin.write(encodeMessage(message));
	};

	const request = (method: string, params?: unknown): Promise<unknown> =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			send({ jsonrpc: '2.0', id, method, params });
		});

	const notify = (method: string, params: unknown) => {
		const message: RpcMessage = { jsonrpc: '2.0', method, params };
		if (state === 'starting') queued.push(message);
		else if (state === 'ready') send(message);
	};

	const pullDiagnostics = (path: string) => {
		if (state === 'starting') {
			pendingPulls.add(path);
			return;
		}
		if (state !== 'ready' || !pullProvider) return;
		const uri = pathToFileURL(path).href;
		void request('textDocument/diagnostic', { textDocument: { uri } })
			.then((result) => {
				const report = result as DiagnosticReport | null;
				if (report?.kind === 'full') options.onDiagnostics(uri, report.items ?? []);
			})
			.catch(() => {});
	};

	const die = (reason: string | null, missing = false) => {
		if (state === 'dead') return;
		state = 'dead';
		log('event', reason === null || disposed ? 'stopped' : reason);
		for (const waiter of pending.values()) waiter.reject(new Error(reason ?? 'disposed'));
		pending.clear();
		queued.length = 0;
		if (reason !== null && !disposed) options.onFail(reason, missing);
	};

	const answerTsserverRequests = async (params: unknown) => {
		if (!Array.isArray(params)) return;
		const answers: [number, unknown][] = [];
		for (const entry of params as unknown[]) {
			if (!Array.isArray(entry)) continue;
			const [id, command, args] = entry as [number, string, unknown];
			let body: unknown = null;
			try {
				body = (await options.onTsserverRequest?.(command, args)) ?? null;
			} catch {
				body = null;
			}
			answers.push([id, body]);
		}
		if (answers.length > 0) notify('tsserver/response', answers);
	};

	const answerClientRequest = (message: RpcMessage) => {
		if (message.method === 'workspace/configuration') {
			const items = (message.params as { items?: unknown[] } | undefined)?.items ?? [];
			send({ jsonrpc: '2.0', id: message.id, result: items.map(() => options.settings ?? null) });
			return;
		}
		if (
			message.method === 'client/registerCapability' ||
			message.method === 'client/unregisterCapability' ||
			message.method === 'window/workDoneProgress/create'
		) {
			send({ jsonrpc: '2.0', id: message.id, result: null });
			return;
		}
		send({
			jsonrpc: '2.0',
			id: message.id,
			error: { code: -32601, message: `method not found: ${message.method}` },
		});
	};

	const onMessage = (message: RpcMessage) => {
		if (message.method !== undefined && message.id != null) {
			answerClientRequest(message);
			return;
		}
		if (message.method === 'textDocument/publishDiagnostics') {
			const params = message.params as { uri: string; diagnostics?: Diagnostic[] };
			options.onDiagnostics(params.uri, params.diagnostics ?? []);
			return;
		}
		if (message.method === 'tsserver/request') {
			void answerTsserverRequests(message.params);
			return;
		}
		if (message.method === 'workspace/diagnostic/refresh') {
			options.onRefreshDiagnostics?.();
			return;
		}
		if (message.method === 'window/logMessage' || message.method === 'window/showMessage') {
			const params = message.params as { type?: number; message?: string } | undefined;
			log('server', `${MESSAGE_LEVEL[params?.type ?? 4] ?? 'log'}: ${params?.message ?? ''}`);
			return;
		}
		if (message.id == null) return;
		const id = Number(message.id);
		const waiter = pending.get(id);
		if (!waiter) return;
		pending.delete(id);
		if (message.error) waiter.reject(new Error(message.error.message));
		else waiter.resolve(message.result);
	};

	child.stdout?.on('data', createDecoder(onMessage));
	child.on('error', (error: NodeJS.ErrnoException) => die(error.message, error.code === 'ENOENT'));
	child.on('exit', () => die('exited'));

	const killNow = () => {
		try {
			child.kill('SIGKILL');
		} catch {
			// The process may already have exited.
		}
	};

	const initTimeout = setTimeout(() => {
		if (state !== 'starting') return;
		die('did not answer initialize');
		killNow();
	}, INITIALIZE_TIMEOUT_MS);
	initTimeout.unref?.();

	const rootUri = pathToFileURL(options.rootDir).href;
	void request('initialize', {
		processId: process.pid,
		rootUri,
		capabilities: {
			workspace: { configuration: true },
			textDocument: {
				synchronization: { didSave: true },
				publishDiagnostics: {},
				definition: { linkSupport: true },
				diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
				completion: {
					completionItem: {
						snippetSupport: false,
						insertReplaceSupport: true,
						labelDetailsSupport: true,
						documentationFormat: ['markdown', 'plaintext'],
						deprecatedSupport: true,
						tagSupport: { valueSet: [1] },
						resolveSupport: {
							properties: ['documentation', 'detail', 'additionalTextEdits'],
						},
					},
				},
			},
		},
		workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
		initializationOptions: options.initializationOptions,
	})
		.then((result) => {
			if (state !== 'starting') return;
			const capabilities = (
				result as {
					capabilities?: {
						completionProvider?: { resolveProvider?: boolean };
						diagnosticProvider?: unknown;
						executeCommandProvider?: { commands?: string[] };
					};
				} | null
			)?.capabilities;
			resolveProvider = capabilities?.completionProvider?.resolveProvider === true;
			pullProvider = capabilities?.diagnosticProvider != null;
			for (const command of capabilities?.executeCommandProvider?.commands ?? []) {
				commands.add(command);
			}
			send({ jsonrpc: '2.0', method: 'initialized', params: {} });
			state = 'ready';
			log('event', `initialized — diagnostics ${pullProvider ? 'pulled' : 'published'}`);
			if (options.settings !== undefined) {
				send({
					jsonrpc: '2.0',
					method: 'workspace/didChangeConfiguration',
					params: { settings: options.settings },
				});
			}
			for (const message of queued) send(message);
			queued.length = 0;
			for (const path of pendingPulls) pullDiagnostics(path);
			pendingPulls.clear();
		})
		.catch((error: unknown) => {
			die(error instanceof Error ? error.message : 'initialize failed');
		})
		.finally(() => clearTimeout(initTimeout));

	return {
		ready: () => state === 'ready',
		state: () => state,
		pullDiagnostics,

		supportsCommand(command: string): boolean {
			return commands.has(command);
		},

		executeCommand(command: string, args: unknown[]): Promise<unknown> {
			if (state !== 'ready') return Promise.resolve(null);
			return request('workspace/executeCommand', { command, arguments: args }).catch(() => null);
		},

		openDocument(path: string, languageId: string, text: string) {
			const uri = pathToFileURL(path).href;
			versions.set(uri, 1);
			log('event', `opened ${relative(options.rootDir, path)}`);
			notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
		},

		changeDocument(path: string, text: string) {
			const uri = pathToFileURL(path).href;
			const version = (versions.get(uri) ?? 1) + 1;
			versions.set(uri, version);
			notify('textDocument/didChange', {
				textDocument: { uri, version },
				contentChanges: [{ text }],
			});
		},

		complete(path: string, position: { line: number; character: number }): Promise<unknown> {
			if (state !== 'ready') return Promise.resolve(null);
			return request('textDocument/completion', {
				textDocument: { uri: pathToFileURL(path).href },
				position,
			}).catch(() => null);
		},

		definition(path: string, position: { line: number; character: number }): Promise<unknown> {
			if (state !== 'ready') return Promise.resolve(null);
			return request('textDocument/definition', {
				textDocument: { uri: pathToFileURL(path).href },
				position,
			}).catch(() => null);
		},

		resolveCompletion(item: CompletionItem): Promise<CompletionItem | null> {
			if (state !== 'ready' || !resolveProvider) return Promise.resolve(null);
			return request('completionItem/resolve', item).then(
				(result) => result as CompletionItem | null,
				() => null,
			);
		},

		saveDocument(path: string) {
			notify('textDocument/didSave', { textDocument: { uri: pathToFileURL(path).href } });
		},

		closeDocument(path: string) {
			const uri = pathToFileURL(path).href;
			versions.delete(uri);
			log('event', `closed ${relative(options.rootDir, path)}`);
			notify('textDocument/didClose', { textDocument: { uri } });
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			if (state === 'ready') {
				void request('shutdown').catch(() => {});
				send({ jsonrpc: '2.0', method: 'exit' });
			}
			die(null);
			if (child.exitCode === null) {
				const backstop = setTimeout(killNow, 500);
				backstop.unref?.();
				child.once('exit', () => clearTimeout(backstop));
			}
		},
	};
}

export type LspClient = ReturnType<typeof spawnLspClient>;
