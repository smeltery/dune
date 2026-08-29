export interface RpcMessage {
	jsonrpc?: '2.0';
	id?: number | string | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4;
export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint';

export const SEVERITY_RANK: Record<ProblemSeverity, number> = {
	error: 1,
	warning: 2,
	info: 3,
	hint: 4,
};

export interface Diagnostic {
	range: Range;
	message: string;
	severity?: DiagnosticSeverity;
	source?: string;
	tags?: number[];
}

export interface DiagnosticReport {
	kind: 'full' | 'unchanged';
	items?: Diagnostic[];
}

export interface TextEdit {
	range: Range;
	newText: string;
}

export interface InsertReplaceEdit {
	insert: Range;
	replace: Range;
	newText: string;
}

export interface CompletionItem {
	label: string;
	kind?: number;
	detail?: string;
	documentation?: string | { kind?: string; value?: string };
	labelDetails?: { detail?: string; description?: string };
	filterText?: string;
	sortText?: string;
	insertText?: string;
	insertTextFormat?: number;
	textEdit?: TextEdit | InsertReplaceEdit;
	additionalTextEdits?: TextEdit[];
	tags?: number[];
	deprecated?: boolean;
}

export interface CompletionList {
	isIncomplete?: boolean;
	items: CompletionItem[];
}

export interface Location {
	uri: string;
	range: Range;
}

export interface LocationLink {
	targetUri: string;
	targetRange: Range;
	targetSelectionRange?: Range;
	originSelectionRange?: Range;
}

export function severityOf(diagnostic: Diagnostic): ProblemSeverity {
	if (diagnostic.severity === 2) return 'warning';
	if (diagnostic.severity === 3) return 'info';
	if (diagnostic.severity === 4) return 'hint';
	return 'error';
}

const TAG_UNNECESSARY = 1;
const TAG_DEPRECATED = 2;

export function isUnnecessary(diagnostic: Diagnostic): boolean {
	return diagnostic.tags?.includes(TAG_UNNECESSARY) ?? false;
}

export function isDeprecated(diagnostic: Diagnostic): boolean {
	return diagnostic.tags?.includes(TAG_DEPRECATED) ?? false;
}
