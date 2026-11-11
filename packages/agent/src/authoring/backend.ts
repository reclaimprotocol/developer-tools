/**
 * Backend seam for the authoring tools. The tool LOGIC (drive the browser →
 * capture → propose → replay → prove) is written once against this interface;
 * each environment supplies a backend:
 *   - local (MCP): a Chrome tab over CDP + the in-process attestor SDK.
 *   - remote (cloud): the user's Popcorn browser over CDP + the TEE prover.
 *
 * One backend instance == one live session (a page + its capture). Multi
 * session falls out of instancing: the MCP resolves a backend per tab/capture,
 * the cloud one per run — so the shared tools never carry a session id and hold
 * no cross-session state.
 */
import { randomUUID } from 'node:crypto'
import type { CaptureSession } from '../cdp/capture-engine.ts'
import type { Extraction } from '../provider/draft.ts'
import type { ReclaimProvider, SecretParamRef } from '../provider/schema.ts'

/** Secret request params (cookie/auth headers), materialized only for the
 *  replay/prove call — never surfaced in tool output. */
export interface SecretParams {
	headers: Record<string, string>
}

/** A drafted recipe held server-side so the model only handles an opaque
 *  `draftId` — the provider is secret-free but the captured secrets never enter
 *  the transcript. Shared by propose → replay → run_proof. */
export interface Draft {
	provider: ReclaimProvider
	secretRefs: SecretParamRef[]
	/** Real secret header values (cookie/auth) for replay/prove — never returned
	 *  to the model. */
	secrets: Record<string, string>
	/** The captured request this draft was proposed from. */
	requestId: string
	/** One entry per extracted value (value + its redaction), so replay can
	 *  validate each against its own selector. */
	extractions: Extraction[]
	/** Outcome of the latest authenticated in-browser replay, recorded by
	 *  backends that track it. Lets a failed proof tell "the site blocks
	 *  non-browser clients" apart from a broken recipe. */
	lastReplay?: { status: number, ok: boolean }
}

/** A navigation script installed for every later page load of the authoring
 *  session. `identifier` is the CDP registration, so it can be removed. */
export interface KeptScript {
	script: string
	identifier?: string
}

/** Holds the session's kept script, replaced by each `keep` call. */
export interface KeptScriptRef {
	keptScript?: KeptScript
}

/** Per-session draft store: `propose` puts, `replay`/`run_proof` get by id,
 *  `update_draft` replaces one in place (same id). */
export interface DraftStore {
	put(draft: Draft): string
	get(id: string): Draft | undefined
	set(id: string, draft: Draft): void
}

export function makeDraftStore(): DraftStore {
	const map = new Map<string, Draft>()
	return {
		put: (draft) => {
			const id = `draft_${randomUUID()}`
			map.set(id, draft)
			return id
		},
		get: (id) => map.get(id),
		set: (id, draft) => {
			map.set(id, draft)
		},
	}
}

/** Options for a proof run. `ownerAddress` selects the local signing credential
 *  and `attestorUrl` overrides the attestor endpoint (both MCP-only); the
 *  remote TEE backend ignores them (it signs in-enclave, own attestor). */
export interface ProveOptions {
	ownerAddress?: string
	attestorUrl?: string
	/** ISO country the attestor's request goes out from (local proofs). */
	geoLocation?: string
}

/**
 * Everything the shared authoring tools need from one live session. Browser ops
 * go through `sendCdp` (+ `waitForEvent` for load-style waits); capture reads
 * use `capture`; proof/replay are whole operations because they genuinely
 * differ (local attestor + live re-fetch vs remote TEE) — each backend shapes
 * its own result, passed straight through as the tool's output.
 */
export interface AuthoringBackend {
	/** Ask Chrome to reject page evaluation when side effects cannot be ruled
	 * out. Cloud authoring enables this; local MCP keeps its existing
	 * behavior. */
	readonly readOnlyPageEval?: boolean
	/** Where `test_user_script` keeps its script. Absent for hosts that do not
	 * publish it (the cloud loop synthesizes its own navigation script). */
	readonly kept?: KeptScriptRef
	/** Send a raw CDP command scoped to this session's page. */
	sendCdp(method: string, params?: Record<string, unknown>): Promise<unknown>
	/** Resolve once `method` (a CDP event) fires on this session's page, or
	 *  after `timeoutMs`. Used for `Page.loadEventFired`-style waits. */
	waitForEvent(method: string, timeoutMs: number): Promise<'fired' | 'timeout'>
	/** This session's captured requests (the shared capture engine). */
	readonly capture: CaptureSession
	/** This session's drafts (propose → replay/run_proof). */
	readonly drafts: DraftStore
	/** Prove a drafted recipe. Local: attestor SDK (rich claim view). Remote: TEE
	 * `/reclaim/prove` (lean, secret-free summary). Returns the environment's
	 * display shape. A backend may record the proven recipe internally (for
	 * example, the cloud publish step) — that side effect is the backend's, not
	 * ours. */
	prove(draft: Draft, opts?: ProveOptions): Promise<unknown>
	/**
	 * Validate/replay a drafted recipe before proving. Both local and remote
	 * backends re-issue the request FROM INSIDE the live attached page (a
	 * `fetch` run over CDP), never a detached out-of-band call, so replay
	 * always reflects the real browser session. With `withoutSecrets` it is
	 * the AUTH-BOUND check: re-issue anonymously (`credentials: 'omit'`, no
	 * secret headers) and report whether the values are STILL extractable —
	 * that is, the endpoint is public. Without it, validate extraction for the
	 * authenticated request. The shape is environment-specific and passed
	 * straight through as the tool's result.
	 */
	replay(draft: Draft, opts?: { withoutSecrets?: boolean }): Promise<unknown>
}
