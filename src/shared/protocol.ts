import Ajv, { type ValidateFunction } from 'ajv/dist/2020';

export const PROTOCOL_VERSION = 1 as const;

export type UiRequestV1 =
	| {
		protocolVersion: 1;
		requestId: string;
		type: 'chat/send';
		payload: {
			text: string;
		};
	}
	| {
		protocolVersion: 1;
		requestId: string;
		type: 'patch/preview' | 'patch/apply' | 'patch/discard';
		payload: {
			planId: string;
		};
	};

export type UiRequestType = UiRequestV1['type'];

export type HostEventV1 =
	| {
		protocolVersion: 1;
		requestId: string;
		seq?: number;
		ts?: number;
		type: 'agent/status' | 'agent/final';
		payload: { text: string };
	}
	| {
		protocolVersion: 1;
		requestId: string;
		seq?: number;
		ts?: number;
		type: 'agent/error';
		payload: { code: string; message: string; details?: unknown };
	}
	| {
		protocolVersion: 1;
		requestId: string;
		seq?: number;
		ts?: number;
		type: 'patch/pending';
		payload: {
			planId: string;
			summary: string;
			targetFile?: string;
			actions: Array<'preview' | 'apply' | 'discard'>;
		};
	};

export type NormalizedIncoming = {
	request: UiRequestV1;
	legacy: boolean;
};

const requestSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['protocolVersion', 'requestId', 'type', 'payload'],
	properties: {
		protocolVersion: { const: 1 },
		requestId: { type: 'string', minLength: 1 },
		type: { type: 'string', enum: ['chat/send', 'patch/preview', 'patch/apply', 'patch/discard'] },
		payload: { type: 'object' }
	},
	oneOf: [
		{
			properties: {
				type: { const: 'chat/send' },
				payload: {
					type: 'object',
					additionalProperties: false,
					required: ['text'],
					properties: {
						text: { type: 'string', minLength: 1 }
					}
				}
			}
		},
		{
			properties: {
				type: { enum: ['patch/preview', 'patch/apply', 'patch/discard'] },
				payload: {
					type: 'object',
					additionalProperties: false,
					required: ['planId'],
					properties: {
						planId: { type: 'string', minLength: 1 }
					}
				}
			}
		}
	]
} as const;

const eventSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['protocolVersion', 'requestId', 'type', 'payload'],
	properties: {
		protocolVersion: { const: 1 },
		requestId: { type: 'string', minLength: 1 },
		seq: { type: 'number' },
		ts: { type: 'number' },
		type: { type: 'string', enum: ['agent/status', 'agent/final', 'agent/error', 'patch/pending'] },
		payload: { type: 'object' }
	},
	oneOf: [
		{
			properties: {
				type: { enum: ['agent/status', 'agent/final'] },
				payload: {
					type: 'object',
					additionalProperties: true,
					required: ['text'],
					properties: { text: { type: 'string' } }
				}
			}
		},
		{
			properties: {
				type: { const: 'agent/error' },
				payload: {
					type: 'object',
					additionalProperties: true,
					required: ['code', 'message'],
					properties: {
						code: { type: 'string' },
						message: { type: 'string' }
					}
				}
			}
		},
		{
			properties: {
				type: { const: 'patch/pending' },
				payload: {
					type: 'object',
					additionalProperties: false,
					required: ['planId', 'summary', 'actions'],
					properties: {
						planId: { type: 'string', minLength: 1 },
						summary: { type: 'string', minLength: 1 },
						targetFile: { type: 'string' },
						actions: {
							type: 'array',
							minItems: 1,
							items: { type: 'string', enum: ['preview', 'apply', 'discard'] }
						}
					}
				}
			}
		}
	]
} as const;

let requestValidator: ValidateFunction | undefined;
let eventValidator: ValidateFunction | undefined;

function getRequestValidator(): ValidateFunction {
	if (!requestValidator) {
		const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
		requestValidator = ajv.compile(requestSchema);
	}
	return requestValidator;
}

function getEventValidator(): ValidateFunction {
	if (!eventValidator) {
		const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
		eventValidator = ajv.compile(eventSchema);
	}
	return eventValidator;
}

export function makeRequestId(): string {
	return `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function parseIncomingMessage(raw: unknown):
	| { ok: true; value: NormalizedIncoming }
	| { ok: false; error: string; requestId: string } {
	if (raw && typeof raw === 'object') {
		const anyRaw = raw as { protocolVersion?: number; requestId?: string; type?: string; payload?: unknown };
		if (anyRaw.protocolVersion === 1) {
			const validator = getRequestValidator();
			const valid = validator(raw);
			if (valid) {
				return { ok: true, value: { request: raw as UiRequestV1, legacy: false } };
			}
			const reqId = typeof anyRaw.requestId === 'string' && anyRaw.requestId.length > 0
				? anyRaw.requestId
				: makeRequestId();
			const error = validator.errors?.map((err) => `${err.instancePath} ${err.message}`.trim()).join('; ')
				?? 'Invalid message.';
			return { ok: false, error, requestId: reqId };
		}

		const legacy = raw as { type?: string; text?: string };
		if (legacy.type === 'userMessage' && typeof legacy.text === 'string') {
			const request: UiRequestV1 = {
				protocolVersion: 1,
				requestId: makeRequestId(),
				type: 'chat/send',
				payload: { text: legacy.text }
			};
			return { ok: true, value: { request, legacy: true } };
		}
	}

	return { ok: false, error: 'Invalid message format.', requestId: makeRequestId() };
}

type HostEventInput = Omit<HostEventV1, 'protocolVersion' | 'ts'> & {
	protocolVersion?: 1;
	ts?: number;
};

export function makeEvent(params: HostEventInput): HostEventV1 {
	const event: HostEventV1 = {
		...(params as HostEventV1),
		protocolVersion: 1,
		ts: params.ts ?? Date.now()
	};
	const validator = getEventValidator();
	if (!validator(event)) {
		// Do not throw; return event anyway to avoid breaking host.
	}
	return event;
}
