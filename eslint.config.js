import config from '@adiwajshing/eslint-config'
import { defineConfig } from 'eslint/config'

export default defineConfig([
	{
		files: [
			'packages/**/*.ts',
			'scripts/*.ts',
		],
	},
	{
		ignores: [
			'**/lib/**',
			'**/lib',
			// plain JavaScript and Node test files are outside the TypeScript project
			'**/*.js',
			'**/*.mjs',
			'**/*.cjs',
			'**/dist',
			'**/cjs',
			'**/node_modules',
			'**/*.gen.ts',
			'**/*.min.js',
			'**/vendor',
			// scaffold templates copied verbatim by scaffold_reclaim_demo_server;
			// server.js has __PROVIDER_ID__ substitution tokens
			'packages/agent/samples/**',
		],
	},
	{
		extends: config,
	},
	{
		rules: {
			camelcase: 'off',
		},
	},
])
