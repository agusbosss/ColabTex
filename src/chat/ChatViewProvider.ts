import * as vscode from 'vscode';
import { getWebviewHtml } from './getWebviewHtml';
import { parseIncomingMessage, makeEvent } from '../shared/protocol';
import { PatchPlanService } from '../patch/patchPlanService';
import { AgentController } from '../agent/agentController';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private readonly context: vscode.ExtensionContext;
	private readonly extensionUri: vscode.Uri;
	private readonly output: vscode.OutputChannel;
	private readonly patchPlanService: PatchPlanService;
	private controller: AgentController | undefined;

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

		this.controller?.dispose();
		this.controller = new AgentController({
			context: this.context,
			webview: view.webview,
			output: this.output,
			patchPlanService: this.patchPlanService
		});

		view.webview.onDidReceiveMessage((raw) => {
			const parsed = parseIncomingMessage(raw);
			if (!parsed.ok) {
				const errorEvent = makeEvent({
					requestId: parsed.requestId,
					type: 'agent/error',
					payload: { code: 'INVALID_MESSAGE', message: parsed.error }
				});
				void view.webview.postMessage(errorEvent);
				return;
			}
			this.controller?.handleUiEnvelope(parsed.value.request);
		});
	}
}
