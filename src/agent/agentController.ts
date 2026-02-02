import * as vscode from 'vscode';
import { type AgentEvent } from './agentEvents';
import { type AgentState, type UiRequestEnvelope } from './agentTypes';
import { type Effect } from './agentEffects';
import { transition } from './agentReducer';
import { AgentRunner } from './agentRunner';
import { type PatchPlanService } from '../patch/patchPlanService';
import { type StickyState } from './intentRouter';

const STICKY_TTL_MS = 10 * 60 * 1000;

export class AgentController {
	private state: AgentState;
	private readonly runner: AgentRunner;
	private readonly output: vscode.OutputChannel;
	private readonly sticky: StickyState;

	constructor(params: {
		context: vscode.ExtensionContext;
		webview: vscode.Webview;
		output: vscode.OutputChannel;
		patchPlanService: PatchPlanService;
	}) {
		this.output = params.output;
		this.sticky = {
			lastTargetFile: null,
			lastTouchedFiles: [],
			lastEditAt: null
		};
		const existingPlanId = params.patchPlanService.getPlanId();
		const existingSummary = params.patchPlanService.getPlanSummary();
		if (existingPlanId && existingSummary) {
			this.state = {
				kind: 'patchPending',
				planId: existingPlanId,
				summary: existingSummary,
				targetFile: params.patchPlanService.getPlanTargetFiles()[0],
				lastRequestId: 'boot',
				queue: []
			};
		} else {
			this.state = { kind: 'idle', queue: [] };
		}

		this.runner = new AgentRunner(
			{
				context: params.context,
				webview: params.webview,
				output: params.output,
				patchPlanService: params.patchPlanService,
				sticky: this.sticky,
				stickyTtlMs: STICKY_TTL_MS
			},
			(event) => this.dispatch(event as AgentEvent)
		);
	}

	handleUiEnvelope(envelope: UiRequestEnvelope): void {
		this.dispatch({ type: 'UI_REQUEST', envelope });
	}

	dispose(): void {
		// no-op for now
	}

	private dispatch(event: AgentEvent): void {
		const prev = this.state;
		const { state, effects } = transition(this.state, event);
		this.state = state;
		this.logTransition(prev, state, event, effects);
		void this.runner.runEffects(effects);
	}

	private logTransition(prev: AgentState, next: AgentState, event: AgentEvent, effects: Effect[]): void {
		const requestId =
			event.type === 'UI_REQUEST'
				? event.envelope.requestId
				: event.requestId;
		this.output.appendLine(
			`[FSM] ${prev.kind} -> ${next.kind} requestId=${requestId} event=${event.type} effects=${effects.map((e) => e.type).join(',')}`
		);
	}
}
