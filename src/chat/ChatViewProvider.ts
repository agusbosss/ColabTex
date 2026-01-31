import * as vscode from 'vscode';
import { getWebviewHtml } from './getWebviewHtml';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private readonly extensionUri: vscode.Uri;
	private readonly output: vscode.OutputChannel;

	constructor(extensionUri: vscode.Uri, output?: vscode.OutputChannel) {
		this.extensionUri = extensionUri;
		this.output = output ?? vscode.window.createOutputChannel('ColabTex');
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};

		view.webview.html = getWebviewHtml(view.webview, this.extensionUri);

		view.webview.onDidReceiveMessage((msg) => {
			if (!msg || typeof msg.type !== 'string') {
				return;
			}
			if (msg.type === 'userMessage' && typeof msg.text === 'string') {
				this.output.appendLine(`Chat userMessage: ${msg.text}`);
				void view.webview.postMessage({
					type: 'assistantMessage',
					text: `Echo: ${msg.text}`
				});
			}
		});
	}
}