import * as path from 'node:path';
import * as vscode from 'vscode';

export type SelectionInfo = {
	path: string;
	selectionText: string;
	start: { line: number; character: number };
	end: { line: number; character: number };
	surroundingText?: string;
};

export async function listTexFiles(): Promise<string[]> {
	if (!vscode.workspace.workspaceFolders?.length) {
		return [];
	}
	const files = await vscode.workspace.findFiles('**/*.{tex,bib,sty,cls}', '**/node_modules/**');
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	return files.map((file) => path.relative(root, file.fsPath).replace(/\\/g, '/'));
}

export async function readFile(relPath: string): Promise<string> {
	const fileUri = resolveWorkspacePath(relPath);
	const bytes = await vscode.workspace.fs.readFile(fileUri);
	return Buffer.from(bytes).toString('utf8');
}

export async function createFile(relPath: string, content: string, overwrite = false): Promise<void> {
	const fileUri = resolveWorkspacePath(relPath);
	try {
		await vscode.workspace.fs.stat(fileUri);
		if (!overwrite) {
			throw new Error('File already exists.');
		}
	} catch {
		// file does not exist
	}

	const root = getWorkspaceRoot();
	const dir = path.posix.dirname(relPath);
	if (dir !== '.') {
		const dirUri = vscode.Uri.joinPath(root, dir);
		await vscode.workspace.fs.createDirectory(dirUri);
	}
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
}

export function getActiveEditorSelection(): SelectionInfo | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}
	const doc = editor.document;
	const selection = editor.selection;
	if (selection.isEmpty) {
		return undefined;
	}
	const selectionText = doc.getText(selection);
	const start = { line: selection.start.line, character: selection.start.character };
	const end = { line: selection.end.line, character: selection.end.character };
	const startLine = Math.max(0, selection.start.line - 3);
	const endLine = Math.min(doc.lineCount - 1, selection.end.line + 3);
	const surroundingRange = new vscode.Range(
		new vscode.Position(startLine, 0),
		new vscode.Position(endLine, doc.lineAt(endLine).text.length)
	);
	const surroundingText = doc.getText(surroundingRange);

	const relPath = getRelativePath(doc.uri);
	if (!relPath) {
		return undefined;
	}

	return {
		path: relPath,
		selectionText,
		start,
		end,
		surroundingText
	};
}

export async function findMainTexFile(): Promise<string | undefined> {
	const files = await listTexFiles();
	const main = files.find((file) => file.toLowerCase().endsWith('main.tex'));
	return main ?? files.find((file) => file.toLowerCase().endsWith('.tex'));
}

function resolveWorkspacePath(relPath: string): vscode.Uri {
	const root = getWorkspaceRoot();
	if (!isSafeWorkspacePath(relPath)) {
		throw new Error('Invalid path.');
	}
	return vscode.Uri.joinPath(root, relPath);
}

function getRelativePath(uri: vscode.Uri): string | undefined {
	const root = getWorkspaceRoot().fsPath;
	const rel = path.relative(root, uri.fsPath);
	if (path.isAbsolute(rel) || rel.startsWith('..')) {
		return undefined;
	}
	return rel.replace(/\\/g, '/');
}

function getWorkspaceRoot(): vscode.Uri {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder open.');
	}
	return folder.uri;
}

function isSafeWorkspacePath(relPath: string): boolean {
	if (!relPath || relPath.includes('..') || relPath.includes('\\') || relPath.includes('\0')) {
		return false;
	}
	if (path.isAbsolute(relPath)) {
		return false;
	}
	return true;
}
