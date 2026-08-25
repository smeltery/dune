/**
 * A minimal language server that only answers the handshake, so the restart
 * test can count how many times it was spawned without depending on
 * fake-lsp's own argv-based debug dumps. argv[2] names a file to append a
 * spawn marker to; it appends rather than writes, since the count is what the
 * test reads.
 */
import { appendFileSync } from 'node:fs';

import { createDecoder, encodeMessage } from '../../src/lsp/transport';

const marker = process.argv[2]!;
appendFileSync(marker, 'spawned\n');

const send = (message: object) => process.stdout.write(encodeMessage(message));

process.stdin.on(
	'data',
	createDecoder((message) => {
		if (message.method === 'initialize') {
			send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
		} else if (message.method === 'shutdown') {
			send({ jsonrpc: '2.0', id: message.id, result: null });
		} else if (message.method === 'exit') {
			process.exit(0);
		}
	}),
);
process.stdin.on('end', () => process.exit(0));
