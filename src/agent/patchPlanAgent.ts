import * as vscode from 'vscode';
import { callOpenAI } from '../openai/openaiClient';
import { listTexFiles, getActiveEditorSelection, findMainTexFile, readFile } from '../tools/fileTools';
import { ensurePatchPlan, validatePatchPlan } from '../patch/patchPlanValidator';
import { type PatchPlan } from '../patch/patchPlanTypes';

const MAX_SNIPPET_CHARS = 2000;

export async function generatePatchPlan(
	context: vscode.ExtensionContext,
	apiKey: string,
	userText: string,
	options?: {
		targetFile?: string;
		stickyTarget?: string;
		reason?: string[];
	}
): Promise<PatchPlan> {
	const schemaText = await loadSchemaText(context.extensionUri);
	const toolContext = await buildToolContext(userText, options?.targetFile);

	const basePrompt = buildPrompt(userText, schemaText, toolContext, options?.stickyTarget, options?.reason);

	const first = await callOpenAI({
		apiKey,
		inputText: basePrompt,
		textFormat: {
			type: 'json_object'
		}
	});
	const firstParsed = await parseAndValidate(first, context.extensionUri);
	let firstError: string | undefined;
	if (firstParsed.ok) {
		const conflictError = await getCreateConflictError(ensurePatchPlan(firstParsed.value));
		if (!conflictError) {
			return ensurePatchPlan(firstParsed.value);
		}
		firstError = conflictError;
	} else {
		firstError = firstParsed.error;
	}

	const retryPrompt = `${basePrompt}\n\nReturn ONLY a single JSON object. No markdown. No prose. Errors: ${firstError}`;
	const retry = await callOpenAI({
		apiKey,
		inputText: retryPrompt,
		textFormat: {
			type: 'json_object'
		}
	});
	const retryParsed = await parseAndValidate(retry, context.extensionUri);
	if (retryParsed.ok) {
		const conflictError = await getCreateConflictError(ensurePatchPlan(retryParsed.value));
		if (!conflictError) {
			return ensurePatchPlan(retryParsed.value);
		}
		throw new Error(`PatchPlan validation failed: ${conflictError}`);
	}

	throw new Error(`PatchPlan validation failed: ${retryParsed.error}`);
}

async function buildToolContext(userText: string, explicitTarget?: string): Promise<{
	texFiles: string[];
	mainFile?: string;
	mainFileSnippet?: string;
	selection?: ReturnType<typeof getActiveEditorSelection>;
	explicitFile?: string;
	explicitFileSnippet?: string;
	targetFile?: string;
	targetSnippet?: string;
}> {
	const texFiles = await listTexFiles();
	const explicitFile = explicitTarget ?? findExplicitFile(userText, texFiles);
	const mainFile = await findMainTexFile();
	let mainFileSnippet: string | undefined;
	if (mainFile) {
		try {
			const content = await readFile(mainFile);
			mainFileSnippet = content.slice(0, MAX_SNIPPET_CHARS);
		} catch {
			mainFileSnippet = undefined;
		}
	}
	let explicitFileSnippet: string | undefined;
	if (explicitFile) {
		try {
			const content = await readFile(explicitFile);
			explicitFileSnippet = content.slice(0, MAX_SNIPPET_CHARS);
		} catch {
			explicitFileSnippet = undefined;
		}
	}
	const selection = getActiveEditorSelection();
	const targetFile = explicitFile ?? selection?.path ?? mainFile;
	let targetSnippet: string | undefined;
	if (targetFile) {
		try {
			const content = await readFile(targetFile);
			targetSnippet = content.slice(0, MAX_SNIPPET_CHARS);
		} catch {
			targetSnippet = undefined;
		}
	}
	return {
		texFiles,
		mainFile,
		mainFileSnippet,
		selection,
		explicitFile,
		explicitFileSnippet,
		targetFile,
		targetSnippet
	};
}

async function loadSchemaText(extensionUri: vscode.Uri): Promise<string> {
	const schemaUri = vscode.Uri.joinPath(extensionUri, 'patch.schema.json');
	const bytes = await vscode.workspace.fs.readFile(schemaUri);
	return Buffer.from(bytes).toString('utf8');
}

function buildPrompt(
	userText: string,
	schemaText: string,
	context: {
		texFiles: string[];
		mainFile?: string;
		mainFileSnippet?: string;
		selection?: ReturnType<typeof getActiveEditorSelection>;
		explicitFile?: string;
		explicitFileSnippet?: string;
		targetFile?: string;
		targetSnippet?: string;
	},
	stickyTarget?: string,
	reason?: string[]
): string {
	const selectionBlock = context.selection
		? `Active selection:\nPath: ${context.selection.path}\nStart: ${context.selection.start.line}:${context.selection.start.character}\nEnd: ${context.selection.end.line}:${context.selection.end.character}\nSelection:\n${context.selection.selectionText}\nContext:\n${context.selection.surroundingText ?? ''}`
		: 'Active selection: (none)';
	const mainBlock = context.mainFile
		? `Main file: ${context.mainFile}\nMain snippet:\n${context.mainFileSnippet ?? ''}`
		: 'Main file: (not found)';
	const explicitBlock = context.explicitFile
		? `Referenced file: ${context.explicitFile}\nSnippet:\n${context.explicitFileSnippet ?? ''}`
		: 'Referenced file: (none)';
	const targetBlock = context.targetFile
		? `Target file: ${context.targetFile}\nTarget snippet:\n${context.targetSnippet ?? ''}`
		: 'Target file: (not determined)';
	const stickyBlock = stickyTarget ? `Sticky target: ${stickyTarget}` : 'Sticky target: (none)';
	const reasonBlock = reason?.length ? `Intent reasons: ${reason.join(', ')}` : 'Intent reasons: (none)';

	return `You are a code editing agent for a LaTeX workspace.\n\nReturn ONLY JSON matching the schema. No markdown. No prose.\n\nSTRICT RULES:\n- Output must be a single JSON object with version, summary, edits.\n- edits items must be either:\n  1) {\"op\":\"createFile\",\"path\":\"...\",\"content\":\"...\",\"overwrite\":false}\n  2) {\"op\":\"editFile\",\"path\":\"...\",\"edits\":[{\"range\":{\"start\":{\"line\":0,\"character\":0},\"end\":{\"line\":0,\"character\":0}},\"text\":\"...\"}]}\n- Do NOT include any other fields.\n- Preserve style and structure when editing existing files. If the user asks for a template, you may create one.\n- If the request is for an article template and no clear target exists, create or edit main.tex. If the request is for a CV, prefer CV.tex.\n- If the target file already exists, prefer editFile. Only use createFile for new files.\n- If insertion location is unclear, choose a reasonable location based on the current content.\n\nEXAMPLES:\nUser: Ponele fecha 31/01/2026 a \\date{\\today} en CV.tex\nOutput:\n{\"version\":\"1.0\",\"summary\":\"Set CV date\",\"edits\":[{\"op\":\"editFile\",\"path\":\"CV.tex\",\"edits\":[{\"range\":{\"start\":{\"line\":4,\"character\":6},\"end\":{\"line\":4,\"character\":13}},\"text\":\"31/01/2026\"}]}]}\n\nUser: hacé que el CV sea mucho más amplio y detallado añadiendo secciones y divisores\nOutput:\n{\"version\":\"1.0\",\"summary\":\"Expand CV sections\",\"edits\":[{\"op\":\"editFile\",\"path\":\"CV.tex\",\"edits\":[{\"range\":{\"start\":{\"line\":10,\"character\":0},\"end\":{\"line\":10,\"character\":0}},\"text\":\"\\\\section{Experiencia}\\n...\"}]}]}\n\nUser: mejorá este párrafo\nOutput:\n{\"version\":\"1.0\",\"summary\":\"Improve paragraph\",\"edits\":[{\"op\":\"editFile\",\"path\":\"main.tex\",\"edits\":[{\"range\":{\"start\":{\"line\":10,\"character\":0},\"end\":{\"line\":12,\"character\":0}},\"text\":\"Texto mejorado...\"}]}]}\n\nSchema:\n${schemaText}\n\nWorkspace files (tex/bib/sty/cls):\n${context.texFiles.join('\\n') || '(none)'}\n\n${mainBlock}\n\n${explicitBlock}\n\n${targetBlock}\n\n${stickyBlock}\n${reasonBlock}\n\n${selectionBlock}\n\nUser request:\n${userText}\n`;
}

async function parseAndValidate(
	text: string,
	extensionUri: vscode.Uri
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return { ok: false, error: `JSON parse failed: ${parsed.error}` };
	}
	const normalized = normalizePatchPlan(parsed.value);
	const validation = await validatePatchPlan(normalized, extensionUri);
	if (!validation.ok) {
		return { ok: false, error: `Schema validation failed: ${(validation.errors ?? []).join('; ')}` };
	}
	return { ok: true, value: normalized };
}

function normalizePatchPlan(value: unknown): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}
	const plan = value as { version?: unknown; summary?: unknown; edits?: unknown };
	const edits = Array.isArray(plan.edits) ? plan.edits : [];
	const normalizedEdits = edits.map((edit) => {
		if (!edit || typeof edit !== 'object') {
			return edit;
		}
		const op = (edit as { op?: unknown }).op;
		const path = (edit as { path?: unknown }).path;
		if (op === 'createFile') {
			const content = (edit as { content?: unknown }).content;
			const overwrite = (edit as { overwrite?: unknown }).overwrite;
			const result: { op: 'createFile'; path?: unknown; content?: unknown; overwrite?: boolean } = {
				op: 'createFile'
			};
			if (typeof path === 'string') {
				result.path = path;
			}
			if (typeof content === 'string') {
				result.content = content;
			}
			result.overwrite = typeof overwrite === 'boolean' ? overwrite : false;
			return result;
		}
		if (op === 'editFile') {
			const editsList = (edit as { edits?: unknown }).edits;
			const result: { op: 'editFile'; path?: unknown; edits?: unknown } = { op: 'editFile' };
			if (typeof path === 'string') {
				result.path = path;
			}
			result.edits = Array.isArray(editsList) ? editsList : [];
			return result;
		}
		return edit;
	});
	return {
		version: plan.version,
		summary: plan.summary,
		edits: normalizedEdits
	};
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
	const direct = tryParse(text);
	if (direct.ok) {
		return direct;
	}

	const extracted = extractJsonObject(text);
	if (extracted) {
		const parsed = tryParse(extracted);
		if (parsed.ok) {
			return parsed;
		}
	}

	return direct;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
	try {
		const value = JSON.parse(text);
		return { ok: true, value };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Unknown parse error.' };
	}
}

function extractJsonObject(text: string): string | undefined {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) {
		return undefined;
	}
	return text.slice(start, end + 1);
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



async function getCreateConflictError(plan: PatchPlan): Promise<string | undefined> {
	const conflicts: string[] = [];
	for (const edit of plan.edits) {
		if (edit.op !== 'createFile') {
			continue;
		}
		if (edit.overwrite) {
			continue;
		}
		const exists = await fileExists(edit.path);
		if (exists) {
			conflicts.push(edit.path);
		}
	}
	if (!conflicts.length) {
		return undefined;
	}
	return `CreateFile target already exists: ${conflicts.join(', ')}. Use editFile or choose a new filename (e.g., article.tex).`;
}

async function fileExists(relPath: string): Promise<boolean> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return false;
	}
	const uri = vscode.Uri.joinPath(folder.uri, relPath);
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
