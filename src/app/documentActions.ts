import { basename, dirname, join } from 'node:path';

import { produce } from 'solid-js/store';

import { removeAll } from '../core/bulk';
import { formatterFor, parseFormatterEdit, runFormatter } from '../core/format';
import { parseLspServerEdit } from '../core/lspSettings';
import { MARKET_URL, removeFromDisk } from '../core/market';
import { SIDEBAR_MAX, SIDEBAR_MIN } from '../core/config';
import type { Config } from '../core/config';
import { createDir, createFile, exists, mtimeOf, readTextFile, writeFile } from '../core/fs';
import type { FileStatus } from '../core/git';
import {
	bindingProblem,
	chordId,
	formatChord,
	isDisabledShortcut,
	parseChord,
	parseKeybindingEdit,
} from '../core/keybindings';
import { trimTrailing } from '../editor/lines';
import type { PackageManager } from '../lsp/install';
import type { FetchableInstall } from '../lsp/servers';
import { ALT } from '../ui/keys';
import {
	installMarketPlugin,
	activatePluginChoice,
	choosePluginActivation,
} from './appearance/pluginsPage';
import { KEYBINDABLE_COMMANDS } from './commands/keybindings';
import { CLASH_CHANGED } from './constants';
import { isTextPrompt } from './prompts';
import { syncedBuffer } from './state/buffers';
import type { BufferState, Conflict, DiskSync, Prompt } from './types';

export function createDocumentActions(deps: {
	config: Config;
	buffers: Record<string, BufferState>;
	activePath: () => string | null;
	activeBuffer: () => BufferState | undefined;
	prompt: () => Prompt;
	conflict: () => Conflict | null;
	nodes: () => { path: string }[];
	tabs: () => string[];
	selectedPath: () => string | null;
	gitCommands: {
		submitCommit: (message: string) => void;
		submitCommitAll: (message: string) => void;
		submitBranch: (name: string, from?: string | null) => void;
		rename: (from: string, to: string) => void;
		remove: (name: string, force: boolean) => void;
		merge: (name: string) => void;
		pullPush: (branch: string, hasUpstream: boolean) => void;
		undoCommit: () => void;
		discard: (path: string, status: FileStatus) => void;
		submitTag: (name: string) => void;
		removeTag: (name: string) => void;
		submitRemoteName: (name: string) => void;
		submitRemote: (name: string, url: string) => void;
		removeRemoteConfirmed: (name: string) => void;
		submitAmend: (message: string) => void;
	};
	installLspServer: (
		id: string,
		name: string,
		install: FetchableInstall,
		manager?: PackageManager,
	) => void;
	closeTab: (path: string, discardUnsaved?: boolean) => void;
	expand: (path: string) => void;
	movePath: (from: string, to: string) => string | null;
	openFile: (path: string) => void;
	pinTab: (path: string) => void;
	quit: (discardUnsaved?: boolean) => void;
	refreshTree: () => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	setAnchor: (path: string | null) => void;
	setBuffers: (...args: unknown[]) => void;
	setBusy: (busy: { label: string; done: number; total: number } | null) => void;
	setConflict: (conflict: Conflict | null) => void;
	setFocus: (focus: 'tree' | 'editor') => void;
	setGitRevision: (update: (n: number) => number) => void;
	setGoto: (
		update: (prev: { line: number; col: number; key: number } | null) => {
			line: number;
			col: number;
			key: number;
		},
	) => void;
	setMarked: (paths: string[]) => void;
	setPrompt: (prompt: Prompt) => void;
	setReloadKey: (update: (n: number) => number) => void;
	setSelectedPath: (path: string | null) => void;
	pushEdit: (content: string) => void;
	patchConfig: (patch: Partial<Config>) => void;
	reloadAppearancePlugins: () => void;
	appearance: () => import('../core/localThemes').AppearancePluginLoad;
	applyTheme: (id: string) => void;
	applyIconTheme: (id: string) => void;
	addReviewNote: (note: {
		path: string;
		line: number;
		endLine: number;
		kind: import('../core/review').NoteKind;
		body: string;
	}) => void;
	addReviewReply: (parentId: string, body: string) => void;
	whileFree: (run: () => void) => void;
	rootDir: string;
}) {
	// Runs at most one write/format at a time per path. A counter that only discarded a
	// stale *result* was not enough: the external formatter process itself would still
	// write the file's old content to disk after a newer save, regardless of anything
	// this process decided to ignore. Queuing means the two can never overlap at all.
	const pathQueue: Record<string, Promise<void>> = {};
	const serialize = <T>(path: string, run: () => Promise<T>): Promise<T> => {
		const prior = pathQueue[path] ?? Promise.resolve();
		const result = prior.then(run);
		pathQueue[path] = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};

	const writeBufferNow = async (
		path: string,
		content: string,
		opts: { skipFormat?: boolean } = {},
	): Promise<boolean> => {
		const encoding = deps.buffers[path]?.encoding;
		const final = deps.config.trimOnSave ? trimTrailing(content) : content;
		const err = writeFile(path, final, encoding);
		if (err) {
			deps.say(`Save failed: ${err}`, 'error');
			return false;
		}
		let saved = final;
		const formatter =
			!opts.skipFormat && deps.config.formatOnSave
				? formatterFor(path, deps.config.formatters)
				: null;
		if (formatter) {
			const formatError = await runFormatter(formatter, path, deps.rootDir);
			if (formatError) {
				deps.setBuffers(path, syncedBuffer(final, mtimeOf(path), encoding));
				if (final !== content && path === deps.activePath()) deps.pushEdit(final);
				deps.setGitRevision((n) => n + 1);
				deps.say(`Format failed: ${formatError}`, 'error');
				return true;
			}
			try {
				const file = readTextFile(path);
				saved = file.content;
				deps.setBuffers(path, syncedBuffer(saved, mtimeOf(path), file.encoding));
				if (saved !== content && path === deps.activePath()) deps.pushEdit(saved);
				deps.setGitRevision((n) => n + 1);
				deps.say(`Formatted ${basename(path)}`);
				return true;
			} catch (e) {
				deps.say(`Format failed: ${(e as Error).message}`, 'error');
				saved = final;
			}
		}
		deps.setBuffers(path, syncedBuffer(saved, mtimeOf(path), encoding));
		if (saved !== content && path === deps.activePath()) deps.pushEdit(saved);
		deps.setGitRevision((n) => n + 1);
		deps.say(formatter ? `Formatted ${basename(path)}` : `Saved ${basename(path)}`);
		return true;
	};
	const writeBuffer = (
		path: string,
		content: string,
		opts: { skipFormat?: boolean } = {},
	): Promise<boolean> => serialize(path, () => writeBufferNow(path, content, opts));
	/** Runs the configured formatter for `path` regardless of `formatOnSave`, assuming the
	 * buffer is already synced to disk. Returns an error message rather than saying it, so
	 * `formatOpenFiles` can report one summary instead of a message per file. Not queued on
	 * its own — callers that also need to flush a dirty buffer first run both in one
	 * `serialize` block, via `formatOnDiskNow`, so nothing can land between the two. */
	const formatOnDiskNow = async (path: string): Promise<{ ok: boolean; error?: string }> => {
		const formatter = formatterFor(path, deps.config.formatters);
		if (!formatter) return { ok: false };
		const before = deps.buffers[path]?.content;
		const formatError = await runFormatter(formatter, path, deps.rootDir);
		if (formatError) return { ok: false, error: formatError };
		const current = deps.buffers[path];
		if (!current) return { ok: false };
		if (current.dirty) {
			// An edit landed while the formatter ran. It still wrote to disk — there is no way
			// to stop an external process mid-write — but the newer edit must win, not this
			// stale result, so only the mtime is acknowledged here. Comparing content instead of
			// checking dirty would also misfire on dune's own file watcher quietly absorbing
			// this same write into the buffer first (that always clears dirty, never sets it).
			// The save queued behind this one (per-path serialize) sees a buffer whose mtime now
			// matches disk and so writes cleanly instead of raising a conflict over a change
			// dune itself just made.
			deps.setBuffers(path, { ...current, mtime: mtimeOf(path) });
			return { ok: false };
		}
		try {
			const file = readTextFile(path);
			deps.setBuffers(path, syncedBuffer(file.content, mtimeOf(path), file.encoding));
			if (file.content !== before && path === deps.activePath()) deps.pushEdit(file.content);
			deps.setGitRevision((n) => n + 1);
			return { ok: true };
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	};
	const saveWithConflictCheckNow = async (
		path: string,
		buffer: BufferState,
		opts: { skipFormat?: boolean } = {},
	): Promise<boolean> => {
		if (mtimeOf(path) !== buffer.mtime) {
			if (!exists(path)) {
				deps.setConflict({ path, disk: '', deleted: true });
				return false;
			}
			let disk = '';
			let encoding = buffer.encoding;
			try {
				const file = readTextFile(path);
				disk = file.content;
				encoding = file.encoding;
			} catch {}
			if (disk !== buffer.content) {
				deps.setConflict({ path, disk, encoding, deleted: false });
				return false;
			}
		}
		return writeBufferNow(path, buffer.content, opts);
	};
	// Re-reads the buffer inside the queued job rather than taking a snapshot at call time —
	// by the time this runs, a format queued ahead of it may have moved on without it.
	const saveWithConflictCheck = (
		path: string,
		opts: { skipFormat?: boolean } = {},
	): Promise<boolean> =>
		serialize(path, () => {
			const buffer = deps.buffers[path];
			return buffer ? saveWithConflictCheckNow(path, buffer, opts) : Promise.resolve(false);
		});
	const saveActive = async () => {
		const path = deps.activePath();
		if (!path || !deps.activeBuffer()) return;
		await saveWithConflictCheck(path);
	};
	const saveWithoutFormatting = async () => {
		const path = deps.activePath();
		if (!path || !deps.activeBuffer()) return;
		await saveWithConflictCheck(path, { skipFormat: true });
	};
	// A flush-then-format for one path, queued as a single unit so a save that lands while
	// the formatter is still running has to wait its turn instead of racing its disk write.
	const formatOnePath = (path: string): Promise<{ ok: boolean; error?: string }> =>
		serialize(path, async () => {
			const buffer = deps.buffers[path];
			if (!buffer) return { ok: false };
			if (buffer.dirty && !(await saveWithConflictCheckNow(path, buffer, { skipFormat: true }))) {
				return { ok: false };
			}
			return formatOnDiskNow(path);
		});
	const formatActive = async () => {
		const path = deps.activePath();
		if (!path || !deps.activeBuffer()) return;
		if (!formatterFor(path, deps.config.formatters)) {
			return deps.say('No formatter configured for this file', 'warn');
		}
		const result = await formatOnePath(path);
		if (result.error) deps.say(`Format failed: ${result.error}`, 'error');
		else if (result.ok) deps.say(`Formatted ${basename(path)}`);
	};
	const formatOpenFiles = async () => {
		let formatted = 0;
		const failed: string[] = [];
		for (const path of deps.tabs()) {
			if (!formatterFor(path, deps.config.formatters)) continue;
			const result = await formatOnePath(path);
			if (result.ok) formatted++;
			else if (result.error) failed.push(basename(path));
		}
		if (formatted === 0 && failed.length === 0) {
			return deps.say('No open files matched a formatter', 'warn');
		}
		if (failed.length > 0) {
			deps.say(`Formatted ${formatted}, failed: ${failed.join(', ')}`, 'error');
		} else {
			deps.say(formatted === 1 ? 'Formatted 1 file' : `Formatted ${formatted} files`);
		}
	};
	const saveDirtyPaths = async (paths: string[]) => {
		const skipped: string[] = [];
		const failed: string[] = [];
		let saved = 0;
		for (const path of paths) {
			const buffer = deps.buffers[path]!;
			if (!buffer.dirty) continue;
			if (mtimeOf(path) !== buffer.mtime) {
				skipped.push(basename(path));
				continue;
			}
			if (await writeBuffer(path, buffer.content)) saved++;
			else failed.push(basename(path));
		}
		if (saved > 1) deps.say(`Saved ${saved} files`);
		if (skipped.length > 0) deps.say(`${CLASH_CHANGED}${skipped.join(', ')}`, 'warn');
		if (failed.length > 0) deps.say(`Save failed: ${failed.join(', ')}`, 'error');
	};
	const saveAll = () => {
		const dirty = Object.entries(deps.buffers)
			.filter(([, buffer]) => buffer.dirty)
			.map(([path]) => path);
		if (dirty.length === 0) return deps.say('Nothing to save');
		void saveDirtyPaths(dirty);
	};
	const saveDirtyOnBlur = () => void saveDirtyPaths(Object.keys(deps.buffers));
	const resolveConflict = (choice: string) => {
		const c = deps.conflict();
		deps.setConflict(null);
		if (!c) return;
		if (choice === 'overwrite' && deps.buffers[c.path])
			void writeBuffer(c.path, deps.buffers[c.path]!.content);
		else if (choice === 'reload') {
			deps.setBuffers(c.path, syncedBuffer(c.disk, mtimeOf(c.path), c.encoding));
			deps.setReloadKey((k) => k + 1);
			deps.say(`Reloaded ${basename(c.path)} from disk`);
		}
	};
	const onEditorChange = (text: string) => {
		const path = deps.activePath();
		const buffer = path ? deps.buffers[path] : undefined;
		if (!path || !buffer || buffer.content === text) return;
		deps.pinTab(path);
		deps.setBuffers(path, { ...buffer, content: text, dirty: text !== buffer.saved });
	};
	const syncFromDisk = (): DiskSync => {
		const updates: [string, BufferState][] = [];
		const changed: string[] = [];
		const deleted: string[] = [];
		const vanished: string[] = [];
		for (const path of Object.keys(deps.buffers)) {
			const buffer = deps.buffers[path]!;
			if (!exists(path)) {
				if (buffer.dirty) deleted.push(basename(path));
				else vanished.push(path);
				continue;
			}
			let disk: string;
			let encoding = buffer.encoding;
			try {
				const file = readTextFile(path);
				disk = file.content;
				encoding = file.encoding;
			} catch {
				continue;
			}
			if (disk === buffer.content) continue;
			if (buffer.dirty) changed.push(basename(path));
			else updates.push([path, syncedBuffer(disk, mtimeOf(path), encoding)]);
		}
		for (const path of vanished) deps.closeTab(path, true);
		if (updates.length > 0) {
			deps.setBuffers(
				produce((draft: Record<string, BufferState>) => {
					for (const [path, buffer] of updates) draft[path] = buffer;
				}),
			);
			deps.setReloadKey((k) => k + 1);
		}
		deps.refreshTree();
		return { changed, deleted };
	};
	const submitPrompt = (value: string) => {
		const name = value.trim();
		const p = deps.prompt();
		deps.setPrompt(null);
		if (!p || !isTextPrompt(p)) return;
		if (p.kind === 'reviewNote') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return deps.addReviewNote({
				path: p.path,
				line: p.line,
				endLine: p.endLine,
				kind: p.noteKind,
				body: name,
			});
		}
		if (p.kind === 'reviewReply') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return deps.addReviewReply(p.parentId, name);
		}
		if (p.kind === 'commitMessage') return deps.gitCommands.submitCommit(name);
		if (p.kind === 'commitAmend') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return deps.gitCommands.submitAmend(name);
		}
		if (p.kind === 'newBranch') return deps.gitCommands.submitBranch(name, p.from);
		if (p.kind === 'renameBranch') return deps.gitCommands.rename(p.from, name);
		if (p.kind === 'newTag') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return deps.gitCommands.submitTag(name);
		}
		if (p.kind === 'newRemoteName') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return deps.gitCommands.submitRemoteName(name);
		}
		if (p.kind === 'newRemoteUrl') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return deps.gitCommands.submitRemote(p.name, name);
		}
		if (p.kind === 'typescriptTsdk') {
			deps.patchConfig({ typescriptTsdk: name });
			return deps.say(name ? `TypeScript SDK: ${name}` : 'TypeScript SDK: server default');
		}
		if (p.kind === 'formatterCommand') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const edit = parseFormatterEdit(name);
			if (!edit.ok) return deps.say(edit.error, 'error');
			const formatters = { ...deps.config.formatters };
			if (edit.command) {
				formatters[edit.key] = edit.command;
				deps.patchConfig({ formatters });
				return deps.say(`Formatter: ${edit.key} = ${edit.command.join(' ')}`);
			}
			delete formatters[edit.key];
			deps.patchConfig({ formatters });
			return deps.say(`Formatter for "${edit.key}" removed`);
		}
		if (p.kind === 'lspServerCommand') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const edit = parseLspServerEdit(name);
			if (!edit.ok) return deps.say(edit.error, 'error');
			const lspServers = { ...deps.config.lspServers };
			if (edit.command?.length === 0) {
				lspServers[edit.id] = [];
				deps.patchConfig({ lspServers });
				return deps.say(`LSP: ${edit.id} disabled`);
			}
			if (edit.command) {
				lspServers[edit.id] = edit.command;
				deps.patchConfig({ lspServers });
				return deps.say(`LSP: ${edit.id} = ${edit.command.join(' ')}`);
			}
			delete lspServers[edit.id];
			deps.patchConfig({ lspServers });
			return deps.say(`LSP override for "${edit.id}" removed`);
		}
		if (p.kind === 'keybindingCommand') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const edit = parseKeybindingEdit(name);
			if (!edit.ok) return deps.say(edit.error, 'error');
			const command = KEYBINDABLE_COMMANDS.find(
				(item) =>
					item.id === edit.command || item.label.toLowerCase() === edit.command.toLowerCase(),
			);
			if (!command) return deps.say(`Unknown shortcut command: ${edit.command}`, 'error');
			const keybindings = { ...deps.config.keybindings };
			if (!edit.shortcut) {
				delete keybindings[command.id];
				deps.patchConfig({ keybindings });
				return deps.say(`Shortcut removed for ${command.label}`);
			}
			if (isDisabledShortcut(edit.shortcut)) {
				keybindings[command.id] = 'none';
				deps.patchConfig({ keybindings });
				return deps.say(`Shortcut disabled for ${command.label}`);
			}
			const parsed = parseChord(edit.shortcut);
			if (!parsed) return deps.say(`Shortcut "${edit.shortcut}" is not valid`, 'error');
			const problem = bindingProblem(parsed);
			if (problem) return deps.say(problem, 'error');
			const id = chordId(parsed);
			const taken = Object.entries(keybindings).find(([otherCommand, otherShortcut]) => {
				if (otherCommand === command.id) return false;
				const other = parseChord(otherShortcut);
				return other ? chordId(other) === id : false;
			});
			if (taken) return deps.say(`${formatChord(parsed, ALT)} is already bound`, 'error');
			const shortcut = formatChord(parsed, ALT);
			keybindings[command.id] = shortcut;
			deps.patchConfig({ keybindings });
			return deps.say(`${shortcut} → ${command.label}`);
		}
		if (p.kind === 'sidebarWidth') {
			if (!name) return deps.say('Nothing entered', 'warn');
			if (name.toLowerCase() === 'auto') {
				deps.patchConfig({ sidebarWidth: 'auto' });
				return deps.say('Sidebar width: auto');
			}
			const width = Number.parseInt(name, 10);
			if (!Number.isInteger(width) || `${width}` !== name)
				return deps.say(`Not a sidebar width: ${name}`, 'error');
			if (width < SIDEBAR_MIN || width > SIDEBAR_MAX)
				return deps.say(`Sidebar width must be ${SIDEBAR_MIN}-${SIDEBAR_MAX}`, 'error');
			deps.patchConfig({ sidebarWidth: width });
			return deps.say(`Sidebar width: ${width}`);
		}
		if (p.kind === 'appearancePluginId') {
			if (!name) return deps.say('Nothing entered', 'warn');
			return void installMarketPlugin(name, {
				config: deps.config,
				reload: deps.reloadAppearancePlugins,
				say: deps.say,
				appearance: deps.appearance,
				prompt: deps.prompt,
				setPrompt: deps.setPrompt,
			});
		}
		if (p.kind === 'appearancePluginRemoveId') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const error = removeFromDisk(name);
			if (error) return deps.say(`Could not remove ${name}: ${error}`, 'error');
			deps.reloadAppearancePlugins();
			return deps.say(`Removed plugin ${name}`);
		}
		if (p.kind === 'appearancePluginRegistry') {
			const registry = name || MARKET_URL;
			if (!registry.startsWith('https://')) {
				return deps.say('Plugin registry must be an https URL', 'error');
			}
			deps.patchConfig({ pluginRegistry: registry });
			return deps.say(`Plugin registry: ${registry}`);
		}
		if (p.kind === 'gotoLine') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const asked = Number.parseInt(name, 10);
			if (!Number.isInteger(asked) || asked < 1)
				return deps.say(`Not a line number: ${name}`, 'error');
			const total = deps.activeBuffer()?.content.split('\n').length ?? 1;
			const line = Math.min(asked, total);
			deps.setGoto((prev) => ({ line: line - 1, col: 0, key: (prev?.key ?? 0) + 1 }));
			deps.setFocus('editor');
			return deps.say(line === asked ? `Line ${line}` : `Line ${line} — the file ends there`);
		}
		if (p.kind === 'newFile') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const path = join(p.dir, name);
			const err = createFile(path);
			if (err) return deps.say(err, 'error');
			deps.expand(p.dir);
			deps.openFile(path);
			return deps.say(`Created ${name}`);
		}
		if (p.kind === 'newFolder') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const path = join(p.dir, name);
			const err = createDir(path);
			if (err) return deps.say(err, 'error');
			deps.expand(path);
			deps.setSelectedPath(path);
			return deps.say(`Created ${name}/`);
		}
		if (p.kind === 'rename') {
			if (!name) return deps.say('Nothing entered', 'warn');
			const err = deps.movePath(p.target, join(dirname(p.target), name));
			if (err) return deps.say(err, 'error');
			deps.say(`Renamed to ${name}`);
		}
	};
	const confirmPrompt = () => {
		const p = deps.prompt();
		deps.setPrompt(null);
		switch (p?.kind) {
			case 'delete': {
				for (const target of p.targets)
					if (deps.tabs().includes(target)) deps.closeTab(target, true);
				const gone = deps.selectedPath();
				const wasAt =
					gone && p.targets.includes(gone) ? deps.nodes().findIndex((n) => n.path === gone) : -1;
				deps.setMarked([]);
				deps.setAnchor(null);
				const targets = p.targets;
				deps.whileFree(
					() =>
						void (async () => {
							deps.setBusy({ label: 'Deleting', done: 0, total: 0 });
							const { failed } = await removeAll(targets, (progress) =>
								deps.setBusy({ label: 'Deleting', done: progress.done, total: progress.total }),
							);
							deps.setBusy(null);
							deps.refreshTree();
							if (wasAt >= 0)
								deps.setSelectedPath(
									deps.nodes()[Math.min(wasAt, deps.nodes().length - 1)]?.path ?? null,
								);
							if (failed.length > 0)
								return deps.say(`Could not delete ${failed.join(', ')}`, 'error');
							deps.say(
								targets.length === 1
									? `Deleted ${basename(targets[0]!)}`
									: `Deleted ${targets.length} items`,
							);
						})(),
				);
				return;
			}
			case 'closeDirty':
				for (const path of p.paths) deps.closeTab(path, true);
				return deps.say(`Discarded unsaved edits in ${p.names.join(', ')}`, 'warn');
			case 'quitDirty':
				return deps.quit(true);
			case 'undoCommit':
				return deps.gitCommands.undoCommit();
			case 'commitAll':
				return deps.gitCommands.submitCommitAll(p.message);
			case 'discardChanges':
				return deps.gitCommands.discard(p.path, p.status);
			case 'deleteTag':
				return deps.gitCommands.removeTag(p.name);
			case 'removeRemote':
				return deps.gitCommands.removeRemoteConfirmed(p.name);
			case 'deleteBranch':
				return deps.gitCommands.remove(p.name, p.force);
			case 'mergeBranch':
				return deps.gitCommands.merge(p.name);
			case 'pullPush':
				return deps.gitCommands.pullPush(p.branch, p.hasUpstream);
			case 'installServer':
				return deps.installLspServer(p.id, p.name, p.install, p.manager);
			case 'installPlugin':
				return void installMarketPlugin(p.id, {
					config: deps.config,
					reload: deps.reloadAppearancePlugins,
					say: deps.say,
					appearance: deps.appearance,
					prompt: deps.prompt,
					setPrompt: deps.setPrompt,
				});
			case 'activatePlugin': {
				const only = p.choices[0];
				if (only) activatePluginChoice(only.id, deps);
				return;
			}
		}
	};
	const chooseActivation = (choice: string) => choosePluginActivation(choice, deps);
	return {
		onEditorChange,
		resolveConflict,
		saveActive,
		saveAll,
		saveDirtyOnBlur,
		saveDirtyPaths,
		saveWithoutFormatting,
		formatActive,
		formatOpenFiles,
		submitPrompt,
		confirmPrompt,
		chooseActivation,
		syncFromDisk,
	};
}
