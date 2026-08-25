import { basename } from 'node:path';

import { on, onCleanup, onMount, createEffect } from 'solid-js';

import type { Config } from '../core/config';
import type { Appearance } from '../core/appearance';
import type { TreeNode } from '../core/fs';
import type { FileStatus, LineChange, StatusEntry, Upstream } from '../core/git';
import {
	currentBranch,
	diffLines,
	ignoredAmong,
	statusEntries,
	statusMap,
	upstreamOf,
} from '../core/git';
import { fetchCatalog, missingConfiguredAppearancePlugins, updatesFor } from '../core/market';
import { loadLocalLspServers } from '../core/plugins/localLspServers';
import { watchNotes } from '../core/review';
import { saveSession } from '../core/session';
import { checkForUpdate } from '../core/update';
import { watchTree } from '../core/fs';
import { watchAppearance } from '../core/appearance';
import { installedMarketPlugins } from './appearance/pluginsPage';
import { clashWarning } from './clashes';
import { CLASH_CHANGED, CLASH_DELETED, READY } from './constants';
import type { AppProps, BufferState, DiskSync, Prompt } from './types';

export function startupOpen(props: Pick<AppProps, 'openFile' | 'openLine' | 'openCol'>): {
	single: string | null;
	openLine: number | null | undefined;
	openCol: number | null | undefined;
} {
	return { single: props.openFile ?? null, openLine: props.openLine, openCol: props.openCol };
}

export function useAppLifecycle(deps: {
	rootDir: string;
	single: string | null;
	openLine: number | null | undefined;
	openCol: number | null | undefined;
	initialConfig: Config;
	checkUpdates: boolean | undefined;
	appearanceVersion: () => {
		iconThemes: readonly { id: string }[];
		plugins: readonly { id: string; version: string }[];
	};
	restoredFailed: string | null | undefined;
	activeBuffer: () => BufferState | undefined;
	activePath: () => string | null;
	expanded: () => Set<string>;
	nodes: () => TreeNode[];
	gitRevision: () => number;
	diffBase: () => string | null;
	reloadKey: () => number;
	sidebar: () => boolean;
	tabs: () => string[];
	branch: () => string | null;
	config: Config;
	renderer: {
		stdin: {
			on: (event: 'data', fn: (chunk: BufferState | string) => void) => void;
			off: (event: 'data', fn: (chunk: BufferState | string) => void) => void;
		};
	};
	onAppearance: (appearance: Appearance) => void;
	saveDirtyOnBlur: () => void;
	syncFromDisk: () => DiskSync;
	dependenciesChanged: () => void;
	reloadNotes: () => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	setPrompt: (prompt: Prompt) => void;
	setGitRevision: (update: (n: number) => number) => void;
	setGitLines: (lines: Map<number, LineChange>) => void;
	setGitStatus: (status: Map<string, FileStatus>) => void;
	setGitStatusEntries: (entries: Map<string, StatusEntry>) => void;
	setGitIgnored: (ignored: Set<string>) => void;
	setBranch: (branch: string | null) => void;
	setUpstream: (upstream: Upstream | null) => void;
	setGoto: (goto: { line: number; col: number; key: number }) => void;
	setNotice: (notice: { name: string; reason: string } | null) => void;
	setUpdate: (update: Awaited<ReturnType<typeof checkForUpdate>>) => void;
	status: () => { msg: string };
}) {
	onMount(() => {
		if (deps.restoredFailed && deps.single)
			deps.setNotice({ name: basename(deps.single), reason: deps.restoredFailed });
		const buffer = deps.activeBuffer();
		if (deps.openLine != null && buffer) {
			const total = buffer.content.split('\n').length;
			deps.setGoto({
				line: Math.min(deps.openLine, total - 1),
				col: deps.openCol ?? 0,
				key: 1,
			});
		}
	});
	onMount(() => {
		if (deps.checkUpdates === false) return;
		let cancelled = false;
		onCleanup(() => {
			cancelled = true;
		});
		void (async () => {
			const info = await checkForUpdate();
			if (!cancelled && info && info.latest !== deps.initialConfig.skipUpdate) deps.setUpdate(info);
		})();
		if (deps.config.pluginUpdates) {
			void (async () => {
				const catalog = await fetchCatalog(deps.config.pluginRegistry);
				if (cancelled || !catalog) return;
				const appearance = deps.appearanceVersion();
				const missing = missingConfiguredAppearancePlugins(
					deps.config,
					appearance.iconThemes,
					catalog,
				);
				if (missing.length === 1) {
					const plugin = missing[0]!;
					deps.setPrompt({
						kind: 'installPlugin',
						id: plugin.id,
						name: plugin.name,
						reason: `Configured appearance needs ${plugin.id}`,
					});
					return;
				}
				if (missing.length > 1) {
					deps.say(`${missing.length} plugins match your config`, 'info');
					return;
				}
				const updates = updatesFor(
					installedMarketPlugins(appearance, loadLocalLspServers(deps.rootDir).plugins),
					catalog,
				);
				if (updates.length === 1) {
					const plugin = updates[0]!;
					deps.setPrompt({
						kind: 'installPlugin',
						id: plugin.id,
						name: plugin.name,
						reason: `${plugin.name} ${plugin.version} is available`,
					});
				} else if (updates.length > 1) {
					deps.say(`${updates.length} plugin updates available`, 'info');
				}
			})();
		}
	});
	onMount(() => {
		const stop = watchAppearance(deps.onAppearance);
		onCleanup(stop);
	});
	// Review notes written by another process — an agent editing review.json is
	// the notes' documented interop — appear the way git state made in another
	// terminal does: without a restart.
	onMount(() => onCleanup(watchNotes(deps.reloadNotes)));
	onMount(() => {
		if (process.stdout.isTTY) process.stdout.write('\x1B[?1004h');
		const onStdin = (chunk: BufferState | string) => {
			if (deps.config.autoSaveOnBlur && chunk.toString().includes('\x1B[O')) deps.saveDirtyOnBlur();
		};
		deps.renderer.stdin.on('data', onStdin);
		onCleanup(() => {
			deps.renderer.stdin.off('data', onStdin);
			if (process.stdout.isTTY) process.stdout.write('\x1B[?1004l');
		});
	});
	onMount(() =>
		onCleanup(
			watchTree(deps.rootDir, (changed) => {
				if (changed.git) deps.setGitRevision((n) => n + 1);
				if (changed.deps) deps.dependenciesChanged();
				if (!changed.tree) return;
				const warning = clashWarning(deps.syncFromDisk());
				if (warning) deps.say(warning, 'warn');
				else if (
					deps.status().msg.startsWith(CLASH_CHANGED) ||
					deps.status().msg.startsWith(CLASH_DELETED)
				)
					deps.say(READY);
			}),
		),
	);
	createEffect(
		on(
			() => [deps.activePath(), deps.reloadKey(), deps.gitRevision(), deps.diffBase()] as const,
			([path]) => deps.setGitLines(path ? diffLines(path, deps.diffBase()) : new Map()),
		),
	);
	createEffect(
		on(
			() => [deps.branch(), deps.gitRevision()] as const,
			() => deps.setUpstream(upstreamOf(deps.rootDir)),
		),
	);
	createEffect(
		on(
			() =>
				[
					deps.nodes(),
					deps.gitRevision(),
					deps.reloadKey(),
					deps.diffBase(),
					deps.config.gitScanDepth,
				] as const,
			() => {
				deps.setGitStatus(statusMap(deps.rootDir, deps.diffBase(), deps.config.gitScanDepth));
				deps.setGitStatusEntries(
					statusEntries(deps.rootDir, deps.diffBase(), deps.config.gitScanDepth),
				);
				deps.setGitIgnored(
					ignoredAmong(
						deps.rootDir,
						deps.nodes().map((node) => node.path),
						deps.config.gitScanDepth,
					),
				);
				deps.setBranch(currentBranch(deps.rootDir));
			},
		),
	);
	createEffect(
		on(
			() => [deps.tabs(), deps.activePath(), deps.expanded(), deps.sidebar()] as const,
			([openTabs, active, folders, showTree]) => {
				if (deps.single) return;
				saveSession(deps.rootDir, {
					tabs: openTabs,
					activePath: active,
					expanded: [...folders],
					sidebar: showTree,
				});
			},
		),
	);
}
