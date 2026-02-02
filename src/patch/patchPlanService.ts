import * as path from 'node:path';
import * as vscode from 'vscode';
import { PreviewContentProvider } from './previewProvider';
import { type PatchPlan, type EditFileOp, type CreateFileOp, type TextEdit } from './patchPlanTypes';

export type PatchPreview = {
	path: string;
	before: string;
	after: string;
	isNewFile: boolean;
};

export class PatchPlanService {
	private readonly previewProvider: PreviewContentProvider;
	private readonly scheme = 'colabtex-preview';
	private currentPlan: PatchPlan | undefined;
	private currentPlanId: string | undefined;
	private previews = new Map<string, PatchPreview>();

	constructor(previewProvider: PreviewContentProvider) {
		this.previewProvider = previewProvider;
	}

	setPlan(plan: PatchPlan): void {
		const planId = plan.planId ?? this.generatePlanId();
		this.currentPlan = { ...plan, planId };
		this.currentPlanId = planId;
		this.previews.clear();
	}

	getPlan(): PatchPlan | undefined {
		return this.currentPlan;
	}

	getPlanId(): string | undefined {
		return this.currentPlanId;
	}

	getPlanSummary(): string | undefined {
		return this.currentPlan?.summary;
	}

	getPlanTargetFiles(): string[] {
		const plan = this.currentPlan;
		if (!plan) {
			return [];
		}
		const paths = new Set<string>();
		for (const edit of plan.edits) {
			paths.add(edit.path);
		}
		return Array.from(paths);
	}

	getPrimaryTargetFile(): string | undefined {
		const plan = this.currentPlan;
		if (!plan) {
			return undefined;
		}
		const createOp = plan.edits.find((edit) => edit.op === 'createFile');
		if (createOp) {
			return createOp.path;
		}
		const editOp = plan.edits.find((edit) => edit.op === 'editFile');
		return editOp?.path;
	}

	clearPlan(): void {
		this.currentPlan = undefined;
		this.currentPlanId = undefined;
		this.previews.clear();
		this.previewProvider.clear();
	}

	async buildPreviews(): Promise<PatchPreview[]> {
		const plan = this.currentPlan;
		if (!plan) {
			throw new Error('No PatchPlan available.');
		}
		const workspaceRoot = getWorkspaceRoot();
		const previews: PatchPreview[] = [];

		const createOps = plan.edits.filter((edit): edit is CreateFileOp => edit.op === 'createFile');
		const editOps = plan.edits.filter((edit): edit is EditFileOp => edit.op === 'editFile');

		for (const createOp of createOps) {
			ensureSafePath(createOp.path);
			const preview: PatchPreview = {
				path: createOp.path,
				before: '',
				after: createOp.content,
				isNewFile: true
			};
			previews.push(preview);
		}

		for (const editOp of editOps) {
			ensureSafePath(editOp.path);
			validateEdits(editOp.path, editOp.edits);
			const fileUri = vscode.Uri.joinPath(workspaceRoot, editOp.path);
			const beforeContent = await readFileSafe(fileUri);
			const afterContent = applyTextEdits(beforeContent, editOp.edits);
			const preview: PatchPreview = {
				path: editOp.path,
				before: beforeContent,
				after: afterContent,
				isNewFile: false
			};
			previews.push(preview);
		}

		this.previews.clear();
		for (const preview of previews) {
			this.previews.set(preview.path, preview);
		}

		return previews;
	}

	async showDiffs(): Promise<void> {
		const previews = await this.buildPreviews();
		for (const preview of previews) {
			const title = `Proposed: ${preview.path}`;
			const leftUri = preview.isNewFile
				? this.previewUri(preview.path, 'before')
				: vscode.Uri.joinPath(getWorkspaceRoot(), preview.path);
			const rightUri = this.previewUri(preview.path, 'after');

			if (preview.isNewFile) {
				this.previewProvider.setContent(leftUri, '');
			}
			this.previewProvider.setContent(rightUri, preview.after);
			await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
		}
	}

	async applyCurrentPlan(): Promise<void> {
		const plan = this.currentPlan;
		if (!plan) {
			throw new Error('No PatchPlan available.');
		}

		const workspaceRoot = getWorkspaceRoot();
		const edit = new vscode.WorkspaceEdit();

		const createOps = plan.edits.filter((op): op is CreateFileOp => op.op === 'createFile');
		const editOps = plan.edits.filter((op): op is EditFileOp => op.op === 'editFile');

		for (const createOp of createOps) {
			ensureSafePath(createOp.path);
			const fileUri = vscode.Uri.joinPath(workspaceRoot, createOp.path);
			const exists = await existsSafe(fileUri);
			if (exists && !createOp.overwrite) {
				throw new Error(`File already exists: ${createOp.path}`);
			}
			edit.createFile(fileUri, { overwrite: !!createOp.overwrite });
			edit.insert(fileUri, new vscode.Position(0, 0), createOp.content);
		}

		for (const editOp of editOps) {
			ensureSafePath(editOp.path);
			validateEdits(editOp.path, editOp.edits);
			const fileUri = vscode.Uri.joinPath(workspaceRoot, editOp.path);
			for (const textEdit of editOp.edits) {
				const range = new vscode.Range(
					new vscode.Position(textEdit.range.start.line, textEdit.range.start.character),
					new vscode.Position(textEdit.range.end.line, textEdit.range.end.character)
				);
				edit.replace(fileUri, range, textEdit.text);
			}
		}

		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			throw new Error('Failed to apply edits.');
		}
		this.clearPlan();
	}

	private previewUri(relPath: string, variant: 'before' | 'after'): vscode.Uri {
		const encoded = encodeURIComponent(relPath);
		return vscode.Uri.parse(`${this.scheme}:/${encoded}?v=${variant}-${Date.now()}`);
	}

	private generatePlanId(): string {
		return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	}
}

function ensureSafePath(relPath: string): void {
	if (!relPath || relPath.includes('..') || relPath.includes('\\') || relPath.includes('\0')) {
		throw new Error(`Invalid path: ${relPath}`);
	}
	if (path.isAbsolute(relPath)) {
		throw new Error(`Absolute paths are not allowed: ${relPath}`);
	}
}

function getWorkspaceRoot(): vscode.Uri {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder open.');
	}
	return folder.uri;
}

async function readFileSafe(uri: vscode.Uri): Promise<string> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return Buffer.from(bytes).toString('utf8');
	} catch {
		return '';
	}
}

async function existsSafe(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

function applyTextEdits(text: string, edits: TextEdit[]): string {
	const offsets = computeLineOffsets(text);
	const withOffsets = edits.map((edit) => ({
		start: offsetAt(edit.range.start, offsets, text),
		end: offsetAt(edit.range.end, offsets, text),
		text: edit.text
	}));
	withOffsets.sort((a, b) => b.start - a.start);
	let result = text;
	for (const edit of withOffsets) {
		result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
	}
	return result;
}

function validateEdits(pathLabel: string, edits: TextEdit[]): void {
	const ranges = edits.map((edit) => {
		const start = edit.range.start;
		const end = edit.range.end;
		if (start.line < 0 || start.character < 0 || end.line < 0 || end.character < 0) {
			throw new Error(`Invalid range in file ${pathLabel}: negative positions.`);
		}
		if (isAfter(start, end)) {
			throw new Error(`Invalid range in file ${pathLabel}: start after end.`);
		}
		return {
			start,
			end
		};
	});

	ranges.sort((a, b) => comparePos(a.start, b.start));
	for (let i = 1; i < ranges.length; i += 1) {
		const prev = ranges[i - 1];
		const curr = ranges[i];
		if (isAfter(prev.end, curr.start)) {
			throw new Error(`Overlapping edits in file ${pathLabel}.`);
		}
	}
}

function comparePos(a: { line: number; character: number }, b: { line: number; character: number }): number {
	if (a.line !== b.line) {
		return a.line - b.line;
	}
	return a.character - b.character;
}

function isAfter(a: { line: number; character: number }, b: { line: number; character: number }): boolean {
	return a.line > b.line || (a.line === b.line && a.character > b.character);
}

function computeLineOffsets(text: string): number[] {
	const offsets: number[] = [0];
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '\n') {
			offsets.push(i + 1);
		}
	}
	return offsets;
}

function offsetAt(position: { line: number; character: number }, offsets: number[], text: string): number {
	const line = Math.min(position.line, offsets.length - 1);
	const lineOffset = offsets[line] ?? 0;
	const lineEnd = text.indexOf('\n', lineOffset);
	const lineLength = (lineEnd === -1 ? text.length : lineEnd) - lineOffset;
	const char = Math.min(position.character, lineLength);
	return lineOffset + char;
}
