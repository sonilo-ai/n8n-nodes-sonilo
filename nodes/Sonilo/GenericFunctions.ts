import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const BASE_URL = 'https://api.sonilo.com';

/** Terminal states for an async task, per GET /v1/tasks/{task_id}. */
const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'canceled'];

/**
 * Performs an authenticated request against the Sonilo API.
 * Every request is sent as JSON, which all documented Sonilo endpoints accept.
 */
export async function soniloApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject> {
	const options = {
		method,
		body: Object.keys(body).length ? body : undefined,
		qs: Object.keys(qs).length ? qs : undefined,
		url: `${BASE_URL}${endpoint}`,
		json: true,
	};

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'soniloApi',
			options,
		)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * A generation call either returns a finished result immediately, or a
 * `{ task_id, status }` acknowledgement that must be polled via
 * GET /v1/tasks/{task_id}. This checks for the latter shape.
 */
export function isTaskResponse(response: IDataObject): boolean {
	return typeof response.task_id === 'string';
}

/**
 * Polls GET /v1/tasks/{task_id} until the task reaches a terminal status
 * (`completed`, `failed`, or `canceled`), or the timeout elapses.
 *
 * Throws a NodeOperationError if the task fails, is canceled, or does not
 * complete within `timeoutSeconds`.
 */
export async function waitForSoniloTask(
	this: IExecuteFunctions,
	taskId: string,
	itemIndex: number,
	pollIntervalSeconds: number,
	timeoutSeconds: number,
): Promise<IDataObject> {
	// Callers get validation for free from the node UI (minValue: 1 on both
	// parameters); values are only clamped here to stay non-negative in case
	// this is invoked programmatically.
	const pollIntervalMs = Math.max(0, pollIntervalSeconds) * 1000;
	const deadline = Date.now() + Math.max(0, timeoutSeconds) * 1000;

	for (;;) {
		const task = await soniloApiRequest.call(this, 'GET', `/v1/tasks/${encodeURIComponent(taskId)}`);
		const status = task.status as string | undefined;

		if (status && TERMINAL_TASK_STATUSES.includes(status)) {
			if (status === 'completed') {
				return task;
			}

			const errorDetail =
				typeof task.error === 'object' && task.error !== null
					? JSON.stringify(task.error)
					: (task.error as string | undefined);

			throw new NodeOperationError(
				this.getNode(),
				`Sonilo task ${taskId} ended with status "${status}"${
					errorDetail ? `: ${errorDetail}` : ''
				}`,
				{ itemIndex },
			);
		}

		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`Sonilo task ${taskId} did not complete within ${timeoutSeconds} seconds ` +
					`(last known status: "${status ?? 'unknown'}"). It may still finish later — ` +
					'check it manually via GET /v1/tasks/{task_id}, or increase "Poll Timeout".',
				{ itemIndex },
			);
		}

		await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
	}
}
