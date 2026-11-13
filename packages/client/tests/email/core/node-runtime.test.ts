
import {
	assertSupportedNodeVersion,
	isSupportedNodeVersion,
} from '../../../src/email/lib/node-runtime.ts'
import { describe, expect, it } from './vitest-compat.ts'

describe('required Node.js runtime', () => {
	it.each(['20.18.0', '22.18.0'])(
		'rejects %s with upgrade instructions before starting the server',
		(version) => {
			expect(isSupportedNodeVersion(version)).toBe(false)
			expect(() => assertSupportedNodeVersion(version)).toThrow(
				`Node.js ${version} is unsupported.`,
			)
			expect(() => assertSupportedNodeVersion(version)).toThrow('nvm use')
		},
	)
	it.each(['22.19.0', '22.23.3', '24.0.0'])(
		'accepts the supported runtime %s',
		(version) => {
			expect(isSupportedNodeVersion(version)).toBe(true)
			expect(() => assertSupportedNodeVersion(version)).not.toThrow()
		},
	)
})
