import { Show } from 'solid-js';

import { ChoiceModal } from '../ChoiceModal';

export type ActivatePluginAsk = {
	name: string;
	choices: { id: string; label: string }[];
	more: number;
};

function multiAsk(prompt: unknown): ActivatePluginAsk | null {
	if (!prompt || typeof prompt !== 'object') return null;
	const p = prompt as {
		kind?: string;
		choices?: ActivatePluginAsk['choices'];
		name?: string;
		more?: number;
	};
	if (
		p.kind !== 'activatePlugin' ||
		!p.choices ||
		p.choices.length <= 1 ||
		typeof p.name !== 'string'
	)
		return null;
	return { name: p.name, choices: p.choices, more: p.more ?? 0 };
}

/** Multi-appearance post-install offer; a single choice uses ConfirmModal instead. */
export function ActivatePluginModal(props: {
	prompt: unknown;
	onChoose: (choice: string) => void;
	onCancel: () => void;
}) {
	return (
		<Show when={multiAsk(props.prompt)}>
			{(ask: () => ActivatePluginAsk) => (
				<ChoiceModal
					title="Plugin installed"
					message={`${ask().name} is installed. Use one of what it adds?${ask().more > 0 ? ` ${ask().more} more are in the palette.` : ''}`}
					choices={ask().choices}
					onPick={props.onChoose}
					onCancel={props.onCancel}
				/>
			)}
		</Show>
	);
}
