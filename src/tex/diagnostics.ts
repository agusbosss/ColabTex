import * as vscode from 'vscode';
import type { TexDetectionResult } from './texDetector';

let diagnosticsChannel: vscode.OutputChannel | undefined;

export function createDiagnosticsChannel(): vscode.OutputChannel {
	if (!diagnosticsChannel) {
		diagnosticsChannel = vscode.window.createOutputChannel('ColabTex');
	}
	return diagnosticsChannel;
}

function timestamp(): string {
	return new Date().toISOString();
}

export function logDetection(result: TexDetectionResult): void {
	const channel = createDiagnosticsChannel();
	channel.appendLine(`[${timestamp()}] TeX detection result: ${result.status}`);
	channel.appendLine(`[${timestamp()}] Details: ${result.details}`);
	if (result.versions) {
		if (result.versions.latexmk) {
			channel.appendLine(`[${timestamp()}] latexmk: ${result.versions.latexmk}`);
		}
		if (result.versions.pdflatex) {
			channel.appendLine(`[${timestamp()}] engine: ${result.versions.pdflatex}`);
		}
	}
	if (result.errors?.length) {
		for (const error of result.errors) {
			channel.appendLine(`[${timestamp()}] Error: ${error}`);
		}
	}
}

export function logError(err: unknown): void {
	const channel = createDiagnosticsChannel();
	if (err instanceof Error) {
		channel.appendLine(`[${timestamp()}] Error: ${err.message}`);
		if (err.stack) {
			channel.appendLine(err.stack);
		}
		return;
	}
	channel.appendLine(`[${timestamp()}] Error: ${String(err)}`);
}
