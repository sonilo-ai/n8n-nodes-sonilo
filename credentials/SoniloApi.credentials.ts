import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SoniloApi implements ICredentialType {
	name = 'soniloApi';

	displayName = 'Sonilo API';

	icon = { light: 'file:sonilo.svg', dark: 'file:sonilo.dark.svg' } as const;

	documentationUrl = 'https://docs.sonilo.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Your Sonilo API key. Sent as a Bearer token on every request.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.sonilo.com',
			url: '/v1/account/services',
			method: 'GET',
		},
	};
}
