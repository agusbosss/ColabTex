import * as vscode from 'vscode';

export class PreviewContentProvider implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>();
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

	readonly onDidChange = this.emitter.event;

	setContent(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this.emitter.fire(uri);
	}

	clear(): void {
		this.contents.clear();
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}
}