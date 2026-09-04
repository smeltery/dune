#!/usr/bin/env bun
import './core/assets';
import { render } from '@opentui/solid';

import { Root } from './app/Root';
import { flagOutput, resolveTarget } from './core/cli';
import { detectAppearance } from './core/appearance';
import { loadConfig, loadProjectConfig, resolveConfig, resolvedTheme } from './core/config';
import { loadLocalThemes } from './core/localThemes';
import { runUpgrade } from './core/upgrade';
import { divertWarnings } from './core/warnings';
import { registerLocalThemes, setTheme, setTransparency } from './themes';

divertWarnings();

const flag = flagOutput(process.argv[2]);
if (flag !== null) {
	process.stdout.write(flag);
	process.exit(0);
}

// Before the path handling: `update` is a command, not a directory to open.
if (process.argv[2] === 'update') {
	process.exit(await runUpgrade());
}

const target = resolveTarget(process.argv[2], process.cwd());
if (!target) {
	process.stderr.write(`dune: no such file or directory: ${process.argv[2]}\n`);
	process.exit(1);
}
const { rootDir, openFile } = target;

registerLocalThemes(loadLocalThemes(rootDir).themes);
const config = loadConfig();
const projectConfig = loadProjectConfig(rootDir);
// Apply the resolved theme before the first render.
const resolved = resolveConfig(config, projectConfig);
setTheme(resolvedTheme(resolved, detectAppearance()));
setTransparency(resolved.transparent);

await render(
	() => (
		<Root
			rootDir={rootDir}
			openFile={openFile}
			openLine={target.line}
			openCol={target.col}
			initialConfig={config}
			projectConfig={projectConfig}
		/>
	),
	{
		useMouse: true,
		// Without motion reporting the terminal never hands drags to the app, so every
		// click-drag paints the terminal's own selection over the UI instead.
		enableMouseMovement: true,
		// Ctrl+C is handled in App, not here: it copies when there is a selection and
		// quits otherwise. OpenTUI's own exit would bypass the unsaved-buffer prompt and
		// drop the work.
		exitOnCtrlC: false,
		targetFps: 30,
	},
);
