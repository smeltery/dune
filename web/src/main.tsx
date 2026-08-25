import { createRoot } from 'react-dom/client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

import './styles.css';

const GITHUB = 'https://github.com/smeltery/dune';

function copyText(text: string): Promise<void> {
	const legacy = () => {
		const area = document.createElement('textarea');
		area.value = text;
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		document.execCommand('copy');
		area.remove();
	};
	if (navigator.clipboard?.writeText) {
		return navigator.clipboard.writeText(text).catch(legacy);
	}
	legacy();
	return Promise.resolve();
}

function Command({ text, note }: { text: string; note?: string }) {
	const [copied, setCopied] = useState(false);

	return (
		<button
			type="button"
			className="command"
			onClick={async () => {
				await copyText(text);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1400);
			}}
			aria-label={`Copy ${text}`}
		>
			<span className="command-main">
				<span className="prompt-sign">$ </span>
				{text}
			</span>
			<span className="command-note">
				{copied ? (
					<>
						<Check size={14} aria-hidden="true" /> copied
					</>
				) : (
					<>
						<Copy size={14} aria-hidden="true" /> {note ?? 'copy'}
					</>
				)}
			</span>
		</button>
	);
}

type Span = [className: string, text: string];

interface MockRow {
	side: Span[];
	num?: string;
	git?: 'add' | 'mod';
	fold?: string;
	code: Span[];
	cursor?: boolean;
	caret?: boolean;
}

const SIDEBAR_COLUMNS = 24;

const width = (spans: Span[]) => spans.reduce((sum, [, text]) => sum + [...text].length, 0);

function side(text: string, mark?: Span): Span[] {
	if (!mark) return [['', text.padEnd(SIDEBAR_COLUMNS)]];
	return [['', text.padEnd(SIDEBAR_COLUMNS - 2)], mark, ['', ' ']];
}

const rows: MockRow[] = [
	{
		side: [
			['side-active', ' Files '],
			['dim', ' Git  Review  Ext'],
		],
		code: [['dim', ' src/app/documentActions.ts']],
	},
	{
		side: [
			['', ' dune        '],
			['dim', '▴ explorer '],
		],
		num: '130',
		fold: '▾',
		code: [
			['keyword', 'export async function '],
			['function', 'saveFile'],
			['', '(path: '],
			['type', 'string'],
			['', ') {'],
		],
	},
	{
		side: side(' ▾ src'),
		num: '131',
		code: [
			['keyword', '  const'],
			['', ' final = '],
			['function', 'prepareSaveContent'],
			['', '(buffer.content)'],
		],
	},
	{
		side: side('   ▾ app'),
		num: '132',
		code: [
			['keyword', '  const'],
			['', ' saved = '],
			['keyword', 'await'],
			['function', ' writeBuffer'],
			['', '(path, final)'],
		],
	},
	{ side: side('     commands.ts'), num: '133', code: [] },
	{
		side: side('     documentActions.ts', ['git-mod', 'M']),
		num: '134',
		git: 'mod',
		cursor: true,
		caret: true,
		code: [
			['keyword', '  if'],
			['', ' (saved) '],
			['function', 'syncBuffer'],
			['', '(path, final)'],
		],
	},
	{
		side: side('     gitCommands.ts'),
		num: '135',
		code: [['dim', '  // formatter, watcher, and status bar stay aligned']],
	},
	{
		side: side('   ▾ ui'),
		num: '136',
		git: 'add',
		code: [
			['keyword', '  return'],
			['', ' { dirty: content !== saved }'],
		],
	},
	{ side: side('     StatusBar.tsx', ['git-add', 'A']), num: '137', git: 'add', code: [] },
	{
		side: side(' ▸ languages'),
		num: '138',
		code: [
			['function', '  highlight'],
			['', '(visibleWindow, syntaxTheme)'],
		],
	},
	{
		side: side(' ▸ themes'),
		num: '139',
		code: [['', '}']],
	},
];

function Spans({ spans }: { spans: Span[] }) {
	return (
		<>
			{spans.map(([className, text], index) => (
				<span key={index} className={className || undefined}>
					{text}
				</span>
			))}
		</>
	);
}

function Row({ row }: { row: MockRow }) {
	const gutter = row.git === 'add' ? 'git-add' : row.git === 'mod' ? 'git-mod' : 'gutter';

	return (
		<div className={row.cursor ? 'cursor-line' : undefined}>
			<span className="mock-side dim">
				<Spans spans={row.side} />
				{' '.repeat(Math.max(0, SIDEBAR_COLUMNS - width(row.side)))}
			</span>
			<span className="mock-side gutter">│</span>
			<span className="line-number">{row.num ?? '   '}</span>
			<span className={gutter}>{row.git ? '▎' : ' '}</span>
			<span className="dim">{`${row.fold ?? ' '} `}</span>
			<Spans spans={row.code} />
			{row.caret ? <span className="caret" /> : null}
		</div>
	);
}

function EditorMock() {
	return (
		<div className="editor" aria-label="Dune editing its own source">
			<pre>
				<div className="tabs">
					<span className="mock-wide">{'  <- ->  '}</span>
					<span className="tab-active">{' ● documentActions.ts x '}</span>
					{'  '}
					<span className="warning">{'▲ StatusBar.tsx'}</span>
					<span className="mock-wide">{'    commands.ts    git.ts'}</span>
				</div>
				<div>
					{rows.map((row, index) => (
						<Row key={index} row={row} />
					))}
				</div>
				<div className="status">
					<span>
						{' main ↑1  ~3   '}
						<span className="error">● 1</span>
						{'  '}
						<span className="warning">▲ 2</span>
						{'   '}
						<span className="mock-wide dim">F1 commands Ctrl+K keys Space preview</span>
					</span>
					<span className="dim">
						{'Ln 134, Col 24  '}
						<span className="constant">typescript</span>
						{'  '}
					</span>
				</div>
			</pre>
		</div>
	);
}

function Feature({ name, children }: { name: string; children: React.ReactNode }) {
	return (
		<div className="feature">
			<span className="feature-name">{name}</span>
			<span className="feature-text"> - {children}</span>
		</div>
	);
}

function App() {
	return (
		<main className="terminal">
			<header className="session">
				<h1>
					<span className="comment"># </span>
					<span className="title">Dune</span>
					<span className="comment"> - a code editor that lives in your terminal</span>
				</h1>
				<p className="comment">
					# one self-contained binary. no Electron window. no project runtime.
				</p>
				<p className="shell-line">
					<span className="prompt-sign">~/code $</span> dune .
				</p>
			</header>

			<EditorMock />

			<section className="section" aria-labelledby="features">
				<p id="features" className="shell-line">
					<span className="prompt-sign">$</span> <span className="comment"># what's inside</span>
				</p>
				<div className="output">
					<Feature name="tree-sitter syntax">
						highlighting for built-in and plugin languages
					</Feature>
					<Feature name="language servers">
						diagnostics, completion, go to definition, and server status
					</Feature>
					<Feature name="git">
						status marks, diffs, commits, branch workflows, stash, remotes, and tags
					</Feature>
					<Feature name="review notes">
						line-attached notes and read-only pull-request comment fetching
					</Feature>
					<Feature name="search">current-file and project-wide find and replace</Feature>
					<Feature name="views">rendered markdown with Mermaid, images, and PDFs</Feature>
					<Feature name="editing">
						vim mode, word wrap, line actions, history, and conflict resolution
					</Feature>
					<Feature name="plugins">
						appearance assets, icon themes, filetypes, grammars, and language servers
					</Feature>
				</div>
			</section>

			<section className="section" aria-labelledby="install">
				<p id="install" className="shell-line">
					<span className="prompt-sign">$</span>{' '}
					<span className="comment"># install - click a line to copy it</span>
				</p>
				<div className="output">
					<Command text="curl -fsSL https://dune.smeltery.dev/install | bash" />
					<Command text="brew install smeltery/tap/dune" />
					<Command text="npm install -g @smeltery/dune" />
					<Command text="dune update" note="upgrade this copy" />
				</div>
			</section>

			<footer className="section">
				<p className="shell-line">
					<span className="prompt-sign">$</span> open <a href={GITHUB}>github.com/smeltery/dune</a>
					<span className="comment"> # source and issues</span>
					<span className="caret footer-caret" />
				</p>
			</footer>
		</main>
	);
}

createRoot(document.getElementById('root')!).render(
	<>
		<App />
		<Analytics />
	</>,
);
