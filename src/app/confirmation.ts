import { basename } from 'node:path';

import { isDirectory } from '../core/fs';
import { SERVER_ROOT } from '../lsp/install';
import type { Confirmation, Prompt } from './types';

export function confirmationForPrompt(prompt: Prompt): Confirmation | null {
	switch (prompt?.kind) {
		case 'delete': {
			const only = prompt.targets.length === 1 ? prompt.targets[0]! : null;
			return {
				title: 'Delete',
				verb: 'delete',
				danger: true,
				message: only
					? `Delete "${basename(only)}"${isDirectory(only) ? ' and its contents' : ''}?`
					: `Delete these ${prompt.targets.length} items and anything inside them?`,
			};
		}
		case 'closeDirty':
			return {
				title: 'Unsaved changes',
				verb: 'close without saving',
				danger: true,
				message: `Unsaved edits in ${prompt.names.join(', ')} will be lost. Close anyway?`,
			};
		case 'quitDirty':
			return {
				title: 'Unsaved changes',
				verb: 'quit without saving',
				danger: true,
				message: `Unsaved edits in ${prompt.names.join(', ')} will be lost. Quit anyway?`,
			};
		case 'undoCommit':
			return {
				title: 'Undo last commit',
				verb: 'undo commit',
				danger: true,
				message: `Undo "${prompt.subject}" and keep its changes staged?`,
			};
		case 'commitAll':
			return {
				title: 'No staged changes',
				verb: 'commit all',
				danger: false,
				message: `Nothing is staged — commit all ${prompt.count} changed ${prompt.count === 1 ? 'file' : 'files'} directly?`,
			};
		case 'deleteTag':
			return {
				title: 'Delete tag',
				verb: 'delete it',
				danger: true,
				message: `Delete tag "${prompt.name}"?`,
			};
		case 'removeRemote':
			return {
				title: 'Remove remote',
				verb: 'remove it',
				danger: true,
				message: `Remove remote "${prompt.name}"?`,
			};
		case 'discardChanges': {
			const removes = prompt.status === 'untracked' || prompt.status === 'added';
			return {
				title: 'Discard changes',
				verb: removes ? 'delete it' : 'discard changes',
				danger: true,
				message: removes
					? `Delete "${basename(prompt.path)}"? It has never been committed.`
					: `Discard changes to "${basename(prompt.path)}"? This cannot be undone.`,
			};
		}
		case 'mergeBranch':
			return {
				title: 'Merge branch',
				verb: 'merge it',
				danger: false,
				message: `Merge "${prompt.name}" into the current branch? Conflicts are left in the working tree.`,
			};
		case 'pullPush':
			return {
				title: 'Merge origin',
				verb: 'merge and push',
				danger: false,
				message:
					'Origin has commits you do not have. Merge origin into this branch, then push again?',
			};
		case 'replaceProject':
			return {
				title: 'Replace in project',
				verb: 'replace',
				danger: true,
				message: `Replace ${prompt.matches} ${prompt.matches === 1 ? 'match' : 'matches'} in ${prompt.files} ${prompt.files === 1 ? 'file' : 'files'}${prompt.flags}? Closed files are written straight to disk.`,
			};
		case 'deleteBranch':
			return {
				title: prompt.force ? 'Delete branch (force)' : 'Delete branch',
				verb: 'delete it',
				danger: prompt.force,
				message: prompt.force
					? `Delete "${prompt.name}" even if it has commits on no other branch? They are lost.`
					: `Delete "${prompt.name}"? Git refuses if it has commits that are not merged.`,
			};
		case 'installServer':
			return {
				title: 'Language server missing',
				verb: 'install it',
				danger: false,
				message:
					prompt.install.kind === 'npm'
						? `${prompt.name} is not installed. Fetch it with ${prompt.manager ?? 'npm'} into ${SERVER_ROOT}?`
						: `${prompt.name} is not installed. Download it into ${SERVER_ROOT}?`,
			};
		case 'installPlugin':
			return {
				title: 'Plugin available',
				verb: 'install it',
				danger: false,
				message: [
					`${prompt.reason}. Install ${prompt.name} from the plugin market?`,
					...(prompt.commands?.length ? [`It may run: ${prompt.commands.join(', ')}`] : []),
				].join(' '),
			};
		case 'activatePlugin': {
			const only = prompt.choices.length === 1 ? prompt.choices[0]! : null;
			if (!only) return null;
			return {
				title: 'Plugin installed',
				verb: 'use it',
				danger: false,
				message: `${prompt.name} is installed. Use the ${only.label}?`,
			};
		}
		default:
			return null;
	}
}
