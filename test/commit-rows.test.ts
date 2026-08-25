import { expect, test } from 'bun:test';

import { commitRows, changesFor } from '../src/core/changeTree';
import type { Change } from '../src/core/changeTree';

test('commitRows builds Incoming and Outgoing sections', () => {
	const rows = commitRows(
		[{ oid: 'a'.repeat(40), subject: 'pull me' }],
		[{ oid: 'b'.repeat(40), subject: 'push me' }],
	);
	expect(rows.map((row) => row.kind)).toEqual([
		'commitSection',
		'commit',
		'commitSection',
		'commit',
	]);
	expect(rows[0]).toMatchObject({ kind: 'commitSection', label: 'Incoming', count: 1 });
	expect(rows[1]).toMatchObject({ kind: 'commit', label: 'pull me', group: 'incoming' });
	expect(rows[2]).toMatchObject({ kind: 'commitSection', label: 'Outgoing', count: 1 });
	expect(rows[3]).toMatchObject({ kind: 'commit', label: 'push me', group: 'outgoing' });
});

test('commit rows are not stageable changes', () => {
	const changes: Change[] = [{ path: '/a.ts', rel: 'a.ts', status: 'modified', area: 'unstaged' }];
	const rows = commitRows([], [{ oid: 'c'.repeat(40), subject: 'wip' }]);
	expect(changesFor(changes, rows[0]!)).toEqual([]);
	expect(changesFor(changes, rows[1]!)).toEqual([]);
});

test('folding a commit section hides its commits', () => {
	const shut = commitRows([{ oid: 'a'.repeat(40), subject: 'in' }], [], new Set(['incoming:']));
	expect(shut).toHaveLength(1);
	expect(shut[0]).toMatchObject({ kind: 'commitSection', collapsed: true });
});
