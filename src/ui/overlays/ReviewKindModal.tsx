import { basename } from 'node:path';

import { KIND_CHOICES } from '../../core/review';
import { ChoiceModal } from '../ChoiceModal';

export function ReviewKindModal(props: {
	path: string;
	line: number;
	onPick: (kind: string) => void;
	onCancel: () => void;
}) {
	return (
		<ChoiceModal
			title="Review note"
			message={`What kind of remark is this, on ${basename(props.path)}:${props.line + 1}?`}
			choices={KIND_CHOICES}
			onPick={props.onPick}
			onCancel={props.onCancel}
		/>
	);
}
