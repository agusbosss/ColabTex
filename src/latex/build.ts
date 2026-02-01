import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { findMainTexFile } from '../tools/fileTools';

export type BuildResult = {
	ok: boolean;
	stdout: string;
	stderr: string;
	logPath?: string;
};

let lastBuildLogPath: vscode.Uri | undefined;

export async function buildLatex(mainFile?: string): Promise<BuildResult> {
	const root = getWorkspaceRoot();
	const entry = mainFile ?? (await findMainTexFile());
	if (!entry) {
		return { ok: false, stdout: '', stderr: 'No main .tex file found.' };
	}

	const logUri = vscode.Uri.joinPath(root, '.colabtex', 'last-build.log');
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, '.colabtex'));

	const result = await runCommand('latexmk', ['-pdf', '-interaction=nonstopmode', entry], root.fsPath);
	if (result.error?.code === 'ENOENT') {
		return { ok: false, stdout: result.stdout, stderr: 'latexmk not found in PATH.' };
	}
	const combined = `${result.stdout}\n${result.stderr}`.trim();
	await vscode.workspace.fs.writeFile(logUri, Buffer.from(combined, 'utf8'));
	lastBuildLogPath = logUri;

	return {
		ok: !result.error && result.exitCode === 0,
		stdout: result.stdout,
		stderr: result.stderr,
		logPath: logUri.fsPath
	};
}

export async function readLastBuildLog(): Promise<string> {
	if (!lastBuildLogPath) {
		return 'No build log available.';
	}
	const bytes = await vscode.workspace.fs.readFile(lastBuildLogPath);
	return Buffer.from(bytes).toString('utf8');
}

type ExecResult = { stdout: string; stderr: string; exitCode: number; error?: NodeJS.ErrnoException };

function runCommand(command: string, args: string[], cwd: string): Promise<ExecResult> {
	return new Promise((resolve) => {
		execFile(command, args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
			const exitCode = Number((error as { code?: number })?.code ?? 0);
			resolve({
				stdout: stdout ?? '',
				stderr: stderr ?? '',
				exitCode,
				error: error as NodeJS.ErrnoException | undefined
			});
		});
	});
}

function getWorkspaceRoot(): vscode.Uri {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder open.');
	}
	return folder.uri;
}
