export type OpenAIRequestParams = {
	apiKey: string;
	inputText: string;
};

function extractOutputText(payload: unknown): string | undefined {
	if (!payload || typeof payload !== 'object') {
		return undefined;
	}
	const data = payload as { output_text?: string; output?: unknown[] };
	if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
		return data.output_text.trim();
	}
	if (Array.isArray(data.output)) {
		for (const item of data.output) {
			const outputItem = item as { content?: Array<{ type?: string; text?: string }> };
			if (!Array.isArray(outputItem.content)) {
				continue;
			}
			const textPart = outputItem.content.find((part) => part.type === 'output_text' && typeof part.text === 'string');
			if (textPart && typeof textPart.text === 'string' && textPart.text.trim().length > 0) {
				return textPart.text.trim();
			}
		}
	}
	return undefined;
}

function shortErrorMessage(payload: unknown): string {
	if (!payload || typeof payload !== 'object') {
		return 'Unexpected error.';
	}
	const data = payload as { error?: { message?: string } };
	const message = data.error?.message;
	if (typeof message === 'string' && message.trim().length > 0) {
		return message.trim();
	}
	return 'Unexpected error.';
}

export async function callOpenAI(params: OpenAIRequestParams): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini',
			input: params.inputText,
			temperature: 0.2
		})
	});

	if (!response.ok) {
		const status = response.status;
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			payload = undefined;
		}

		if (status === 401 || status === 403) {
			throw new Error('INVALID_KEY');
		}
		if (status === 429) {
			throw new Error('RATE_LIMIT');
		}
		throw new Error(`OPENAI_ERROR:${status}:${shortErrorMessage(payload)}`);
	}

	const data = (await response.json()) as unknown;
	const outputText = extractOutputText(data);
	return outputText ?? 'No text output returned';
}