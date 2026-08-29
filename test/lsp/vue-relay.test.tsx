import { expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { vuePluginLocation, VUE_TYPESCRIPT_PLUGIN } from '../../src/lsp/project';
import { resolveServers } from '../../src/lsp/servers';
import { fixture, launch, press, untilFrame } from '../helpers';

const HYBRID = join(import.meta.dir, '../fixtures/hybrid-lsp.ts');
const TSSERVER = join(import.meta.dir, '../fixtures/tsserver-lsp.ts');

/** Two servers and a relay between them cross process boundaries twice. */
const LSP_WAIT = 200;

const SFC = `<script setup lang="ts">
const message = 'hello'
</script>
`;

test('a .vue file is served by the vue server and by a tsserver beside it', () => {
	const resolved = resolveServers('vue', {}).map((server) => server.id);
	expect(resolved).toContain('vue');
	expect(resolved).toContain('vue-typescript');

	const tsserver = resolveServers('vue', {}).find((server) => server.id === 'vue-typescript');
	expect(tsserver?.command[0]).toBe('typescript-language-server');
	expect(tsserver?.install).toEqual({
		kind: 'npm',
		packages: ['typescript-language-server', VUE_TYPESCRIPT_PLUGIN, 'typescript@5'],
	});
});

test("the plugin location is a prefix, the project ahead of dune's own copy", () => {
	const project = fixture({ 'a.vue': SFC });
	const installed = fixture({ 'a.txt': '' });
	expect(vuePluginLocation(project, installed)).toBeNull();

	mkdirSync(join(installed, 'node_modules', VUE_TYPESCRIPT_PLUGIN), { recursive: true });
	expect(vuePluginLocation(project, installed)).toBe(installed);

	mkdirSync(join(project, 'node_modules', VUE_TYPESCRIPT_PLUGIN), { recursive: true });
	expect(vuePluginLocation(project, installed)).toBe(project);
});

test('a tsserver/request is relayed to the server that drives one', async () => {
	const dir = fixture({ 'a.vue': SFC });
	const t = await launch(
		dir,
		{
			lsp: true,
			lspServers: {
				vue: [process.execPath, HYBRID],
				'vue-typescript': [process.execPath, TSSERVER],
			},
		},
		{},
		{ openFile: join(dir, 'a.vue') },
	);

	await press(t, (input) => void input.typeText('hy'));
	await untilFrame(t, 'hybrid:{"ran":"_vue:projectInfo"}', LSP_WAIT);
}, 30_000);

test('a tsserver/request nobody can answer is still answered', async () => {
	const dir = fixture({ 'a.vue': SFC });
	const t = await launch(
		dir,
		{ lsp: true, lspServers: { vue: [process.execPath, HYBRID], 'vue-typescript': [] } },
		{},
		{ openFile: join(dir, 'a.vue') },
	);

	await press(t, (input) => void input.typeText('hy'));
	await untilFrame(t, 'hybrid:null', LSP_WAIT);
}, 30_000);
