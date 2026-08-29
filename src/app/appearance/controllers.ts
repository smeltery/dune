import type { Accessor } from 'solid-js';

import type { Config } from '../../core/config';
import type { AppearancePluginLoad } from '../../core/localThemes';
import type { Prompt } from '../types';
import { createAppearancePluginUi } from './pluginsPage';
import { createPluginsPanel } from './pluginsPanel';

export function createAppearanceControllers(deps: {
	rootDir: string;
	config: Config;
	appearance: Accessor<AppearancePluginLoad>;
	patchConfig: (patch: Partial<Config>) => void;
	reload: () => void;
	say: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
	prompt: () => Prompt;
	setPrompt: (prompt: Prompt) => void;
	editRegistry: () => void;
}) {
	return {
		ui: createAppearancePluginUi(deps),
		panel: createPluginsPanel(deps),
	};
}
