import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { divertWarnings } from '../src/core/warnings';
import { fixture } from './helpers';

test('warning output is diverted to a log file', () => {
	const dir = fixture({});
	const log = join(dir, 'dune.log');
	const original = process.listeners('warning');
	try {
		divertWarnings(log);
		const warning = new Error('heads up');
		warning.name = 'DuneTestWarning';
		process.emit('warning', warning);
		expect(existsSync(log)).toBe(true);
		expect(readFileSync(log, 'utf8')).toContain('heads up');
	} finally {
		process.removeAllListeners('warning');
		for (const listener of original) process.on('warning', listener);
	}
});
