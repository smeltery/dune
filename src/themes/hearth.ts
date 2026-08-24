import type { StyleDefinitionInput } from '@opentui/core';

import type { Theme, ThemeUi } from './types';

/** Hearth palette from https://github.com/ryanfurrer/hearth-theme (MIT). */

const darkUi: ThemeUi = {
	bg: '#0a0a0b',
	panelBg: '#171718',
	barBg: '#0a0a0b',
	statusBg: '#f05a29',
	statusFg: '#0a0a0b',
	text: '#d7d7db',
	dim: '#a4a4a9',
	faint: '#626269',
	accent: '#f87c49',
	activeTabFg: '#fafafb',
	inactiveTabFg: '#808085',
	treeSelectedBg: '#262628',
	treeFocusBg: '#1d1d1e',
	dirty: '#f87c49',
	error: '#f87171',
	folder: '#d7d7db',
	cursor: '#f05a29',
	scrollbar: '#5a5a5f',
	gutter: '#4a4a4f',
	currentLine: '#121213',
	indentGuide: '#19191a',
	gitAdded: '#dfbda0',
	gitModified: '#f87c49',
	gitDeleted: '#f87171',
};

const lightUi: ThemeUi = {
	bg: '#f8f8f9',
	panelBg: '#ffffff',
	barBg: '#f0f0f1',
	statusBg: '#f05a29',
	statusFg: '#ffffff',
	text: '#2d2d33',
	dim: '#747479',
	faint: '#919197',
	accent: '#b23c00',
	activeTabFg: '#16161a',
	inactiveTabFg: '#919197',
	treeSelectedBg: '#f0f0f1',
	treeFocusBg: '#f4f4f5',
	dirty: '#b23c00',
	error: '#c0362a',
	folder: '#2d2d33',
	cursor: '#f05a29',
	scrollbar: '#b0b0b6',
	gutter: '#c4c4c9',
	currentLine: '#f3f3f4',
	indentGuide: '#e8e8e9',
	gitAdded: '#6f4420',
	gitModified: '#b23c00',
	gitDeleted: '#c0362a',
};

function syntax(c: {
	comment: string;
	keyword: string;
	text: string;
	member: string;
	string: string;
	literal: string;
	function: string;
	type: string;
	operator: string;
	heading: string;
	error: string;
}): Record<string, StyleDefinitionInput> {
	return {
		comment: { fg: c.comment, italic: true },
		keyword: { fg: c.keyword },
		string: { fg: c.string },
		escape: { fg: c.literal },
		number: { fg: c.literal },
		boolean: { fg: c.literal },
		constant: { fg: c.literal },
		function: { fg: c.function },
		constructor: { fg: c.type, italic: true },
		type: { fg: c.type, italic: true },
		namespace: { fg: c.type, italic: true },
		variable: { fg: c.text },
		'variable.builtin': { fg: c.keyword, italic: true },
		'variable.member': { fg: c.member },
		property: { fg: c.member },
		attribute: { fg: c.string, italic: true },
		tag: { fg: c.keyword },
		label: { fg: c.keyword },
		operator: { fg: c.operator },
		punctuation: { fg: c.operator },
		'punctuation.special': { fg: c.literal },
		embedded: { fg: c.text },
		error: { fg: c.error },
		'markup.heading': { fg: c.heading, bold: true },
		'markup.strong': { fg: c.heading, bold: true },
		'markup.italic': { fg: c.text, italic: true },
		'markup.raw': { fg: c.string },
		'markup.link': { fg: c.keyword },
		'markup.link.url': { fg: c.keyword, underline: true },
		'markup.list': { fg: c.keyword },
		'markup.quote': { fg: c.comment, italic: true },
	};
}

const darkBase = {
	comment: '#626269',
	keyword: '#f87c49',
	text: '#d7d7db',
	member: '#c4c4c9',
	string: '#dfbda0',
	literal: '#f66335',
	operator: '#808085',
	heading: '#fafafb',
	error: '#f87171',
};

const lightBase = {
	comment: '#717178',
	keyword: '#b23c00',
	text: '#2d2d33',
	member: '#48484e',
	string: '#89552a',
	literal: '#9f2e00',
	operator: '#5d5d63',
	heading: '#16161a',
	error: '#c0362a',
};

const theme = (name: string, ui: ThemeUi, base: typeof darkBase, fn: string, type = fn): Theme => ({
	name,
	ui,
	syntax: syntax({ ...base, function: fn, type }),
});

export const hearthDark = theme('Hearth Dark', darkUi, darkBase, '#f5f5f6');
export const hearthLight = theme('Hearth Light', lightUi, lightBase, '#16161a');
export const hearthDarkAzure = theme('Hearth Dark Azure', darkUi, darkBase, '#2eb3e5', '#7dc9ec');
export const hearthLightAzure = theme(
	'Hearth Light Azure',
	lightUi,
	lightBase,
	'#007da3',
	'#006a8c',
);
export const hearthDarkTeal = theme('Hearth Dark Teal', darkUi, darkBase, '#4cd0b8', '#8bddcb');
export const hearthLightTeal = theme('Hearth Light Teal', lightUi, lightBase, '#008472', '#007161');
