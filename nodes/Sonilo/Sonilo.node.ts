import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { isTaskResponse, soniloApiRequest, waitForSoniloTask } from './GenericFunctions';

export class Sonilo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sonilo',
		name: 'sonilo',
		icon: { light: 'file:sonilo.svg', dark: 'file:sonilo.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate licensed music and sound effects with the Sonilo API',
		defaults: {
			name: 'Sonilo',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'soniloApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Music', value: 'music' },
					{ name: 'Sound Effect', value: 'soundEffects' },
				],
				default: 'music',
			},

			// ---------- Music operations ----------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
				options: [
					{
						name: 'Text to Music',
						value: 'textToMusic',
						description: 'Generate music from a text prompt',
						action: 'Generate music from a text prompt',
					},
					{
						name: 'Video to Music',
						value: 'videoToMusic',
						description: 'Generate a soundtrack aligned to a video',
						action: 'Generate a soundtrack aligned to a video',
					},
				],
				default: 'textToMusic',
			},

			// ---------- Sound effects operations ----------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['soundEffects'],
					},
				},
				options: [
					{
						name: 'Text to Sound Effects',
						value: 'textToSfx',
						description: 'Generate sound effects from a text prompt',
						action: 'Generate sound effects from a text prompt',
					},
					{
						name: 'Video to Sound Effects',
						value: 'videoToSfx',
						description: 'Generate frame-accurate sound effects aligned to a video',
						action: 'Generate sound effects from a video',
					},
				],
				default: 'textToSfx',
			},

			// ---------- Shared: Prompt (required for text operations, optional for video) ----------
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['textToMusic', 'textToSfx'],
					},
				},
				description: 'Text description of the music or sound effect to generate',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['videoToMusic', 'videoToSfx'],
					},
				},
				description:
					'Optional creative direction for the generation. Sonilo analyzes the video even without a prompt.',
			},

			// ---------- Text to Music: Duration ----------
			{
				displayName: 'Duration (Seconds)',
				name: 'duration',
				type: 'number',
				typeOptions: {
					minValue: 5,
					maxValue: 360,
				},
				default: 30,
				required: true,
				displayOptions: {
					show: {
						operation: ['textToMusic'],
					},
				},
				description: 'Desired output duration in seconds (5–360)',
			},

			// ---------- Text to Sound Effects: Duration ----------
			{
				displayName: 'Duration (Seconds)',
				name: 'duration',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 180,
				},
				default: 10,
				required: true,
				displayOptions: {
					show: {
						operation: ['textToSfx'],
					},
				},
				description: 'Desired output duration in seconds (1–180)',
			},

			// ---------- Video operations: Video URL ----------
			{
				displayName: 'Video URL',
				name: 'videoUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/my-video.mp4',
				displayOptions: {
					show: {
						operation: ['videoToMusic', 'videoToSfx'],
					},
				},
				description:
					'Public or signed URL of the source video. Uploading a binary video file directly ' +
					'is not supported by this node yet — provide a URL the Sonilo API can fetch.',
			},

			// ---------- Video operations: Segments ----------
			{
				displayName: 'Segments',
				name: 'segments',
				type: 'fixedCollection',
				placeholder: 'Add Segment',
				default: {},
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						operation: ['videoToMusic', 'videoToSfx'],
					},
				},
				description:
					'Optional per-section timing and prompts for the generation. Sent to the API as a ' +
					'single JSON-encoded "segments" form field.',
				options: [
					{
						displayName: 'Segment',
						name: 'segment',
						values: [
							{
								displayName: 'Start (Seconds)',
								name: 'start',
								type: 'number',
								default: 0,
								description: 'Segment start time in seconds',
							},
							{
								displayName: 'End (Seconds)',
								name: 'end',
								type: 'number',
								default: 0,
								description: 'Segment end time in seconds',
							},
							{
								displayName: 'Prompt',
								name: 'prompt',
								type: 'string',
								default: '',
								description: 'Optional prompt for this segment',
							},
						],
					},
				],
			},

			// ---------- Additional Fields: Music operations ----------
			// `mode` and `output_format` are only accepted by the music endpoints.
			// The SFX endpoints are unconditionally async and have no `mode` field,
			// and use a differently-named/valued `audio_format` field instead
			// (see the Sound Effect operations block below).
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['textToMusic', 'videoToMusic'],
					},
				},
				options: [
					{
						displayName: 'Mode',
						name: 'mode',
						type: 'options',
						options: [
							{
								name: 'Async (Recommended)',
								value: 'async',
								description:
									'The API immediately returns a task ID; this node polls it until the ' +
									'generation finishes. Recommended so long generations do not hold the ' +
									'HTTP connection open. Required if Output Format is set to WAV.',
							},
							{
								name: 'Stream',
								value: 'stream',
								description:
									'The API holds the connection open and streams the finished result back ' +
									'directly. This is the Sonilo API default. Does not support WAV output.',
							},
						],
						default: 'async',
						description: 'Whether the API should respond synchronously (stream) or as an async task',
					},
					{
						displayName: 'Output Format',
						name: 'outputFormat',
						type: 'options',
						options: [
							{ name: 'M4A', value: 'm4a' },
							{ name: 'WAV', value: 'wav' },
						],
						default: 'm4a',
						description:
							'Audio container for the generated output. WAV requires Mode to be set to Async ' +
							'— the API rejects WAV requests made with Mode = Stream.',
					},
				],
			},

			// ---------- Additional Fields: Sound Effect operations ----------
			// No `mode` field here — text-to-sfx and video-to-sfx are always async
			// and always return { task_id, status: "processing" }.
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['textToSfx', 'videoToSfx'],
					},
				},
				options: [
					{
						displayName: 'Audio Format',
						name: 'audioFormat',
						type: 'options',
						options: [
							{ name: 'WAV', value: 'wav' },
							{ name: 'MP3', value: 'mp3' },
							{ name: 'AAC', value: 'aac' },
							{ name: 'FLAC', value: 'flac' },
						],
						default: 'wav',
						description:
							'Audio container/codec for the generated output. Optional — leave the field out ' +
							'of the request entirely by not adding it here, which uses the Sonilo default.',
					},
				],
			},

			// ---------- Polling behavior ----------
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['textToMusic', 'videoToMusic', 'textToSfx', 'videoToSfx'],
					},
				},
				description:
					'Whether to poll GET /v1/tasks/{task_id} until the generation finishes when the API ' +
					'returns an async task, instead of returning the task ID immediately',
			},
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollInterval',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 5,
				displayOptions: {
					show: {
						operation: ['textToMusic', 'videoToMusic', 'textToSfx', 'videoToSfx'],
						waitForCompletion: [true],
					},
				},
				description: 'How often to check task status while waiting',
			},
			{
				displayName: 'Poll Timeout (Seconds)',
				name: 'pollTimeout',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 600,
				displayOptions: {
					show: {
						operation: ['textToMusic', 'videoToMusic', 'textToSfx', 'videoToSfx'],
						waitForCompletion: [true],
					},
				},
				description:
					'Maximum time to wait for the generation to finish before the node throws a timeout error. ' +
					'The task keeps running on Sonilo\'s side even if this is exceeded.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const endpointByOperation: Record<string, string> = {
			textToMusic: '/v1/text-to-music',
			videoToMusic: '/v1/video-to-music',
			textToSfx: '/v1/text-to-sfx',
			videoToSfx: '/v1/video-to-sfx',
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const endpoint = endpointByOperation[operation];

				if (!endpoint) {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex: i,
					});
				}

				const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
				const waitForCompletion = this.getNodeParameter('waitForCompletion', i, true) as boolean;

				const body: IDataObject = {};

				const prompt = this.getNodeParameter('prompt', i, '') as string;
				if (prompt) {
					body.prompt = prompt;
				}

				if (operation === 'textToMusic' || operation === 'textToSfx') {
					const duration = this.getNodeParameter('duration', i, undefined) as number | undefined;
					if (duration !== undefined && duration !== null) {
						body.duration = duration;
					}
				}

				if (operation === 'videoToMusic' || operation === 'videoToSfx') {
					body.video_url = this.getNodeParameter('videoUrl', i) as string;

					const segmentsCollection = this.getNodeParameter('segments', i, {}) as {
						segment?: Array<{ start: number; end: number; prompt?: string }>;
					};
					if (segmentsCollection.segment?.length) {
						// The API declares `segments` as a Form(...) field, so it can only
						// ever be a string — the array must be JSON-encoded before it goes
						// into the multipart body.
						const segments = segmentsCollection.segment.map((segment) => {
							const entry: IDataObject = { start: segment.start, end: segment.end };
							if (segment.prompt) {
								entry.prompt = segment.prompt;
							}
							return entry;
						});
						body.segments = JSON.stringify(segments);
					}
				}

				if (operation === 'textToMusic' || operation === 'videoToMusic') {
					// `mode` and `output_format` only exist on the music endpoints.
					// Default to async so a long generation never holds the HTTP
					// connection open; users can opt into "stream" via Additional Fields.
					body.mode = (additionalFields.mode as string | undefined) ?? 'async';
					if (additionalFields.outputFormat) {
						body.output_format = additionalFields.outputFormat;
					}
				} else {
					// text-to-sfx / video-to-sfx: no `mode` field exists — these
					// endpoints are unconditionally async. `audio_format` is a
					// separate, differently-valued field from the music endpoints'
					// `output_format`.
					if (additionalFields.audioFormat) {
						body.audio_format = additionalFields.audioFormat;
					}
				}

				let responseData = await soniloApiRequest.call(this, 'POST', endpoint, body);

				if (isTaskResponse(responseData) && waitForCompletion) {
					const pollInterval = this.getNodeParameter('pollInterval', i, 5) as number;
					const pollTimeout = this.getNodeParameter('pollTimeout', i, 600) as number;
					responseData = await waitForSoniloTask.call(
						this,
						responseData.task_id as string,
						i,
						pollInterval,
						pollTimeout,
					);
				}

				returnData.push({
					json: responseData,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}

				// soniloApiRequest()/waitForSoniloTask() already throw NodeApiError /
				// NodeOperationError; wrapping again here just attaches itemIndex so
				// n8n's UI can point at the failing input item.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
