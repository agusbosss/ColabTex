import { type UiRequestEnvelope } from './agentTypes';

export type NormalizedError = {
	code: string;
	message: string;
	details?: unknown;
};

export type AgentEvent =
	| { type: 'UI_REQUEST'; envelope: UiRequestEnvelope }
	| { type: 'EFFECT_DONE'; requestId: string; result: EffectResult }
	| { type: 'EFFECT_FAILED'; requestId: string; error: NormalizedError };

export type EffectResult =
	| {
			kind: 'route';
			requestId: string;
			intent: 'chat' | 'edit';
			userText: string;
			targetFile?: string;
			reasons?: string[];
	  }
	| { kind: 'chat'; requestId: string; text: string }
	| {
			kind: 'patchGenerated';
			requestId: string;
			planId: string;
			summary: string;
			targetFile?: string;
	  }
	| { kind: 'patchPreviewed'; requestId: string }
	| { kind: 'patchApplied'; requestId: string }
	| { kind: 'patchDiscarded'; requestId: string };
