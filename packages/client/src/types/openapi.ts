import type { components, operations } from './openapi.gen.ts'

export type IOperationId = keyof operations

export type RequestBodyContent<T> = T extends {
	content: { 'application/json': infer R }
}
	? R
	: T extends { content: { 'application/x-www-form-urlencoded': infer R } }
		? R
		: undefined

export type IJsonRequestBody<T extends IOperationId> = operations[T] extends {
	requestBody?: infer B
}
	? RequestBodyContent<B>
	: undefined

type AnySuccess<R> = R extends {
	200: { content: { 'application/json': infer J } }
}
	? J
	: R extends { 201: { content: { 'application/json': infer J } } }
		? J
		: R extends { 204: unknown }
			? void
			: unknown

export type IJsonResponseBody<T extends IOperationId> = operations[T] extends {
	responses: infer R
}
	? AnySuccess<R>
	: void

export type IQuery<T extends IOperationId> = operations[T] extends {
	parameters: { query?: infer R }
}
	? Exclude<R, undefined>
	: undefined

export type IParams<T extends IOperationId> = operations[T] extends {
	parameters: { path?: infer R }
}
	? Exclude<R, undefined>
	: undefined

export type IHeaders<T extends IOperationId> = operations[T] extends {
	parameters: { header?: infer R }
}
	? Exclude<R, undefined>
	: undefined

// Shape passed to `ReclaimClient.call(operationId, args)`. Each member
// is keyed off the openapi spec — pass `params` for path params,
// `query` for query params, `body` for the JSON body, and `headers` for
// header params (for example, `If-Match`). `headers` is optional since most
// operations declare none.
export type IOperationArgs<T extends IOperationId> = {
	params?: IParams<T> | undefined
	query?: IQuery<T> | undefined
	body?: IJsonRequestBody<T> | undefined
	headers?: IHeaders<T> | undefined
} & (
		[IParams<T>] extends [undefined] ? unknown : { params: IParams<T> }
	) & (
		[IQuery<T>] extends [undefined] ? unknown : { query: IQuery<T> }
	) & (
		[IJsonRequestBody<T>] extends [undefined]
			? unknown
			: { body: IJsonRequestBody<T> }
	) & (
		[IHeaders<T>] extends [undefined] ? unknown : { headers: IHeaders<T> }
	)

export type IOperationResponse<T extends IOperationId> = IJsonResponseBody<T>

// RFC 9457 — Problem Details for HTTP APIs.
export type ProblemDetails = components['schemas']['Problem'] & {
	[key: string]: unknown
}

// Consumer-facing schema types, re-exported so SDK users import them from
// `@reclaimprotocol/client` instead of reaching into the generated file.
export type VerificationSession =
	components['schemas']['VerificationSession']
export type VerificationRuntimeConfig =
	components['schemas']['VerificationRuntimeConfig']
export type VerificationStatus = components['schemas']['VerificationStatus']
export type VerificationEventRecord =
	components['schemas']['VerificationEventRecord']
export type CallbackSubscription =
	components['schemas']['CallbackSubscription']
export type CallbackDeliveryStatus =
	components['schemas']['CallbackDeliveryStatus']
export type VerificationResultDelivery =
	components['schemas']['VerificationResultDelivery']
// (`Jws` is intentionally NOT re-exported here — `result.ts` exports the
// canonical hand-written Jws type the SDK helpers operate on.)
export type ProviderRequiredContext =
	components['schemas']['ProviderRequiredContext']
export type Provider = components['schemas']['Provider']
export type ProviderVersion = components['schemas']['ProviderVersion']
export type OrgKeypair = components['schemas']['OrgKeypair']
export type JwkSecp256k1Public = components['schemas']['JwkSecp256k1Public']
export type OrgToken = components['schemas']['OrgToken']
export type OrgTokenMeta = components['schemas']['OrgTokenMeta']
export type Organization = components['schemas']['Organization']
export type CreateProviderVersionRequest =
	components['schemas']['CreateProviderVersionRequest']
export type ProviderVersionRef = components['schemas']['ProviderVersionRef']
