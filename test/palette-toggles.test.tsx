import { expect, test } from 'bun:test';

import { fixture, launch, runCommand, settle } from './helpers';

test('palette toggles sidebar position and diff layout', async () => {
	const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, { width: 100, height: 24 });
	await runCommand(t, 'Toggle sidebar position');
	await settle(t);
	expect(t.captureCharFrame()).toContain('Sidebar position: right');

	await runCommand(t, 'Toggle diff layout');
	await settle(t);
	expect(t.captureCharFrame()).toContain('Diff layout: side-by-side');
});
