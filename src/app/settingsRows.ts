import { createMemo } from 'solid-js';
import { CURSOR_STYLES, GIT_SCAN_DEPTH_MAX, GIT_SCAN_DEPTH_MIN, ICON_THEMES } from '../core/config';
import type { Config } from '../core/config';
import type { IconTheme } from '../core/iconThemes';
import type { ThemeName } from '../themes';
import { themeLabels } from '../themes';
import type { SettingRow } from '../ui/overlays/SettingsView';

export type { SettingRow } from '../ui/overlays/SettingsView';

const TAB_SIZES = [2, 4, 8];
const DIFF_VIEWS = ['inline', 'split'] as const;
const GIT_PANEL_VIEWS = ['tree', 'list'] as const;
const GIT_SCAN_DEPTHS = Array.from(
	{ length: GIT_SCAN_DEPTH_MAX - GIT_SCAN_DEPTH_MIN + 1 },
	(_, i) => GIT_SCAN_DEPTH_MIN + i,
);
const SIDEBAR_POSITIONS = ['left', 'right'] as const;

const onOff = (value: boolean) => (value ? 'on' : 'off');

function cycle<T>(values: readonly T[], current: T, dir: 1 | -1): T {
	const at = Math.max(0, values.indexOf(current));
	return values[(at + dir + values.length) % values.length]!;
}

export function settingsRows(
	config: Config,
	iconThemes: readonly IconTheme[],
	actions: {
		applyTheme: (name: ThemeName) => void;
		applyThemeSlot: (slot: 'themeLight' | 'themeDark', name: ThemeName) => void;
		applyTabSize: (size: number) => void;
		applyVim: (enabled: boolean) => void;
		editFormatter: () => void;
		editLspServer: () => void;
		editTypescriptTsdk: () => void;
		editKeybinding: () => void;
		editSidebarWidth: () => void;
		toggleThemeSync: () => void;
		toggleAutoSave: () => void;
		toggleTransparent: () => void;
		toggleDotfiles: () => void;
		toggleGitignored: () => void;
		toggleWrap: () => void;
		toggleFormat: () => void;
		toggleTrim: () => void;
		patchConfig: (patch: Partial<Config>, scope?: 'user' | 'project') => void;
		configScope: () => 'user' | 'project';
	},
): SettingRow[] {
	const themes = Object.keys(themeLabels) as ThemeName[];
	const iconOptions = [
		...ICON_THEMES.map((id) => ({ id, name: id === 'none' ? 'none' : 'Unicode shapes' })),
		...iconThemes.map((theme) => ({ id: theme.id, name: theme.name })),
	];
	const iconValue =
		iconOptions.find((option) => option.id === config.iconTheme)?.name ?? config.iconTheme;
	return [
		{
			section: 'Appearance',
			label: 'Theme',
			value: themeLabels[config.theme] ?? config.theme,
			change: (dir) => actions.applyTheme(cycle(themes, config.theme, dir)),
		},
		{
			section: 'Appearance',
			label: 'Follow OS appearance',
			value: onOff(config.themeSync),
			change: actions.toggleThemeSync,
		},
		{
			section: 'Appearance',
			label: 'Light theme',
			value: themeLabels[config.themeLight] ?? config.themeLight,
			change: (dir) => actions.applyThemeSlot('themeLight', cycle(themes, config.themeLight, dir)),
		},
		{
			section: 'Appearance',
			label: 'Dark theme',
			value: themeLabels[config.themeDark] ?? config.themeDark,
			change: (dir) => actions.applyThemeSlot('themeDark', cycle(themes, config.themeDark, dir)),
		},
		{
			section: 'Appearance',
			label: 'Transparent background',
			value: onOff(config.transparent),
			change: actions.toggleTransparent,
		},
		{
			section: 'Appearance',
			label: 'File icons',
			value: iconValue,
			change: (dir) =>
				actions.patchConfig(
					{
						iconTheme: cycle(
							iconOptions.map((option) => option.id),
							config.iconTheme,
							dir,
						),
					},
					actions.configScope(),
				),
		},
		{
			section: 'Appearance',
			label: 'Plugin update checks',
			value: onOff(config.pluginUpdates),
			change: () =>
				actions.patchConfig({ pluginUpdates: !config.pluginUpdates }, actions.configScope()),
		},
		{
			section: 'Appearance',
			label: 'Tab-bar tooltips',
			value: onOff(config.tooltips),
			change: () => actions.patchConfig({ tooltips: !config.tooltips }, actions.configScope()),
		},
		{
			section: 'Appearance',
			label: 'Tab-bar file icons',
			value: onOff(config.tabIcons),
			change: () => actions.patchConfig({ tabIcons: !config.tabIcons }, actions.configScope()),
		},
		{
			section: 'Editor',
			label: 'Vim mode',
			value: onOff(config.vim),
			change: () => actions.applyVim(!config.vim),
		},
		{
			section: 'Editor',
			label: 'Cursor',
			value: config.vim ? `${config.cursorStyle} (vim overrides)` : config.cursorStyle,
			change: (dir) =>
				actions.patchConfig(
					{ cursorStyle: cycle(CURSOR_STYLES, config.cursorStyle, dir) },
					actions.configScope(),
				),
		},
		{
			section: 'Editor',
			label: 'Word wrap',
			value: onOff(config.wrap),
			change: actions.toggleWrap,
		},
		{
			section: 'Editor',
			label: 'Scroll past end',
			value: onOff(config.scrollPastEnd),
			change: () =>
				actions.patchConfig({ scrollPastEnd: !config.scrollPastEnd }, actions.configScope()),
		},
		{
			section: 'Editor',
			label: 'Tab size',
			value: `${config.tabSize}`,
			change: (dir) => actions.applyTabSize(cycle(TAB_SIZES, config.tabSize, dir)),
		},
		{
			section: 'Editor',
			label: 'Trim trailing whitespace on save',
			value: onOff(config.trimOnSave),
			change: actions.toggleTrim,
		},
		{
			section: 'Editor',
			label: 'Format on save',
			value: onOff(config.formatOnSave),
			change: actions.toggleFormat,
		},
		{
			section: 'Editor',
			label: 'Add/update formatter…',
			value: `${Object.keys(config.formatters).length} configured`,
			change: actions.editFormatter,
		},
		{
			section: 'Editor',
			label: 'Auto-save on blur and tab switch',
			value: onOff(config.autoSaveOnBlur),
			change: actions.toggleAutoSave,
		},
		{
			section: 'Editor',
			label: 'Language servers',
			value: onOff(config.lsp),
			change: () => actions.patchConfig({ lsp: !config.lsp }, actions.configScope()),
		},
		{
			section: 'Editor',
			label: 'Autocomplete',
			value: onOff(config.lspCompletion),
			change: () =>
				actions.patchConfig({ lspCompletion: !config.lspCompletion }, actions.configScope()),
		},
		{
			section: 'Editor',
			label: 'Inline problem text',
			value: onOff(config.lspInline),
			change: () => actions.patchConfig({ lspInline: !config.lspInline }, actions.configScope()),
		},
		{
			section: 'Editor',
			label: 'Offer to install servers',
			value: onOff(config.lspAutoInstall),
			change: () =>
				actions.patchConfig({ lspAutoInstall: !config.lspAutoInstall }, actions.configScope()),
		},
		{
			section: 'Editor',
			label: 'Add/update language server…',
			value: `${Object.keys(config.lspServers).length} overridden`,
			change: actions.editLspServer,
		},
		{
			section: 'Editor',
			label: 'TypeScript SDK',
			value: config.typescriptTsdk || 'server default',
			change: actions.editTypescriptTsdk,
		},
		{
			section: 'Editor',
			label: 'Add/update shortcut…',
			value: `${Object.keys(config.keybindings).length} custom`,
			change: actions.editKeybinding,
		},
		{
			section: 'Tree',
			label: 'Sidebar width',
			value: `${config.sidebarWidth}`,
			change: actions.editSidebarWidth,
		},
		{
			section: 'Tree',
			label: 'Sidebar position',
			value: config.sidebarPosition,
			change: (dir) =>
				actions.patchConfig(
					{ sidebarPosition: cycle(SIDEBAR_POSITIONS, config.sidebarPosition, dir) },
					actions.configScope(),
				),
		},
		{
			section: 'Tree',
			label: 'Show dotfiles',
			value: onOff(config.showDotfiles),
			change: actions.toggleDotfiles,
		},
		{
			section: 'Tree',
			label: 'Hide gitignored files',
			value: onOff(config.respectGitignore),
			change: actions.toggleGitignored,
		},
		{
			section: 'Git',
			label: 'Diff layout',
			value: config.diffView,
			change: (dir) =>
				actions.patchConfig(
					{ diffView: cycle(DIFF_VIEWS, config.diffView, dir) },
					actions.configScope(),
				),
		},
		{
			section: 'Git',
			label: 'Changed files',
			value: config.gitPanelView === 'tree' ? 'tree' : 'flat list',
			change: (dir) =>
				actions.patchConfig(
					{ gitPanelView: cycle(GIT_PANEL_VIEWS, config.gitPanelView, dir) },
					actions.configScope(),
				),
		},
		{
			section: 'Git',
			label: 'Repo scan depth',
			value: `${config.gitScanDepth}`,
			change: (dir) =>
				actions.patchConfig(
					{ gitScanDepth: cycle(GIT_SCAN_DEPTHS, config.gitScanDepth, dir) },
					actions.configScope(),
				),
		},
	];
}

export function createSettingsRows(
	deps: Parameters<typeof settingsRows>[2] & {
		config: Config;
		iconThemes: () => readonly IconTheme[];
	},
) {
	return createMemo(() => settingsRows(deps.config, deps.iconThemes(), deps));
}
