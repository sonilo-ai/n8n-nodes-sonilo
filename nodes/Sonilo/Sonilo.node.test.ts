import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { Sonilo } from './Sonilo.node';

/**
 * These tests drive the node's execute() method end-to-end with a mocked
 * HTTP layer — no live Sonilo API key is available in this environment, so
 * nothing here talks to api.sonilo.com. They exist to lock in the corrected
 * request contract: multipart/form-data bodies, `mode`/`output_format`
 * restricted to the music operations, `audio_format` (not `output_format`)
 * on the SFX operations, and JSON-encoded `segments`.
 */

function formDataToObject(formData: FormData): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of formData.entries()) {
		result[key] = value as string;
	}
	return result;
}

function createExecuteContext(
	params: Record<string, unknown>,
	httpRequestWithAuthentication: ReturnType<typeof vi.fn>,
) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		continueOnFail: () => false,
		getNode: () => ({ name: 'Sonilo', type: 'n8n-nodes-sonilo.sonilo' }),
		helpers: {
			httpRequestWithAuthentication,
		},
	} as unknown as IExecuteFunctions;
}

describe('Sonilo.execute', () => {
	it('sends mode + output_format (not audio_format) for Text to Music', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			id: 'gen_1',
			status: 'succeeded',
			music: [{ url: 'https://cdn.sonilo.com/gen_1.wav' }],
		});
		const context = createExecuteContext(
			{
				operation: 'textToMusic',
				prompt: 'lofi beat',
				duration: 30,
				additionalFields: { mode: 'stream', outputFormat: 'wav' },
				waitForCompletion: true,
			},
			httpRequestWithAuthentication,
		);

		const node = new Sonilo();
		await node.execute.call(context);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(options.url).toBe('https://api.sonilo.com/v1/text-to-music');
		expect(options.body).toBeInstanceOf(FormData);
		expect(formDataToObject(options.body as FormData)).toEqual({
			prompt: 'lofi beat',
			duration: '30',
			mode: 'stream',
			output_format: 'wav',
		});
	});

	it('defaults Text to Music mode to "async" when Additional Fields is empty', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_1',
			status: 'processing',
		});
		const context = createExecuteContext(
			{
				operation: 'textToMusic',
				prompt: 'lofi beat',
				duration: 30,
				additionalFields: {},
				waitForCompletion: false,
			},
			httpRequestWithAuthentication,
		);

		await new Sonilo().execute.call(context);

		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(formDataToObject(options.body as FormData)).toEqual({
			prompt: 'lofi beat',
			duration: '30',
			mode: 'async',
		});
	});

	it('sends audio_format (not output_format or mode) for Text to Sound Effects', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_2',
			status: 'processing',
		});
		const context = createExecuteContext(
			{
				operation: 'textToSfx',
				prompt: 'door creak',
				duration: 5,
				additionalFields: { audioFormat: 'mp3' },
				waitForCompletion: false,
			},
			httpRequestWithAuthentication,
		);

		await new Sonilo().execute.call(context);

		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		const sentFields = formDataToObject(options.body as FormData);
		expect(sentFields).toEqual({
			prompt: 'door creak',
			duration: '5',
			audio_format: 'mp3',
		});
		expect(sentFields.mode).toBeUndefined();
		expect(sentFields.output_format).toBeUndefined();
	});

	it('JSON-encodes segments into a single form field for Video to Sound Effects', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			task_id: 'task_3',
			status: 'processing',
		});
		const context = createExecuteContext(
			{
				operation: 'videoToSfx',
				prompt: '',
				videoUrl: 'https://example.com/clip.mp4',
				segments: {
					segment: [
						{ start: 0, end: 2, prompt: 'footsteps' },
						{ start: 2, end: 4 },
					],
				},
				additionalFields: {},
				waitForCompletion: false,
			},
			httpRequestWithAuthentication,
		);

		await new Sonilo().execute.call(context);

		const [, options] = httpRequestWithAuthentication.mock.calls[0];
		const sentFields = formDataToObject(options.body as FormData);
		expect(sentFields.video_url).toBe('https://example.com/clip.mp4');
		expect(typeof sentFields.segments).toBe('string');
		expect(JSON.parse(sentFields.segments)).toEqual([
			{ start: 0, end: 2, prompt: 'footsteps' },
			{ start: 2, end: 4 },
		]);
	});

	it('polls until "succeeded" and returns the finished task', async () => {
		const httpRequestWithAuthentication = vi
			.fn()
			// POST /v1/text-to-sfx
			.mockResolvedValueOnce({ task_id: 'task_4', status: 'processing' })
			// GET /v1/tasks/task_4
			.mockResolvedValueOnce({
				task_id: 'task_4',
				status: 'succeeded',
				sfx: [{ url: 'https://cdn.sonilo.com/task_4.wav' }],
			});
		const context = createExecuteContext(
			{
				operation: 'textToSfx',
				prompt: 'door creak',
				duration: 5,
				additionalFields: {},
				waitForCompletion: true,
				pollInterval: 0,
				pollTimeout: 5,
			},
			httpRequestWithAuthentication,
		);

		const result = await new Sonilo().execute.call(context);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		expect(result[0][0].json.status).toBe('succeeded');
	});
});
