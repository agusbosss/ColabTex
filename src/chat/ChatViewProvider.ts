import * as vscode from 'vscode';
import { getWebviewHtml } from './getWebviewHtml';
import { callOpenAI } from '../openai/openaiClient';
import { getOpenAIApiKey } from '../secrets/openaiKey';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private readonly context: vscode.ExtensionContext;
	private readonly extensionUri: vscode.Uri;
	private readonly output: vscode.OutputChannel;
	private didShowMissingKeyToast = false;

	constructor(context: vscode.ExtensionContext, extensionUri: vscode.Uri, output?: vscode.OutputChannel) {
		this.context = context;
		this.extensionUri = extensionUri;
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

				try {
					const responseText = await callOpenAI({ apiKey, inputText: msg.text });
					void view.webview.postMessage({
						type: 'assistantMessage',
						text: responseText
					});
				} catch (error) {
					let message = 'OpenAI request failed.';
					if (error instanceof Error) {
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
						text: `${message} (Echo: ${msg.text})`
					});
				}
			}
		});
	}
}
