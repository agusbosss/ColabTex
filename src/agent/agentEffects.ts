import { type UiRequestEnvelope } from './agentTypes';

export type Effect =
	| { type: 'EMIT_STATUS'; requestId: string; text: string }
	| { type: 'EMIT_FINAL'; requestId: string; text: string }
	| { type: 'EMIT_ERROR'; requestId: string; code: string; message: string; details?: unknown }
	| {
			type: 'EMIT_PATCH_PENDING';
			requestId: string;
			planId: string;
			summary: string;
			targetFile?: string;
			actions: Array<'preview' | 'apply' | 'discard'>;
	  }
	| { type: 'CALL_CLASSIFY'; requestId: string; userText: string }
	| { type: 'CALL_CHAT'; requestId: string; text: string }
	| { type: 'CALL_GENERATE_PATCH'; requestId: string; userText: string; targetFile?: string; reasons?: string[] }
	| { type: 'CALL_PATCH_PREVIEW'; requestId: string; planId: string }
	| { type: 'CALL_PATCH_APPLY'; requestId: string; planId: string }
	| { type: 'CALL_PATCH_DISCARD'; requestId: string; planId: string }
	| { type: 'DEQUEUE_NEXT'; envelope: UiRequestEnvelope };
