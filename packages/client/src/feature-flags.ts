import type { VerificationRuntimeConfig } from './types/openapi.ts'

/** Read a resolved session flag without assuming its runtime type. */
export function getFeatureFlag(
	config: VerificationRuntimeConfig | null | undefined,
	key: string,
) {
	return config?.values[key]
}

/** Read a boolean flag, returning `fallback` for absent or mistyped values. */
export function getBooleanFeatureFlag(
	config: VerificationRuntimeConfig | null | undefined,
	key: string,
	fallback = false,
) {
	const value = getFeatureFlag(config, key)
	return typeof value === 'boolean' ? value : fallback
}

/** Read a string flag, returning `fallback` for absent or mistyped values. */
export function getStringFeatureFlag(
	config: VerificationRuntimeConfig | null | undefined,
	key: string,
	fallback: string,
) {
	const value = getFeatureFlag(config, key)
	return typeof value === 'string' ? value : fallback
}

/** Read a numeric flag, returning `fallback` for absent or mistyped values. */
export function getNumberFeatureFlag(
	config: VerificationRuntimeConfig | null | undefined,
	key: string,
	fallback: number,
) {
	const value = getFeatureFlag(config, key)
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
