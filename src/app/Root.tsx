import { basename } from 'node:path';

import { useRenderer } from '@opentui/solid';
import { createSignal, Show } from 'solid-js';

import { loadConfig, loadProjectConfig } from '../core/config';
import type { Config } from '../core/config';
import { App } from './App';

const LISTENER_CAP = 64;

interface Opened {
	rootDir: string;
	openFile: string | null;
	openLine: number | null;
	openCol: number | null;
	config: Config;
	projectConfig: Partial<Config>;
	checkUpdates: boolean;
	notice: string | null;
}

export function Root(props: {
	rootDir: string;
	openFile?: string | null;
	openLine?: number | null;
	openCol?: number | null;
	initialConfig: Config;
	projectConfig: Partial<Config>;
	checkUpdates?: boolean;
}) {
	const renderer = useRenderer();
	renderer.setMaxListeners(LISTENER_CAP);
	renderer.keyInput.setMaxListeners(LISTENER_CAP);
	const [opened, setOpened] = createSignal<Opened>({
		rootDir: props.rootDir,
		openFile: props.openFile ?? null,
		openLine: props.openLine ?? null,
		openCol: props.openCol ?? null,
		config: props.initialConfig,
		projectConfig: props.projectConfig,
		checkUpdates: props.checkUpdates ?? true,
		notice: null,
	});
	const openWorkspace = (dir: string) => {
		const config = loadConfig();
		setOpened({
			rootDir: dir,
			openFile: null,
			openLine: null,
			openCol: null,
			config,
			projectConfig: loadProjectConfig(dir),
			checkUpdates: false,
			notice: `Opened ${basename(dir)}`,
		});
	};

	return (
		<Show when={opened()} keyed>
			{(at: Opened) => (
				<App
					rootDir={at.rootDir}
					openFile={at.openFile}
					openLine={at.openLine}
					openCol={at.openCol}
					initialConfig={at.config}
					projectConfig={at.projectConfig}
					checkUpdates={at.checkUpdates}
					notice={at.notice}
					onOpenWorkspace={openWorkspace}
				/>
			)}
		</Show>
	);
}
