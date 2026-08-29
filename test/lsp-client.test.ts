import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnLspClient } from '../src/lsp/client';
import type { CompletionList, Diagnostic } from '../src/lsp/protocol';

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts');

function collector<T>() {
	const items: T[] = [];
	const waiters: Array<{ count: number; resolve: () => void }> = [];
	return {
		items,
		push(item: T) {
			items.push(item);
			for (let at = waiters.length - 1; at >= 0; at--) {
				if (items.length < waiters[at]!.count) continue;
				waiters[at]!.resolve();
				waiters.splice(at, 1);
			}
		},
		atLeast(count: number): Promise<void> {
			if (items.length >= count) return Promise.resolve();
			const { promise, resolve } = Promise.withResolvers<void>();
			waiters.push({ count, resolve });
			return promise;
		},
	};
}

describe('LSP client', () => {
	test('queues document opens until initialize and receives diagnostics', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-'));
		const path = join(dir, 'a.ts');
		const deliveries = collector<Diagnostic[]>();
		const client = spawnLspClient({
			command: [process.execPath, FAKE],
			rootDir: dir,
			onDiagnostics: (_uri, diagnostics) => deliveries.push(diagnostics),
			onFail: (reason) => {
				throw new Error(`fake server failed: ${reason}`);
			},
		});

		client.openDocument(path, 'typescript', 'const oops = 1\n');
		await deliveries.atLeast(1);
		expect(deliveries.items[0]).toHaveLength(1);
		expect(deliveries.items[0]![0]!.range.start).toEqual({ line: 0, character: 6 });
		expect(client.ready()).toBe(true);

		client.changeDocument(path, 'const fine = 1\n');
		await deliveries.atLeast(2);
		expect(deliveries.items[1]).toHaveLength(0);

		client.dispose();
	}, 20_000);

	test('requests completion and resolves lazy edits', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-'));
		const path = join(dir, 'a.ts');
		const deliveries = collector<Diagnostic[]>();
		const client = spawnLspClient({
			command: [process.execPath, FAKE],
			rootDir: dir,
			onDiagnostics: (_uri, diagnostics) => deliveries.push(diagnostics),
			onFail: (reason) => {
				throw new Error(`fake server failed: ${reason}`);
			},
		});

		client.openDocument(path, 'typescript', 'const x = dune\n');
		await deliveries.atLeast(1);
		const result = (await client.complete(path, { line: 0, character: 14 })) as CompletionList;
		expect(result.items.map((item) => item.label)).toEqual(['duneAlpha', 'duneBeta', 'duneLazy']);

		const resolved = await client.resolveCompletion(result.items[2]!);
		expect(resolved?.additionalTextEdits?.[0]?.newText).toBe('import { duneLazy } from "dune"\n');

		client.dispose();
	}, 20_000);

	test('a missing server command reports failure instead of staying starting', async () => {
		const { promise, resolve } = Promise.withResolvers<string>();
		const client = spawnLspClient({
			command: ['dune-no-such-language-server'],
			rootDir: tmpdir(),
			onDiagnostics: () => {},
			onFail: resolve,
		});

		expect(await promise).toContain('dune-no-such-language-server');
		expect(client.ready()).toBe(false);
		client.dispose();
	}, 10_000);

	test('initialize advertises definition link support', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-'));
		const capabilities = join(dir, 'capabilities.json');
		const client = spawnLspClient({
			command: [process.execPath, FAKE, join(dir, 'init.json'), capabilities],
			rootDir: dir,
			onDiagnostics: () => {},
			onFail: (reason) => {
				throw new Error(`fake server failed: ${reason}`);
			},
		});

		await waitFor(() => existsSync(capabilities));
		expect(JSON.parse(readFileSync(capabilities, 'utf8'))).toMatchObject({
			textDocument: {
				definition: { linkSupport: true },
				diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
				completion: {
					completionItem: {
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
		});
		client.dispose();
	}, 20_000);

	test('pulls diagnostics from servers that do not publish them', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dune-lsp-'));
		const path = join(dir, 'a.ts');
		const deliveries = collector<Diagnostic[]>();
		const client = spawnLspClient({
			command: [process.execPath, FAKE, join(dir, 'init.json'), join(dir, 'cap.json'), 'pull'],
			rootDir: dir,
			onDiagnostics: (_uri, diagnostics) => deliveries.push(diagnostics),
			onFail: (reason) => {
				throw new Error(`fake server failed: ${reason}`);
			},
		});

		client.openDocument(path, 'typescript', 'const oops = 1\n');
		client.pullDiagnostics(path);
		await deliveries.atLeast(1);
		expect(deliveries.items[0]?.[0]?.message).toBe('found oops');

		client.changeDocument(path, 'const ok = 1\n');
		client.pullDiagnostics(path);
		await deliveries.atLeast(2);
		expect(deliveries.items[1]).toHaveLength(0);
		client.dispose();
	}, 20_000);
});

const waitFor = async (done: () => boolean, attempts = 40): Promise<void> => {
	if (done() || attempts <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, 25));
	return waitFor(done, attempts - 1);
};
