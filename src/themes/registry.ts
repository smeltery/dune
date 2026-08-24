import { zeroX96f } from './0x96f';
import { ayuDark } from './ayu-dark';
import { ayuLight } from './ayu-light';
import { ayuMirage } from './ayu-mirage';
import {
	catppuccinFrappe,
	catppuccinLatte,
	catppuccinMacchiato,
	catppuccinMocha,
} from './catppuccin';
import { dracula } from './dracula';
import { everforestDark } from './everforest-dark';
import { everforestLight } from './everforest-light';
import { flexokiDark } from './flexoki-dark';
import { flexokiLight } from './flexoki-light';
import { githubDark } from './github-dark';
import { githubLight } from './github-light';
import { gruvboxDark } from './gruvbox-dark';
import { gruvboxLight } from './gruvbox-light';
import {
	hearthDark,
	hearthDarkAzure,
	hearthDarkTeal,
	hearthLight,
	hearthLightAzure,
	hearthLightTeal,
} from './hearth';
import { icebergDark } from './iceberg-dark';
import { icebergLight } from './iceberg-light';
import { kanagawaDragon } from './kanagawa-dragon';
import { kanagawaLotus } from './kanagawa-lotus';
import { kanagawaWave } from './kanagawa-wave';
import { monokai } from './monokai';
import { nightOwl } from './night-owl';
import { nord } from './nord';
import { oneDark } from './one-dark';
import { rosePine } from './rose-pine';
import { rosePineDawn } from './rose-pine-dawn';
import { rosePineMoon } from './rose-pine-moon';
import { solarizedDark } from './solarized-dark';
import { solarizedLight } from './solarized-light';
import type { Theme } from './types';
import { tokyoNight } from './tokyo-night';
import { vesper } from './vesper';

// Mocha before Macchiato: the palette matches a query in order, so the flavor
// whose name is a prefix of the other's search hits must come first.
export const THEME_ENTRIES = [
	['dark', githubDark],
	['light', githubLight],
	['0x96f', zeroX96f],
	['ayu-dark', ayuDark],
	['ayu-mirage', ayuMirage],
	['ayu-light', ayuLight],
	['catppuccin-mocha', catppuccinMocha],
	['catppuccin-macchiato', catppuccinMacchiato],
	['catppuccin-frappe', catppuccinFrappe],
	['catppuccin-latte', catppuccinLatte],
	['dracula', dracula],
	['everforest-dark', everforestDark],
	['everforest-light', everforestLight],
	['flexoki-dark', flexokiDark],
	['flexoki-light', flexokiLight],
	['gruvbox', gruvboxDark],
	['gruvbox-light', gruvboxLight],
	['hearth-dark', hearthDark],
	['hearth-light', hearthLight],
	['hearth-dark-azure', hearthDarkAzure],
	['hearth-light-azure', hearthLightAzure],
	['hearth-dark-teal', hearthDarkTeal],
	['hearth-light-teal', hearthLightTeal],
	['iceberg-dark', icebergDark],
	['iceberg-light', icebergLight],
	['kanagawa-wave', kanagawaWave],
	['kanagawa-dragon', kanagawaDragon],
	['kanagawa-lotus', kanagawaLotus],
	['monokai', monokai],
	['night-owl', nightOwl],
	['nord', nord],
	['one-dark', oneDark],
	['rose-pine', rosePine],
	['rose-pine-moon', rosePineMoon],
	['rose-pine-dawn', rosePineDawn],
	['solarized-dark', solarizedDark],
	['solarized-light', solarizedLight],
	['tokyo-night', tokyoNight],
	['vesper', vesper],
] as const satisfies readonly (readonly [string, Theme])[];

type ThemeEntry = (typeof THEME_ENTRIES)[number];

export const THEMES = Object.fromEntries(THEME_ENTRIES) as {
	[Entry in ThemeEntry as Entry[0]]: Entry[1];
};
