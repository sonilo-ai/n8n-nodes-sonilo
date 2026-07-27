import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { isTaskResponse, soniloApiRequest, waitForSoniloTask } from './GenericFunctions';

/**
 * These tests mock every HTTP call — there is no live Sonilo API key in this
 * environment, so nothing here talks to api.sonilo.com. They only verify the
 * request shape this node sends and the polling/error-handling logic around
 * GET /v1/tasks/{task_id}.
 */

function createMockContext(httpRequestWithAuthentication: ReturnType<typeof vi.fn>) {
	return {
		helpers: {
			httpRequestWithAuthentication,
		},
		getNode: () => ({ name: 'Sonilo', type: 'n8n-nodes-sonilo.sonilo' }),
	} as unknown as IExecuteFunctions;
}

describe('isTaskResponse', () => {
	it('returns true when the response has a string task_id', () => {
		expect(isTaskResponse({ task_id: 'task_123', status: 'queued' })).toBe(true);
	});

	it('returns false for an immediate generation result', () => {
		expect(isTaskResponse({ id: 'gen_123', status: 'completed', audio_url: 'https://x' })).toBe(
			false,
		);
	});

	it('returns false when task_id is missing', () => {
		expect(isTaskResponse({ status: 'completed' })).toBe(false);
	});
});

describe('soniloApiRequest', () => {
	it('sends an authenticated JSON request to the correct URL', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
		const context = createMockContext(httpRequestWithAuthentication);

		const result = await soniloApiRequest.call(
			context,
			'POST',
			'/v1/text-to-music',
			{ prompt: 'lofi beat', duration: 30, mode: 'async' },
		);

		expect(result).toEqual({ ok: true });
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [credentialType, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(credentialType).toBe('soniloApi');
		expect(options).toMatchObject({
			method: 'POST',
			url: 'https://api.sonilo.com/v1/text-to-music',
			json: true,
			body: { prompt: 'lofi beat', duration: 30, mode: 'async' },
		});
	});

	it('omits an empty body instead of sending {}', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ status: 'completed' });
		const context = createMockContext(httpRequestWithAuthentication);

		await soniloApiRequest.call(context, 'GET', '/v1/tasks/task_123');

		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(options.body).toBeUndefined();
	});

	it('wraps a failed request in a NodeApiError', async () => {
		const httpRequestWithAuthentication = vi.fn().mockRejectedValue(
			Object.assign(new Error('Unauthorized'), { httpCode: 401 }),
		);
		const context = createMockContext(httpRequestWithAuthentication);

		await expect(soniloApiRequest.call(context, 'GET', '/v1/tasks/task_123')).rejects.toThrow();
	});
});

describe('waitForSoniloTask', () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it('returns the task once it reaches "completed"', async () => {
		const httpRequestWithAuthentication = vi
			.fn()
			.mockResolvedValueOnce({ task_id: 'task_1', status: 'running', progress: 0.4 })
			.mockResolvedValueOnce({
				task_id: 'task_1',
				status: 'completed',
				result: { audio_url: 'https://cdn.sonilo.com/task_1.mp3' },
			});
		const context = createMockContext(httpRequestWithAuthentication);

		const result = await waitForSoniloTask.call(context, 'task_1', 0, /* pollInterval */ 0, 5);

		expect(result.status).toBe('completed');
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('throws when the task ends with status "failed"', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_2',
			status: 'failed',
			error: { message: 'generation failed' },
		});
		const context = createMockContext(httpRequestWithAuthentication);

		await expect(
			waitForSoniloTask.call(context, 'task_2', 0, 0, 5),
		).rejects.toThrow(/failed/);
	});

	it('throws a timeout error if the task never reaches a terminal status', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_3',
			status: 'running',
		});
		const context = createMockContext(httpRequestWithAuthentication);

		await expect(
			waitForSoniloTask.call(context, 'task_3', 0, /* pollInterval */ 1, /* timeout */ 0),
		).rejects.toThrow(/did not complete/);
	});
});
