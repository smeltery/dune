import type { Tone } from '../ui/StatusBar';
import type { Config } from '../core/config';
import type { TextEncoding } from '../core/fs';
import type { FileStatus } from '../core/git';
import type { SearchOptions } from '../core/search';
import type { PackageManager } from '../lsp/install';
import type { FetchableInstall } from '../lsp/servers';
import type { NoteKind } from '../core/review';

export type Focus = 'tree' | 'editor';
export type PickerState = 'files' | 'tabs' | null;
export type SearchState = { scope: 'file' | 'project'; replacing?: boolean } | null;
export type ClipboardState = { paths: string[]; mode: 'cut' | 'copy' };
export type HistoryRequest = { kind: 'undo' | 'redo'; key: number } | null;
export type GotoRequest = { line: number; col: number; key: number } | null;
export type EditRequest = { content: string; key: number } | null;
export type CompletionRequest = { key: number } | null;
export type LineOpRequest = {
	op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete' | 'lineHome';
	key: number;
} | null;
export type FoldOpRequest = {
	op: import('../editor/folds').FoldOp;
	key: number;
} | null;
export type BusyState = { label: string; done: number; total: number } | null;

export interface AppProps {
	rootDir: string;
	openFile?: string | null;
	openLine?: number | null;
	openCol?: number | null;
	initialConfig: Config;
	projectConfig?: Partial<Config>;
	checkUpdates?: boolean;
}

export interface BufferState {
	content: string;
	/** Last content synced with disk; dirty is always content !== saved. */
	saved: string;
	dirty: boolean;
	/** Disk mtime this buffer was last in sync with; used to detect outside edits. */
	mtime: number;
	encoding?: TextEncoding;
}

/** Dirty buffers a disk sync refused to touch, split by what happened to the file. */
export interface DiskSync {
	changed: string[];
	deleted: string[];
}

/** An unsaved buffer whose file also changed on disk. */
export interface Conflict {
	path: string;
	disk: string;
	encoding?: TextEncoding;
	/** The file is gone: there is no outside version to accept. */
	deleted: boolean;
}

export type Prompt =
	| { kind: 'gotoLine' }
	| { kind: 'commitMessage' }
	| { kind: 'commitAmend'; subject: string }
	| { kind: 'newBranch'; from?: string | null }
	| { kind: 'newFile'; dir: string }
	| { kind: 'newFolder'; dir: string }
	| { kind: 'rename'; target: string }
	| { kind: 'formatterCommand' }
	| { kind: 'lspServerCommand' }
	| { kind: 'typescriptTsdk' }
	| { kind: 'keybindingCommand' }
	| { kind: 'sidebarWidth' }
	| { kind: 'appearancePluginId' }
	| { kind: 'appearancePluginRemoveId' }
	| { kind: 'appearancePluginRegistry'; current: string }
	| { kind: 'reviewKind'; path: string; line: number; endLine: number }
	| { kind: 'reviewNote'; noteKind: NoteKind; path: string; line: number; endLine: number }
	| { kind: 'reviewReply'; parentId: string }
	| { kind: 'delete'; targets: string[] }
	| { kind: 'closeDirty'; paths: string[]; names: string[] }
	| { kind: 'quitDirty'; names: string[] }
	| { kind: 'undoCommit'; subject: string }
	| { kind: 'discardChanges'; path: string; status: FileStatus }
	| { kind: 'newTag' }
	| { kind: 'deleteTag'; name: string }
	| { kind: 'newRemoteName' }
	| { kind: 'newRemoteUrl'; name: string }
	| { kind: 'removeRemote'; name: string }
	| { kind: 'renameBranch'; from: string }
	| { kind: 'deleteBranch'; name: string; force: boolean }
	| { kind: 'mergeBranch'; name: string }
	| { kind: 'pullPush'; branch: string; hasUpstream: boolean }
	| {
			kind: 'replaceProject';
			query: string;
			replacement: string;
			options: SearchOptions;
			paths: string[];
			matches: number;
			files: number;
			flags: string;
	  }
	| {
			kind: 'installServer';
			id: string;
			name: string;
			install: FetchableInstall;
			manager?: PackageManager;
	  }
	| { kind: 'installPlugin'; id: string; name: string; reason: string; commands?: string[] }
	| null;

export type PromptKind = NonNullable<Prompt>['kind'];

/** What a yes/no prompt asks and how loudly it asks it. */
export interface Confirmation {
	title: string;
	message: string;
	verb: string;
	danger: boolean;
}

export interface StatusMessage {
	msg: string;
	tone: Tone;
}
