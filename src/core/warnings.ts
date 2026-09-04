import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';

export const WARNINGS_LOG = join(
	process.env.XDG_STATE_HOME ?? join(os.homedir(), '.local', 'state'),
	'dune',
	'dune.log',
);

export function divertWarnings(file = WARNINGS_LOG): void {
	process.removeAllListeners('warning');
	process.on('warning', (warning) => {
		const text = warning.stack ?? `${warning.name}: ${warning.message}`;
		try {
			mkdirSync(dirname(file), { recursive: true });
			appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
		} catch {
			// An unwritable log should not paint warnings over the editor.
		}
	});
}
