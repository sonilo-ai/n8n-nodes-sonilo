import { config } from '@n8n/node-cli/eslint';

export default [
	// Unit tests use vitest (a devDependency, never bundled into the published
	// package - see "files": ["dist"] in package.json) and are excluded from
	// the community-nodes cloud-compatibility lint rules that would otherwise
	// flag that import as a disallowed runtime dependency.
	{ ignores: ['**/*.test.ts', 'vitest.config.ts'] },
	...config,
];
