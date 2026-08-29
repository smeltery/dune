export interface ServerSpec {
	id: string;
	command: string[];
	/** OpenTUI filetype ids handled by this server. */
	filetypes: string[];
	install?: ServerInstall;
	settings?: unknown;
}

export type ServerInstall =
	| { kind: 'npm'; packages: string[] }
	| { kind: 'manual'; command: string }
	| { kind: 'download'; url: string };

export type FetchableInstall = Exclude<ServerInstall, { kind: 'manual' }>;
export interface ResolvedServer {
	id: string;
	command: string[];
	install?: ServerInstall;
	settings?: unknown;
}

const npm = (...packages: string[]): ServerInstall => ({ kind: 'npm', packages });
const manual = (command: string): ServerInstall => ({ kind: 'manual', command });

export const DEFAULT_SERVERS: ServerSpec[] = [
	{
		id: 'typescript',
		command: ['typescript-language-server', '--stdio'],
		filetypes: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
		install: npm('typescript-language-server', 'typescript@5'),
	},
	{
		id: 'go',
		command: ['gopls'],
		filetypes: ['go'],
		install: manual('go install golang.org/x/tools/gopls@latest'),
	},
	{
		id: 'rust',
		command: ['rust-analyzer'],
		filetypes: ['rust'],
		install: manual('rustup component add rust-analyzer'),
	},
	{
		id: 'python',
		command: ['pyright-langserver', '--stdio'],
		filetypes: ['python'],
		install: npm('pyright'),
	},
	{ id: 'clangd', command: ['clangd'], filetypes: ['c', 'cpp'] },
	{ id: 'zig', command: ['zls'], filetypes: ['zig'] },
	{ id: 'lua', command: ['lua-language-server'], filetypes: ['lua'] },
	{
		id: 'bash',
		command: ['bash-language-server', 'start'],
		filetypes: ['bash'],
		install: npm('bash-language-server'),
	},
	{
		id: 'ruby',
		command: ['solargraph', 'stdio'],
		filetypes: ['ruby'],
		install: manual('gem install solargraph'),
	},
	{
		id: 'php',
		command: ['intelephense', '--stdio'],
		filetypes: ['php'],
		install: npm('intelephense'),
	},
	{ id: 'swift', command: ['sourcekit-lsp'], filetypes: ['swift'] },
	{
		id: 'css',
		command: ['vscode-css-language-server', '--stdio'],
		filetypes: ['css'],
		install: npm('vscode-langservers-extracted'),
	},
	{
		id: 'html',
		command: ['vscode-html-language-server', '--stdio'],
		filetypes: ['html'],
		install: npm('vscode-langservers-extracted'),
	},
	{
		id: 'json',
		command: ['vscode-json-language-server', '--stdio'],
		filetypes: ['json', 'jsonc'],
		install: npm('vscode-langservers-extracted'),
	},
	{
		id: 'solidity',
		command: ['nomicfoundation-solidity-language-server', '--stdio'],
		filetypes: ['solidity'],
		install: npm('@nomicfoundation/solidity-language-server'),
	},
	{
		id: 'vue',
		command: ['vue-language-server', '--stdio'],
		filetypes: ['vue'],
		install: npm('@vue/language-server', 'typescript@5'),
	},
	{
		id: 'vue-typescript',
		command: ['typescript-language-server', '--stdio'],
		filetypes: ['vue'],
		install: npm('typescript-language-server', '@vue/typescript-plugin', 'typescript@5'),
	},
];

export function serverSpecs(extraServers: readonly ServerSpec[] = []): ServerSpec[] {
	const specs = [...DEFAULT_SERVERS];
	const seen = new Set(specs.map((server) => server.id));
	for (const server of extraServers) {
		if (seen.has(server.id)) continue;
		seen.add(server.id);
		specs.push(server);
	}
	return specs;
}

export function installHint(install: ServerInstall): string {
	if (install.kind === 'npm') return `npm i -g ${install.packages.join(' ')}`;
	if (install.kind === 'download') return `Download it from ${install.url}`;
	return install.command;
}

export function resolveServers(
	filetype: string | undefined,
	overrides: Record<string, string[]>,
	extraServers: readonly ServerSpec[] = [],
): ResolvedServer[] {
	if (!filetype) return [];
	return serverSpecs(extraServers).flatMap((spec) => {
		if (!spec.filetypes.includes(filetype)) return [];
		const override = overrides[spec.id];
		const command = override ?? spec.command;
		return command.length > 0
			? [
					{
						id: spec.id,
						command,
						install: override ? undefined : spec.install,
						settings: spec.settings,
					},
				]
			: [];
	});
}

export function resolveServer(
	filetype: string | undefined,
	overrides: Record<string, string[]>,
	extraServers: readonly ServerSpec[] = [],
): ResolvedServer | null {
	return resolveServers(filetype, overrides, extraServers)[0] ?? null;
}
