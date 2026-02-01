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
	'edita',
	'edit',
	'cambia',
	'cambiar',
	'reemplaza',
	'reemplazar',
	'agrega',
	'agregar',
	'poné',
	'ponele',
	'pone',
	'escribí',
	'escribe',
	'hacé',
	'hace',
	'amplía',
	'amplia',
	'expandí',
	'expande',
	'expand',
	'corrige',
	'fix',
	'update',
	'replace',
	'add',
	'create',
	'crear',
	'inserta',
	'insertar',
	'insert',
	'elimina',
	'eliminar',
	'remove',
	'cambia',
	'change',
	'mejorá',
	'mejora',
	'mejorar',
	'improve',
	'rewrite',
	'reescribe',
	'reescribir',
	'refactor'
];

const LATEX_PATTERNS = [
	'\\author{',
	'\\title{',
	'\\section{',
	'\\input{',
	'\\include{'
];

const FILE_EXT_RE = /\.(tex|bib|sty|cls)\b/i;
const DOC_KEYWORDS = ['cv', 'curriculum', 'currículum', 'resume'];

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
	const normalized = userMessage.toLowerCase();

	const explicitFile = findExplicitFile(userMessage, context.filesList);
	if (explicitFile) {
		reasons.push(`file-mention:${explicitFile}`);
		return { intent: 'edit', targetFile: explicitFile, reasons };
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
	return ['mejorá', 'mejora', 'mejorar', 'improve', 'rewrite', 'reescribe', 'reescribir'].some((verb) =>
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