import { describe, expect, test } from 'bun:test';

import {
	activatePluginChoice,
	appearancesOf,
	claimedAppearances,
} from '../../src/app/appearance/pluginsPage';
import { confirmationForPrompt } from '../../src/app/confirmation';
import type { AppearancePluginLoad } from '../../src/core/localThemes';
import type { Prompt } from '../../src/app/types';

const load = {
	themes: [
		{ id: 'pack-dark', theme: { name: 'Pack Dark' } },
		{ id: 'pack-light', theme: { name: 'Pack Light' } },
	],
	iconThemes: [{ id: 'pack-icons', name: 'Pack Icons' }],
	plugins: [],
	problems: [],
} as unknown as AppearancePluginLoad;

describe('claimedAppearances', () => {
	test('reads theme and icon ids from a manifest body', () => {
		expect(
			claimedAppearances(
				JSON.stringify({
					themes: [{ id: 'pack-dark' }, { id: '' }, {}],
					icons: [{ id: 'pack-icons' }],
				}),
			),
		).toEqual({ themes: ['pack-dark'], icons: ['pack-icons'] });
	});

	test('tolerates invalid JSON', () => {
		expect(claimedAppearances('{')).toEqual({ themes: [], icons: [] });
	});
});

describe('appearancesOf', () => {
	test('skips what is already active and disabled plugins', () => {
		expect(
			appearancesOf(
				{ themes: ['pack-dark', 'pack-light'], icons: ['pack-icons'] },
				load,
				{ theme: 'pack-dark', iconTheme: 'none', disabledAppearancePlugins: [] },
				'pack',
			),
		).toEqual([
			{ id: 'theme:pack-light', label: 'Pack Light theme' },
			{ id: 'icons:pack-icons', label: 'Pack Icons file icons' },
		]);
		expect(
			appearancesOf(
				{ themes: ['pack-dark'], icons: ['pack-icons'] },
				load,
				{ theme: 'dusk', iconTheme: 'none', disabledAppearancePlugins: ['pack'] },
				'pack',
			),
		).toEqual([]);
	});
});

describe('activatePluginChoice', () => {
	test('routes theme and icon choices', () => {
		const themes: string[] = [];
		const icons: string[] = [];
		activatePluginChoice('theme:pack-dark', {
			applyTheme: (id) => themes.push(id),
			applyIconTheme: (id) => icons.push(id),
		});
		activatePluginChoice('icons:pack-icons', {
			applyTheme: (id) => themes.push(id),
			applyIconTheme: (id) => icons.push(id),
		});
		activatePluginChoice('noop', {
			applyTheme: (id) => themes.push(id),
			applyIconTheme: (id) => icons.push(id),
		});
		expect(themes).toEqual(['pack-dark']);
		expect(icons).toEqual(['pack-icons']);
	});
});

describe('activatePlugin confirmation', () => {
	test('one appearance is a yes/no; several are a choice modal', () => {
		const one: Prompt = {
			kind: 'activatePlugin',
			name: 'Mono',
			choices: [{ id: 'icons:mono-icons', label: 'Mono Icons file icons' }],
			more: 0,
		};
		expect(confirmationForPrompt(one)).toEqual({
			title: 'Plugin installed',
			verb: 'use it',
			danger: false,
			message: 'Mono is installed. Use the Mono Icons file icons?',
		});
		const many: Prompt = {
			kind: 'activatePlugin',
			name: 'Pack',
			choices: [
				{ id: 'theme:pack-dark', label: 'Pack Dark theme' },
				{ id: 'icons:pack-icons', label: 'Pack Icons file icons' },
			],
			more: 0,
		};
		expect(confirmationForPrompt(many)).toBeNull();
	});
});
