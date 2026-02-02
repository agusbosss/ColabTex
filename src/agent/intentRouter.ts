import * as vscode from 'vscode';
import { getActiveEditorSelection, type SelectionInfo } from '../tools/fileTools';

export type StickyState = {
	lastTargetFile: string | null;
	lastTouchedFiles: string[];
	lastEditAt: number | null;
};

export type IntentResult = {
	intent: 'edit' | 'chat';
	targetFile?: string;
	reasons: string[];
};

const EDIT_VERBS = [
	'anadi',
	'anadile',
	'agrega',
	'agregale',
	'sumale',
	'inclui',
	'inserta',
	'insertale',
	'borra',
	'saca',
	'elimina',
	'cambia',
	'modifica',
	'reemplaza',
	'mueve',
	'ajusta',
	'corrige',
	'add',
	'insert',
	'remove',
	'delete',
	'change',
	'modify',
	'replace',
	'move',
	'adjust',
	'fix',
	'update',
	'create',
	'crear'
];

const CREATE_VERBS = [
	'crear',
	'crea',
	'generar',
	'genera',
	'armar',
	'arma',
	'hacer',
	'hace',
	'escribir',
	'escribe',
	'redactar',
	'redacta',
	'disenar',
	'create',
	'generate',
	'draft',
	'build'
];

const DOC_NOUNS = ['plantilla', 'template', 'cv', 'curriculum', 'resume', 'article'];

const LATEX_NOUNS = [
	'seccion',
	'subseccion',
	'referencias',
	'bibliografia',
	'citas',
	'cite',
	'bib',
	'tabla',
	'figura',
	'ecuacion',
	'abstract',
	'titulo',
	'section',
	'references',
	'bibliography',
	'citations',
	'table',
	'figure',
	'equation'
];

const LATEX_PATTERNS = [
	'\\author{',
	'\\title{',
	'\\section{',
	'\\input{',
	'\\include{'
];

const FILE_EXT_RE = /\.(tex|bib|sty|cls)\b/i;
const DOC_KEYWORDS = ['cv', 'curriculum', 'resume'];

export function classifyIntent(
	userMessage: string,
	context: {
		filesList: string[];
		selection?: SelectionInfo;
		activeEditorPath?: string;
		sticky?: StickyState;
		pendingPatch?: boolean;
		recentFiles?: string[];
	}
): IntentResult {
	const reasons: string[] = [];
	const normalized = normalizeText(userMessage);

	const explicitFile = findExplicitFile(userMessage, context.filesList);
	if (explicitFile) {
		reasons.push(`file-mention:${explicitFile}`);
		return { intent: 'edit', targetFile: explicitFile, reasons };
	}

	const hasEditSignal = hasEditVerb(normalized) || hasLatexNoun(normalized);
	if (isLikelyGreeting(normalized) && !hasEditSignal && !hasCreateDocIntent(normalized)) {
		return { intent: 'chat', reasons: ['greeting'] };
	}
	if (looksLikeQuestion(normalized) && !hasEditSignal && !hasCreateDocIntent(normalized)) {
		return { intent: 'chat', reasons: ['question'] };
	}

	if (hasCreateDocIntent(normalized)) {
		const target = pickDocumentTarget(context.filesList, context.recentFiles) ?? 'CV.tex';
		reasons.push('create-doc-intent');
		if (target === 'CV.tex' && !context.filesList.some((f) => f.toLowerCase() === 'cv.tex')) {
			reasons.push('assumed-target:CV.tex');
		}
		return { intent: 'edit', targetFile: target, reasons };
	}

	if (hasEditSignal) {
		const target = pickEditTarget(context);
		if (target) {
			reasons.push('edit-signal');
			return { intent: 'edit', targetFile: target, reasons };
		}
		return { intent: 'edit', reasons: ['edit-signal'] };
	}

	if (!looksLikeQuestion(normalized) && (hasEditSignal || hasImproveVerb(normalized))) {
		const stickyTarget = context.sticky?.lastTargetFile;
		const activeTarget =
			context.activeEditorPath && context.activeEditorPath.toLowerCase().endsWith('.tex')
				? context.activeEditorPath
				: undefined;
		const target = stickyTarget ?? activeTarget;
		if (target) {
			reasons.push('sticky-or-active-followup');
			return { intent: 'edit', targetFile: target, reasons };
		}
	}

	if (context.pendingPatch && hasEditVerb(normalized)) {
		reasons.push('pending-patch-followup');
		if (context.sticky?.lastTargetFile) {
			return { intent: 'edit', targetFile: context.sticky.lastTargetFile, reasons };
		}
	}

	if (context.sticky?.lastTargetFile && hasEditVerb(normalized)) {
		reasons.push('sticky-target-verb');
		return { intent: 'edit', targetFile: context.sticky.lastTargetFile, reasons };
	}

	if (DOC_KEYWORDS.some((word) => normalized.includes(word))) {
		const target = pickDocumentTarget(context.filesList, context.recentFiles);
		if (target) {
			reasons.push(`doc-keyword:${target}`);
			return { intent: 'edit', targetFile: target, reasons };
		}
	}

	if (context.activeEditorPath && hasEditVerb(normalized)) {
		reasons.push('active-editor');
		return { intent: 'edit', targetFile: context.activeEditorPath, reasons };
	}

	if (LATEX_PATTERNS.some((pattern) => userMessage.includes(pattern))) {
		reasons.push('latex-pattern');
		if (context.activeEditorPath) {
			return { intent: 'edit', targetFile: context.activeEditorPath, reasons };
		}
		return { intent: 'edit', reasons };
	}

	if (context.selection && hasImproveVerb(normalized)) {
		reasons.push('selection-improve');
		return { intent: 'edit', targetFile: context.selection.path, reasons };
	}

	if (FILE_EXT_RE.test(userMessage)) {
		reasons.push('file-extension');
		return { intent: 'edit', reasons };
	}

	return { intent: 'chat', reasons: ['default-chat'] };
}

export function getSelection(): SelectionInfo | undefined {
	return getActiveEditorSelection();
}

export function getActiveEditorPath(): string | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}
	const uri = editor.document.uri;
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder || !uri.fsPath.startsWith(folder.uri.fsPath)) {
		return undefined;
	}
	return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

export function isStickyExpired(lastEditAt: number | null, ttlMs: number): boolean {
	if (!lastEditAt) {
		return true;
	}
	return Date.now() - lastEditAt > ttlMs;
}

function hasEditVerb(normalized: string): boolean {
	return EDIT_VERBS.some((verb) => normalized.includes(verb));
}

function hasImproveVerb(normalized: string): boolean {
	return ['mejora', 'mejorar', 'improve', 'rewrite', 'reescribe', 'reescribir'].some((verb) =>
		normalized.includes(verb)
	);
}

function findExplicitFile(userText: string, files: string[]): string | undefined {
	const lowered = userText.toLowerCase();
	const directMatch = files.find((file) => lowered.includes(file.toLowerCase()));
	if (directMatch) {
		return directMatch;
	}
	const extMatch = userText.match(/\b([A-Za-z0-9_./-]+\.(tex|bib|sty|cls))\b/i);
	if (extMatch) {
		return extMatch[1];
	}
	return undefined;
}

function pickDocumentTarget(files: string[], recentFiles?: string[]): string | undefined {
	const candidates = ['CV.tex', 'cv.tex', 'resume.tex', 'main.tex'];
	for (const candidate of candidates) {
		const match = files.find((file) => file.toLowerCase() === candidate.toLowerCase());
		if (match) {
			return match;
		}
	}
	if (recentFiles?.length) {
		return recentFiles[0];
	}
	const firstTex = files.find((file) => file.toLowerCase().endsWith('.tex'));
	return firstTex;
}

function hasCreateDocIntent(normalized: string): boolean {
	const hasVerb = CREATE_VERBS.some((verb) => normalized.includes(verb));
	const hasNoun = DOC_NOUNS.some((noun) => normalized.includes(noun));
	return hasVerb && hasNoun;
}

function looksLikeQuestion(normalized: string): boolean {
	if (normalized.includes('?')) {
		return true;
	}
	const starters = ['que ', 'como ', 'por que', 'explicame', 'diferencia', 'what ', 'how ', 'why '];
	return starters.some((start) => normalized.startsWith(start));
}
function normalizeText(input: string): string {
	return input
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function isLikelyGreeting(normalized: string): boolean {
	const cleaned = normalized.replace(/[^a-z0-9\\s]/g, ' ').trim();
	const tokens = cleaned.split(/\\s+/).filter(Boolean);
	if (tokens.length <= 2) {
		const greetings = new Set(['hola', 'buenas', 'buenos', 'buenas', 'hello', 'hi', 'hey']);
		return tokens.every((token) => greetings.has(token));
	}
	return false;
}

function hasLatexNoun(normalized: string): boolean {
	return LATEX_NOUNS.some((noun) => normalized.includes(noun));
}

function pickEditTarget(context: {
	filesList: string[];
	activeEditorPath?: string;
	sticky?: StickyState;
	recentFiles?: string[];
}): string | undefined {
	if (context.sticky?.lastTargetFile) {
		return context.sticky.lastTargetFile;
	}
	if (context.activeEditorPath && context.activeEditorPath.toLowerCase().endsWith('.tex')) {
		return context.activeEditorPath;
	}
	return pickDocumentTarget(context.filesList, context.recentFiles);
}
