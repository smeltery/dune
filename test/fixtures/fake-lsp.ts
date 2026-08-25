import type { CompletionItem, Diagnostic } from '../../src/lsp/protocol';
import { createDecoder, encodeMessage } from '../../src/lsp/transport';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const send = (message: object) => process.stdout.write(encodeMessage(message));
// Chatter on stderr, the way real servers do — the status page's log shows it.
process.stderr.write('fake-lsp standing by\n');
const initDump = process.argv[2];
const capabilitiesDump = process.argv[3];
const mode = process.argv[4];
const documents = new Map<string, string>();

const diagnosticsFor = (text: string): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	const lines = text.split('\n');
	for (let line = 0; line < lines.length; line++) {
		const col = lines[line]!.indexOf('oops');
		if (col < 0) continue;
		diagnostics.push({
			range: { start: { line, character: col }, end: { line, character: col + 4 } },
			severity: 1,
			message: 'found oops',
		});
	}
	return diagnostics;
};

const publish = (uri: string, text: string) => {
	const diagnostics = diagnosticsFor(text);
	send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
};

const COMPLETIONS: CompletionItem[] = [
	{
		label: 'duneAlpha',
		kind: 3,
		detail: '() => void',
		labelDetails: { detail: '() => void', description: 'dune/fake' },
		insertText: 'duneAlpha()',
	},
	{ label: 'duneBeta', kind: 6, detail: 'number' },
	{ label: 'duneLazy', kind: 7, detail: 'resolve-import' },
];
const MEMBER_COMPLETIONS: CompletionItem[] = [
	{ label: 'memberTable', kind: 10 },
	{ label: 'memberOther', kind: 10 },
];

function completionsAt(uri: string, line: number, character: number): CompletionItem[] {
	const text = documents.get(uri) ?? '';
	const lineText = text.split('\n')[line] ?? '';
	return lineText[character - 1] === '.' ? MEMBER_COMPLETIONS : COMPLETIONS;
}

process.stdin.on(
	'data',
	createDecoder((message) => {
		if (message.method === 'initialize') {
			const params = message.params as
				| { initializationOptions?: unknown; capabilities?: unknown }
				| undefined;
			if (initDump) writeFileSync(initDump, JSON.stringify(params?.initializationOptions ?? null));
			if (capabilitiesDump)
				writeFileSync(capabilitiesDump, JSON.stringify(params?.capabilities ?? null));
			send({
				jsonrpc: '2.0',
				id: message.id,
				result: {
					capabilities: {
						textDocumentSync: 1,
						completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
						...(mode === 'pull' ? { diagnosticProvider: { interFileDependencies: false } } : {}),
					},
				},
			});
		} else if (message.method === 'textDocument/diagnostic') {
			const params = message.params as { textDocument: { uri: string } };
			const text = documents.get(params.textDocument.uri) ?? '';
			send({
				jsonrpc: '2.0',
				id: message.id,
				result: { kind: 'full', items: diagnosticsFor(text) },
			});
		} else if (message.method === 'textDocument/completion') {
			const params = message.params as {
				textDocument: { uri: string };
				position: { line: number; character: number };
			};
			const items = completionsAt(
				params.textDocument.uri,
				params.position.line,
				params.position.character,
			);
			setTimeout(
				() =>
					send({
						jsonrpc: '2.0',
						id: message.id,
						result: { isIncomplete: false, items },
					}),
				items === COMPLETIONS ? 400 : 0,
			);
		} else if (message.method === 'textDocument/definition') {
			send({
				jsonrpc: '2.0',
				id: message.id,
				result: [
					{
						targetUri: pathToFileURL(join(process.cwd(), 'def.ts')).href,
						targetRange: {
							start: { line: 0, character: 0 },
							end: { line: 1, character: 14 },
						},
						targetSelectionRange: {
							start: { line: 1, character: 6 },
							end: { line: 1, character: 10 },
						},
					},
				],
			});
		} else if (message.method === 'completionItem/resolve') {
			const item = message.params as CompletionItem;
			const result =
				item.label === 'duneLazy'
					? {
							...item,
							additionalTextEdits: [
								{
									range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
									newText: 'import { duneLazy } from "dune"\n',
								},
							],
						}
					: item.label === 'duneAlpha'
						? {
								...item,
								detail: 'function duneAlpha(): void',
								labelDetails: { detail: 'function duneAlpha(): void', description: 'dune/fake' },
								documentation: 'Runs the alpha completion.',
							}
						: item;
			send({ jsonrpc: '2.0', id: message.id, result });
		} else if (message.method === 'shutdown') {
			send({ jsonrpc: '2.0', id: message.id, result: null });
		} else if (message.method === 'exit') {
			process.exit(0);
		} else if (message.method === 'textDocument/didOpen') {
			const params = message.params as { textDocument: { uri: string; text: string } };
			documents.set(params.textDocument.uri, params.textDocument.text);
			if (mode !== 'pull') publish(params.textDocument.uri, params.textDocument.text);
		} else if (message.method === 'textDocument/didChange') {
			const params = message.params as {
				textDocument: { uri: string };
				contentChanges: { text: string }[];
			};
			const text = params.contentChanges[0]!.text;
			documents.set(params.textDocument.uri, text);
			if (mode !== 'pull') publish(params.textDocument.uri, text);
		}
	}),
);

process.stdin.on('end', () => process.exit(0));
