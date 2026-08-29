import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writePlugin } from '../src/core/market';
import { fixture, launch, press, pressEscape, runCommand, until } from './helpers';

const testConfigFile = () => join(process.env.XDG_CONFIG_HOME!, 'dune', 'config.json');

test('the File icons palette applies an icon theme', async () => {
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();

	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }));
	await runCommand(t, 'Mono Icons');
	await until(t, () => t.captureCharFrame().includes('File icons: mono-icons'));
	expect(JSON.parse(readFileSync(testConfigFile(), 'utf8')).iconTheme).toBe('mono-icons');
});

test('escaping the File icons palette does not keep a previewed theme', async () => {
	const manifest = {
		id: 'mono',
		name: 'Mono',
		version: '1.0.0',
		icons: [{ id: 'mono-icons', name: 'Mono Icons', file: 'f', folder: 'd', folderOpen: 'o' }],
	};
	expect(
		writePlugin('mono', {
			ok: true,
			id: 'mono',
			version: '1.0.0',
			body: JSON.stringify(manifest),
		}),
	).toBeNull();

	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { iconTheme: 'unicode' });
	await press(t, (input) => input.pressKey('F1'));
	await until(t, () => t.captureCharFrame().includes('Open file'));
	await press(t, (input) => void input.typeText('Mono Icons'));
	await until(t, () => t.captureCharFrame().includes('Mono Icons'));
	await pressEscape(t);
	await until(t, () => !t.captureCharFrame().includes('Mono Icons'));
	expect(t.captureCharFrame()).not.toContain('File icons: mono-icons');
});
