/**
 * The small part of Vitest's `expect`, `vi.fn`, and `it.each` API that the
 * email core's tests use, on top of `node:test` and `node:assert`. It lets the
 * ported core tests keep the core's test bodies, so they can be compared with
 * the upstream suite line by line.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as nodeTest from 'node:test'
import { inspect, promisify } from 'node:util'

type TestFn = (...args: never[]) => unknown
type Options = nodeTest.TestOptions
// Vitest's `vi.fn` and `it.each` callbacks take untyped arguments; the core's
// tests rely on that, so these two aliases keep `any` on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

/**
 * Why this host can't run the core's document sandbox, or false when it can.
 * The sandbox needs Linux, Bubblewrap at /usr/bin/bwrap (or
 * EMAIL_DOCUMENT_BWRAP), /usr/bin/prlimit, and unprivileged user namespaces.
 */
export const sandboxSkip = await sandboxUnavailable()

export const describe = withEach(
	(name, options, fn) => nodeTest.describe(name, options, () => {
		void fn()
	}),
	false,
)
export const it = withEach(
	(name, options, fn) => nodeTest.it(name, options, async(t) => {
		await fn(t)
	}),
	true,
)
export const test = it
/** Set while a `beforeAll` hook couldn't start the sandbox. */
let suiteNeedsSandbox = false

export const { beforeEach, afterEach } = nodeTest

export function beforeAll(fn: () => unknown) {
	nodeTest.before(async() => {
		try {
			await fn()
		} catch(error) {
			if(!isSandboxFailure(error)) {
				throw error
			}

			suiteNeedsSandbox = true
		}
	})
}

export function afterAll(fn: () => unknown) {
	nodeTest.after(async() => {
		if(suiteNeedsSandbox) {
			suiteNeedsSandbox = false
			return
		}

		await fn()
	})
}

function isSandboxFailure(error: unknown) {
	return !!sandboxSkip
		&& inspect(error).includes('DOCUMENT_ISOLATION_UNAVAILABLE')
}

class Asymmetric {
	readonly match: (value: unknown) => boolean
	readonly label: string

	constructor(label: string, match: (value: unknown) => boolean) {
		this.label = label
		this.match = match
	}

	[inspect.custom]() {
		return this.label
	}
}

export type Mock<T extends AnyFn = AnyFn> = T & {
	mock: { calls: Parameters<T>[] }
}

export const vi = {
	fn<T extends AnyFn = AnyFn>(impl?: T): Mock<T> {
		const mock: { calls: Parameters<T>[] } = { calls: [] }
		const fn = (...args: Parameters<T>): ReturnType<T> => {
			mock.calls.push(args)
			// A mock without an implementation returns undefined, as in Vitest.
			return impl?.(...args)
		}

		// `fn` forwards every call to `impl`, so it has `impl`'s signature.
		return Object.assign(fn as T, { mock })
	},
}

/** `message` labels a failure, as in Vitest. */
export function expect(actual: unknown, message?: string): Matchers {
	return matchers(actual, false, message)
}

expect.any = (type: unknown) => new Asymmetric(
	`Any<${typeName(type)}>`,
	(value) => isInstance(value, type),
)
expect.objectContaining = (expected: Record<string, unknown>) => new Asymmetric(
	`ObjectContaining ${inspect(expected)}`,
	(value) => matchesObject(value, expected),
)
expect.arrayContaining = (expected: unknown[]) => new Asymmetric(
	`ArrayContaining ${inspect(expected)}`,
	(value) => Array.isArray(value)
		&& expected.every((item) => value.some((v) => equals(v, item))),
)
expect.stringContaining = (expected: string) => new Asymmetric(
	`StringContaining ${inspect(expected)}`,
	(value) => typeof value === 'string' && value.includes(expected),
)
expect.stringMatching = (expected: string | RegExp) => new Asymmetric(
	`StringMatching ${inspect(expected)}`,
	(value) => typeof value === 'string' && new RegExp(expected).test(value),
)
expect.unreachable = (message = 'expected to be unreachable') => {
	assert.fail(message)
}

export interface Matchers {
	toBe(expected: unknown): void
	toEqual(expected: unknown): void
	toStrictEqual(expected: unknown): void
	toMatchObject(expected: unknown): void
	toContain(expected: unknown): void
	toContainEqual(expected: unknown): void
	toHaveLength(expected: number): void
	toHaveProperty(path: string | string[], ...value: unknown[]): void
	toBeUndefined(): void
	toBeDefined(): void
	toBeNull(): void
	toBeTruthy(): void
	toBeFalsy(): void
	toBeInstanceOf(type: unknown): void
	toBeGreaterThan(expected: number): void
	toBeGreaterThanOrEqual(expected: number): void
	toBeLessThan(expected: number): void
	toBeLessThanOrEqual(expected: number): void
	toMatch(expected: string | RegExp): void
	toThrow(expected?: unknown): void
	toThrowError(expected?: unknown): void
	toHaveBeenCalled(): void
	toHaveBeenCalledTimes(expected: number): void
	toHaveBeenCalledWith(...expected: unknown[]): void
	not: Matchers
	rejects: AsyncMatchers
	resolves: AsyncMatchers
}

type SyncMatcher = Exclude<keyof Matchers, 'not' | 'rejects' | 'resolves'>
export type AsyncMatchers = {
	[K in SyncMatcher]: (...args: Parameters<Matchers[K]>) => Promise<void>
}

function matchers(
	actual: unknown,
	negate: boolean,
	label?: string,
): Matchers {
	const check = (pass: boolean, message: () => string) => {
		if(pass === negate) {
			const prefix = `${label ? `${label}: ` : ''}${negate ? 'not: ' : ''}`
			assert.fail(`${prefix}${message()}`)
		}
	}

	const show = (value: unknown) => inspect(value, { depth: 6 })
	const self = {
		toBe(expected: unknown) {
			check(
				Object.is(actual, expected),
				() => `expected ${show(actual)} to be ${show(expected)}`,
			)
		},
		toEqual(expected: unknown) {
			check(
				equals(actual, expected),
				() => `expected ${show(actual)} to equal ${show(expected)}`,
			)
		},
		toStrictEqual(expected: unknown) {
			self.toEqual(expected)
		},
		toMatchObject(expected: unknown) {
			check(
				matchesObject(actual, expected),
				() => `expected ${show(actual)} to match ${show(expected)}`,
			)
		},
		toContain(expected: unknown) {
			const pass = typeof actual === 'string'
				? typeof expected === 'string' && actual.includes(expected)
				: isIterable(actual) && [...actual].includes(expected)
			check(pass, () => `expected ${show(actual)} to contain ${show(expected)}`)
		},
		toContainEqual(expected: unknown) {
			check(
				isIterable(actual) && [...actual].some((v) => equals(v, expected)),
				() => `expected ${show(actual)} to contain ${show(expected)}`,
			)
		},
		toHaveLength(expected: number) {
			const length = (actual && typeof actual === 'object')
				|| typeof actual === 'string'
				? Reflect.get(Object(actual), 'length')
				: undefined
			check(
				length === expected,
				() => `expected length ${show(length)} to be ${expected}`,
			)
		},
		toHaveProperty(path: string | string[], ...value: unknown[]) {
			const keys = Array.isArray(path) ? path : path.split('.')
			let current = actual
			let found = true
			for(const key of keys) {
				if(current === null || current === undefined
					|| !(key in Object(current))) {
					found = false
					break
				}

				current = Reflect.get(Object(current), key)
			}

			check(
				found && (!value.length || equals(current, value[0])),
				() => `expected ${show(actual)} to have property ${keys.join('.')}`,
			)
		},
		toBeUndefined() {
			check(
				actual === undefined,
				() => `expected ${show(actual)} to be undefined`,
			)
		},
		toBeDefined() {
			check(actual !== undefined, () => 'expected a defined value')
		},
		toBeNull() {
			check(actual === null, () => `expected ${show(actual)} to be null`)
		},
		toBeTruthy() {
			check(!!actual, () => `expected ${show(actual)} to be truthy`)
		},
		toBeFalsy() {
			check(!actual, () => `expected ${show(actual)} to be falsy`)
		},
		toBeInstanceOf(type: unknown) {
			check(
				isInstance(actual, type),
				() => `expected ${show(actual)} to be an instance of ${typeName(type)}`,
			)
		},
		toBeGreaterThan(expected: number) {
			check(
				Number(actual) > expected,
				() => `expected ${show(actual)} > ${expected}`,
			)
		},
		toBeGreaterThanOrEqual(expected: number) {
			check(
				Number(actual) >= expected,
				() => `expected ${show(actual)} >= ${expected}`,
			)
		},
		toBeLessThan(expected: number) {
			check(
				Number(actual) < expected,
				() => `expected ${show(actual)} < ${expected}`,
			)
		},
		toBeLessThanOrEqual(expected: number) {
			check(
				Number(actual) <= expected,
				() => `expected ${show(actual)} <= ${expected}`,
			)
		},
		toMatch(expected: string | RegExp) {
			check(
				typeof actual === 'string' && (
					typeof expected === 'string'
						? actual.includes(expected)
						: expected.test(actual)
				),
				() => `expected ${show(actual)} to match ${show(expected)}`,
			)
		},
		toThrow(expected?: unknown) {
			assert.equal(typeof actual, 'function', 'toThrow needs a function')
			let thrown = false
			let error: unknown
			try {
				Reflect.apply(actual as TestFn, undefined, [])
			} catch(caught) {
				thrown = true
				error = caught
			}

			check(
				thrown && matchesError(error, expected),
				() => `expected a throw matching ${show(expected)}, got ${show(error)}`,
			)
		},
		toThrowError(expected?: unknown) {
			self.toThrow(expected)
		},
		toHaveBeenCalled() {
			check(calls(actual).length > 0, () => 'expected the mock to be called')
		},
		toHaveBeenCalledTimes(expected: number) {
			const count = calls(actual).length
			check(
				count === expected,
				() => `expected ${expected} calls, got ${count}`,
			)
		},
		toHaveBeenCalledWith(...expected: unknown[]) {
			check(
				calls(actual).some((args) => equals(args, expected)),
				() => `expected a call with ${show(expected)}`,
			)
		},
	}
	// Lazy getters: `Object.assign` would evaluate them, recursing forever.
	// The getters add the three chain properties `Matchers` declares.
	return Object.defineProperties(self as typeof self & Matchers, {
		not: { get: () => matchers(actual, !negate, label) },
		rejects: { get: () => settled(actual, true, negate) },
		resolves: { get: () => settled(actual, false, negate) },
	})
}

function settled(
	actual: unknown,
	rejects: boolean,
	negate: boolean,
): AsyncMatchers {
	const run = async() => {
		const promise = typeof actual === 'function'
			? Reflect.apply(actual as TestFn, undefined, [])
			: actual
		let value: unknown
		try {
			value = await promise
		} catch(error) {
			if(!rejects) {
				throw error
			}

			return error
		}

		assert.ok(!rejects, `expected a rejection, got ${inspect(value)}`)
		return value
	}

	return new Proxy({}, {
		get(_target, name: string) {
			return async(...args: unknown[]) => {
				const value = await run()
				const target = matchers(value, negate)
				if(name === 'toThrow' || name === 'toThrowError') {
					// `rejects.toThrow` matches the rejection reason as an error.
					const pass = matchesError(value, args[0])
					assert.ok(
						pass !== negate,
						`expected a rejection matching ${inspect(args[0])}`
							+ `, got ${inspect(value)}`,
					)
					return
				}

				Reflect.apply(Reflect.get(target, name), target, args)
			}
		},
	}) as AsyncMatchers // The proxy answers every matcher name.
}

function matchesError(error: unknown, expected: unknown) {
	if(expected === undefined) {
		return true
	}

	const message = error instanceof Error ? error.message : String(error)
	if(typeof expected === 'string') {
		return message.includes(expected)
	}

	if(expected instanceof RegExp) {
		return expected.test(message)
	}

	if(typeof expected === 'function') {
		return isInstance(error, expected)
	}

	if(expected instanceof Asymmetric) {
		return expected.match(error)
	}

	if(expected instanceof Error) {
		return message === expected.message
	}

	return matchesObject(error, expected)
}

function calls(value: unknown): unknown[][] {
	const mock = typeof value === 'function'
		? Reflect.get(value, 'mock')
		: undefined
	assert.ok(mock && Array.isArray(mock.calls), 'expected a vi.fn() mock')
	return mock.calls
}

function isIterable(value: unknown): value is Iterable<unknown> {
	return !!value && typeof value === 'object' && Symbol.iterator in value
}

function isInstance(value: unknown, type: unknown) {
	switch (type) {
		case String: return typeof value === 'string' || value instanceof String
		case Number: return typeof value === 'number' || value instanceof Number
		case Boolean: return typeof value === 'boolean' || value instanceof Boolean
		case Function: return typeof value === 'function'
		case Object: return value !== null && typeof value === 'object'
	}

	return typeof type === 'function' && value instanceof type
}

function typeName(type: unknown) {
	return typeof type === 'function' ? type.name : String(type)
}

/** Vitest's `toEqual`: recursive, ignores undefined properties. */
function equals(a: unknown, b: unknown): boolean {
	if(b instanceof Asymmetric) {
		return b.match(a)
	}

	if(a instanceof Asymmetric) {
		return a.match(b)
	}

	if(Object.is(a, b)) {
		return true
	}

	if(!a || !b || typeof a !== 'object' || typeof b !== 'object') {
		return false
	}

	if(a instanceof Error || b instanceof Error) {
		return a instanceof Error && b instanceof Error
			&& a.message === b.message && a.name === b.name
	}

	if(a instanceof Date || b instanceof Date) {
		return a instanceof Date && b instanceof Date
			&& a.getTime() === b.getTime()
	}

	if(a instanceof RegExp || b instanceof RegExp) {
		return String(a) === String(b)
	}

	if(ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
		return ArrayBuffer.isView(a) && ArrayBuffer.isView(b)
			&& Buffer.from(a.buffer, a.byteOffset, a.byteLength)
				.equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
	}

	if(Array.isArray(a) !== Array.isArray(b)) {
		return false
	}

	if(a instanceof Map || a instanceof Set) {
		return b.constructor === a.constructor
			&& equals([...a], [...(b as Iterable<unknown>)])
	}

	if(Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => equals(v, b[i]))
	}

	const keys = new Set([...Object.keys(a), ...Object.keys(b)])
	return [...keys].every((key) => equals(
		Reflect.get(a, key),
		Reflect.get(b, key),
	))
}

/** Vitest's `toMatchObject`: every expected property matches, recursively. */
function matchesObject(actual: unknown, expected: unknown): boolean {
	if(expected instanceof Asymmetric) {
		return expected.match(actual)
	}

	if(Array.isArray(expected)) {
		return Array.isArray(actual)
			&& actual.length === expected.length
			&& expected.every((item, i) => matchesObject(actual[i], item))
	}

	if(
		!expected
		|| typeof expected !== 'object'
		|| expected instanceof Date
		|| expected instanceof RegExp
		|| ArrayBuffer.isView(expected)
	) {
		return equals(actual, expected)
	}

	if(actual === null || typeof actual !== 'object') {
		return false
	}

	return Object.keys(expected).every((key) => (
		key in actual
		&& matchesObject(Reflect.get(actual, key), Reflect.get(expected, key))
	))
}

type Runner = (
	name: string,
	options: Options,
	fn: (t?: nodeTest.TestContext) => unknown,
) => unknown

type EachTest = (
	name: string,
	fn: AnyFn,
	timeout?: number,
) => void

/** Vitest's `each` overloads: tuple rows spread, other rows pass as one. */
interface Each {
	<T extends unknown[] | [unknown]>(table: readonly T[]): (
		name: string,
		fn: (...args: T) => unknown,
		timeout?: number,
	) => void
	<T extends readonly unknown[]>(table: readonly T[]): (
		name: string,
		fn: (...args: [...T]) => unknown,
		timeout?: number,
	) => void
	<T>(table: readonly T[]): (
		name: string,
		fn: (arg: T) => unknown,
		timeout?: number,
	) => void
}

/**
 * Adds Vitest's `each(table)(name, fn)` with `%s`/`%j`/`%i`/`$key` names.
 * A test that fails only because this host can't start the document
 * sandbox is skipped, so the suite runs on hosts without Bubblewrap.
 */
function withEach(run: Runner, isTest: boolean) {
	const body = (fn: AnyFn, args: unknown[]) => {
		if(!isTest) {
			return () => Reflect.apply(fn, undefined, args)
		}

		return async(t?: nodeTest.TestContext) => {
			if(suiteNeedsSandbox && sandboxSkip) {
				t?.skip(sandboxSkip)
				return
			}

			try {
				return await Reflect.apply(fn, undefined, args)
			} catch(error) {
				if(isSandboxFailure(error) && sandboxSkip) {
					t?.skip(sandboxSkip)
					return
				}

				throw error
			}
		}
	}

	const each = (options: Options = {}): Each => (
		(table: readonly unknown[]): EachTest => (name, fn) => {
			for(const [index, row] of table.entries()) {
				const args = Array.isArray(row) ? row : [row]
				void run(
					format(name, args, index),
					{ timeout: 60_000, ...options },
					body(fn, args),
				)
			}
		}
	)

	const wrapped = (
		name: string,
		optionsOrFn?: Options | AnyFn,
		maybeFn?: AnyFn | number,
	) => {
		const fn = typeof optionsOrFn === 'function'
			? optionsOrFn
			: typeof maybeFn === 'function' ? maybeFn : () => {}

		const options = typeof optionsOrFn === 'object' ? optionsOrFn : {}
		// Vitest's third argument is a timeout; allow at least a minute.
		return run(name, { timeout: 60_000, ...options }, body(fn, []))
	}

	return Object.assign(wrapped, {
		each: each(),
		skip: Object.assign(
			(name: string, fn?: AnyFn) => (
				run(name, { skip: true }, body(fn ?? (() => {}), []))
			),
			{ each: each({ skip: true }) },
		),
	})
}

function format(name: string, args: unknown[], index: number) {
	let next = 0
	const row = args[0]
	return name
		.replace(/%[sdijo#%]/g, (token) => {
			if(token === '%%') {
				return '%'
			}

			if(token === '%#') {
				return String(index)
			}

			const value = args[next++]
			return token === '%j' || token === '%o'
				? JSON.stringify(value)
				: typeof value === 'string' ? value : inspect(value)
		})
		.replace(/\$([a-zA-Z_][\w.]*)/g, (match, key: string) => (
			row && typeof row === 'object' && key in row
				? String(Reflect.get(row, key))
				: match
		))
}

async function sandboxUnavailable() {
	if(process.platform !== 'linux') {
		return 'the document sandbox runs only on Linux'
	}

	const bwrap = process.env.EMAIL_DOCUMENT_BWRAP ?? '/usr/bin/bwrap'
	try {
		await promisify(execFile)('/usr/bin/prlimit', [
			'--',
			bwrap,
			'--unshare-all',
			'--unshare-user',
			'--ro-bind',
			'/',
			'/',
			'--proc',
			'/proc',
			'--dev',
			'/dev',
			'--',
			'/bin/true',
		], { timeout: 5000 })
		return false
	} catch{
		return 'Bubblewrap or user namespaces are unavailable on this host'
	}
}
