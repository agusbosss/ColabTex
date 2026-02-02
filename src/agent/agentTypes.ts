export type AgentMode = 'chat' | 'edit';

export type ActiveRequestKind =
	| 'route'
	| 'chat'
	| 'generatePatch'
	| 'previewPatch'
	| 'applyPatch'
	| 'discardPatch';

export type ActiveRequest = {
	requestId: string;
	kind: ActiveRequestKind;
	startedAt: number;
	patch?: {
		planId: string;
		summary: string;
		targetFile?: string;
	};
	intent?: AgentMode;
	userText?: string;
	controlTarget?: string;
	reasons?: string[];
};

export type UiRequestEnvelope = {
	protocolVersion: 1;
	requestId: string;
	type: 'chat/send' | 'patch/preview' | 'patch/apply' | 'patch/discard';
	payload: { text?: string; planId?: string };
};

export type AgentState =
	| { kind: 'idle'; queue: UiRequestEnvelope[] }
	| { kind: 'busy'; active: ActiveRequest; queue: UiRequestEnvelope[] }
	| {
			kind: 'patchPending';
			planId: string;
			summary: string;
			targetFile?: string;
			lastRequestId: string;
			queue: UiRequestEnvelope[];
	  };
