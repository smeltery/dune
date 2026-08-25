import { expect, test } from 'bun:test';
import { fixture, launch, press, pressEscape, settle } from './helpers';

test('debug frame', async () => {
	const files: Record<string, string> = {};
	for (let index = 0; index < 30; index++) {
		files[`deep/nested/f${index}.ts`] = `const a${index} = 1\n`;
	}
	const t = await launch(fixture(files));

	await press(t, (input) => input.pressKey('o', { ctrl: true }));
	await press(t, (input) => void input.typeText('f21.ts'));
	await press(t, (input) => input.pressEnter());
	await pressEscape(t);
	await settle(t);
	await settle(t);

	console.log(t.captureCharFrame());
});
