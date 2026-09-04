import type { Prompt } from './types';

const PROMPT_TITLES: Partial<Record<NonNullable<Prompt>['kind'], string>> = {
	newFile: 'New file name',
	newFolder: 'New folder name',
	rename: 'Rename to',
	formatterCommand: 'Formatter: extensions = command',
	lspServerCommand: 'LSP override: server = command',
	typescriptTsdk: 'TypeScript SDK path',
	keybindingCommand: 'Shortcut: command = key',
	sidebarWidth: 'Sidebar width: auto or columns',
	appearancePluginId: 'Plugin id',
	appearancePluginRemoveId: 'Remove plugin id',
	appearancePluginRegistry: 'Plugin registry URL',
	reviewNote: 'Review note',
	reviewReply: 'Reply',
	workspaceOpen: 'Open workspace folder',
	gotoLine: 'Go to line',
	commitMessage: 'Commit message',
	commitAmend: 'Amend commit message',
	newBranch: 'New branch name',
	renameBranch: 'Rename branch to',
	newTag: 'New tag name',
	newRemoteName: 'New remote name',
};

export function promptTitleFor(prompt: Prompt): string | undefined {
	if (prompt?.kind === 'newBranch' && prompt.from) return `New branch from ${prompt.from}`;
	if (prompt?.kind === 'reviewNote') return `${prompt.noteKind} on line ${prompt.line + 1}`;
	if (prompt?.kind === 'newRemoteUrl') return `Remote URL for ${prompt.name}`;
	return prompt ? PROMPT_TITLES[prompt.kind] : undefined;
}

export function isTextPrompt(prompt: Prompt): boolean {
	return !!promptTitleFor(prompt);
}
