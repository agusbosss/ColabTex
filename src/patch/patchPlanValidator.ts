import Ajv, { type ValidateFunction } from 'ajv/dist/2020';
import * as vscode from 'vscode';
import { type PatchPlan, type PatchPlanValidation } from './patchPlanTypes';

let validator: ValidateFunction | undefined;

async function loadSchema(extensionUri: vscode.Uri): Promise<object> {
	const schemaUri = vscode.Uri.joinPath(extensionUri, 'patch.schema.json');
	const bytes = await vscode.workspace.fs.readFile(schemaUri);
	const text = Buffer.from(bytes).toString('utf8');
	return JSON.parse(text) as object;
}

export async function validatePatchPlan(
	plan: unknown,
	extensionUri: vscode.Uri
): Promise<PatchPlanValidation> {
	if (!validator) {
		const schema = await loadSchema(extensionUri);
		const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
		validator = ajv.compile(schema);
	}

	const ok = validator(plan) as boolean;
	if (ok) {
		return { ok: true };
	}
	const errors = validator.errors?.map((err) => `${err.instancePath} ${err.message}`.trim()) ?? [
		'Unknown validation error.'
	];
	return { ok: false, errors };
}

export function ensurePatchPlan(plan: unknown): PatchPlan {
	return plan as PatchPlan;
}
