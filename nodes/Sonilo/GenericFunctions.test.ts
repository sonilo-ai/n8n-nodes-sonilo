import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { isTaskResponse, soniloApiRequest, waitForSoniloTask } from './GenericFunctions';

/**
 * These tests mock every HTTP call — there is no live Sonilo API key in this
 * environment, so nothing here talks to api.sonilo.com. They only verify the
 * request shape this node sends (multipart/form-data, per the Sonilo API's
 * FastAPI Form(...) route signatures) and the polling/error-handling logic
 * around GET /v1/tasks/{task_id} (status: "processing" | "succeeded" |
 * "failed").
 */

function createMockContext(httpRequestWithAuthentication: ReturnType<typeof vi.fn>) {
	return {
		helpers: {
			httpRequestWithAuthentication,
		},
		getNode: () => ({ name: 'Sonilo', type: 'n8n-nodes-sonilo.sonilo' }),
	} as unknown as IExecuteFunctions;
}

/** Reads every field out of a FormData instance as plain strings, for assertions. */
function formDataToObject(formData: FormData): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of formData.entries()) {
		result[key] = value as string;
	}
	return result;
}

describe('isTaskResponse', () => {
	it('returns true when the response has a string task_id', () => {
		expect(isTaskResponse({ task_id: 'task_123', status: 'processing' })).toBe(true);
	});

	it('returns false for an immediate generation result', () => {
		expect(
			isTaskResponse({ id: 'gen_123', status: 'succeeded', audio_url: 'https://x' }),
		).toBe(false);
	});

	it('returns false when task_id is missing', () => {
		expect(isTaskResponse({ status: 'succeeded' })).toBe(false);
	});
});

describe('soniloApiRequest', () => {
	it('sends an authenticated multipart/form-data request to the correct URL', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
		const context = createMockContext(httpRequestWithAuthentication);

		const result = await soniloApiRequest.call(context, 'POST', '/v1/text-to-music', {
			prompt: 'lofi beat',
			duration: 30,
			mode: 'async',
		});

		expect(result).toEqual({ ok: true });
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [credentialType, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(credentialType).toBe('soniloApi');
		expect(options.method).toBe('POST');
		expect(options.url).toBe('https://api.sonilo.com/v1/text-to-music');
		expect(options.body).toBeInstanceOf(FormData);
		expect(formDataToObject(options.body as FormData)).toEqual({
			prompt: 'lofi beat',
			duration: '30',
			mode: 'async',
		});
	});

	it('encodes boolean fields as "true"/"false" strings in the form body', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
		const context = createMockContext(httpRequestWithAuthentication);

		await soniloApiRequest.call(context, 'POST', '/v1/video-to-music', {
			video_url: 'https://example.com/clip.mp4',
			preserve_speech: true,
			isolate_vocals: false,
		});

		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(formDataToObject(options.body as FormData)).toEqual({
			video_url: 'https://example.com/clip.mp4',
			preserve_speech: 'true',
			isolate_vocals: 'false',
		});
	});

	it('omits an empty body instead of sending an empty FormData', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ status: 'succeeded' });
		const context = createMockContext(httpRequestWithAuthentication);

		await soniloApiRequest.call(context, 'GET', '/v1/tasks/task_123');

		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(options.body).toBeUndefined();
	});

	it('wraps a failed request in a NodeApiError', async () => {
		const httpRequestWithAuthentication = vi
			.fn()
			.mockRejectedValue(Object.assign(new Error('Unauthorized'), { httpCode: 401 }));
		const context = createMockContext(httpRequestWithAuthentication);

		await expect(soniloApiRequest.call(context, 'GET', '/v1/tasks/task_123')).rejects.toThrow();
	});
});

describe('waitForSoniloTask', () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it('returns the task once it reaches "succeeded"', async () => {
		const httpRequestWithAuthentication = vi
			.fn()
			.mockResolvedValueOnce({ task_id: 'task_1', status: 'processing' })
			.mockResolvedValueOnce({
				task_id: 'task_1',
				status: 'succeeded',
				music: [{ url: 'https://cdn.sonilo.com/task_1.m4a', content_type: 'audio/mp4' }],
			});
		const context = createMockContext(httpRequestWithAuthentication);

		const result = await waitForSoniloTask.call(context, 'task_1', 0, /* pollInterval */ 0, 5);

		expect(result.status).toBe('succeeded');
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('throws when the task ends with status "failed"', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_2',
			status: 'failed',
			error: { code: 'generation_error', message: 'generation failed' },
			refunded: true,
		});
		const context = createMockContext(httpRequestWithAuthentication);

		await expect(waitForSoniloTask.call(context, 'task_2', 0, 0, 5)).rejects.toThrow(/failed/);
	});

	it('throws a timeout error if the task never reaches a terminal status', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_3',
			status: 'processing',
		});
		const context = createMockContext(httpRequestWithAuthentication);

		await expect(
			waitForSoniloTask.call(context, 'task_3', 0, /* pollInterval */ 1, /* timeout */ 0),
		).rejects.toThrow(/did not complete/);
	});
});
