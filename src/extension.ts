// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { runSetupWizard } from './tex/setupWizard';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "colabtex" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('colabtex.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from ColabTex!');
	});

	const setupCheck = vscode.commands.registerCommand('colabtex.runSetupCheck', async () => {
		await runSetupWizard(context, 'manual');
	});

	let setupWizardShown = false;
	const autoTrigger = vscode.workspace.onDidOpenTextDocument((doc) => {
		if (setupWizardShown) {
			return;
		}
		const isTexFile = doc.languageId === 'latex' || doc.fileName.toLowerCase().endsWith('.tex');
		if (!isTexFile) {
			return;
		}
		setupWizardShown = true;
		void runSetupWizard(context, 'auto', doc.fileName);
	});

	context.subscriptions.push(disposable, setupCheck, autoTrigger);
}

// This method is called when your extension is deactivated
export function deactivate() {}
