import type * as vscode from 'vscode';

const SECRET_KEY = 'colabtex.openaiApiKey';

export async function getOpenAIApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
	return context.secrets.get(SECRET_KEY);
}

export async function setOpenAIApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
	await context.secrets.store(SECRET_KEY, key);
}

export async function clearOpenAIApiKey(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(SECRET_KEY);
}