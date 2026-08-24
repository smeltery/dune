import type { Theme } from './types';

/** Hearth palette from https://github.com/ryanfurrer/hearth-theme (MIT). */
export const hearthDark: Theme = {
	name: 'Hearth Dark',
	ui: {
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
	},
	syntax: {
		comment: {
			fg: '#626269',
			italic: true,
		},
		keyword: {
			fg: '#f87c49',
		},
		string: {
			fg: '#dfbda0',
		},
		escape: {
			fg: '#f66335',
		},
		number: {
			fg: '#f66335',
		},
		boolean: {
			fg: '#f66335',
		},
		constant: {
			fg: '#f66335',
		},
		function: {
			fg: '#f5f5f6',
		},
		constructor: {
			fg: '#f5f5f6',
			italic: true,
		},
		type: {
			fg: '#f5f5f6',
			italic: true,
		},
		namespace: {
			fg: '#f5f5f6',
			italic: true,
		},
		variable: {
			fg: '#d7d7db',
		},
		'variable.builtin': {
			fg: '#f87c49',
			italic: true,
		},
		'variable.member': {
			fg: '#c4c4c9',
		},
		property: {
			fg: '#c4c4c9',
		},
		attribute: {
			fg: '#dfbda0',
			italic: true,
		},
		tag: {
			fg: '#f87c49',
		},
		label: {
			fg: '#f87c49',
		},
		operator: {
			fg: '#808085',
		},
		punctuation: {
			fg: '#808085',
		},
		'punctuation.special': {
			fg: '#f66335',
		},
		embedded: {
			fg: '#d7d7db',
		},
		error: {
			fg: '#f87171',
		},
		'markup.heading': {
			fg: '#fafafb',
			bold: true,
		},
		'markup.strong': {
			fg: '#fafafb',
			bold: true,
		},
		'markup.italic': {
			fg: '#d7d7db',
			italic: true,
		},
		'markup.raw': {
			fg: '#dfbda0',
		},
		'markup.link': {
			fg: '#f05a29',
		},
		'markup.link.url': {
			fg: '#f05a29',
			underline: true,
		},
		'markup.list': {
			fg: '#f87c49',
		},
		'markup.quote': {
			fg: '#626269',
			italic: true,
		},
	},
};

export const hearthLight: Theme = {
	name: 'Hearth Light',
	ui: {
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
	},
	syntax: {
		comment: {
			fg: '#717178',
			italic: true,
		},
		keyword: {
			fg: '#b23c00',
		},
		string: {
			fg: '#89552a',
		},
		escape: {
			fg: '#9f2e00',
		},
		number: {
			fg: '#9f2e00',
		},
		boolean: {
			fg: '#9f2e00',
		},
		constant: {
			fg: '#9f2e00',
		},
		function: {
			fg: '#16161a',
		},
		constructor: {
			fg: '#16161a',
			italic: true,
		},
		type: {
			fg: '#16161a',
			italic: true,
		},
		namespace: {
			fg: '#16161a',
			italic: true,
		},
		variable: {
			fg: '#2d2d33',
		},
		'variable.builtin': {
			fg: '#b23c00',
			italic: true,
		},
		'variable.member': {
			fg: '#48484e',
		},
		property: {
			fg: '#48484e',
		},
		attribute: {
			fg: '#89552a',
			italic: true,
		},
		tag: {
			fg: '#b23c00',
		},
		label: {
			fg: '#b23c00',
		},
		operator: {
			fg: '#5d5d63',
		},
		punctuation: {
			fg: '#5d5d63',
		},
		'punctuation.special': {
			fg: '#9f2e00',
		},
		embedded: {
			fg: '#2d2d33',
		},
		error: {
			fg: '#c0362a',
		},
		'markup.heading': {
			fg: '#16161a',
			bold: true,
		},
		'markup.strong': {
			fg: '#16161a',
			bold: true,
		},
		'markup.italic': {
			fg: '#2d2d33',
			italic: true,
		},
		'markup.raw': {
			fg: '#89552a',
		},
		'markup.link': {
			fg: '#b23c00',
		},
		'markup.link.url': {
			fg: '#b23c00',
			underline: true,
		},
		'markup.list': {
			fg: '#b23c00',
		},
		'markup.quote': {
			fg: '#717178',
			italic: true,
		},
	},
};

export const hearthDarkAzure: Theme = {
	name: 'Hearth Dark Azure',
	ui: {
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
	},
	syntax: {
		comment: {
			fg: '#626269',
			italic: true,
		},
		keyword: {
			fg: '#f87c49',
		},
		string: {
			fg: '#dfbda0',
		},
		escape: {
			fg: '#f66335',
		},
		number: {
			fg: '#f66335',
		},
		boolean: {
			fg: '#f66335',
		},
		constant: {
			fg: '#f66335',
		},
		function: {
			fg: '#2eb3e5',
		},
		constructor: {
			fg: '#7dc9ec',
			italic: true,
		},
		type: {
			fg: '#7dc9ec',
			italic: true,
		},
		namespace: {
			fg: '#7dc9ec',
			italic: true,
		},
		variable: {
			fg: '#d7d7db',
		},
		'variable.builtin': {
			fg: '#f87c49',
			italic: true,
		},
		'variable.member': {
			fg: '#c4c4c9',
		},
		property: {
			fg: '#c4c4c9',
		},
		attribute: {
			fg: '#dfbda0',
			italic: true,
		},
		tag: {
			fg: '#f87c49',
		},
		label: {
			fg: '#f87c49',
		},
		operator: {
			fg: '#808085',
		},
		punctuation: {
			fg: '#808085',
		},
		'punctuation.special': {
			fg: '#f66335',
		},
		embedded: {
			fg: '#d7d7db',
		},
		error: {
			fg: '#f87171',
		},
		'markup.heading': {
			fg: '#fafafb',
			bold: true,
		},
		'markup.strong': {
			fg: '#fafafb',
			bold: true,
		},
		'markup.italic': {
			fg: '#d7d7db',
			italic: true,
		},
		'markup.raw': {
			fg: '#dfbda0',
		},
		'markup.link': {
			fg: '#f05a29',
		},
		'markup.link.url': {
			fg: '#f05a29',
			underline: true,
		},
		'markup.list': {
			fg: '#f87c49',
		},
		'markup.quote': {
			fg: '#626269',
			italic: true,
		},
	},
};

export const hearthLightAzure: Theme = {
	name: 'Hearth Light Azure',
	ui: {
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
	},
	syntax: {
		comment: {
			fg: '#717178',
			italic: true,
		},
		keyword: {
			fg: '#b23c00',
		},
		string: {
			fg: '#89552a',
		},
		escape: {
			fg: '#9f2e00',
		},
		number: {
			fg: '#9f2e00',
		},
		boolean: {
			fg: '#9f2e00',
		},
		constant: {
			fg: '#9f2e00',
		},
		function: {
			fg: '#007da3',
		},
		constructor: {
			fg: '#006a8c',
			italic: true,
		},
		type: {
			fg: '#006a8c',
			italic: true,
		},
		namespace: {
			fg: '#006a8c',
			italic: true,
		},
		variable: {
			fg: '#2d2d33',
		},
		'variable.builtin': {
			fg: '#b23c00',
			italic: true,
		},
		'variable.member': {
			fg: '#48484e',
		},
		property: {
			fg: '#48484e',
		},
		attribute: {
			fg: '#89552a',
			italic: true,
		},
		tag: {
			fg: '#b23c00',
		},
		label: {
			fg: '#b23c00',
		},
		operator: {
			fg: '#5d5d63',
		},
		punctuation: {
			fg: '#5d5d63',
		},
		'punctuation.special': {
			fg: '#9f2e00',
		},
		embedded: {
			fg: '#2d2d33',
		},
		error: {
			fg: '#c0362a',
		},
		'markup.heading': {
			fg: '#16161a',
			bold: true,
		},
		'markup.strong': {
			fg: '#16161a',
			bold: true,
		},
		'markup.italic': {
			fg: '#2d2d33',
			italic: true,
		},
		'markup.raw': {
			fg: '#89552a',
		},
		'markup.link': {
			fg: '#b23c00',
		},
		'markup.link.url': {
			fg: '#b23c00',
			underline: true,
		},
		'markup.list': {
			fg: '#b23c00',
		},
		'markup.quote': {
			fg: '#717178',
			italic: true,
		},
	},
};

export const hearthDarkTeal: Theme = {
	name: 'Hearth Dark Teal',
	ui: {
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
	},
	syntax: {
		comment: {
			fg: '#626269',
			italic: true,
		},
		keyword: {
			fg: '#f87c49',
		},
		string: {
			fg: '#dfbda0',
		},
		escape: {
			fg: '#f66335',
		},
		number: {
			fg: '#f66335',
		},
		boolean: {
			fg: '#f66335',
		},
		constant: {
			fg: '#f66335',
		},
		function: {
			fg: '#4cd0b8',
		},
		constructor: {
			fg: '#8bddcb',
			italic: true,
		},
		type: {
			fg: '#8bddcb',
			italic: true,
		},
		namespace: {
			fg: '#8bddcb',
			italic: true,
		},
		variable: {
			fg: '#d7d7db',
		},
		'variable.builtin': {
			fg: '#f87c49',
			italic: true,
		},
		'variable.member': {
			fg: '#c4c4c9',
		},
		property: {
			fg: '#c4c4c9',
		},
		attribute: {
			fg: '#dfbda0',
			italic: true,
		},
		tag: {
			fg: '#f87c49',
		},
		label: {
			fg: '#f87c49',
		},
		operator: {
			fg: '#808085',
		},
		punctuation: {
			fg: '#808085',
		},
		'punctuation.special': {
			fg: '#f66335',
		},
		embedded: {
			fg: '#d7d7db',
		},
		error: {
			fg: '#f87171',
		},
		'markup.heading': {
			fg: '#fafafb',
			bold: true,
		},
		'markup.strong': {
			fg: '#fafafb',
			bold: true,
		},
		'markup.italic': {
			fg: '#d7d7db',
			italic: true,
		},
		'markup.raw': {
			fg: '#dfbda0',
		},
		'markup.link': {
			fg: '#f05a29',
		},
		'markup.link.url': {
			fg: '#f05a29',
			underline: true,
		},
		'markup.list': {
			fg: '#f87c49',
		},
		'markup.quote': {
			fg: '#626269',
			italic: true,
		},
	},
};

export const hearthLightTeal: Theme = {
	name: 'Hearth Light Teal',
	ui: {
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
	},
	syntax: {
		comment: {
			fg: '#717178',
			italic: true,
		},
		keyword: {
			fg: '#b23c00',
		},
		string: {
			fg: '#89552a',
		},
		escape: {
			fg: '#9f2e00',
		},
		number: {
			fg: '#9f2e00',
		},
		boolean: {
			fg: '#9f2e00',
		},
		constant: {
			fg: '#9f2e00',
		},
		function: {
			fg: '#008472',
		},
		constructor: {
			fg: '#007161',
			italic: true,
		},
		type: {
			fg: '#007161',
			italic: true,
		},
		namespace: {
			fg: '#007161',
			italic: true,
		},
		variable: {
			fg: '#2d2d33',
		},
		'variable.builtin': {
			fg: '#b23c00',
			italic: true,
		},
		'variable.member': {
			fg: '#48484e',
		},
		property: {
			fg: '#48484e',
		},
		attribute: {
			fg: '#89552a',
			italic: true,
		},
		tag: {
			fg: '#b23c00',
		},
		label: {
			fg: '#b23c00',
		},
		operator: {
			fg: '#5d5d63',
		},
		punctuation: {
			fg: '#5d5d63',
		},
		'punctuation.special': {
			fg: '#9f2e00',
		},
		embedded: {
			fg: '#2d2d33',
		},
		error: {
			fg: '#c0362a',
		},
		'markup.heading': {
			fg: '#16161a',
			bold: true,
		},
		'markup.strong': {
			fg: '#16161a',
			bold: true,
		},
		'markup.italic': {
			fg: '#2d2d33',
			italic: true,
		},
		'markup.raw': {
			fg: '#89552a',
		},
		'markup.link': {
			fg: '#b23c00',
		},
		'markup.link.url': {
			fg: '#b23c00',
			underline: true,
		},
		'markup.list': {
			fg: '#b23c00',
		},
		'markup.quote': {
			fg: '#717178',
			italic: true,
		},
	},
};
