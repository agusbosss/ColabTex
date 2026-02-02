import * as vscode from 'vscode';
import { type Effect } from './agentEffects';
import { type EffectResult, type NormalizedError } from './agentEvents';
import { type UiRequestEnvelope } from './agentTypes';
import { makeEvent } from '../shared/protocol';
import { type PatchPlanService } from '../patch/patchPlanService';
import { type StickyState, classifyIntent, getSelection, getActiveEditorPath, isStickyExpired } from './intentRouter';
import { listTexFiles } from '../tools/fileTools';
import { callOpenAI } from '../openai/openaiClient';
import { generatePatchPlan } from './patchPlanAgent';

export type RunnerDeps = {
	context: vscode.ExtensionContext;
	webview: vscode.Webview;
	output: vscode.OutputChannel;
	patchPlanService: PatchPlanService;
	sticky: StickyState;
	stickyTtlMs: number;
};

export class AgentRunner {
	private readonly deps: RunnerDeps;
	private readonly dispatchEvent: (event: { type: 'UI_REQUEST' | 'EFFECT_DONE' | 'EFFECT_FAILED'; requestId?: string; envelope?: UiRequestEnvelope; result?: EffectResult; error?: NormalizedError }) => void;
	private seqByRequestId = new Map<string, number>();

	constructor(
		deps: RunnerDeps,
		dispatchEvent: (event: {
			type: 'UI_REQUEST' | 'EFFECT_DONE' | 'EFFECT_FAILED';
			requestId?: string;
			envelope?: UiRequestEnvelope;
			result?: EffectResult;
			error?: NormalizedError;
		}) => void
	) {
		this.deps = deps;
		this.dispatchEvent = dispatchEvent;
	}

	async runEffects(effects: Effect[]): Promise<void> {
		for (const effect of effects) {
			await this.runEffect(effect);
		}
	}

	private nextSeq(requestId: string): number {
		const next = (this.seqByRequestId.get(requestId) ?? 0) + 1;
		this.seqByRequestId.set(requestId, next);
		return next;
	}

	private emit(requestId: string, type: string, payload: Record<string, unknown>): void {
		const seq = this.nextSeq(requestId);
		const event = makeEvent({
			requestId,
			type: type as never,
			payload: payload as never,
			seq
		});
		void this.deps.webview.postMessage(event);
	}

	private async runEffect(effect: Effect): Promise<void> {
		switch (effect.type) {
			case 'EMIT_STATUS':
				this.emit(effect.requestId, 'agent/status', { text: effect.text });
				return;
			case 'EMIT_FINAL':
				this.emit(effect.requestId, 'agent/final', { text: effect.text });
				return;
			case 'EMIT_ERROR':
				this.emit(effect.requestId, 'agent/error', {
					code: effect.code,
					message: effect.message,
					details: effect.details
				});
				return;
			case 'EMIT_PATCH_PENDING':
				this.emit(effect.requestId, 'patch/pending', {
					planId: effect.planId,
					summary: effect.summary,
					targetFile: effect.targetFile,
					actions: effect.actions
				});
				return;
			case 'CALL_CLASSIFY':
				await this.handleClassify(effect.requestId, effect.userText);
				return;
			case 'CALL_CHAT':
				await this.handleChat(effect.requestId, effect.text);
				return;
			case 'CALL_GENERATE_PATCH':
				await this.handleGeneratePatch(effect);
				return;
			case 'CALL_PATCH_PREVIEW':
				await this.handlePatchPreview(effect.requestId, effect.planId);
				return;
			case 'CALL_PATCH_APPLY':
				await this.handlePatchApply(effect.requestId, effect.planId);
				return;
			case 'CALL_PATCH_DISCARD':
				await this.handlePatchDiscard(effect.requestId, effect.planId);
				return;
			case 'DEQUEUE_NEXT':
				this.dispatchEvent({ type: 'UI_REQUEST', envelope: effect.envelope });
				return;
		}
	}

	private async handleClassify(requestId: string, userText: string): Promise<void> {
		try {
			if (isStickyExpired(this.deps.sticky.lastEditAt, this.deps.stickyTtlMs)) {
				this.deps.sticky.lastTargetFile = null;
				this.deps.sticky.lastTouchedFiles = [];
				this.deps.sticky.lastEditAt = null;
			}
			const filesList = await listTexFiles();
			const selection = getSelection();
			const activeEditorPath = getActiveEditorPath();
			const intentResult = classifyIntent(userText, {
				filesList,
				selection,
				activeEditorPath,
				sticky: this.deps.sticky,
				pendingPatch: !!this.deps.patchPlanService.getPlan(),
				recentFiles: this.deps.sticky.lastTouchedFiles
			});
			this.deps.output.appendLine(`[FSM] intent=${intentResult.intent} requestId=${requestId} reasons=${intentResult.reasons.join(',')}`);
			this.dispatchEvent({
				type: 'EFFECT_DONE',
				requestId,
				result: {
					kind: 'route',
					requestId,
					intent: intentResult.intent,
					userText,
					targetFile: intentResult.targetFile,
					reasons: intentResult.reasons
				}
			});
		} catch (error) {
			this.dispatchEvent({ type: 'EFFECT_FAILED', requestId, error: normalizeError(error) });
		}
	}

	private async handleChat(requestId: string, text: string): Promise<void> {
		try {
			const apiKey = await this.getApiKey();
			const responseText = await callOpenAI({ apiKey, inputText: text });
			this.dispatchEvent({ type: 'EFFECT_DONE', requestId, result: { kind: 'chat', requestId, text: responseText } });
		} catch (error) {
			this.dispatchEvent({ type: 'EFFECT_FAILED', requestId, error: normalizeError(error) });
		}
	}

	private async handleGeneratePatch(effect: Extract<Effect, { type: 'CALL_GENERATE_PATCH' }>): Promise<void> {
		const requestId = effect.requestId;
		try {
			const apiKey = await this.getApiKey();
		const plan = await generatePatchPlan(this.deps.context, apiKey, effect.userText, {
			targetFile: effect.targetFile,
			stickyTarget: this.deps.sticky.lastTargetFile ?? undefined,
			reason: effect.reasons
		});
		this.deps.patchPlanService.setPlan(plan);
		this.deps.sticky.lastEditAt = Date.now();
		const primaryTarget = this.deps.patchPlanService.getPrimaryTargetFile();
		const target = primaryTarget ?? effect.targetFile ?? this.deps.sticky.lastTargetFile ?? undefined;
		if (target) {
			this.deps.sticky.lastTargetFile = target;
			if (!this.deps.sticky.lastTouchedFiles.includes(target)) {
				this.deps.sticky.lastTouchedFiles.unshift(target);
				this.deps.sticky.lastTouchedFiles = this.deps.sticky.lastTouchedFiles.slice(0, 5);
			}
		}

		const planId = this.deps.patchPlanService.getPlanId() ?? '';
		const summary = plan.summary;
		const targetFile = target ?? this.deps.patchPlanService.getPlanTargetFiles()[0];
		this.dispatchEvent({
			type: 'EFFECT_DONE',
			requestId,
			result: { kind: 'patchGenerated', requestId, planId, summary, targetFile }
		});
		} catch (error) {
			this.dispatchEvent({ type: 'EFFECT_FAILED', requestId, error: normalizeError(error) });
		}
	}

	private async handlePatchPreview(requestId: string, planId: string): Promise<void> {
		try {
			await this.deps.patchPlanService.showDiffs();
			this.dispatchEvent({ type: 'EFFECT_DONE', requestId, result: { kind: 'patchPreviewed', requestId } });
		} catch (error) {
			this.dispatchEvent({ type: 'EFFECT_FAILED', requestId, error: normalizeError(error) });
		}
	}

	private async handlePatchApply(requestId: string, planId: string): Promise<void> {
		try {
			const primaryTarget = this.deps.patchPlanService.getPrimaryTargetFile();
			await this.deps.patchPlanService.applyCurrentPlan();
			this.deps.sticky.lastEditAt = Date.now();
			if (primaryTarget) {
				this.deps.sticky.lastTargetFile = primaryTarget;
				if (!this.deps.sticky.lastTouchedFiles.includes(primaryTarget)) {
					this.deps.sticky.lastTouchedFiles.unshift(primaryTarget);
					this.deps.sticky.lastTouchedFiles = this.deps.sticky.lastTouchedFiles.slice(0, 5);
				}
			}
			this.dispatchEvent({ type: 'EFFECT_DONE', requestId, result: { kind: 'patchApplied', requestId } });
		} catch (error) {
			this.dispatchEvent({ type: 'EFFECT_FAILED', requestId, error: normalizeError(error) });
		}
	}

	private async handlePatchDiscard(requestId: string, planId: string): Promise<void> {
		try {
			this.deps.patchPlanService.clearPlan();
			this.dispatchEvent({ type: 'EFFECT_DONE', requestId, result: { kind: 'patchDiscarded', requestId } });
		} catch (error) {
			this.dispatchEvent({ type: 'EFFECT_FAILED', requestId, error: normalizeError(error) });
		}
	}

	private async getApiKey(): Promise<string> {
		const apiKey = await this.deps.context.secrets.get('colabtex.openaiApiKey');
		if (!apiKey) {
			throw new Error('MISSING_KEY');
		}
		return apiKey;
	}
}

export function normalizeError(error: unknown): NormalizedError {
	if (error instanceof Error) {
		if (error.message === 'MISSING_KEY') {
			return { code: 'MISSING_KEY', message: "No OpenAI API key set. Run 'ColabTex: Set OpenAI API Key' to continue." };
		}
		if (error.message === 'INVALID_KEY') {
			return { code: 'INVALID_KEY', message: 'Invalid API key. Please re-set it (ColabTex: Set OpenAI API Key).' };
		}
		if (error.message === 'RATE_LIMIT') {
			return { code: 'RATE_LIMIT', message: 'Rate limit exceeded. Please wait and retry.' };
		}
		if (error.message.startsWith('OPENAI_REQUEST_INVALID:')) {
			const message = error.message.slice('OPENAI_REQUEST_INVALID:'.length).trim() || 'Invalid request to OpenAI.';
			return { code: 'OPENAI_REQUEST_INVALID', message };
		}
		if (error.message.startsWith('OPENAI_ERROR:')) {
			const message = error.message.split(':').slice(2).join(':') || 'OpenAI request failed.';
			return { code: 'OPENAI_ERROR', message };
		}
		if (error.message.includes('PatchPlan')) {
			return { code: 'PATCHPLAN_INVALID', message: error.message };
		}
		return { code: 'INTERNAL_ERROR', message: error.message };
	}
	return { code: 'INTERNAL_ERROR', message: 'Unknown error.' };
}
