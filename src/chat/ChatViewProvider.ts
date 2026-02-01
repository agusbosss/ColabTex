import * as vscode from 'vscode';
import { getWebviewHtml } from './getWebviewHtml';
import { getOpenAIApiKey } from '../secrets/openaiKey';
import { callOpenAI } from '../openai/openaiClient';
import { generatePatchPlan } from '../agent/patchPlanAgent';
import { PatchPlanService } from '../patch/patchPlanService';
import { classifyIntent, getSelection, getActiveEditorPath, isStickyExpired, type StickyState } from '../agent/intentRouter';
import { listTexFiles } from '../tools/fileTools';

const STICKY_TTL_MS = 10 * 60 * 1000;

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private readonly context: vscode.ExtensionContext;
	private readonly extensionUri: vscode.Uri;
	private readonly output: vscode.OutputChannel;
	private readonly patchPlanService: PatchPlanService;
	private didShowMissingKeyToast = false;
	private sticky: StickyState = {
		lastTargetFile: null,
		lastTouchedFiles: [],
		lastEditAt: null
	};

	constructor(
		context: vscode.ExtensionContext,
		extensionUri: vscode.Uri,
		patchPlanService: PatchPlanService,
		output?: vscode.OutputChannel
	) {
		this.context = context;
		this.extensionUri = extensionUri;
		this.patchPlanService = patchPlanService;
		this.output = output ?? vscode.window.createOutputChannel('ColabTex');
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};

		view.webview.html = getWebviewHtml(view.webview, this.extensionUri);

		view.webview.onDidReceiveMessage(async (msg) => {
			if (!msg || typeof msg.type !== 'string') {
				return;
			}
			if (msg.type === 'userMessage' && typeof msg.text === 'string') {
				if (isStickyExpired(this.sticky.lastEditAt, STICKY_TTL_MS)) {
					this.sticky.lastTargetFile = null;
					this.sticky.lastTouchedFiles = [];
					this.sticky.lastEditAt = null;
				}

				const filesList = await listTexFiles();
				const selection = getSelection();
				const activeEditorPath = getActiveEditorPath();
				const intentResult = classifyIntent(msg.text, {
					filesList,
					selection,
					activeEditorPath,
					sticky: this.sticky,
					pendingPatch: !!this.patchPlanService.getPlan(),
					recentFiles: this.sticky.lastTouchedFiles
				});
				this.output.appendLine(
					`[Intent] ${intentResult.intent} target=${intentResult.targetFile ?? 'n/a'} reasons=${intentResult.reasons.join(',')}`
				);
				this.output.appendLine(`Chat userMessage: ${msg.text}`);

				const apiKey = await getOpenAIApiKey(this.context);
				if (apiKey) {
					this.didShowMissingKeyToast = false;
				}
				if (!apiKey) {
					void view.webview.postMessage({
						type: 'assistantMessage',
						text: "No OpenAI API key set. Run 'ColabTex: Set OpenAI API Key' to continue."
					});
					if (!this.didShowMissingKeyToast) {
						this.didShowMissingKeyToast = true;
						const choice = await vscode.window.showInformationMessage(
							'ColabTex: No OpenAI API key set.',
							'Set key'
						);
						if (choice === 'Set key') {
							await vscode.commands.executeCommand('colabtex.setOpenAIApiKey');
							this.didShowMissingKeyToast = false;
						}
					}
					return;
				}

				if (intentResult.intent === 'chat') {
					try {
						const responseText = await callOpenAI({ apiKey, inputText: msg.text });
						void view.webview.postMessage({
							type: 'assistantMessage',
							text: responseText
						});
					} catch (error) {
						let message = 'OpenAI request failed.';
						if (error instanceof Error) {
							this.output.appendLine(`[OpenAI] ${error.message}`);
							if (error.message === 'INVALID_KEY') {
								message = 'Invalid API key. Please re-set it (ColabTex: Set OpenAI API Key).';
							} else if (error.message === 'RATE_LIMIT') {
								message = 'Rate limit exceeded. Please wait and retry.';
							} else if (error.message.startsWith('OPENAI_ERROR:')) {
								const parts = error.message.split(':');
								message = parts.slice(2).join(':') || 'OpenAI request failed.';
								message = `OpenAI request failed: ${message}`;
							}
						}
						void view.webview.postMessage({
							type: 'assistantMessage',
							text: message
						});
					}
					return;
				}

				if (this.patchPlanService.getPlan()) {
					const choice = await vscode.window.showInformationMessage(
						'ColabTex: There is a pending patch. Apply or discard it before creating a new one.',
						'Preview',
						'Apply',
						'Discard'
					);
					if (choice === 'Preview') {
						void vscode.commands.executeCommand('colabtex.previewProposedChanges');
					} else if (choice === 'Apply') {
						void vscode.commands.executeCommand('colabtex.applyProposedChanges');
					} else if (choice === 'Discard') {
						void vscode.commands.executeCommand('colabtex.discardProposedChanges');
					}
					return;
				}

				try {
					const plan = await generatePatchPlan(this.context, apiKey, msg.text, {
						targetFile: intentResult.targetFile ?? this.sticky.lastTargetFile ?? undefined,
						stickyTarget: this.sticky.lastTargetFile ?? undefined,
						reason: intentResult.reasons
					});
					this.patchPlanService.setPlan(plan);
					this.sticky.lastEditAt = Date.now();

					const target = intentResult.targetFile ?? this.sticky.lastTargetFile ?? null;
					if (target) {
						this.sticky.lastTargetFile = target;
						if (!this.sticky.lastTouchedFiles.includes(target)) {
							this.sticky.lastTouchedFiles.unshift(target);
							this.sticky.lastTouchedFiles = this.sticky.lastTouchedFiles.slice(0, 5);
						}
					}

					const action = await vscode.window.showInformationMessage(
						`ColabTex: Proposed changes ready. ${plan.summary}`,
						'Preview',
						'Apply',
						'Discard'
					);
					if (action === 'Preview') {
						await this.patchPlanService.showDiffs();
					} else if (action === 'Apply') {
						void vscode.commands.executeCommand('colabtex.applyProposedChanges');
					} else if (action === 'Discard') {
						void vscode.commands.executeCommand('colabtex.discardProposedChanges');
					}

					const targetNote = target ? ` Target: ${target} (from previous context).` : '';
					void view.webview.postMessage({
						type: 'assistantMessage',
						text: `Proposed changes ready: ${plan.summary}.${targetNote} Use Preview/Apply/Discard from the command palette if needed.`
					});
				} catch (error) {
					let message = 'OpenAI request failed.';
					if (error instanceof Error) {
						this.output.appendLine(`[OpenAI] ${error.message}`);
						if (error.message === 'INVALID_KEY') {
							message = 'Invalid API key. Please re-set it (ColabTex: Set OpenAI API Key).';
						} else if (error.message === 'RATE_LIMIT') {
							message = 'Rate limit exceeded. Please wait and retry.';
						} else if (error.message.startsWith('OPENAI_ERROR:')) {
							const parts = error.message.split(':');
							message = parts.slice(2).join(':') || 'OpenAI request failed.';
							message = `OpenAI request failed: ${message}`;
						} else if (error.message.includes('PatchPlan')) {
							message = `PatchPlan error: ${error.message}`;
						}
					}
					void view.webview.postMessage({
						type: 'assistantMessage',
						text: `${message} (Echo: ${msg.text})`
					});
				}
			}
		});
	}
}