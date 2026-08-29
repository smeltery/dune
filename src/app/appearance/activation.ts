import type { Config } from '../../core/config';
import type { AppearancePluginLoad } from '../../core/localThemes';
import { themeLabels } from '../../themes';
import type { Prompt } from '../types';

const MAX_ACTIVATION_CHOICES = 8;

/** Theme/icon ids claimed by a just-fetched manifest body. */
export function claimedAppearances(body: string): { themes: string[]; icons: string[] } {
	try {
		const raw = JSON.parse(body) as {
			themes?: { id?: string }[];
			icons?: { id?: string }[];
		};
		const themes = (raw.themes ?? [])
			.map((entry) => entry.id)
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
		const icons = (raw.icons ?? [])
			.map((entry) => entry.id)
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
		return { themes, icons };
	} catch {
		return { themes: [], icons: [] };
	}
}

export function appearancesOf(
	claimed: { themes: string[]; icons: string[] },
	load: AppearancePluginLoad,
	config: Pick<Config, 'theme' | 'iconTheme' | 'disabledAppearancePlugins'>,
	pluginId: string,
): { id: string; label: string }[] {
	if (config.disabledAppearancePlugins.includes(pluginId)) return [];
	const registeredThemes = new Map(load.themes.map((entry) => [entry.id, entry.theme.name]));
	const registeredIcons = new Map(load.iconThemes.map((theme) => [theme.id, theme.name]));
	return [
		...claimed.themes
			.filter((id) => id !== config.theme && registeredThemes.has(id))
			.map((id) => ({
				id: `theme:${id}`,
				label: `${registeredThemes.get(id) ?? themeLabels[id] ?? id} theme`,
			})),
		...claimed.icons
			.filter((id) => id !== config.iconTheme && registeredIcons.has(id))
			.map((id) => ({
				id: `icons:${id}`,
				label: `${registeredIcons.get(id) ?? id} file icons`,
			})),
	];
}

export function offerActivation(deps: {
	pluginId: string;
	name: string;
	claimed: { themes: string[]; icons: string[] };
	appearance: () => AppearancePluginLoad;
	config: Config;
	prompt: () => Prompt;
	setPrompt: (prompt: Prompt) => void;
}): void {
	if (deps.prompt()) return;
	const choices = appearancesOf(deps.claimed, deps.appearance(), deps.config, deps.pluginId);
	if (choices.length === 0) return;
	deps.setPrompt({
		kind: 'activatePlugin',
		name: deps.name,
		choices: choices.slice(0, MAX_ACTIVATION_CHOICES),
		more: Math.max(0, choices.length - MAX_ACTIVATION_CHOICES),
	});
}

export function activatePluginChoice(
	choice: string,
	deps: {
		applyTheme: (id: string) => void;
		applyIconTheme: (id: string) => void;
	},
): void {
	const colon = choice.indexOf(':');
	if (colon < 0) return;
	const kind = choice.slice(0, colon);
	const id = choice.slice(colon + 1);
	if (!id) return;
	if (kind === 'theme') deps.applyTheme(id);
	else if (kind === 'icons') deps.applyIconTheme(id);
}

export function choosePluginActivation(
	choice: string,
	deps: {
		prompt: () => Prompt;
		setPrompt: (prompt: Prompt) => void;
		applyTheme: (id: string) => void;
		applyIconTheme: (id: string) => void;
	},
): void {
	const p = deps.prompt();
	deps.setPrompt(null);
	if (p?.kind !== 'activatePlugin') return;
	if (p.choices.some((candidate) => candidate.id === choice)) {
		activatePluginChoice(choice, deps);
	}
}
