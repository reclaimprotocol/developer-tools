import { z } from 'zod'
import type { JSONSchema } from 'zod/v4/core'

/**
 * JSON Schema → zod for the generated MCP tool inputs.
 *
 * The MCP tool generator inlines `$ref`s it
 * walks through `properties`/`items`, but it does NOT recurse into `allOf` /
 * `anyOf` / `oneOf`. So a schema composed with `allOf` (for example,
 * `RequestSelectionTemplate =
 * allOf[ RequestSelection, { multiple, required } ]`,
 * surfaced by the proof tools' `allowedJsRequests`) can carry a dangling
 * `#/components/schemas/…` `$ref` that points outside the standalone schema
 * object handed to `z.fromJSONSchema`. zod then throws `Reference not found`
 * at module-load time, taking down every tool.
 *
 * We pre-process here (rather than hand-editing the generated file, which
 * regen would clobber): flatten `allOf` compositions into a single object
 * schema and neutralize any remaining unresolvable `#/components/schemas/…`
 * `$ref` to a permissive `{}`. The schemas affected are deep proof-tool inputs
 * the model rarely hand-builds, so loosening leaf validation there is
 * acceptable; the common tool inputs (uuids, version patterns, contexts) keep
 * their full constraints.
 */
export function toZod(schema: JSONSchema.Schema) {
	return z.fromJSONSchema(sanitize(schema) as JSONSchema.Schema)
}

type AnySchema = Record<string, unknown>

/** True for a `$ref` that can't be resolved in a standalone schema object. */
function isDanglingComponentRef(node: AnySchema): boolean {
	return (
		typeof node.$ref === 'string' &&
		(node.$ref).startsWith('#/components/')
	)
}

/**
 * Recursively (a) merge `allOf` members into their parent so composition
 * resolves locally, and (b) replace any dangling `#/components/…` `$ref` with
 * a permissive empty schema. Pure — returns a fresh tree, never mutates input.
 */
function sanitize(input: unknown): unknown {
	if(Array.isArray(input)) {
		return input.map(sanitize)
	}

	if(input === null || typeof input !== 'object') {
		return input
	}

	const node = input as AnySchema

	if(isDanglingComponentRef(node)) {
		// Drop the ref; keep any sibling keys (rare) sanitized.
		const { $ref: _ref, ...rest } = node
		void _ref
		return sanitizeEntries(rest)
	}

	// Flatten allOf into the parent object. Each member is sanitized first so
	// its own refs/allOf collapse; object members merge their `properties`,
	// `required`, and scalar keys upward.
	if(Array.isArray(node.allOf)) {
		const { allOf, ...rest } = node
		let merged: AnySchema = sanitizeEntries(rest)
		for(const member of allOf as unknown[]) {
			merged = mergeObjectSchemas(merged, sanitize(member) as AnySchema)
		}

		return merged
	}

	return sanitizeEntries(node)
}

/** Sanitize every value of an object schema's keys. */
function sanitizeEntries(node: AnySchema): AnySchema {
	const out: AnySchema = {}
	for(const [k, v] of Object.entries(node)) {
		out[k] = sanitize(v)
	}

	return out
}

/**
 * Merge two (already-sanitized) object schemas for `allOf` flattening: union
 * `properties`, union `required`, and let later members win on scalar keys.
 * Both sides are expected to be object-shaped; non-object members fall back to
 * a plain key spread (the rare case).
 */
function mergeObjectSchemas(a: AnySchema, b: AnySchema): AnySchema {
	const out: AnySchema = { ...a, ...b }

	const aProps = a.properties as AnySchema | undefined
	const bProps = b.properties as AnySchema | undefined
	if(aProps || bProps) {
		out.properties = { ...aProps, ...bProps }
	}

	const aReq = Array.isArray(a.required) ? (a.required as string[]) : []
	const bReq = Array.isArray(b.required) ? (b.required as string[]) : []
	if(aReq.length || bReq.length) {
		out.required = Array.from(new Set([...aReq, ...bReq]))
	}

	// `type` should stay `object` after merging two object schemas.
	if(a.type === 'object' || b.type === 'object' || out.properties) {
		out.type = 'object'
	}

	return out
}
