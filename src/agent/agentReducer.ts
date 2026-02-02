import { type AgentState, type ActiveRequest, type UiRequestEnvelope } from './agentTypes';
import { type AgentEvent, type EffectResult, type NormalizedError } from './agentEvents';
import { type Effect } from './agentEffects';

export type TransitionResult = { state: AgentState; effects: Effect[] };

function withQueue(state: AgentState, queue: UiRequestEnvelope[]): AgentState {
	if (state.kind === 'idle') {
		return { kind: 'idle', queue };
	}
	if (state.kind === 'busy') {
		return { ...state, queue };
	}
	return { ...state, queue };
}

function dequeueIfIdle(state: AgentState): { state: AgentState; effects: Effect[] } {
	if (state.kind !== 'idle' || state.queue.length === 0) {
		return { state, effects: [] };
	}
	const [next, ...rest] = state.queue;
	return { state: { kind: 'idle', queue: rest }, effects: [{ type: 'DEQUEUE_NEXT', envelope: next }] };
}

function makeBusy(active: ActiveRequest, queue: UiRequestEnvelope[]): AgentState {
	return { kind: 'busy', active, queue };
}

function pendingFromBusy(state: AgentState, summary: string, targetFile?: string): AgentState {
	if (state.kind !== 'busy') {
		return state;
	}
	const patch = state.active.patch;
	if (!patch) {
		return { kind: 'idle', queue: state.queue };
	}
	return {
		kind: 'patchPending',
		planId: patch.planId,
		summary,
		targetFile,
		lastRequestId: state.active.requestId,
		queue: state.queue
	};
}

export function transition(state: AgentState, event: AgentEvent): TransitionResult {
	if (event.type === 'UI_REQUEST') {
		return handleUiRequest(state, event.envelope);
	}
	if (event.type === 'EFFECT_DONE') {
		return handleEffectDone(state, event.requestId, event.result);
	}
	return handleEffectFailed(state, event.requestId, event.error);
}

function handleUiRequest(state: AgentState, envelope: UiRequestEnvelope): TransitionResult {
	if (state.kind === 'busy') {
		return { state: withQueue(state, [...state.queue, envelope]), effects: [] };
	}

	if (state.kind === 'patchPending') {
		if (envelope.type === 'chat/send') {
			return {
				state,
				effects: [
					{
						type: 'EMIT_ERROR',
						requestId: envelope.requestId,
						code: 'PATCH_PENDING',
						message: 'There is a pending patch. Preview/Apply/Discard it before creating a new one.'
					},
					{
						type: 'EMIT_PATCH_PENDING',
						requestId: envelope.requestId,
						planId: state.planId,
						summary: state.summary,
						targetFile: state.targetFile,
						actions: ['preview', 'apply', 'discard']
					}
				]
			};
		}

		const requestedPlan = envelope.payload.planId;
		if (!requestedPlan || requestedPlan !== state.planId) {
			return {
				state,
				effects: [
					{
						type: 'EMIT_ERROR',
						requestId: envelope.requestId,
						code: 'PATCH_NOT_FOUND',
						message: 'No pending patch found for this planId.'
					}
				]
			};
		}

		const active = {
			requestId: envelope.requestId,
			kind: envelope.type === 'patch/preview'
				? 'previewPatch'
				: envelope.type === 'patch/apply'
				? 'applyPatch'
				: 'discardPatch',
			startedAt: Date.now(),
			patch: {
				planId: state.planId,
				summary: state.summary,
				targetFile: state.targetFile
			}
		} satisfies ActiveRequest;

		const effects: Effect[] = [];
		if (envelope.type === 'patch/preview') {
			effects.push({ type: 'EMIT_STATUS', requestId: envelope.requestId, text: 'Opening diffs...' });
			effects.push({ type: 'CALL_PATCH_PREVIEW', requestId: envelope.requestId, planId: state.planId });
		}
		if (envelope.type === 'patch/apply') {
			effects.push({ type: 'EMIT_STATUS', requestId: envelope.requestId, text: 'Applying changes...' });
			effects.push({ type: 'CALL_PATCH_APPLY', requestId: envelope.requestId, planId: state.planId });
		}
		if (envelope.type === 'patch/discard') {
			effects.push({ type: 'CALL_PATCH_DISCARD', requestId: envelope.requestId, planId: state.planId });
		}
		return { state: makeBusy(active, state.queue), effects };
	}

	if (envelope.type !== 'chat/send') {
		return {
			state,
			effects: [
				{
					type: 'EMIT_ERROR',
					requestId: envelope.requestId,
					code: 'NO_PENDING_PATCH',
					message: 'No pending patch available.'
				}
			]
		};
	}

	const active: ActiveRequest = {
		requestId: envelope.requestId,
		kind: 'route',
		startedAt: Date.now(),
		userText: envelope.payload.text ?? ''
	};
	return {
		state: makeBusy(active, state.queue),
		effects: [{ type: 'CALL_CLASSIFY', requestId: envelope.requestId, userText: envelope.payload.text ?? '' }]
	};
}

function handleEffectDone(state: AgentState, requestId: string, result: EffectResult): TransitionResult {
	if (state.kind !== 'busy' || state.active.requestId !== requestId) {
		return { state, effects: [] };
	}

	if (state.active.kind === 'route' && result.kind === 'route') {
		if (result.intent === 'chat') {
			const active: ActiveRequest = {
				requestId,
				kind: 'chat',
				startedAt: Date.now(),
				intent: 'chat',
				userText: result.userText
			};
			return {
				state: makeBusy(active, state.queue),
				effects: [
					{ type: 'EMIT_STATUS', requestId, text: 'Calling OpenAI...' },
					{ type: 'CALL_CHAT', requestId, text: result.userText }
				]
			};
		}
		const active: ActiveRequest = {
			requestId,
			kind: 'generatePatch',
			startedAt: Date.now(),
			intent: 'edit',
			userText: result.userText,
			controlTarget: result.targetFile,
			reasons: result.reasons
		};
		return {
			state: makeBusy(active, state.queue),
			effects: [
				{ type: 'EMIT_STATUS', requestId, text: 'Generating PatchPlan...' },
				{
					type: 'CALL_GENERATE_PATCH',
					requestId,
					userText: result.userText,
					targetFile: result.targetFile,
					reasons: result.reasons
				}
			]
		};
	}

	if (state.active.kind === 'chat' && result.kind === 'chat') {
		const nextState = { kind: 'idle', queue: state.queue } as AgentState;
		const effects: Effect[] = [{ type: 'EMIT_FINAL', requestId, text: result.text }];
		const dequeued = dequeueIfIdle(nextState);
		return { state: dequeued.state, effects: effects.concat(dequeued.effects) };
	}

	if (state.active.kind === 'generatePatch' && result.kind === 'patchGenerated') {
		const patchPending: AgentState = {
			kind: 'patchPending',
			planId: result.planId,
			summary: result.summary,
			targetFile: result.targetFile,
			lastRequestId: requestId,
			queue: state.queue
		};
		return {
			state: patchPending,
			effects: [
				{ type: 'EMIT_STATUS', requestId, text: 'Patch plan ready.' },
				{
					type: 'EMIT_PATCH_PENDING',
					requestId,
					planId: result.planId,
					summary: result.summary,
					targetFile: result.targetFile,
					actions: ['preview', 'apply', 'discard']
				},
				{ type: 'EMIT_FINAL', requestId, text: `Proposed changes ready: ${result.summary}.` }
			]
		};
	}

	if (state.active.kind === 'previewPatch' && result.kind === 'patchPreviewed') {
		const pending = pendingFromBusy(state, state.active.patch?.summary ?? 'Patch plan', state.active.patch?.targetFile);
		return {
			state: pending,
			effects: [{ type: 'EMIT_FINAL', requestId, text: 'Diffs opened.' }]
		};
	}

	if (state.active.kind === 'applyPatch' && result.kind === 'patchApplied') {
		const nextState = { kind: 'idle', queue: state.queue } as AgentState;
		const effects: Effect[] = [{ type: 'EMIT_FINAL', requestId, text: 'Changes applied.' }];
		const dequeued = dequeueIfIdle(nextState);
		return { state: dequeued.state, effects: effects.concat(dequeued.effects) };
	}

	if (state.active.kind === 'discardPatch' && result.kind === 'patchDiscarded') {
		const nextState = { kind: 'idle', queue: state.queue } as AgentState;
		const effects: Effect[] = [{ type: 'EMIT_FINAL', requestId, text: 'Changes discarded.' }];
		const dequeued = dequeueIfIdle(nextState);
		return { state: dequeued.state, effects: effects.concat(dequeued.effects) };
	}

	return { state: withQueue(state, state.queue), effects: [] };
}

function handleEffectFailed(state: AgentState, requestId: string, error: NormalizedError): TransitionResult {
	if (state.kind !== 'busy' || state.active.requestId !== requestId) {
		return { state, effects: [] };
	}

	const effects: Effect[] = [
		{ type: 'EMIT_ERROR', requestId, code: error.code, message: error.message, details: error.details }
	];

	if (state.active.kind === 'previewPatch' || state.active.kind === 'applyPatch' || state.active.kind === 'discardPatch') {
		const pending = pendingFromBusy(state, state.active.patch?.summary ?? 'Patch plan', state.active.patch?.targetFile);
		return { state: pending, effects };
	}

	const nextState = { kind: 'idle', queue: state.queue } as AgentState;
	const dequeued = dequeueIfIdle(nextState);
	return { state: dequeued.state, effects: effects.concat(dequeued.effects) };
}
