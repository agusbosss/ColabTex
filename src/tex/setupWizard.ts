import * as vscode from 'vscode';
import { detectTex } from './texDetector';
import { createDiagnosticsChannel, logDetection, logError } from './diagnostics';

type WizardTrigger = 'manual' | 'auto';

const RETRY_LABEL = 'Retry';
const SHOW_DIAGNOSTICS_LABEL = 'Show diagnostics';
const INSTALL_GUIDE_LABEL = 'Open install guide';
const LATEXMK_GUIDE_LABEL = 'Open latexmk guide';
const PATH_HINT = 'If you just installed TeX, restart VS Code to refresh PATH, then retry.';

function installGuideUrl(): string {
	switch (process.platform) {
		case 'win32':
			return 'https://miktex.org/download';
		case 'darwin':
			return 'https://tug.org/mactex/';
		default:
			return 'https://tug.org/texlive/';
	}
}

function latexmkGuideUrl(): string {
	return 'https://ctan.org/pkg/latexmk';
}

async function openExternal(url: string): Promise<void> {
	await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function showDiagnostics(): Promise<void> {
	createDiagnosticsChannel().show(true);
}

async function renderResult(
	context: vscode.ExtensionContext,
	trigger: WizardTrigger,
	fileName?: string
): Promise<void> {
	try {
		const result = await detectTex();
		logDetection(result);

		if (trigger === 'manual' || result.status !== 'OK') {
			createDiagnosticsChannel().show(true);
		}

		if (result.status === 'OK') {
			if (trigger === 'auto') {
				const channel = createDiagnosticsChannel();
				const label = fileName ? fileName : 'unknown file';
				channel.appendLine(`Auto check OK for ${label}`);
				return;
			}
			const selection = await vscode.window.showInformationMessage(
				'ColabTex: TeX detected ✅',
				SHOW_DIAGNOSTICS_LABEL
			);
			if (selection === SHOW_DIAGNOSTICS_LABEL) {
				await showDiagnostics();
			}
			return;
		}

		if (result.status === 'MISSING_TEX') {
			const selection = await vscode.window.showWarningMessage(
				`ColabTex: TeX not detected. ${PATH_HINT}`,
				INSTALL_GUIDE_LABEL,
				RETRY_LABEL,
				SHOW_DIAGNOSTICS_LABEL
			);
			if (selection === INSTALL_GUIDE_LABEL) {
				await openExternal(installGuideUrl());
			} else if (selection === RETRY_LABEL) {
				await renderResult(context, trigger, fileName);
			} else if (selection === SHOW_DIAGNOSTICS_LABEL) {
				await showDiagnostics();
			}
			return;
		}

		if (result.status === 'MISSING_LATEXMK') {
			const selection = await vscode.window.showWarningMessage(
				`ColabTex: latexmk not detected. ${PATH_HINT}`,
				LATEXMK_GUIDE_LABEL,
				RETRY_LABEL,
				SHOW_DIAGNOSTICS_LABEL
			);
			if (selection === LATEXMK_GUIDE_LABEL) {
				await openExternal(latexmkGuideUrl());
			} else if (selection === RETRY_LABEL) {
				await renderResult(context, trigger, fileName);
			} else if (selection === SHOW_DIAGNOSTICS_LABEL) {
				await showDiagnostics();
			}
			return;
		}

		const selection = await vscode.window.showWarningMessage(
			`ColabTex: Unable to detect TeX setup. ${PATH_HINT}`,
			RETRY_LABEL,
			SHOW_DIAGNOSTICS_LABEL
		);
		if (selection === RETRY_LABEL) {
			await renderResult(context, trigger, fileName);
		} else if (selection === SHOW_DIAGNOSTICS_LABEL) {
			await showDiagnostics();
		}
	} catch (err) {
		logError(err);
		createDiagnosticsChannel().show(true);
		if (trigger === 'manual') {
			await vscode.window.showErrorMessage('ColabTex: Setup check failed. See diagnostics for details.');
		}
	}
}

export async function runSetupWizard(
	context: vscode.ExtensionContext,
	trigger: WizardTrigger,
	fileName?: string
): Promise<void> {
	await renderResult(context, trigger, fileName);
}