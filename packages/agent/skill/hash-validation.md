# Spec hashing: `bodySniff` and `verifyRequestProof({ providerId })`

## Contents

- The one fact everything follows from
- `bodySniff` — when to enable it, how to template a partly dynamic body
- How `verifyRequestProof(proof, { providerId })` gates a proof
- Why `url` is hashed verbatim, and when that makes
  `allowedJsRequests`/`allowedInjectedRequestData` unusable
- Optional fields, and the `dangerouslyDisableContentValidation` fallback
- Related topics

Everything here follows from one fact, confirmed directly from
`hashProviderParams` in `@reclaimprotocol/attestor-core`:

> The claim/spec hash is
> `keccak256(canonicalStringify({ url, method, body, responseMatches, responseRedactions }))`,
> and attestor-core does **no** template resolution, substitution, or
> `{{}}`-stripping on any of it. It hashes exactly the strings it is given.

## `bodySniff`

A per-request field (it sits next to `url`/`method` on each `requestData` entry,
not a version-level setting): `{ enabled: boolean, template: string }`.

**`bodySniff.enabled` should be `true` whenever the request HAS a body at all**
— it isn't reserved for dynamic bodies. Only leave it off when the request
genuinely sends no body (typically a GET). Both publish tools in this package
already set `enabled`/`template` from `provider.body` for a normal
capture-and-replay provider, so you don't touch it there.

The rest of this section matters when authoring a claim through live
interception (`window.Reclaim.requestClaim`) whose body isn't the one literal
string you captured once — usually because a SMALL part is dynamic per
user/run.

`bodySniff` as a concept doesn't exist inside attestor-core at all: it's
translated one layer up (old-devtools' `providerUtils.ts`:
`body: bodySniff.enabled ? bodySniff.template : ''`), and THAT literal string —
including any unresolved `{{paramName}}` text still in it — is what reaches
`hashProviderParams`.

**The consequence, and why this differs from `templateParams`.** A live claim's
`body` can also be set to the literal template string containing
`{{paramName}}` rather than the substituted content, with the real value
supplied separately as a witness param. Since the body is hashed opaquely, a
claim whose `body` is template `T` and a spec whose `bodySniff.template` is that
same `T` hash identically, whatever the placeholder stood for. This is the
OPPOSITE of `templateParams`/`${var}` in `responseMatches`/`responseRedactions`,
which — per the JS SDK's `generateSpecsFromRequestSpecTemplate` — genuinely IS
substituted before hashing. Don't conflate them: `${var}` in a match/redaction
is resolved before hashing; `{{var}}` in a body is never resolved, on either
side.

**Practical use.** Work out exactly which part of the body varies across
users/runs — usually one small field, not the whole payload. Template ONLY that
part; leave everything else literal. For
`{"request":1,"type":"user_info","id":"12345"}` where only `id` varies, the
template is `{"request":1,"type":"user_info","id":"{{REQ_BODY_USER_ID}}"}` —
NOT `{{whole_body}}`, which throws away the ability to pin down everything else.
Then:

1. In the claim you build for `requestClaim`, set
   `bodySniff: { enabled: true, template: '<that exact string>' }` and add a
   matching witness/extracted param `REQ_BODY_USER_ID: <the real id>`, so the
   real value stays independently verifiable while staying out of the hash.
2. In the corresponding `allowedInjectedRequestData` / `allowedJsRequests`
   entry, set `body` to that EXACT SAME literal template, byte for byte — not a
   `${var}` substitution.
3. Check by hand that
   `template.replace('{{REQ_BODY_USER_ID}}', '<a real sample id>')` reproduces
   the real request body byte for byte. Extra whitespace, different key order,
   or a field that also varies but wasn't templated → the hashes won't match.
   Multiple varying fields → one `{{placeholder}}` and one witness param each;
   you're not limited to one hole.

**Fallback — whole-body placeholder.** If precise per-field templating keeps
mismatching and you can't pin every variable field down, template the ENTIRE
body as `{{REQ_BODY_GRD}}`. The `GRD` suffix matters: per the template engine
(`convertTemplateToRegex`), a placeholder name ending in `GRD` becomes a GREEDY
match (`(.*)`, including embedded delimiters) instead of the default non-greedy
`(.*?)`, which is what you want for a placeholder covering the whole remaining
body. Strictly a fallback — nothing about the body's structure is pinned by the
hash anymore (any body at all hashes the same).

## How `verifyRequestProof(proof, { providerId })` gates

Traced from `@reclaimprotocol/js-sdk`
(`src/utils/proofValidationUtils.ts`, `src/utils/providerUtils.ts`,
`src/witness.ts`):

1. `assertValidateProof` → `fetchProviderHashRequirementsBy(providerId, …)`
   fetches the provider's CURRENT PUBLISHED CONFIG and builds a list of expected
   hashes — one per `requestData` entry PLUS one per
   `allowedInjectedRequestData` (old-devtools) / `allowedJsRequests` (builder)
   entry.
2. Each expected hash is `hashRequestSpec` → `hashProofClaimParams({ url,
   method, body, responseMatches, responseRedactions })` — the same opaque
   hashing as above, applied to the whole spec.
3. The real submitted proof's `claimData.parameters` is hashed the same way,
   with `isOptional`-driven 2^N combinatorial expansion over
   `responseMatches`/`responseRedactions` PAIRS
   (`getProviderParamsAsCanonicalizedString`) so an optional field can be
   present or absent. **That expansion only touches match/redaction pairs, never
   `url`.**
4. `assertValidProofsByHash` requires the real proof's hash to equal exactly ONE
   expected hash. No match → `verifyRequestProof` rejects, even for a perfectly valid,
   correctly signed proof whose `responseMatches` are 100% right.

### `url` is hashed VERBATIM — zero template/regex resolution

Even with `urlType: REGEX` or `TEMPLATE`. Confirmed from
`generateSpecsFromRequestSpecTemplate` (the function that DOES resolve `${var}`
in matches/redactions): it spreads every other field through unchanged and never
touches `url`. `urlType` is consumed by a different validation path entirely
(matching a live request against the spec at capture time), never by this hash.

**So, before populating `allowedInjectedRequestData`/`allowedJsRequests` for a
`verifyRequestProof({ providerId })` use case:** if the real captured URL contains ANY
component that varies between two otherwise-identical sessions — a tracking
nonce, a CSRF token, a cache-busting timestamp, a per-request trace id — the
hash from your declared spec can NEVER equal any real future proof's, no matter
how correct everything else is. This is common on JS-heavy sites (Slack
regenerates `_x_id`, `_x_csid` and `fp` on every API call, so a captured
`users.profile.getSections` URL is never identical twice, even seconds apart).

Populating the field for such a provider is **actively worse than leaving it
empty**: it converts "no provider-hash check was attempted" into
"`verifyRequestProof({ providerId })` rejects every real proof, unconditionally."

**Verify first:** capture the same endpoint twice in two separate sessions
(ideally two users, or the same user on two days) and diff the full URL byte for
byte.

- Identical every time → safe to populate (`urlType: CONSTANT`, literal URL).
- Not identical → do not populate it expecting it to gate `verifyRequestProof`. No
  amount of care with `responseMatches`/`responseRedactions`/`body` fixes it on
  either backend; it's a property of the hashing itself.

### Optional fields

Independent of the `url` constraint: even with a stable URL,
`responseMatches`/`responseRedactions` must match EXACTLY, not just in spirit. A
provider whose extracted field SET varies per user (optional profile fields
present for some, absent for others) needs `isOptional: true` on the
`ResponseMatch`. `ResponseRedaction` has no `isOptional` field; for legacy
proof-hash compatibility, the redaction at the same index is treated as that
match's pair during the 2^N optional-subset expansion. A sometimes-present
field that isn't marked optional breaks the hash for every user missing it — the
same failure mode as the `url` constraint, scoped to one field. Builder recipes
still keep `responseRedactions` as an independent ordered list; this legacy
compatibility rule does not pair the lists generally.

### Fallback

Whether it's an unstable `url`, an unmarked optional field, or any other
persistent mismatch, the way out is on the VERIFYING side:
`verifyRequestProof(proof, { dangerouslyDisableContentValidation: true })`. That skips
steps 1–4 entirely and trusts only the attestor's cryptographic signature; it
does NOT check that the proof's url/method/body/matches/redactions match
anything you declared. A caller-supplied `{ hashes: [...] }` computed some other
way is the alternative when you still want hash-equality enforced, just not
derived from the published config. Reach for
`dangerouslyDisableContentValidation` deliberately, never as a silent default —
it trades away the guarantee that the proof is shaped the way the provider's
spec says.

## Related topics

- `user-script` — `allowedJsRequests` / `allowedInjectedRequestData`, the fields
  this page's `url` constraint applies to.
- `prove` — `run_proof` and diagnosing a proof that fails before it ever reaches
  `verifyRequestProof`.
