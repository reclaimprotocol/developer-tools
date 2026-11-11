// Generated from Builder's OpenAPI spec (https://build.reclaimprotocol.org/openapi.yaml, spec v0.1.0, source sha256:bd379584571e).
// Do not edit by hand: Reclaim regenerates this file upstream.
// @ts-nocheck

import { toZod } from './to-zod.ts'

export const MCP_TOOLS = {
	"AddOrgMember": {
		description: "Invite a member to an organization\n\nOwner only. Invites a user to the organization by email. The invitee does **not** need to be a registered user — an invite is created in either case, and an invite email with an accept link is dispatched. The new row is returned with `status: PENDING`; it flips to `ACTIVE` only when the invitee explicitly accepts via `POST /orgs/{orgId}/invite`.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for inviting a member to an organization. The invitee does not need to be a registered user; an invite is created either way and an email is dispatched.",
					"required": [
						"email",
						"role"
					],
					"properties": {
						"email": {
							"type": "string",
							"format": "email",
							"description": "Email to invite. Need not match an existing `User`.",
							"minLength": 3,
							"maxLength": 320
						},
						"role": {
							"type": "string",
							"description": "Role a user holds in an organization. `OWNER` can invite, promote, demote, and remove members, and delete the org. `MEMBER` has read/write access to resources owned by the org but cannot manage membership.",
							"enum": [
								"OWNER",
								"MEMBER"
							]
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"AdminAnalytics": {
		description: "Usage, session, and revenue analytics (admin-only)\n\nAdmin only. Aggregates across every organization over a date window: session outcomes by UTC day, device category, and claimant country; demand per provider, money in by month, and per-org consumption against the plan allowance (including closed periods, which the org-scoped usage endpoint never returns). Defaults to the last 30 days; narrow to one org with `orgId`.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"minLength": 1,
							"maxLength": 64,
							"pattern": "^[0-9a-fA-F-]+$",
							"description": "An organization id used as a filter. Hyphens are ignored, so it matches with or without them; an id that matches no organization returns nothing."
						},
						"providerSearch": {
							"type": "string",
							"maxLength": 100
						},
						"verificationClientId": {
							"type": "string",
							"minLength": 1,
							"maxLength": 64,
							"pattern": "^[0-9a-fA-F-]+$",
							"description": "A verification client id used as a filter. Hyphens are ignored."
						},
						"from": {
							"type": "string",
							"maxLength": 40,
							"pattern": "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
							"description": "One end of a date window: either a calendar date (`2026-09-01`, read as UTC midnight) or a full ISO date-time. The date-only form is what a native `<input type=\"date\">` submits, so `format: date-time` alone would reject every filter the dashboard's own form sends."
						},
						"to": {
							"type": "string",
							"maxLength": 40,
							"pattern": "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
							"description": "One end of a date window: either a calendar date (`2026-09-01`, read as UTC midnight) or a full ISO date-time. The date-only form is what a native `<input type=\"date\">` submits, so `format: date-time` alone would reject every filter the dashboard's own form sends."
						},
						"format": {
							"type": "string",
							"enum": [
								"csv"
							]
						},
						"section": {
							"type": "string",
							"enum": [
								"providers",
								"revenue",
								"usage",
								"goals",
								"ai-session-prompts",
								"ai-session-prompt-rejections",
								"tools",
								"agents",
								"funnel"
							]
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"AdminOrgs": {
		description: "All workspaces (admin-only)\n\nAdmin only. Lists all organizations. Search matches workspace name or any member's email address.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"q": {
							"type": "string",
							"maxLength": 200
						},
						"cursor": {
							"type": "string",
							"maxLength": 500
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"AdminProviders": {
		description: "All providers (admin-only)\n\nAdmin only. Lists all providers across all organizations. Supports filtering by visibility, status, and free-text search on title/domain/slug.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"q": {
							"type": "string",
							"maxLength": 200
						},
						"visibility": {
							"type": "string",
							"description": "The visibility of the entity.\n\n- `PRIVATE`: Only the owner can see the entity.\n\n- `PUBLIC`: Anyone can see the entity.",
							"enum": [
								"PRIVATE",
								"PUBLIC"
							]
						},
						"status": {
							"type": "string",
							"description": "The status of the entity.\n\n- `ACTIVE`: The entity is active.\n\n- `ARCHIVED`: The entity is archived.",
							"enum": [
								"ACTIVE",
								"ARCHIVED"
							]
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"AdminReviews": {
		description: "Pending review queue (admin-only)\n\nAdmin only. Lists all provider versions currently awaiting review (branch = 'in_review'). Use decide_provider_version_review to approve or reject each version.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"AdminSessions": {
		description: "Explore verification sessions (admin-only)\n\nAdmin only. Search verification sessions across all organizations — filter by `sessionId` (prefix match, at least 5 characters), `providerId` (id or slug), `claimantClientId`, `orgId` (all exact match), `status`, and a `createdAfter`/`createdBefore` time range. Rows link to the org-scoped session detail page (admins can open any org's pages). Newest first, 50 per page, with opaque cursor pagination.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"maxLength": 100
						},
						"providerId": {
							"type": "string",
							"maxLength": 100
						},
						"verificationClientId": {
							"type": "string",
							"minLength": 1,
							"maxLength": 64,
							"pattern": "^[0-9a-fA-F-]+$",
							"description": "A verification client id used as a filter. Hyphens are ignored."
						},
						"providerSearch": {
							"type": "string",
							"maxLength": 100
						},
						"claimantClientId": {
							"type": "string",
							"maxLength": 100
						},
						"orgId": {
							"type": "string",
							"maxLength": 100
						},
						"status": {
							"type": "string",
							"description": "Status of a verification session, derived from its events. New values\nmay be added over time; clients MUST tolerate unknown values in\nresponses.\n\n- `pending`: Created, not yet finished; completable until `expiresAt`.\n\n- `success`: Terminal — `verification_success` recorded.\n\n- `rejected`: Terminal — `verification_rejected` recorded.\n\n- `error`: Terminal — `verification_error` recorded.\n\n- `cancelled`: Terminal — `verification_cancelled` recorded.\n\n- `expired`: `expiresAt` passed before a terminal event; the end-user\n  can no longer complete it.",
							"enum": [
								"pending",
								"success",
								"rejected",
								"error",
								"cancelled",
								"expired"
							]
						},
						"createdAfter": {
							"type": "string",
							"format": "date-time"
						},
						"createdBefore": {
							"type": "string",
							"format": "date-time"
						},
						"cursor": {
							"type": "string",
							"maxLength": 500
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"BindVerificationSessionTeeNonce": {
		description: "Bind a legacy-compatible TEE nonce to a verification session\n\nBinds one immutable legacy TEE nonce context to a pending session. Requires an OrgToken and an EIP-191 signature from the organization's registered verification key. Repeating the exact binding is idempotent; conflicting or terminal sessions return 409.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"format": "uuid",
							"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
						}
					},
					"required": [
						"sessionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "One immutable legacy TEE context, signed by the organization verification key. The signature is EIP-191 `personal_sign` over `RECLAIM_BUILDER_TEE_BINDING_V1:{organizationId}:{sessionId}:{applicationId}:{timestamp}:{attestationVersion}:{attestationNonce}`.",
					"required": [
						"attestationNonce",
						"attestationNonceData",
						"signature"
					],
					"properties": {
						"attestationNonce": {
							"description": "Either the current lowercase 64-hex hash nonce (without `0x`) or the older 65-byte EIP-191 signature nonce (`0x` plus 130 hex characters). Builder preserves either encoding unchanged.",
							"oneOf": [
								{
									"type": "string",
									"pattern": "^[0-9a-f]{64}$",
									"minLength": 64,
									"maxLength": 64
								},
								{
									"type": "string",
									"pattern": "^0x[0-9a-fA-F]{130}$",
									"minLength": 132,
									"maxLength": 132
								}
							]
						},
						"attestationNonceData": {
							"type": "object",
							"additionalProperties": false,
							"description": "Exact legacy TEE nonce inputs. Builder stores this unchanged in the session context after it verifies the signed binding request.",
							"required": [
								"applicationId",
								"sessionId",
								"timestamp",
								"attestationVersion"
							],
							"properties": {
								"applicationId": {
									"type": "string",
									"description": "Ethereum application address derived from the organization private key. Its supplied casing is preserved for legacy nonce compatibility.",
									"pattern": "^0x[0-9a-fA-F]{40}$",
									"minLength": 42,
									"maxLength": 42
								},
								"sessionId": {
									"type": "string",
									"format": "uuid",
									"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
								},
								"timestamp": {
									"type": "string",
									"description": "Decimal Unix timestamp in milliseconds.",
									"pattern": "^[0-9]{13}$",
									"minLength": 13,
									"maxLength": 13
								},
								"attestationVersion": {
									"type": "string",
									"description": "Legacy SDK TEE attestation protocol version.",
									"enum": [
										"v3"
									]
								}
							}
						},
						"signature": {
							"type": "string",
							"description": "EIP-191 65-byte secp256k1 signature, encoded as 0x-prefixed hex.",
							"pattern": "^0x[0-9a-fA-F]{130}$",
							"minLength": 132,
							"maxLength": 132
						}
					}
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"idempotentHint":true,"openWorldHint":false},
	},
	"CancelPublicListingRequest": {
		description: "Cancel a pending public listing review request\n\nCancels a pending public listing request by moving the version from `in_review` back to `draft`. Only org members can cancel their own review requests. This allows users to withdraw a request before admin review if they change their mind.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						},
						"version": {
							"type": "string",
							"pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9_-]+(?:\\.[0-9]+)?)?$",
							"maxLength": 32
						}
					},
					"required": [
						"providerId",
						"version"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for visibility change requests (request public listing or make private).",
					"properties": {
						"notes": {
							"type": "string",
							"description": "Optional note explaining the change.",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"CreateAiVerificationSession": {
		description: "Start an AI verification session from a prompt\n\nStarts an AI verification session from a plain-language prompt and optional dataPoints/loginUrls; returns the session with verificationUrl to share with the user. Needs the org token and at least one callback subscription (409 otherwise). No provider or org keypair needed: Builder manages the AI app key. Poll with get_ai_verification_session or wait_for_ai_session.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for `POST /verifications/ai-sessions`. Send a `prompt`, at least one entry in `dataPoints`, or both.",
					"properties": {
						"prompt": {
							"type": "string",
							"minLength": 0,
							"maxLength": 10000,
							"description": "What to verify, in plain language, such as \"verify I'm a student at Manipal University\". Required unless `dataPoints` has at least one item. Builder rejects a prompt that contains credentials, card numbers, instructions for the AI, or a sensitive claim. The prompt and the data point lines together can't exceed 10,000 characters."
						},
						"dataPoints": {
							"type": "array",
							"maxItems": 32,
							"description": "The values to verify. Required unless you send a `prompt`. Names must be unique, and at least one data point must be required (its `isOptional` is `false` or absent). When you send data points, Builder keeps them and adds only optional data points that the prompt implies. When you send none, Builder chooses the data points from the prompt. Every required data point must appear in the verified proofs. If one is missing, the session ends as `rejected` with `reasonCode` `missing-data-points`.",
							"items": {
								"type": "object",
								"additionalProperties": false,
								"required": [
									"name",
									"description"
								],
								"properties": {
									"name": {
										"type": "string",
										"maxLength": 64,
										"pattern": "^[A-Za-z_][A-Za-z0-9_]{0,63}$",
										"description": "Name of the value, such as `username`. Starts with a letter or underscore, followed by up to 63 letters, digits, or underscores."
									},
									"description": {
										"type": "string",
										"minLength": 1,
										"maxLength": 300,
										"description": "What the value is and why it proves the claim."
									},
									"isOptional": {
										"type": "boolean",
										"description": "Defaults to `false`. If `true`, the claim can be proven without this value, and the proofs can omit it. If `false` or absent, the data point is required, and a session whose proofs omit it ends as `rejected` with `reasonCode` `missing-data-points`."
									}
								}
							}
						},
						"loginUrls": {
							"type": "array",
							"maxItems": 10,
							"description": "Pages where the user signs in, such as `https://portal.example.edu/login`. Builder shows them first as candidates with source `caller`, and skips the web search. Each URL must use `http` or `https`, can't contain credentials, and must resolve to a public host.",
							"items": {
								"type": "string",
								"format": "uri",
								"maxLength": 2048
							}
						},
						"isEmailVerificationAllowed": {
							"type": "boolean",
							"description": "Defaults to `false`. If `true`, the share page offers the user a choice to verify using email instead of signing in. If you omit it, the page doesn't offer that choice."
						},
						"context": {
							"type": "object",
							"maxProperties": 50,
							"additionalProperties": true,
							"description": "Values you already know, such as `{\"fullName\": \"Asha Rao\"}`. Builder merges them over the values the prompt states and returns the result in `context`. Must not contain `attestationNonce` or `attestationNonceData`; bind those after you create the session. Also must not contain `reclaimSessionId`, `extractedParameters`, or `builderSessionId`. Omit if you have none."
						},
						"verificationClientUrl": {
							"type": "string",
							"description": "Base URL of the registered verification client the user verifies with, as for `POST /verifications/sessions`. Builder charges this client's quota pool. If you omit it, Builder uses the default (`portals`) client.",
							"maxLength": 2000,
							"pattern": "^https?://"
						},
						"geoLocation": {
							"type": "string",
							"description": "ISO 3166-1 alpha-2 country code, such as `IN`. Builder searches the web from this country (Google's `gl` parameter), so portals for that country rank first. If you omit it, the search has no country preference.",
							"minLength": 2,
							"maxLength": 2,
							"pattern": "^[A-Za-z]{2}$"
						}
					}
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"openWorldHint":false},
	},
	"CreateCallbackSubscription": {
		description: "Register a callback subscription\n\nRegisters a destination for verification results on the organization\nthe presented `OrgToken` resolves to. At least one subscription must\nexist for the org before you can create a verification session.\nDelivery is scoped by org: terminal results are ECIES-encrypted to the\norg's eth public key when its `canEncryptResult` is enabled (see\n`PUT /orgs/{orgId}/keypair`), else delivered as plaintext.\n\nTo receive results at a URL, send `callbackUrl` and `events`. Builder\nPOSTs each delivery to that URL.\n\nTo read results without a public URL during local development, send\n`deliveryMode: \"pull\"`. Builder keeps the deliveries and you read them\nwith `GET /verifications/callback-events`. A pull subscription is a\n90-second lease: it receives events and satisfies the session-creation\ncheck only while the lease is unexpired. Send the same request about\nevery 30 seconds to renew it, and call\n`POST /verifications/callback-listener/release` when you stop. Production\nneeds a webhook subscription. An org has at most one pull subscription.\nIf it already exists, Builder renews it and returns it with status 200.\nIf the body includes `events`, they replace the subscription's events;\nif it omits them, the existing events are kept.\n",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"description": "Body for `POST /verifications/callback-subscriptions`. The owning organization is resolved from the presented `OrgToken`; delivery is scoped to that org and encrypted to its credential when set. Send `callbackUrl` for a webhook, or `deliveryMode: \"pull\"` for a subscription you read.",
					"oneOf": [
						{
							"type": "object",
							"additionalProperties": false,
							"description": "A subscription that Builder POSTs each delivery to.",
							"required": [
								"callbackUrl",
								"events"
							],
							"properties": {
								"deliveryMode": {
									"type": "string",
									"description": "Omit it or send `webhook`.",
									"enum": [
										"webhook"
									]
								},
								"callbackUrl": {
									"type": "string",
									"pattern": "^https?://",
									"description": "Callback URL or template. Supported placeholders are `{{sessionId}}` and top-level scalar context keys.",
									"maxLength": 2000
								},
								"events": {
									"type": "array",
									"minItems": 1,
									"maxItems": 51,
									"items": {
										"type": "string",
										"description": "Canonical Builder lifecycle event. Names use lower snake case; metadata uses camel case. Provider events include providerId, resolvedVersion, and ordinal. Request events also include requestId. New values are additive, so clients must tolerate unknown response values. For field requirements and funnel semantics, see docs/verification-analytics-events.md.",
										"enum": [
											"billing_required",
											"session_pending",
											"verification_client_opened",
											"verification_client_ready",
											"verification_client_warning",
											"verification_client_visibility_shown",
											"verification_client_visibility_hidden",
											"verification_diagnostics_mode_changed",
											"verification_cancelled",
											"consent_viewed",
											"consent_scrolled",
											"consent_agreed",
											"verification_browser_started",
											"verification_browser_ready",
											"verification_browser_reconnect_started",
											"verification_browser_reconnected",
											"verification_browser_failed",
											"verification_provider_started",
											"provider_config",
											"provider_script_log",
											"network_request_observed",
											"verification_page_ready",
											"verification_request_interceptor_ready",
											"verification_provider_completed",
											"auth_required",
											"auth_submitted",
											"auth_challenge_remains",
											"auth_rejected",
											"auth_submission_failed",
											"auth_challenge_completed",
											"auth_gate_not_detected",
											"authenticated",
											"user_interaction_started",
											"user_input_started",
											"user_interaction_summary",
											"verification_inactivity_detected",
											"request_matched",
											"request_match_failed",
											"request_claim_parameters_captured",
											"request_claim_created",
											"request_claim_retrying",
											"request_claim_completed",
											"request_claim_rejected",
											"request_claim_failed",
											"verification_proofs_completed",
											"verification_result_submitting",
											"verification_result_submission_failed",
											"verification_success",
											"verification_rejected",
											"verification_error",
											"session_expired"
										]
									}
								}
							}
						},
						{
							"type": "object",
							"additionalProperties": false,
							"description": "A subscription whose deliveries wait for you to read them. It has no URL. An org has at most one.",
							"required": [
								"deliveryMode"
							],
							"properties": {
								"deliveryMode": {
									"type": "string",
									"enum": [
										"pull"
									]
								},
								"callbackUrl": {
									"description": "Not allowed. A pull subscription has no URL.",
									"not": {

									}
								},
								"events": {
									"type": "array",
									"description": "Events to keep. Defaults to every event.",
									"minItems": 1,
									"maxItems": 51,
									"items": {
										"type": "string",
										"description": "Canonical Builder lifecycle event. Names use lower snake case; metadata uses camel case. Provider events include providerId, resolvedVersion, and ordinal. Request events also include requestId. New values are additive, so clients must tolerate unknown response values. For field requirements and funnel semantics, see docs/verification-analytics-events.md.",
										"enum": [
											"billing_required",
											"session_pending",
											"verification_client_opened",
											"verification_client_ready",
											"verification_client_warning",
											"verification_client_visibility_shown",
											"verification_client_visibility_hidden",
											"verification_diagnostics_mode_changed",
											"verification_cancelled",
											"consent_viewed",
											"consent_scrolled",
											"consent_agreed",
											"verification_browser_started",
											"verification_browser_ready",
											"verification_browser_reconnect_started",
											"verification_browser_reconnected",
											"verification_browser_failed",
											"verification_provider_started",
											"provider_config",
											"provider_script_log",
											"network_request_observed",
											"verification_page_ready",
											"verification_request_interceptor_ready",
											"verification_provider_completed",
											"auth_required",
											"auth_submitted",
											"auth_challenge_remains",
											"auth_rejected",
											"auth_submission_failed",
											"auth_challenge_completed",
											"auth_gate_not_detected",
											"authenticated",
											"user_interaction_started",
											"user_input_started",
											"user_interaction_summary",
											"verification_inactivity_detected",
											"request_matched",
											"request_match_failed",
											"request_claim_parameters_captured",
											"request_claim_created",
											"request_claim_retrying",
											"request_claim_completed",
											"request_claim_rejected",
											"request_claim_failed",
											"verification_proofs_completed",
											"verification_result_submitting",
											"verification_result_submission_failed",
											"verification_success",
											"verification_rejected",
											"verification_error",
											"session_expired"
										]
									}
								}
							}
						}
					]
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"openWorldHint":false},
	},
	"CreateOrg": {
		description: "Create an organization\n\nCreates a new `ORG`-kind organization with the caller as its first `OWNER`. Every user gets a default organization at sign-up, and it counts toward their org-creation limit (1 active organization unless Reclaim support raises it). Past the limit this returns `409`; contact support@reclaimprotocol.org to raise the limit or archive an organization.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for `POST /orgs` — just a name. Every org is created keyless, like each user's default org; its Ethereum (secp256k1) key pair is published separately via `PUT /orgs/{orgId}/keypair`, which is also where `canEncryptResult` is set. Creation deliberately collects nothing else so it never blocks on generating and safeguarding a private key.",
					"required": [
						"name"
					],
					"properties": {
						"name": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"CreateOrgCallbackSubscription": {
		description: "Register a callback subscription on an organization\n\nRegisters an organization callback subscription. Pass the callback URL and events to deliver. Builder encrypts signed results when the organization enables result encryption.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"description": "Body for `POST /orgs/{orgId}/callback-subscriptions`. The owning organization comes from the path; bearer-authenticated and gated on org membership. Delivery is scoped to the org and encrypted to its credential when set. Send `callbackUrl` for a webhook, or `deliveryMode: \"pull\"` for a subscription you read.",
					"oneOf": [
						{
							"type": "object",
							"additionalProperties": false,
							"description": "A subscription that Builder POSTs each delivery to.",
							"required": [
								"callbackUrl",
								"events"
							],
							"properties": {
								"deliveryMode": {
									"type": "string",
									"description": "Omit it or send `webhook`.",
									"enum": [
										"webhook"
									]
								},
								"callbackUrl": {
									"type": "string",
									"pattern": "^https?://",
									"description": "Callback URL or template. Supported placeholders are `{{sessionId}}` and top-level scalar context keys.",
									"maxLength": 2000
								},
								"events": {
									"type": "array",
									"minItems": 1,
									"maxItems": 51,
									"items": {
										"type": "string",
										"description": "Canonical Builder lifecycle event. Names use lower snake case; metadata uses camel case. Provider events include providerId, resolvedVersion, and ordinal. Request events also include requestId. New values are additive, so clients must tolerate unknown response values. For field requirements and funnel semantics, see docs/verification-analytics-events.md.",
										"enum": [
											"billing_required",
											"session_pending",
											"verification_client_opened",
											"verification_client_ready",
											"verification_client_warning",
											"verification_client_visibility_shown",
											"verification_client_visibility_hidden",
											"verification_diagnostics_mode_changed",
											"verification_cancelled",
											"consent_viewed",
											"consent_scrolled",
											"consent_agreed",
											"verification_browser_started",
											"verification_browser_ready",
											"verification_browser_reconnect_started",
											"verification_browser_reconnected",
											"verification_browser_failed",
											"verification_provider_started",
											"provider_config",
											"provider_script_log",
											"network_request_observed",
											"verification_page_ready",
											"verification_request_interceptor_ready",
											"verification_provider_completed",
											"auth_required",
											"auth_submitted",
											"auth_challenge_remains",
											"auth_rejected",
											"auth_submission_failed",
											"auth_challenge_completed",
											"auth_gate_not_detected",
											"authenticated",
											"user_interaction_started",
											"user_input_started",
											"user_interaction_summary",
											"verification_inactivity_detected",
											"request_matched",
											"request_match_failed",
											"request_claim_parameters_captured",
											"request_claim_created",
											"request_claim_retrying",
											"request_claim_completed",
											"request_claim_rejected",
											"request_claim_failed",
											"verification_proofs_completed",
											"verification_result_submitting",
											"verification_result_submission_failed",
											"verification_success",
											"verification_rejected",
											"verification_error",
											"session_expired"
										]
									}
								}
							}
						},
						{
							"type": "object",
							"additionalProperties": false,
							"description": "A subscription whose deliveries wait for you to read them. It has no URL. An org has at most one.",
							"required": [
								"deliveryMode"
							],
							"properties": {
								"deliveryMode": {
									"type": "string",
									"enum": [
										"pull"
									]
								},
								"callbackUrl": {
									"description": "Not allowed. A pull subscription has no URL.",
									"not": {

									}
								},
								"events": {
									"type": "array",
									"description": "Events to keep. Defaults to every event.",
									"minItems": 1,
									"maxItems": 51,
									"items": {
										"type": "string",
										"description": "Canonical Builder lifecycle event. Names use lower snake case; metadata uses camel case. Provider events include providerId, resolvedVersion, and ordinal. Request events also include requestId. New values are additive, so clients must tolerate unknown response values. For field requirements and funnel semantics, see docs/verification-analytics-events.md.",
										"enum": [
											"billing_required",
											"session_pending",
											"verification_client_opened",
											"verification_client_ready",
											"verification_client_warning",
											"verification_client_visibility_shown",
											"verification_client_visibility_hidden",
											"verification_diagnostics_mode_changed",
											"verification_cancelled",
											"consent_viewed",
											"consent_scrolled",
											"consent_agreed",
											"verification_browser_started",
											"verification_browser_ready",
											"verification_browser_reconnect_started",
											"verification_browser_reconnected",
											"verification_browser_failed",
											"verification_provider_started",
											"provider_config",
											"provider_script_log",
											"network_request_observed",
											"verification_page_ready",
											"verification_request_interceptor_ready",
											"verification_provider_completed",
											"auth_required",
											"auth_submitted",
											"auth_challenge_remains",
											"auth_rejected",
											"auth_submission_failed",
											"auth_challenge_completed",
											"auth_gate_not_detected",
											"authenticated",
											"user_interaction_started",
											"user_input_started",
											"user_interaction_summary",
											"verification_inactivity_detected",
											"request_matched",
											"request_match_failed",
											"request_claim_parameters_captured",
											"request_claim_created",
											"request_claim_retrying",
											"request_claim_completed",
											"request_claim_rejected",
											"request_claim_failed",
											"verification_proofs_completed",
											"verification_result_submitting",
											"verification_result_submission_failed",
											"verification_success",
											"verification_rejected",
											"verification_error",
											"session_expired"
										]
									}
								}
							}
						}
					]
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"CreateProvider": {
		description: "Create a provider\n\nCreates a provider in an organization. Call providers first and only create when nothing existing covers the domain. Requires active membership of the target organization. A provider starts empty — add its recipe with create_provider_version.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "`title` is optional — when omitted the dashboard renders `seoSuggestions.title` (server-derived from the scrape result or `derive_brand_name(domain)`).",
					"required": [
						"orgId",
						"domain",
						"slug"
					],
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"domain": {
							"description": "Canonical root domain (for example, `github.com`). No scheme, no port, no path.",
							"type": "string",
							"format": "hostname",
							"minLength": 1,
							"maxLength": 200
						},
						"slug": {
							"description": "URL-safe identifier. Globally unique — pick something domain-specific like `github-followers`.",
							"type": "string",
							"pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
							"minLength": 1,
							"maxLength": 100
						},
						"title": {
							"description": "Short headline shown to end-users. Defaults to a domain-derived brand name.",
							"type": "string",
							"minLength": 1,
							"maxLength": 100
						},
						"description": {
							"type": "string",
							"minLength": 1,
							"maxLength": 2000
						},
						"iconUrl": {
							"description": "uri of the icon. Optional. If omitted, the server auto-populates from the first version's `initialUrl` (see `Provider.iconUrl`).",
							"type": "string",
							"format": "uri",
							"maxLength": 2000
						},
						"visibility": {
							"type": "string",
							"description": "The visibility of the entity.\n\n- `PRIVATE`: Only the owner can see the entity.\n\n- `PUBLIC`: Anyone can see the entity.",
							"enum": [
								"PRIVATE",
								"PUBLIC"
							]
						},
						"tags": {
							"type": "array",
							"maxItems": 50,
							"uniqueItems": true,
							"default": [

							],
							"items": {
								"type": "string",
								"description": "A free-form label attached to an entity for grouping and filtering in listings. Must start and end with an alphanumeric character; only ASCII letters, digits, spaces, and hyphens are allowed between.",
								"pattern": "^[A-Za-z0-9]([A-Za-z0-9 \\-]*[A-Za-z0-9])?$",
								"minLength": 1,
								"maxLength": 50
							}
						},
						"seo": {
							"type": "object",
							"additionalProperties": false,
							"description": "Author-set SEO fields. All optional.\n\nEach field is paired with a server-derived default of the\nsame name on `Provider.seoSuggestions`. Renderers pick the\neffective value per field:\n\n    effective.<field> = seo.<field> ?? seoSuggestions.<field>\n\nSet a field here to override; leave it unset to let the\ndefault win. Both objects are returned on every\n`GET /providers/{id}` — the builder does not pre-merge.\n",
							"properties": {
								"brandUrl": {
									"type": "string",
									"format": "uri",
									"description": "Canonical homepage of the brand (for example, `https://google.com`). Used in brand-link cards and JSON-LD.",
									"maxLength": 2000
								},
								"primaryDataPoint": {
									"type": "string",
									"description": "Headline data point — the single most-important variable this provider can verify (for example, `subscriber count`). Used in the provider's SEO title.",
									"maxLength": 200
								},
								"dataPoints": {
									"type": "array",
									"description": "Full list of data points this provider can verify.",
									"maxItems": 50,
									"items": {
										"type": "string",
										"maxLength": 200
									}
								},
								"titleOverride": {
									"type": "string",
									"description": "Replaces the renderer's composed `<title>` / OG title. Use when the default composition reads awkwardly.",
									"maxLength": 200
								},
								"descriptionOverride": {
									"type": "string",
									"description": "Replaces the renderer's composed `<meta name=\"description\">` / OG description.",
									"maxLength": 320
								}
							}
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"CreateProviderVersion": {
		description: "Create a new provider version\n\nCreates a new immutable semantic version of a provider. Every recipe change needs its own version; existing versions are never edited in place. Defaults to a patch bump. Publish it with publish_provider_version, or submit it for review with submit_provider_version_for_review.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for creating a new version of a provider. Every new version starts on the `draft` branch — see `CreateProviderVersion`. The request body never sets `branch` directly; going live is a separate, explicit step (publish for PRIVATE, submit-for-review → approve for PUBLIC). `verificationType` defaults to `structured`; pass `llm` with a `prompt` to author an AI-verification provider.",
					"required": [
						"initialUrl",
						"requests",
						"allowedJsRequests",
						"webSettings"
					],
					"properties": {
						"verificationType": {
							"type": "string",
							"description": "How a provider version verifies a claim. `structured` uses the explicit match rules on this version (the `matches` / `allowedJsMatches` and related settings). `llm` defers the verification decision to a language model and requires `prompt` to be set.",
							"enum": [
								"llm",
								"structured"
							]
						},
						"prompt": {
							"type": "string",
							"description": "Extraction prompt, used (and required) when `verificationType` is `llm`. Gated by the prompt guard before it is stored (docs/prompt-guard.md).",
							"minLength": 0,
							"maxLength": 4000
						},
						"version": {
							"type": "object",
							"additionalProperties": false,
							"required": [
								"major",
								"minor",
								"patch"
							],
							"properties": {
								"major": {
									"type": "integer",
									"minimum": 0
								},
								"minor": {
									"type": "integer",
									"minimum": 0
								},
								"patch": {
									"type": "integer",
									"minimum": 0
								},
								"branch": {
									"type": "string",
									"description": "Branch (lifecycle stage) of this provider version.\n\n- `ai`: changes authored by the AI assistant live on this branch.\n\n- `draft`: a human is actively editing the version.\n\n- `fixed`: a proven AI repair. It remains pinned to its explicit\n  version and does not replace the live trunk version.\n\n- `in_review`: the author has submitted the version to be made\n  public and it is awaiting review. On approval the branch tag\n  is cleared (the version is promoted to the live channel and becomes\n  public).\n\n- `rejected`: review concluded with a rejection. When the author\n  addresses the feedback the branch transitions back to\n  `in_review`.",
									"enum": [
										"ai",
										"draft",
										"fixed",
										"in_review",
										"rejected"
									]
								},
								"buildNumber": {
									"type": "integer",
									"description": "Build number for the provider version",
									"minimum": 0
								}
							}
						},
						"initialUrl": {
							"type": "string",
							"format": "uri"
						},
						"requests": {
							"type": "array",
							"minItems": 0,
							"default": [

							],
							"items": {
								"type": "object",
								"additionalProperties": false,
								"description": "A matcher for one HTTP request in observed traffic, together with the response constraints that must hold for a Reclaim proof over that request to be valid. Used by interceptors, in-page injections, and LLM agents.",
								"required": [
									"url",
									"method"
								],
								"properties": {
									"url": {
										"type": "string",
										"description": "The URL or generic path of the HTTP request."
									},
									"method": {
										"type": "string",
										"description": "The HTTP method used for the request.",
										"enum": [
											"GET",
											"POST",
											"PUT",
											"PATCH",
											"DELETE"
										]
									},
									"requestBodyTemplate": {
										"type": "string",
										"description": "Template used to match or capture an outgoing request body. Template can use regex templates as placeholders. For example, to match an outgoing request body that contains a request ID, you can use the following template: `(?<requestId>.*)`.",
										"maxLength": 100000
									},
									"headers": {
										"type": "object",
										"additionalProperties": {
											"type": "string",
											"maxLength": 16000
										},
										"maxProperties": 100,
										"description": "Static HTTP request headers passed to the attestor. Header values may use the same `{{param}}` and `{{context.key}}` templates as the URL and request body. Cookies captured by the Verification Client are attached separately and don't need to be declared."
									},
									"credentials": {
										"type": "string",
										"description": "Mirrors the Fetch API `RequestCredentials` value used when issuing the request — controls whether cookies and auth headers are sent.",
										"enum": [
											"omit",
											"same-origin",
											"include"
										]
									},
									"writeRedactionMode": {
										"type": "string",
										"description": "How the matched portion of the response should be redacted before the transcript is handed to the attestor.\n- `zk`: redact using a zero-knowledge proof over the original\n  bytes.\n\n- `key-update`: redact by performing a TLS key update so the\n  attestor never observes the matched bytes in cleartext.",
										"enum": [
											"zk",
											"key-update"
										]
									},
									"additionalClientOptions": {
										"type": "object",
										"additionalProperties": false,
										"description": "Apply TLS configuration when creating the tunnel to the attestor.",
										"properties": {
											"supportedProtocolVersions": {
												"type": "array",
												"description": "TLS protocol versions the client is allowed to negotiate.",
												"minItems": 1,
												"uniqueItems": true,
												"items": {
													"type": "string",
													"enum": [
														"TLS1_2",
														"TLS1_3"
													]
												}
											}
										}
									},
									"responseMatches": {
										"type": "array",
										"description": "Conditions the (redacted) response must satisfy for the proof to be valid. Each runs against the union of the portions revealed by `responseRedactions` (or the whole response when there are none). Mirrors attestor-core `responseMatches`.",
										"minItems": 1,
										"items": {
											"type": "object",
											"additionalProperties": false,
											"description": "Specifies a rule to match against a string in response to validate proof content.",
											"required": [
												"type",
												"value"
											],
											"properties": {
												"isOptional": {
													"type": "boolean",
													"description": "If true, the match condition is optional and won't fail if absent",
													"default": false
												},
												"description": {
													"type": "string",
													"description": "The description of the field that is extracted using this match rule",
													"minLength": 1,
													"maxLength": 1000
												},
												"order": {
													"type": "integer",
													"description": "The order in which the field should be displayed to user in UI",
													"minimum": 0
												},
												"type": {
													"type": "string",
													"description": "The matching mechanism to use value as against response. Typically regex or simple string containment",
													"enum": [
														"regex",
														"contains"
													]
												},
												"value": {
													"type": "string",
													"description": "The pattern or value to look for in the response. When `type` is 'contains', supports template variable declaration using `{{variable}}` syntax. When `type` is 'regex', can be used to extract variables using regex named groups."
												}
											}
										}
									},
									"responseRedactions": {
										"type": "array",
										"description": "Portions to select/reveal from the response, applied in order (xPath => jsonPath => regex). Done client-side; only the selected portions (plus the first response line) are sent to the attestor. An independent ordered list — not generally paired 1:1 with `responseMatches`. For legacy proof-hash optional-subset compatibility only, the redaction at the same index is treated as the pair for an optional `ResponseMatch`; this does not pair all redactions with matches. Mirrors attestor-core `responseRedactions`.",
										"items": {
											"type": "object",
											"additionalProperties": false,
											"description": "Which portions to select from a response. These are selected in order, xpath => jsonPath => regex * These redactions are done client side and only the selected portions are sent to the attestor. The attestor will only be able to see the selected portions alongside the first line of the HTTP response (that is, \"HTTP/1.1 200 OK\")",
											"properties": {
												"xPath": {
													"type": "string",
													"description": "expect an HTML response, and to contain a certain xpath for eg. \"/html/body/div.a1/div.a2/span.a5\""
												},
												"jsonPath": {
													"type": "string",
													"description": "expect a JSON response, retrieve the item at this path using dot notation, for example 'email.addresses.0'."
												},
												"regex": {
													"type": "string",
													"description": "select a regex match from the response"
												},
												"hash": {
													"type": "string",
													"description": "If provided, the value inside will be hashed instead of being redacted. Useful for cases where the data inside is an identifiying piece of information that you don't want to reveal to the attestor, eg. an email address.\nIf the hash function produces more bytes than the original value, the hash will be truncated.\nEg. if hash is enabled, the original value is \"hello\", and hashed is \"a1b2c\", then the attestor will only see \"a1b2c\".\nNote: if a regex with named groups is provided, only the named groups will be hashed.",
													"enum": [
														"oprf",
														"oprf-mpc",
														"oprf-raw"
													]
												}
											}
										}
									}
								}
							}
						},
						"allowedJsRequests": {
							"type": "array",
							"minItems": 0,
							"default": [

							],
							"items": {
								"type": "object",
								"additionalProperties": false,
								"description": "A template for selecting requests. Same matcher shape as `RequestSelection`, plus template flags (`multiple`/`required`) and optional `templateParams` expansion.",
								"required": [
									"url",
									"method",
									"multiple",
									"required"
								],
								"properties": {
									"url": {
										"type": "string",
										"description": "The URL or generic path of the HTTP request."
									},
									"method": {
										"type": "string",
										"description": "The HTTP method used for the request.",
										"enum": [
											"GET",
											"POST",
											"PUT",
											"PATCH",
											"DELETE"
										]
									},
									"requestBodyTemplate": {
										"type": "string",
										"description": "Template used to match or capture an outgoing request body. Template can use regex templates as placeholders. For example, to match an outgoing request body that contains a request ID, you can use the following template: `(?<requestId>.*)`.",
										"maxLength": 100000
									},
									"headers": {
										"type": "object",
										"additionalProperties": {
											"type": "string",
											"maxLength": 16000
										},
										"maxProperties": 100,
										"description": "Static HTTP request headers passed to the attestor. Values may contain `{{param}}` and `{{context.key}}` templates."
									},
									"credentials": {
										"type": "string",
										"description": "Mirrors the Fetch API `RequestCredentials` value used when issuing the request — controls whether cookies and auth headers are sent.",
										"enum": [
											"omit",
											"same-origin",
											"include"
										]
									},
									"writeRedactionMode": {
										"type": "string",
										"description": "How the matched portion of the response should be redacted before the transcript is handed to the attestor.\n- `zk`: redact using a zero-knowledge proof over the original\n  bytes.\n\n- `key-update`: redact by performing a TLS key update so the\n  attestor never observes the matched bytes in cleartext.",
										"enum": [
											"zk",
											"key-update"
										]
									},
									"additionalClientOptions": {
										"type": "object",
										"additionalProperties": false,
										"description": "Apply TLS configuration when creating the tunnel to the attestor.",
										"properties": {
											"supportedProtocolVersions": {
												"type": "array",
												"description": "TLS protocol versions the client is allowed to negotiate.",
												"minItems": 1,
												"uniqueItems": true,
												"items": {
													"type": "string",
													"enum": [
														"TLS1_2",
														"TLS1_3"
													]
												}
											}
										}
									},
									"responseMatches": {
										"type": "array",
										"description": "Conditions the (redacted) response must satisfy for the proof to be valid. Each runs against the union of the portions revealed by `responseRedactions` (or the whole response when there are none). Mirrors attestor-core `responseMatches`.",
										"minItems": 1,
										"items": {
											"type": "object",
											"additionalProperties": false,
											"description": "Specifies a rule to match against a string in response to validate proof content.",
											"required": [
												"type",
												"value"
											],
											"properties": {
												"isOptional": {
													"type": "boolean",
													"description": "If true, the match condition is optional and won't fail if absent",
													"default": false
												},
												"description": {
													"type": "string",
													"description": "The description of the field that is extracted using this match rule",
													"minLength": 1,
													"maxLength": 1000
												},
												"order": {
													"type": "integer",
													"description": "The order in which the field should be displayed to user in UI",
													"minimum": 0
												},
												"type": {
													"type": "string",
													"description": "The matching mechanism to use value as against response. Typically regex or simple string containment",
													"enum": [
														"regex",
														"contains"
													]
												},
												"value": {
													"type": "string",
													"description": "The pattern or value to look for in the response. When `type` is 'contains', supports template variable declaration using `{{variable}}` syntax. When `type` is 'regex', can be used to extract variables using regex named groups."
												}
											}
										}
									},
									"responseRedactions": {
										"type": "array",
										"description": "Portions to select/reveal from the response, applied in order (xPath => jsonPath => regex). Done client-side; only the selected portions (plus the first response line) are sent to the attestor. An independent ordered list — not generally paired 1:1 with `responseMatches`. For legacy proof-hash optional-subset compatibility only, the redaction at the same index is treated as the pair for an optional `ResponseMatch`; this does not pair all redactions with matches. Mirrors attestor-core `responseRedactions`.",
										"items": {
											"type": "object",
											"additionalProperties": false,
											"description": "Which portions to select from a response. These are selected in order, xpath => jsonPath => regex * These redactions are done client side and only the selected portions are sent to the attestor. The attestor will only be able to see the selected portions alongside the first line of the HTTP response (that is, \"HTTP/1.1 200 OK\")",
											"properties": {
												"xPath": {
													"type": "string",
													"description": "expect an HTML response, and to contain a certain xpath for eg. \"/html/body/div.a1/div.a2/span.a5\""
												},
												"jsonPath": {
													"type": "string",
													"description": "expect a JSON response, retrieve the item at this path using dot notation, for example 'email.addresses.0'."
												},
												"regex": {
													"type": "string",
													"description": "select a regex match from the response"
												},
												"hash": {
													"type": "string",
													"description": "If provided, the value inside will be hashed instead of being redacted. Useful for cases where the data inside is an identifiying piece of information that you don't want to reveal to the attestor, eg. an email address.\nIf the hash function produces more bytes than the original value, the hash will be truncated.\nEg. if hash is enabled, the original value is \"hello\", and hashed is \"a1b2c\", then the attestor will only see \"a1b2c\".\nNote: if a regex with named groups is provided, only the named groups will be hashed.",
													"enum": [
														"oprf",
														"oprf-mpc",
														"oprf-raw"
													]
												}
											}
										}
									},
									"multiple": {
										"type": "boolean",
										"description": "If true, the template is allowed for multiple requests. Useful for requests like paginated API calls.",
										"default": true
									},
									"required": {
										"type": "boolean",
										"description": "If true, a request is required to match with this template. If not requests matches this template in proof, then validation fails.",
										"default": true
									},
									"templateParams": {
										"type": "array",
										"description": "Names of `${param}` placeholders used in this template's `responseMatches` / `responseRedactions`, substituted at verification time from array-valued extracted parameters (each name must resolve to an array of values; all named arrays must have the same length). Absent or empty means the template is used as-is with no expansion.",
										"maxItems": 50,
										"items": {
											"type": "string",
											"minLength": 1,
											"maxLength": 100
										}
									},
									"templateParamsMode": {
										"type": "string",
										"description": "How array values of `templateParams` expand the template: `separate` (default) emits one expanded request — its own claim — per value; `merge` emits a single request whose `responseMatches`/`responseRedactions` contain all substituted entries, proven by one claim.",
										"enum": [
											"separate",
											"merge"
										],
										"default": "separate"
									}
								}
							}
						},
						"webSettings": {
							"type": "object",
							"additionalProperties": false,
							"description": "Settings used by the web-based verification client.",
							"properties": {
								"geoLocation": {
									"type": "string",
									"description": "Geographic location the verification should appear to originate from: a 2-letter ISO country code, or a parameter the attestor resolves at proof time. `{{DYNAMIC_GEO}}` and `{{DYNAMIC_GEO_SECRET}}` are the Verification Client's standard names for the end-user's own country — the `_SECRET` one is delivered as a secret param, so the attestor never learns which country the proof egressed from.",
									"maxLength": 64,
									"default": "{{DYNAMIC_GEO}}"
								},
								"clientOptions": {
									"type": "object",
									"additionalProperties": false,
									"description": "Options that influence how the web verification client behaves.",
									"properties": {
										"portal": {
											"type": "object",
											"additionalProperties": false,
											"description": "Options that influence how the portal verification client behaves.",
											"properties": {
												"useProxy": {
													"type": "boolean",
													"description": "When true, network traffic from the portal client and attestation is routed through a proxy.",
													"default": true
												},
												"userAgent": {
													"type": "string",
													"description": "User-agent string used for platform verification.",
													"maxLength": 500
												}
											}
										},
										"inapp": {
											"type": "object",
											"additionalProperties": false,
											"description": "Options that influence how the in-app verification client behaves.",
											"properties": {
												"interceptorOptions": {
													"type": "object",
													"additionalProperties": false,
													"required": [
														"interceptorType"
													],
													"properties": {
														"interceptorType": {
															"type": "string",
															"description": "How traffic interception is implemented.",
															"enum": [
																"HAWKEYE",
																"MSWJS",
																"CDP"
															]
														},
														"isDocumentRequestReplayEnabled": {
															"type": "boolean",
															"description": "Whether the main document request is replayed via the attestor",
															"default": false
														},
														"interceptorSettings": {
															"type": "string",
															"description": "Free-form configuration passed through to the interceptor implementation selected by `interceptorType`. Keys and value shapes are defined by the chosen interceptor.",
															"contentMediaType": "application/json"
														}
													}
												},
												"userAgents": {
													"type": "object",
													"additionalProperties": false,
													"description": "User-agent strings keyed by platform.",
													"properties": {
														"android": {
															"type": "string",
															"description": "User-agent string used for platform verification.",
															"maxLength": 500
														},
														"ios": {
															"type": "string",
															"description": "User-agent string used for platform verification.",
															"maxLength": 500
														}
													}
												}
											}
										},
										"extension": {
											"type": "object",
											"description": "Free-form key-value configuration for the browser-extension verification client. Keys and value shapes are defined by the extension client; values may be any JSON. Absent by default.",
											"maxProperties": 100,
											"additionalProperties": true
										}
									}
								},
								"jsUserScripts": {
									"type": "string",
									"description": "JavaScript snippets injected into the page which runs before every page load. `window.Reclaim.` APIs are available to these scripts to request actions to the client like claim creation.",
									"maxLength": 1000000
								},
								"browserRequestActions": {
									"type": "array",
									"description": "Portal-only authenticated browser actions available to `jsUserScripts` through `window.Reclaim.browserRequest`.",
									"maxItems": 50,
									"items": {
										"type": "object",
										"additionalProperties": false,
										"description": "A portal-only, provider-declared HTTP action for `window.Reclaim.browserRequest`. The claimant page supplies only the action id and declared primitive inputs; the recipe controls the HTTPS origin, request template, and returned fields. Other Verification Clients currently ignore this field.",
										"required": [
											"id",
											"origin",
											"path",
											"method"
										],
										"properties": {
											"id": {
												"type": "string",
												"pattern": "^[A-Za-z][A-Za-z0-9_-]{0,99}$",
												"minLength": 1,
												"maxLength": 100
											},
											"origin": {
												"type": "string",
												"format": "uri",
												"pattern": "^https://[^/?#]+$",
												"maxLength": 2000
											},
											"path": {
												"type": "string",
												"description": "Origin-relative fallback path.",
												"pattern": "^/(?:$|[^/\\\\][^\\\\]*)$",
												"maxLength": 4000
											},
											"pathTemplate": {
												"type": "string",
												"description": "Optional origin-relative path/query template. Declared inputs use `{{name}}` and are URL-encoded.",
												"pattern": "^/(?:$|[^/\\\\][^\\\\]*)$",
												"maxLength": 4000
											},
											"method": {
												"type": "string",
												"enum": [
													"GET",
													"POST",
													"PUT",
													"PATCH",
													"DELETE"
												]
											},
											"transport": {
												"type": "string",
												"description": "`fetch` is the default. `navigate` supports GET only and performs a top-level navigation in the action's isolated browser page.",
												"enum": [
													"fetch",
													"navigate"
												]
											},
											"userAgent": {
												"type": "string",
												"description": "Browser User-Agent applied to the isolated action page before its first navigation. Use only when the target origin requires a specific browser identity.",
												"minLength": 1,
												"maxLength": 300,
												"pattern": "^[^\\r\\n]+$"
											},
											"omitOriginHeader": {
												"type": "boolean",
												"description": "Remove Chromium's automatic Origin header from a fetch action. Unsupported for navigate actions."
											},
											"headers": {
												"type": "object",
												"maxProperties": 50,
												"additionalProperties": {
													"type": "string",
													"maxLength": 8192
												}
											},
											"headersTemplate": {
												"type": "object",
												"description": "Header values may interpolate declared `{{name}}` inputs.",
												"maxProperties": 50,
												"additionalProperties": {
													"type": "string",
													"maxLength": 8192
												}
											},
											"bodyTemplate": {
												"type": "string",
												"description": "JSON template whose `{{name}}` inputs are inserted as JSON literals. The rendered body is limited again at execution time.",
												"maxLength": 65536
											},
											"cookieValueHeader": {
												"type": "object",
												"additionalProperties": false,
												"description": "Copies one same-origin, script-readable cookie into a request header. The cookie value stays inside the verification client's browser.",
												"required": [
													"name",
													"cookieName"
												],
												"properties": {
													"name": {
														"type": "string",
														"minLength": 1,
														"maxLength": 256
													},
													"cookieName": {
														"type": "string",
														"minLength": 1,
														"maxLength": 256
													}
												}
											},
											"includeBody": {
												"type": "boolean",
												"description": "Return the bounded raw response body."
											},
											"inputKeys": {
												"type": "array",
												"maxItems": 50,
												"uniqueItems": true,
												"items": {
													"type": "string",
													"pattern": "^[A-Za-z][A-Za-z0-9_]{0,99}$",
													"maxLength": 100
												}
											},
											"responseFields": {
												"type": "array",
												"maxItems": 50,
												"uniqueItems": true,
												"items": {
													"type": "string",
													"pattern": "^[A-Za-z][A-Za-z0-9_]{0,99}$",
													"maxLength": 100
												}
											}
										}
									}
								}
							}
						},
						"requiredContext": {
							"type": "object",
							"description": "Optional JSON Schema describing the `context` a Consumer must supply when creating a verification session for this provider version. Only needed when the recipe expects Consumer-supplied values: those are referenced as `{{context.<key>}}` in recipe requests. Bare `{{parameterName}}` placeholders are normally provider parameters extracted from claimant traffic. For old DevTools recipes, Builder-mode Verification Clients seed a missing bare `parameterName` from a same-named scalar session context field when the recipe doesn't use `{{context.parameterName}}`; an explicit parameter always wins. New recipes should use the explicit `{{context.<key>}}` form. Bare parameters need no declaration here. Builder-owned `reclaimSessionId` and `attestationNonce` remain context-only. The Builder validates `CreateVerificationSessionRequest.context` against this schema and rejects the request (400) on mismatch. Extra context fields are always allowed regardless of the schema (a root-level `additionalProperties: false` is ignored). Empty/absent accepts any context.",
							"additionalProperties": true
						},
						"notes": {
							"type": "string",
							"description": "Free-form change note recorded on `createMetadata`.",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"CreateTheme": {
		description: "Create a theme in an organization\n\nCreates a theme in the organization: the colors, logo and copy of the verification screens. Pass its id as `themeId` when you create a session; the session keeps a snapshot.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"required": [
						"label"
					],
					"properties": {
						"label": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						},
						"iconUrl": {
							"type": "string",
							"format": "uri",
							"maxLength": 2000
						},
						"preferredLocale": {
							"type": "string",
							"minLength": 2,
							"maxLength": 64,
							"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
						},
						"consent": {
							"type": "object",
							"additionalProperties": false,
							"minProperties": 1,
							"description": "A full-screen consent prompt shown once, before the end-user is navigated to the provider's site — mirrors reclaim-portal's `ConsentInfo`. Absent on the owning `Theme` ⇒ no consent screen is shown for that org's sessions.",
							"properties": {
								"title": {
									"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
									"oneOf": [
										{
											"type": "string",
											"minLength": 1,
											"maxLength": 2000
										},
										{
											"type": "object",
											"minProperties": 1,
											"maxProperties": 50,
											"propertyNames": {
												"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
											},
											"additionalProperties": {
												"type": "string",
												"minLength": 1,
												"maxLength": 2000
											}
										}
									]
								},
								"body": {
									"description": "The consent copy. A single string, or an array of strings rendered as a bullet list (matches reclaim-portal, where `body` can be either shape).",
									"oneOf": [
										{
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										{
											"type": "array",
											"items": {
												"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
												"oneOf": [
													{
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													},
													{
														"type": "object",
														"minProperties": 1,
														"maxProperties": 50,
														"propertyNames": {
															"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
														},
														"additionalProperties": {
															"type": "string",
															"minLength": 1,
															"maxLength": 2000
														}
													}
												]
											},
											"minItems": 1,
											"maxItems": 20
										}
									]
								},
								"disclaimer": {
									"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
									"oneOf": [
										{
											"type": "string",
											"minLength": 1,
											"maxLength": 2000
										},
										{
											"type": "object",
											"minProperties": 1,
											"maxProperties": 50,
											"propertyNames": {
												"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
											},
											"additionalProperties": {
												"type": "string",
												"minLength": 1,
												"maxLength": 2000
											}
										}
									]
								},
								"continueButtonLabel": {
									"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
									"oneOf": [
										{
											"type": "string",
											"minLength": 1,
											"maxLength": 2000
										},
										{
											"type": "object",
											"minProperties": 1,
											"maxProperties": 50,
											"propertyNames": {
												"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
											},
											"additionalProperties": {
												"type": "string",
												"minLength": 1,
												"maxLength": 2000
											}
										}
									]
								}
							}
						},
						"clientTheme": {
							"type": "object",
							"additionalProperties": false,
							"description": "Cross-client presentation fields used by the in-app SDK and Portal. Clients apply supported visual fields and ignore fields that don't belong to their UI surface.",
							"properties": {
								"themeMode": {
									"type": "string",
									"enum": [
										"dark",
										"light",
										"system"
									],
									"default": "light"
								},
								"theme": {
									"type": "object",
									"additionalProperties": false,
									"properties": {
										"background": {
											"type": "object",
											"additionalProperties": false,
											"minProperties": 1,
											"properties": {
												"color": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"image": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												}
											}
										},
										"backgroundBlurStrength": {
											"type": "number",
											"minimum": 0,
											"maximum": 100
										},
										"backgroundBlurColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"parameterStyle": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"displayStyle": {
													"type": "string",
													"enum": [
														"compact",
														"dividerSeparated"
													]
												},
												"dividerColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"borderStyle": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"width": {
															"type": "number",
															"minimum": 0,
															"maximum": 100
														},
														"radius": {
															"type": "number",
															"minimum": 0,
															"maximum": 1000
														}
													}
												},
												"isValueShown": {
													"type": "boolean",
													"default": true
												}
											}
										},
										"colorScheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"themeColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"surfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"onSurfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												}
											}
										},
										"doneIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"appImageOptions": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"alignment": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"x": {
															"type": "number",
															"minimum": -1,
															"maximum": 1,
															"default": 0
														},
														"y": {
															"type": "number",
															"minimum": -1,
															"maximum": 1,
															"default": 0
														}
													}
												},
												"backgroundColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"opacity": {
													"type": "number",
													"minimum": 0,
													"maximum": 1,
													"default": 1
												},
												"fit": {
													"type": "string",
													"enum": [
														"cover",
														"scale_down"
													],
													"default": "cover"
												},
												"spin": {
													"type": "boolean",
													"default": false,
													"deprecated": true,
													"description": "Deprecated legacy client field retained for theme compatibility."
												}
											}
										},
										"loading": {
											"type": "object",
											"additionalProperties": false,
											"minProperties": 1,
											"properties": {
												"color": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"image": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												}
											}
										},
										"cardElevation": {
											"type": "number",
											"minimum": 0,
											"maximum": 100
										},
										"cardColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"onCardColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"sessionChipSurfaceColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"sessionChipOnSurfaceColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"termsNoticeColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"hyperlinkColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"hyperlinkColorInt": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295,
											"deprecated": true,
											"description": "Deprecated alias for `hyperlinkColor`."
										},
										"verificationReviewScreenTheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"fieldVerifyingIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"fieldVerifiedIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"providerToAppLoaderColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"providerToAppLoader": {
													"type": "object",
													"additionalProperties": false,
													"minProperties": 1,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"image": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"verificationCompleteIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"verifyScreenAppIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"verificationFailedIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												}
											}
										},
										"consentViewIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"consentDisclaimerIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"submissionConsentDisclaimerIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"consentContinueButtonTheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"backgroundColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"foregroundColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												}
											}
										},
										"verifyAnotherWayStyle": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"headerActionButtonStyle": {
													"type": "object",
													"additionalProperties": false,
													"required": [
														"style"
													],
													"properties": {
														"style": {
															"type": "string",
															"enum": [
																"filled",
																"outlined"
															]
														},
														"border": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"width": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 100
																},
																"radius": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1000
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"foregroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												},
												"failedActionButtonStyle": {
													"type": "object",
													"additionalProperties": false,
													"required": [
														"style"
													],
													"properties": {
														"style": {
															"type": "string",
															"enum": [
																"filled",
																"outlined"
															]
														},
														"border": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"width": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 100
																},
																"radius": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1000
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"foregroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												}
											}
										}
									}
								},
								"darkTheme": {
									"type": "object",
									"additionalProperties": false,
									"properties": {
										"background": {
											"type": "object",
											"additionalProperties": false,
											"minProperties": 1,
											"properties": {
												"color": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"image": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												}
											}
										},
										"backgroundBlurStrength": {
											"type": "number",
											"minimum": 0,
											"maximum": 100
										},
										"backgroundBlurColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"parameterStyle": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"displayStyle": {
													"type": "string",
													"enum": [
														"compact",
														"dividerSeparated"
													]
												},
												"dividerColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"borderStyle": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"width": {
															"type": "number",
															"minimum": 0,
															"maximum": 100
														},
														"radius": {
															"type": "number",
															"minimum": 0,
															"maximum": 1000
														}
													}
												},
												"isValueShown": {
													"type": "boolean",
													"default": true
												}
											}
										},
										"colorScheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"themeColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"surfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"onSurfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												}
											}
										},
										"doneIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"appImageOptions": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"alignment": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"x": {
															"type": "number",
															"minimum": -1,
															"maximum": 1,
															"default": 0
														},
														"y": {
															"type": "number",
															"minimum": -1,
															"maximum": 1,
															"default": 0
														}
													}
												},
												"backgroundColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"opacity": {
													"type": "number",
													"minimum": 0,
													"maximum": 1,
													"default": 1
												},
												"fit": {
													"type": "string",
													"enum": [
														"cover",
														"scale_down"
													],
													"default": "cover"
												},
												"spin": {
													"type": "boolean",
													"default": false,
													"deprecated": true,
													"description": "Deprecated legacy client field retained for theme compatibility."
												}
											}
										},
										"loading": {
											"type": "object",
											"additionalProperties": false,
											"minProperties": 1,
											"properties": {
												"color": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"image": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												}
											}
										},
										"cardElevation": {
											"type": "number",
											"minimum": 0,
											"maximum": 100
										},
										"cardColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"onCardColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"sessionChipSurfaceColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"sessionChipOnSurfaceColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"termsNoticeColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"hyperlinkColor": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295
										},
										"hyperlinkColorInt": {
											"type": "integer",
											"format": "int64",
											"minimum": 0,
											"maximum": 4294967295,
											"deprecated": true,
											"description": "Deprecated alias for `hyperlinkColor`."
										},
										"verificationReviewScreenTheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"fieldVerifyingIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"fieldVerifiedIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"providerToAppLoaderColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"providerToAppLoader": {
													"type": "object",
													"additionalProperties": false,
													"minProperties": 1,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"image": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"verificationCompleteIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"verifyScreenAppIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"verificationFailedIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												}
											}
										},
										"consentViewIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"consentDisclaimerIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"submissionConsentDisclaimerIcon": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"url": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												},
												"options": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												}
											}
										},
										"consentContinueButtonTheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"backgroundColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"foregroundColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												}
											}
										},
										"verifyAnotherWayStyle": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"headerActionButtonStyle": {
													"type": "object",
													"additionalProperties": false,
													"required": [
														"style"
													],
													"properties": {
														"style": {
															"type": "string",
															"enum": [
																"filled",
																"outlined"
															]
														},
														"border": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"width": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 100
																},
																"radius": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1000
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"foregroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												},
												"failedActionButtonStyle": {
													"type": "object",
													"additionalProperties": false,
													"required": [
														"style"
													],
													"properties": {
														"style": {
															"type": "string",
															"enum": [
																"filled",
																"outlined"
															]
														},
														"border": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"width": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 100
																},
																"radius": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1000
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"foregroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												}
											}
										}
									}
								},
								"returnToAppMessage": {
									"type": "object",
									"additionalProperties": false,
									"properties": {
										"success": {
											"type": "string",
											"maxLength": 2000
										},
										"failure": {
											"type": "string",
											"maxLength": 2000
										}
									}
								},
								"dataSharedMessage": {
									"type": "object",
									"additionalProperties": false,
									"properties": {
										"savedAndShared": {
											"type": "string",
											"maxLength": 2000
										},
										"shared": {
											"type": "string",
											"maxLength": 2000
										},
										"whatWasShared": {
											"type": "string",
											"maxLength": 2000
										}
									}
								},
								"potentialFailureReasonsLink": {
									"type": "string",
									"format": "uri",
									"maxLength": 2000
								},
								"secureAndPrivateText": {
									"type": "string",
									"maxLength": 2000
								},
								"canShowLoadingOnPageChange": {
									"type": "boolean"
								},
								"submitButtonLabel": {
									"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
									"oneOf": [
										{
											"type": "string",
											"minLength": 1,
											"maxLength": 2000
										},
										{
											"type": "object",
											"minProperties": 1,
											"maxProperties": 50,
											"propertyNames": {
												"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
											},
											"additionalProperties": {
												"type": "string",
												"minLength": 1,
												"maxLength": 2000
											}
										}
									]
								},
								"cancelButtonLabel": {
									"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
									"oneOf": [
										{
											"type": "string",
											"minLength": 1,
											"maxLength": 2000
										},
										{
											"type": "object",
											"minProperties": 1,
											"maxProperties": 50,
											"propertyNames": {
												"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
											},
											"additionalProperties": {
												"type": "string",
												"minLength": 1,
												"maxLength": 2000
											}
										}
									]
								},
								"extraTranslations": {
									"type": "object",
									"maxProperties": 200,
									"additionalProperties": {
										"$ref": "#/components/schemas/ConsentText"
									}
								},
								"portalInfo": {
									"type": "object",
									"additionalProperties": false,
									"properties": {
										"header": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"description": {
													"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
													"oneOf": [
														{
															"type": "string",
															"minLength": 1,
															"maxLength": 2000
														},
														{
															"type": "object",
															"minProperties": 1,
															"maxProperties": 50,
															"propertyNames": {
																"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
															},
															"additionalProperties": {
																"type": "string",
																"minLength": 1,
																"maxLength": 2000
															}
														}
													]
												},
												"descriptionLink": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												}
											}
										},
										"verificationReviewInfo": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"displayStyle": {
													"type": "string",
													"enum": [
														"comfortablyStartAligned"
													]
												},
												"placeholderFields": {
													"type": "array",
													"maxItems": 100,
													"items": {
														"type": "object",
														"additionalProperties": false,
														"properties": {
															"label": {
																"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																"oneOf": [
																	{
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	},
																	{
																		"type": "object",
																		"minProperties": 1,
																		"maxProperties": 50,
																		"propertyNames": {
																			"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																		},
																		"additionalProperties": {
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		}
																	}
																]
															},
															"hashed": {
																"type": "boolean"
															},
															"order": {
																"type": "integer",
																"minimum": 0
															}
														}
													}
												},
												"gettingStarted": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"title": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"subtitle": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														}
													}
												},
												"pageLoading": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"title": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"subtitle": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														}
													}
												},
												"lookingForInformation": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"title": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"subtitle": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														}
													}
												},
												"validatingInformation": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"title": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"subtitle": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														}
													}
												},
												"validationComplete": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"title": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"subtitle": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														}
													}
												},
												"validatingFailed": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"title": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"subtitle": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														}
													}
												},
												"skipGettingStartedOverlay": {
													"type": "boolean",
													"default": false
												},
												"skipPageLoadingOverlay": {
													"type": "boolean",
													"default": false
												},
												"skipCompletionOverlay": {
													"type": "boolean",
													"default": false
												}
											}
										},
										"submissionConsent": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										"verifyAnotherWayLabel": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										"verifyAnotherWayLink": {
											"type": "string",
											"format": "uri",
											"maxLength": 2000
										}
									}
								}
							}
						},
						"termsAndConditionLink": {
							"type": "string",
							"format": "uri",
							"maxLength": 2000
						},
						"privacyPolicyLink": {
							"type": "string",
							"format": "uri",
							"maxLength": 2000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"CreateVerificationSession": {
		description: "Create a verification session\n\nCreates an end-user verification session. Requires an OrgToken and a callback subscription; pass providers, context, and an optional registered verificationClientUrl (omitted: the Portal). Send the end user to the returned verificationUrl; that is where they verify. Billing refusal returns 402 or 429 with event billing_required and a terminal sessionId.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for `POST /verifications/sessions`. Authenticated by the consumer's `OrgToken`. Carries no callback URLs — they come from the org's callback subscriptions. The one shared `context` is validated against every provider's `requiredContext`.",
					"required": [
						"providers",
						"context"
					],
					"properties": {
						"providers": {
							"type": "array",
							"minItems": 1,
							"maxItems": 20,
							"uniqueItems": true,
							"description": "Providers to verify, in run order. The Verification Client runs each sequentially in one browser session and submits one combined result; all are required. Provider version constraints are resolved only while this request is created; clients receive the exact immutable resolved versions and never resolve them again.",
							"items": {
								"type": "object",
								"additionalProperties": false,
								"description": "A provider (+ optional version) to verify in a session.",
								"required": [
									"providerId"
								],
								"properties": {
									"providerId": {
										"type": "string",
										"format": "uuid"
									},
									"version": {
										"type": "string",
										"description": "Empty selects the latest active trunk version. An exact semantic version pins that version. Any other valid npm semantic-version range selects the highest active matching version.",
										"maxLength": 64
									}
								}
							}
						},
						"context": {
							"type": "object",
							"additionalProperties": true,
							"description": "Consumer context, shared by all providers. Validated against EACH resolved provider version's `requiredContext` JSON Schema (a 400 is returned on mismatch); extra fields are always allowed. Recipe requests resolve scalar values as `{{context.key}}`, then `{{context_key}}`, then `{{key}}`. A lower-priority alias is used only when the recipe doesn't use a higher-priority spelling; an explicit parameter takes precedence. Echoed back (plus `reclaimSessionId`) in the result. Builder-owned `reclaimSessionId` and `attestationNonce` remain context-only."
						},
						"verificationClientUrl": {
							"type": "string",
							"description": "Optional. Must exactly equal the base URL of a registered verification client (see the `verification_clients` registry / `/admin/verification-clients`). Omit to use the default (`portals`) client. The Builder resolves and stores the registered client UUID, then returns the ready-to-share `verificationUrl` with the session id and `api=2`. A URL that is not a registered client's base is rejected with 400. Consumers append any client-owned redirect parameters after receiving the URL; Builder does not manage them. The built-in clients are `{origin}/share/{name}`, listed in the examples.",
							"maxLength": 2000,
							"pattern": "^https?://",
							"examples": [
								"https://build.reclaimprotocol.org/share/portals",
								"https://build.reclaimprotocol.org/share/verifier-app",
								"https://build.reclaimprotocol.org/share/reclaim-browser-extension",
								"https://build.reclaimprotocol.org/share/builder",
								"https://build.reclaimprotocol.org/share/inapp-sdk"
							]
						},
						"themeId": {
							"type": "string",
							"format": "uuid"
						},
						"preferredLocale": {
							"type": "string",
							"description": "Optional locale override for this verification session. It takes precedence over the organization theme's preferred locale.",
							"minLength": 2,
							"maxLength": 64,
							"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
						},
						"preferAiAgent": {
							"type": "boolean",
							"description": "When true, the Builder verification page runs the AI authoring agent instead of the providers' structured recipes. A proven recipe is published only for the provider's own organization; for any other provider it is submitted for admin review. Omit it to run the stored recipes."
						},
						"diagnostics": {
							"type": "boolean",
							"description": "Optional; omit or send false for a normal session. Opts this session into diagnostic mode. A diagnostic session records more event detail, including personal data such as the claimant's IP addresses (see ClaimantDetails.network). Builder appends `diag=1` to the returned `verificationUrl` for a diagnostic session and strips any `diag` value the Consumer's own `verificationClientUrl` carries, so this field — not the URL — is the only way to turn diagnostics on. Treat a diagnostic verification URL as sensitive, and don't hand it to a claimant by default."
						},
						"launchOptions": {
							"type": "object",
							"additionalProperties": false,
							"description": "Where a Verification Client sends the claimant's browser at the end of a flow. Builder stores these on the session and returns them unchanged (see VerificationSession.launchOptions / BootstrapVerificationClient) — it never reads them itself, never redirects a claimant to them, and never executes them; only the Verification Client that renders the flow does. Vocabulary matches `reclaim-js-sdk`'s `VerificationRequest` and `reclaim-portal`'s `parseVerificationLaunch`: `redirectUrl`/`redirectUrlOptions` on success, `cancelRedirectUrl`/`cancelRedirectUrlOptions` on cancellation. `https:` only — `javascript:`, `data:`, and any other scheme are rejected with 400 at session creation.",
							"properties": {
								"redirectUrl": {
									"type": "string",
									"format": "uri",
									"description": "Where to send the claimant after a successful verification.",
									"maxLength": 2000,
									"pattern": "^https://"
								},
								"redirectUrlOptions": {
									"type": "object",
									"additionalProperties": false,
									"description": "How a Verification Client performs a launch-options redirect — a plain GET (default) or a form POST/GET carrying extra fields. Matches `reclaim-portal`'s `HttpRedirectionOptions`.",
									"properties": {
										"method": {
											"type": "string",
											"enum": [
												"GET",
												"POST"
											]
										},
										"body": {
											"type": "array",
											"maxItems": 50,
											"items": {
												"type": "object",
												"additionalProperties": false,
												"required": [
													"name",
													"value"
												],
												"properties": {
													"name": {
														"type": "string",
														"maxLength": 256
													},
													"value": {
														"type": "string",
														"maxLength": 2000
													}
												}
											}
										}
									}
								},
								"cancelRedirectUrl": {
									"type": "string",
									"format": "uri",
									"description": "Where to send the claimant after a cancelled verification.",
									"maxLength": 2000,
									"pattern": "^https://"
								},
								"cancelRedirectUrlOptions": {
									"type": "object",
									"additionalProperties": false,
									"description": "How a Verification Client performs a launch-options redirect — a plain GET (default) or a form POST/GET carrying extra fields. Matches `reclaim-portal`'s `HttpRedirectionOptions`.",
									"properties": {
										"method": {
											"type": "string",
											"enum": [
												"GET",
												"POST"
											]
										},
										"body": {
											"type": "array",
											"maxItems": 50,
											"items": {
												"type": "object",
												"additionalProperties": false,
												"required": [
													"name",
													"value"
												],
												"properties": {
													"name": {
														"type": "string",
														"maxLength": 256
													},
													"value": {
														"type": "string",
														"maxLength": 2000
													}
												}
											}
										}
									}
								}
							}
						}
					}
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"openWorldHint":false},
	},
	"DecideProviderVersionReview": {
		description: "Record a decision on a provider version review\n\nApproves or rejects a provider version awaiting review. Admin only. Approval promotes the version to the live channel; rejection moves it to the rejected branch with a reason. Use admin_reviews to find versions waiting on a decision.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						},
						"version": {
							"type": "string",
							"pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9_-]+(?:\\.[0-9]+)?)?$",
							"maxLength": 32
						}
					},
					"required": [
						"providerId",
						"version"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for recording a decision on a provider version in `in_review`. On `APPROVED` the branch tag is cleared and the version is promoted to the live channel (becomes public). On `REJECTED` the branch becomes `rejected`.",
					"required": [
						"decision"
					],
					"properties": {
						"decision": {
							"type": "string",
							"enum": [
								"APPROVED",
								"REJECTED"
							]
						},
						"notes": {
							"type": "string",
							"description": "Free-form rationale shown to the author.",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"DeleteCallbackSubscription": {
		description: "Delete a callback subscription\n\nRemoves one callback subscription and its stored results. Needs the organization API key as orgToken. Use list_callback_subscriptions to find the id.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"subscriptionId": {
							"type": "string",
							"format": "uuid",
							"description": "Stable id for a callback subscription."
						}
					},
					"required": [
						"subscriptionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
	},
	"DeleteOrgCallbackSubscription": {
		description: "Delete an organization's callback subscription\n\nRemoves one callback subscription and its stored results. Needs active membership of the organization. Use list_org_callback_subscriptions to find the id. Delete a temporary subscription only after you have read the results.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"subscriptionId": {
							"type": "string",
							"format": "uuid",
							"description": "Stable id for a callback subscription."
						}
					},
					"required": [
						"orgId",
						"subscriptionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
	},
	"DeleteOrgKeypair": {
		description: "Clear the organization's encryption keypair\n\nRemoves the organization's result encryption public key. Results are then delivered unencrypted until you set a new key. Run it only when the developer asks. To rotate the key, use `issue_org_keypair` with `replace: true` instead of deleting first.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
	},
	"DeleteProvider": {
		description: "Delete a provider\n\nArchives a provider: its status becomes ARCHIVED and past references still resolve. Owner of the provider's organization only. Supports If-Match.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"headers": {
					"type": "object",
					"properties": {
						"If-Match": {
							"type": "string",
							"maxLength": 128,
							"description": "Opaque `ETag` from a prior GET on the same resource. When\nsupplied, the server applies optimistic concurrency: the\nmutation fails with `412 Precondition Failed` if the\nresource has been modified since. Omit for last-write-wins.\n"
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
	},
	"DeleteTheme": {
		description: "Delete a theme\n\nDeletes one of the organization's themes. Sessions created with it keep their snapshot.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"themeId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId",
						"themeId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
	},
	"DiscoverDataPoints": {
		description: "List the verifiable data points on a website\n\nThe data points existing providers can prove on a website — the menu to pick from before discover_resolve. Optionally filter by `q`.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"domain": {
							"type": "string",
							"format": "hostname",
							"minLength": 1,
							"maxLength": 200
						},
						"q": {
							"type": "string",
							"maxLength": 200
						}
					},
					"required": [
						"domain"
					],
					"additionalProperties": false
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"DiscoverResolve": {
		description: "Resolve a website + data points to providers\n\nResolves a website plus the data points to prove into the smallest set of existing providers that covers them, with the context inputs each needs. Use after discover_data_points, and before deciding whether to build anything new.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"domain": {
							"type": "string",
							"format": "hostname",
							"minLength": 1,
							"maxLength": 200
						},
						"dataPoints": {
							"type": "array",
							"minItems": 1,
							"maxItems": 200,
							"items": {
								"type": "string",
								"minLength": 1,
								"maxLength": 200
							}
						},
						"mode": {
							"type": "string",
							"description": "How the resolver picks providers. `combine` (default) minimizes to the fewest providers (set-cover); `ai` is a forward-compat alias that currently resolves like combine.",
							"enum": [
								"combine",
								"ai"
							],
							"default": "combine"
						}
					},
					"required": [
						"domain",
						"dataPoints"
					],
					"additionalProperties": false
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetAiVerificationSession": {
		description: "Get what an AI verification session's prompt resolved to\n\nGets what the AI session's lookup found: status resolving|ready|started|failed, candidates (login pages), merged dataPoints, error. Use get_verification_session for the overall outcome.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"format": "uuid",
							"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
						}
					},
					"required": [
						"sessionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetMe": {
		description: "Get the authenticated user\n\nGets the authenticated caller's own profile: id, email, and name. Requires a signed-in user session, not an OrgToken. Use it to confirm who the current credentials belong to.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetOrg": {
		description: "Get an organization\n\nGets one organization: name, kind, status, and members. Requires membership or staff access. Use list_orgs when the id is unknown.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {
						"tab": {
							"type": "string",
							"enum": [
								"overview",
								"connect",
								"integrate",
								"providers",
								"members",
								"themes",
								"settings",
								"sessions",
								"billing"
							]
						},
						"track": {
							"type": "string",
							"enum": [
								"agent",
								"sdk",
								"http"
							]
						},
						"agent": {
							"type": "string",
							"enum": [
								"claude",
								"copilot",
								"cursor",
								"omp",
								"opencode",
								"codex",
								"antigravity",
								"others"
							]
						},
						"goal": {
							"type": "string",
							"maxLength": 200
						},
						"providerId": {
							"type": "array",
							"maxItems": 20,
							"items": {
								"type": "string",
								"format": "uuid"
							}
						},
						"client": {
							"type": "string",
							"enum": [
								"auto",
								"portals",
								"verifier-app",
								"reclaim-browser-extension",
								"builder",
								"inapp-sdk"
							]
						},
						"from": {
							"type": "string",
							"maxLength": 40,
							"pattern": "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
							"description": "One end of a date window: either a calendar date (`2026-09-01`, read as UTC midnight) or a full ISO date-time. The date-only form is what a native `<input type=\"date\">` submits, so `format: date-time` alone would reject every filter the dashboard's own form sends."
						},
						"to": {
							"type": "string",
							"maxLength": 40,
							"pattern": "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
							"description": "One end of a date window: either a calendar date (`2026-09-01`, read as UTC midnight) or a full ISO date-time. The date-only form is what a native `<input type=\"date\">` submits, so `format: date-time` alone would reject every filter the dashboard's own form sends."
						},
						"verificationClientId": {
							"type": "string",
							"minLength": 1,
							"maxLength": 64,
							"pattern": "^[0-9a-fA-F-]+$",
							"description": "A verification client id used as a filter. Hyphens are ignored."
						},
						"q": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						},
						"visibility": {
							"type": "string",
							"enum": [
								"PUBLIC",
								"PRIVATE"
							]
						},
						"newProvider": {
							"type": "boolean"
						},
						"billing": {
							"type": "string",
							"enum": [
								"success",
								"cancelled",
								"changed",
								"credits",
								"card"
							]
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetOrgBilling": {
		description: "Get the billing record for an organization\n\nGets the organization's billing record. Owner only. Returns 404 when none is set. Does not return payment card details.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetOrgKeypair": {
		description: "Get the organization's encryption keypair\n\nGets the organization's result encryption public key: public JWK, derived address, and whether result encryption is on. Returns 404 when none is set. The response never includes a private key.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetOrgVerificationAnalytics": {
		description: "Verification outcomes by day, device, and country\n\nShow an organization's verification counts and outcomes by UTC day, claimant device category, and claimant country. Missing telemetry appears in unknown buckets; filter with from and to.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {
						"from": {
							"type": "string",
							"maxLength": 40,
							"pattern": "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
							"description": "One end of a date window: either a calendar date (`2026-09-01`, read as UTC midnight) or a full ISO date-time. The date-only form is what a native `<input type=\"date\">` submits, so `format: date-time` alone would reject every filter the dashboard's own form sends."
						},
						"to": {
							"type": "string",
							"maxLength": 40,
							"pattern": "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
							"description": "One end of a date window: either a calendar date (`2026-09-01`, read as UTC midnight) or a full ISO date-time. The date-only form is what a native `<input type=\"date\">` submits, so `format: date-time` alone would reject every filter the dashboard's own form sends."
						},
						"providerId": {
							"type": "string",
							"format": "uuid"
						},
						"verificationClientId": {
							"type": "string",
							"minLength": 1,
							"maxLength": 64,
							"pattern": "^[0-9a-fA-F-]+$",
							"description": "A verification client id used as a filter. Hyphens are ignored."
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetProvider": {
		description: "Get a provider\n\nGets one provider by id: its domain, live version (initialUrl and requests), and the data points it can prove. Use providers first when only a domain or search term is known.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetProviderVersion": {
		description: "Get a specific provider version\n\nFetches one exact canonical version. Trunk is public when the provider is public. Non-trunk versions are visible to admins and members of the provider's organization.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						},
						"version": {
							"type": "string",
							"pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9_-]+(?:\\.[0-9]+)?)?$",
							"maxLength": 32
						}
					},
					"required": [
						"providerId",
						"version"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetTheme": {
		description: "Get a theme\n\nGets one of the organization's themes.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"themeId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId",
						"themeId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetUser": {
		description: "Get a user's profile\n\nReturns a user record. Visible to the user themselves, any member of an organization the subject also belongs to, and staff.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"userId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"userId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetVerificationFunnel": {
		description: "Get the verification funnel\n\nCalculates an organization's lifecycle funnel for sessions created between required createdAfter (inclusive) and createdBefore (exclusive). Use providerIds/providerMatch and mode (SESSION or PROVIDER) to scope counts. Missing optional events can reflect telemetry loss.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {
						"providerIds": {
							"type": "array",
							"minItems": 1,
							"maxItems": 50,
							"uniqueItems": true,
							"items": {
								"type": "string",
								"format": "uuid"
							}
						},
						"providerMatch": {
							"type": "string",
							"enum": [
								"ANY",
								"ALL"
							],
							"default": "ANY"
						},
						"mode": {
							"type": "string",
							"enum": [
								"SESSION",
								"PROVIDER"
							],
							"default": "SESSION"
						},
						"createdAfter": {
							"type": "string",
							"format": "date-time"
						},
						"createdBefore": {
							"type": "string",
							"format": "date-time"
						}
					},
					"required": [
						"createdAfter",
						"createdBefore"
					],
					"additionalProperties": false
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"GetVerificationSession": {
		description: "Get a verification session\n\nGets one verification session. Use it to inspect status, resolved providers, context, Verification Client identity, and expiry. Requires the owning organization token.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"format": "uuid",
							"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
						}
					},
					"required": [
						"sessionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ImportDevtoolsProvider": {
		description: "Import a provider from devtools\n\nImports a public legacy provider into Builder by UUID. Requires human BearerAuth and a target orgId; preserves the provider UUID and is idempotent for seeded providers. Returns 409 if another Builder org owns the UUID.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"required": [
						"orgId",
						"providerId"
					],
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"ListCallbackDlq": {
		description: "List dead-lettered callbacks (admin-only)\n\nAdmin only. Lists callback deliveries whose retries were exhausted and moved to the DLQ for manual recovery.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListCallbackSubscriptions": {
		description: "List callback subscriptions for the organization\n\nReturns every callback subscription owned by the organization the presented `OrgToken` resolves to.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListOrgCallbackSubscriptions": {
		description: "List an organization's callback subscriptions\n\nReturns every callback subscription owned by the organization. Caller must be an active member of the org.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListOrgs": {
		description: "List organizations the caller belongs to\n\nLists the organizations the caller belongs to. Use it first to find an organization id — most other tools take one.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"q": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						},
						"cursor": {
							"type": "string",
							"maxLength": 500
						},
						"newOrg": {
							"type": "boolean"
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListOrgTokens": {
		description: "List the organization's API keys\n\nLists the organization's API keys by id, last four characters, issue date, and last use. Owner only. The response never includes a key value.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListOrgUsedProviders": {
		description: "List the providers an organization uses\n\nLists the providers that have verification sessions in an organization, busiest first, with session count and last use. Use it to find a provider id to filter sessions or analytics.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {
						"q": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						},
						"cursor": {
							"type": "string",
							"maxLength": 500
						},
						"limit": {
							"type": "integer",
							"minimum": 1,
							"maximum": 1000
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListOrgVerificationSessions": {
		description: "List an organization's verification sessions\n\nLists an organization's verification sessions, newest first, filterable by session id prefix, provider, status, resolved version, claimant, and a created-at range. Use it to find a session id; use get_verification_session for one session in full.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"maxLength": 100
						},
						"providerId": {
							"type": "string",
							"maxLength": 100
						},
						"verificationClientId": {
							"type": "string",
							"minLength": 1,
							"maxLength": 64,
							"pattern": "^[0-9a-fA-F-]+$",
							"description": "A verification client id used as a filter. Hyphens are ignored."
						},
						"status": {
							"type": "string",
							"description": "Status of a verification session, derived from its events. New values\nmay be added over time; clients MUST tolerate unknown values in\nresponses.\n\n- `pending`: Created, not yet finished; completable until `expiresAt`.\n\n- `success`: Terminal — `verification_success` recorded.\n\n- `rejected`: Terminal — `verification_rejected` recorded.\n\n- `error`: Terminal — `verification_error` recorded.\n\n- `cancelled`: Terminal — `verification_cancelled` recorded.\n\n- `expired`: `expiresAt` passed before a terminal event; the end-user\n  can no longer complete it.",
							"enum": [
								"pending",
								"success",
								"rejected",
								"error",
								"cancelled",
								"expired"
							]
						},
						"resolvedVersion": {
							"type": "string",
							"maxLength": 64
						},
						"claimantClientId": {
							"type": "string",
							"maxLength": 100
						},
						"createdAfter": {
							"type": "string",
							"format": "date-time"
						},
						"createdBefore": {
							"type": "string",
							"format": "date-time"
						},
						"cursor": {
							"type": "string",
							"maxLength": 500
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListProviderVersions": {
		description: "List a provider's versions\n\nLists versions visible to the caller. Non-public branches (`ai`, `draft`, `fixed`, `in_review`, `rejected`) are only visible to members of the provider's owning organization.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {
						"cursor": {
							"type": "string",
							"maxLength": 500
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListThemes": {
		description: "List themes owned by an organization\n\nLists the organization's themes: the colors, logo and copy of the verification screens. Pass a theme's id as `themeId` when you create a session.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListVerificationDeliveries": {
		description: "Get the callback delivery status for a session\n\nLists callback delivery attempts for a session. Requires the owning organization's token. Use after terminal status to diagnose pending, failed, or dead-lettered callbacks; retry failures with retry_verification_callback.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"format": "uuid",
							"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
						}
					},
					"required": [
						"sessionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"ListVerificationEvents": {
		description: "Get the event log for a session\n\nLists append-only lifecycle events for a session. Requires the owning organization's token. Use after get_verification_session to find the first missing or failed milestone; inspect eventData for failure details.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"format": "uuid",
							"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
						}
					},
					"required": [
						"sessionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"MakePrivate": {
		description: "Change a PUBLIC provider back to PRIVATE\n\nChanges a PUBLIC provider's visibility to PRIVATE. Unlike the reverse (PRIVATE → PUBLIC), this does not require review since it restricts rather than expands access. Existing live versions remain but are no longer publicly listed.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for visibility change requests (request public listing or make private).",
					"properties": {
						"notes": {
							"type": "string",
							"description": "Optional note explaining the change.",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"Providers": {
		description: "Search providers\n\nSearches existing Reclaim providers by domain or data point. A provider is the recipe an end-user follows to prove something about themselves, such as a follower count or an order history. Call this before create_provider — most popular domains already have one.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {

					}
				},
				"query": {
					"type": "object",
					"properties": {
						"q": {
							"type": "string",
							"maxLength": 200
						},
						"tag": {
							"type": "array",
							"maxItems": 20,
							"items": {
								"type": "string",
								"description": "A free-form label attached to an entity for grouping and filtering in listings. Must start and end with an alphanumeric character; only ASCII letters, digits, spaces, and hyphens are allowed between.",
								"pattern": "^[A-Za-z0-9]([A-Za-z0-9 \\-]*[A-Za-z0-9])?$",
								"minLength": 1,
								"maxLength": 50
							}
						},
						"cursor": {
							"type": "string",
							"maxLength": 500
						}
					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"readOnlyHint":true,"openWorldHint":false},
	},
	"PublishProviderVersion": {
		description: "Publish a draft version directly (PRIVATE providers only)\n\nPublishes a draft version straight to live. PRIVATE providers only — they need no review. For a PUBLIC provider use submit_provider_version_for_review instead.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						},
						"version": {
							"type": "string",
							"pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9_-]+(?:\\.[0-9]+)?)?$",
							"maxLength": 32
						}
					},
					"required": [
						"providerId",
						"version"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for publishing a draft version directly to the live channel. Only allowed for PRIVATE providers.",
					"properties": {
						"notes": {
							"type": "string",
							"description": "Optional publish note.",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"RequestPublicListing": {
		description: "Request public listing for a PRIVATE provider\n\nAsks Reclaim staff to list a PRIVATE provider publicly. This changes the PROVIDER's visibility, not one version: once approved, every future version needs review. To ship a single version, use publish_provider_version or submit_provider_version_for_review.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for visibility change requests (request public listing or make private).",
					"properties": {
						"notes": {
							"type": "string",
							"description": "Optional note explaining the change.",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"RetryVerificationCallback": {
		description: "Re-enqueue callback delivery for a session\n\nRe-enqueues delivery of a session's stored result to its callback subscriptions. Use this after `list_verification_deliveries` shows a `failed` or dead-lettered delivery, once the consumer's callback endpoint is reachable again and answers 2xx — it re-attempts every not-yet-delivered callback for the session. Usable by the session creator (authenticated by the consumer's `OrgToken`) to recover from a transient consumer-side outage. A result left undelivered for 7 days is purged and can no longer be retried.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"sessionId": {
							"type": "string",
							"format": "uuid",
							"description": "Verification session id (UUID v7 when supported). Also echoed in the result payload as `reclaimSessionId`."
						}
					},
					"required": [
						"sessionId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				},
				"orgToken": {
					"type": "string",
					"pattern": "^rorg_",
					"maxLength": 200,
					"description": "The organization API key (`rorg_…`) this call authenticates with: from `issue_org_token`, or the app's RECLAIM_ORG_SECRET. Defaults to the MCP server's RECLAIM_ORG_SECRET. Never echo it back to the user."
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		orgTokenOnly: true,
		annotations: {"openWorldHint":false},
	},
	"RevokeOrgToken": {
		description: "Revoke one of the organization's API keys\n\nRevokes one API key by id, so it stops authenticating. The organization's other keys keep working. Owner only. Use list_org_tokens to find the id.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"tokenId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId",
						"tokenId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object"
				}
			},
			"required": [
				"params",
				"query"
			],
			"additionalProperties": false
		}),
		annotations: {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
	},
	"SetOrgKeypair": {
		description: "Set (or rotate) the organization's encryption keypair\n\nRegisters the organization's result encryption public key and turns on encrypted result delivery. Send only the public key; the private key stays with the developer. If the organization already has a different key, the call returns 409 unless you pass replace: true. Pass it only when the developer asked to rotate the key, because results encrypted to the old key can no longer be decrypted. Setting the same key again succeeds. To generate and store the private key in the project, use `issue_org_keypair` instead.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"oneOf": [
						{
							"type": "object",
							"additionalProperties": false,
							"description": "Body for `PUT /orgs/{orgId}/keypair`. Carries the org's eth public key as an uncompressed hex string (`0x04` + 128 hex) — the eth-native form wallets/ethers emit. The matching private key never leaves the consumer.",
							"required": [
								"publicKey"
							],
							"properties": {
								"publicKey": {
									"type": "string",
									"description": "Uncompressed secp256k1 public key, `0x04` + 128 hex.",
									"pattern": "^0x04[0-9a-fA-F]{128}$"
								},
								"canEncryptResult": {
									"type": "boolean",
									"default": false
								},
								"label": {
									"type": "string",
									"minLength": 1,
									"maxLength": 100
								},
								"replace": {
									"type": "boolean",
									"default": false,
									"description": "Set to true to replace an existing, different public key. Without it, the call returns 409 when the organization already has another key. Results encrypted to the old key can no longer be decrypted."
								}
							}
						},
						{
							"type": "object",
							"additionalProperties": false,
							"description": "Body for `PUT /orgs/{orgId}/keypair`. Carries the org's eth public key as a secp256k1 public JWK.",
							"required": [
								"publicKeyJwk"
							],
							"properties": {
								"publicKeyJwk": {
									"type": "object",
									"additionalProperties": false,
									"description": "A secp256k1 (Ethereum) public key in JWK form (`{kty:'EC', crv:'secp256k1', x, y}`), used to ECIES-encrypt delivered verification results and to identify the org. The matching private key never leaves the consumer. Same shape published by the signing JWKS.",
									"required": [
										"kty",
										"crv",
										"x",
										"y"
									],
									"properties": {
										"kty": {
											"type": "string",
											"enum": [
												"EC"
											]
										},
										"crv": {
											"type": "string",
											"enum": [
												"secp256k1"
											]
										},
										"x": {
											"type": "string",
											"description": "base64url-encoded X coordinate (32 bytes).",
											"minLength": 1,
											"maxLength": 64
										},
										"y": {
											"type": "string",
											"description": "base64url-encoded Y coordinate (32 bytes).",
											"minLength": 1,
											"maxLength": 64
										}
									}
								},
								"canEncryptResult": {
									"type": "boolean",
									"default": false
								},
								"label": {
									"type": "string",
									"minLength": 1,
									"maxLength": 100
								},
								"replace": {
									"type": "boolean",
									"default": false,
									"description": "Set to true to replace an existing, different public key. Without it, the call returns 409 when the organization already has another key. Results encrypted to the old key can no longer be decrypted."
								}
							}
						}
					]
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"idempotentHint":true,"openWorldHint":false},
	},
	"SubmitProviderVersionForReview": {
		description: "Submit a provider version for review\n\nSubmits a draft or rejected version for admin review, the way a PUBLIC provider's versions go live. On a PRIVATE provider use publish_provider_version instead — those need no review.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						},
						"version": {
							"type": "string",
							"pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9_-]+(?:\\.[0-9]+)?)?$",
							"maxLength": 32
						}
					},
					"required": [
						"providerId",
						"version"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for submitting a provider version for review. Transitions the version's branch from `draft` (or `rejected`) to `in_review`.",
					"properties": {
						"notes": {
							"type": "string",
							"description": "Optional note from the author to reviewers (changelog, areas to focus on, and so on).",
							"maxLength": 10000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"TransferProvider": {
		description: "Transfer a provider to a different workspace\n\nAdmin-only. Moves a provider to a different organization, preserving its slug, versions, and members. Fails if the target organization does not exist.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"required": [
						"orgId"
					],
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"UpdateOrg": {
		description: "Update an organization\n\nUpdates an organization's name, icon, or status. Owner only, and a partial update — pass only the fields to change. Archiving an organization is a status change, not a delete.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"properties": {
						"name": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						},
						"status": {
							"type": "string",
							"description": "The status of the entity.\n\n- `ACTIVE`: The entity is active.\n\n- `ARCHIVED`: The entity is archived.",
							"enum": [
								"ACTIVE",
								"ARCHIVED"
							]
						},
						"iconUrl": {
							"type": "string",
							"format": "uri",
							"description": "Replace the org avatar URL directly. Most clients upload via `PUT /orgs/{orgId}/icon` and let the server write this field.",
							"maxLength": 2000
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"UpdateOrgKeypair": {
		description: "Turn result encryption on or off\n\nTurns result encryption on or off for the organization's existing key pair without changing the key. Use it when the developer asks to turn encryption on or off. When on, the app's callback needs `orgEthPrivateKey` to decrypt results. Returns 404 when the organization has no key pair; create one with `issue_org_keypair`.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Body for `PATCH /orgs/{orgId}/keypair`.",
					"required": [
						"canEncryptResult"
					],
					"properties": {
						"canEncryptResult": {
							"type": "boolean",
							"description": "Set to true to encrypt results to the organization's public key. Set to false to deliver results as plaintext."
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"UpdateProvider": {
		description: "Update a provider\n\nUpdates a provider's metadata, such as title, description, or tags. Partial update — pass only the fields to change. Requires active membership. To change the recipe (initialUrl or requests), cut a new version with create_provider_version instead.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"providerId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"providerId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"headers": {
					"type": "object",
					"properties": {
						"If-Match": {
							"type": "string",
							"maxLength": 128,
							"description": "Opaque `ETag` from a prior GET on the same resource. When\nsupplied, the server applies optimistic concurrency: the\nmutation fails with `412 Precondition Failed` if the\nresource has been modified since. Omit for last-write-wins.\n"
						}
					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"description": "Partial update of an existing provider. Immutable fields (`id`, `orgId`, `slug`) are not accepted here.",
					"properties": {
						"domain": {
							"type": "string",
							"format": "hostname",
							"minLength": 1,
							"maxLength": 200
						},
						"region": {
							"type": "string",
							"nullable": true,
							"description": "Confirm or override the provider's region. Send `null` to clear it so the provider applies to every region. See `Provider.region`.",
							"pattern": "^[a-z]{2}(-[a-z]{2})?$",
							"maxLength": 5
						},
						"title": {
							"type": "string",
							"minLength": 1,
							"maxLength": 100
						},
						"description": {
							"type": "string",
							"minLength": 1,
							"maxLength": 2000
						},
						"iconUrl": {
							"description": "uri of the icon",
							"type": "string",
							"format": "uri",
							"maxLength": 2000
						},
						"visibility": {
							"type": "string",
							"description": "The visibility of the entity.\n\n- `PRIVATE`: Only the owner can see the entity.\n\n- `PUBLIC`: Anyone can see the entity.",
							"enum": [
								"PRIVATE",
								"PUBLIC"
							]
						},
						"status": {
							"type": "string",
							"description": "The status of the entity.\n\n- `ACTIVE`: The entity is active.\n\n- `ARCHIVED`: The entity is archived.",
							"enum": [
								"ACTIVE",
								"ARCHIVED"
							]
						},
						"tags": {
							"type": "array",
							"maxItems": 50,
							"uniqueItems": true,
							"items": {
								"type": "string",
								"description": "A free-form label attached to an entity for grouping and filtering in listings. Must start and end with an alphanumeric character; only ASCII letters, digits, spaces, and hyphens are allowed between.",
								"pattern": "^[A-Za-z0-9]([A-Za-z0-9 \\-]*[A-Za-z0-9])?$",
								"minLength": 1,
								"maxLength": 50
							}
						},
						"seo": {
							"type": "object",
							"additionalProperties": false,
							"description": "Author-set SEO fields. All optional.\n\nEach field is paired with a server-derived default of the\nsame name on `Provider.seoSuggestions`. Renderers pick the\neffective value per field:\n\n    effective.<field> = seo.<field> ?? seoSuggestions.<field>\n\nSet a field here to override; leave it unset to let the\ndefault win. Both objects are returned on every\n`GET /providers/{id}` — the builder does not pre-merge.\n",
							"properties": {
								"brandUrl": {
									"type": "string",
									"format": "uri",
									"description": "Canonical homepage of the brand (for example, `https://google.com`). Used in brand-link cards and JSON-LD.",
									"maxLength": 2000
								},
								"primaryDataPoint": {
									"type": "string",
									"description": "Headline data point — the single most-important variable this provider can verify (for example, `subscriber count`). Used in the provider's SEO title.",
									"maxLength": 200
								},
								"dataPoints": {
									"type": "array",
									"description": "Full list of data points this provider can verify.",
									"maxItems": 50,
									"items": {
										"type": "string",
										"maxLength": 200
									}
								},
								"titleOverride": {
									"type": "string",
									"description": "Replaces the renderer's composed `<title>` / OG title. Use when the default composition reads awkwardly.",
									"maxLength": 200
								},
								"descriptionOverride": {
									"type": "string",
									"description": "Replaces the renderer's composed `<meta name=\"description\">` / OG description.",
									"maxLength": 320
								}
							}
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
	"UpdateTheme": {
		description: "Update a theme\n\nUpdates one of the organization's themes. Sessions created before keep their snapshot.",
		inputSchema: toZod({
			"type": "object",
			"properties": {
				"params": {
					"type": "object",
					"properties": {
						"orgId": {
							"type": "string",
							"format": "uuid"
						},
						"themeId": {
							"type": "string",
							"format": "uuid"
						}
					},
					"required": [
						"orgId",
						"themeId"
					],
					"additionalProperties": false
				},
				"query": {
					"type": "object",
					"properties": {

					}
				},
				"body": {
					"type": "object",
					"additionalProperties": false,
					"properties": {
						"label": {
							"type": "string",
							"minLength": 1,
							"maxLength": 200
						},
						"iconUrl": {
							"type": "string",
							"format": "uri",
							"maxLength": 2000
						},
						"preferredLocale": {
							"description": "Omit to leave unchanged; pass `null` to clear.",
							"type": "string",
							"minLength": 2,
							"maxLength": 64,
							"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$",
							"nullable": true
						},
						"consent": {
							"type": "object",
							"description": "Omit to leave unchanged; pass `null` to clear.",
							"nullable": true,
							"allOf": [
								{
									"type": "object",
									"additionalProperties": false,
									"minProperties": 1,
									"description": "A full-screen consent prompt shown once, before the end-user is navigated to the provider's site — mirrors reclaim-portal's `ConsentInfo`. Absent on the owning `Theme` ⇒ no consent screen is shown for that org's sessions.",
									"properties": {
										"title": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										"body": {
											"description": "The consent copy. A single string, or an array of strings rendered as a bullet list (matches reclaim-portal, where `body` can be either shape).",
											"oneOf": [
												{
													"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
													"oneOf": [
														{
															"type": "string",
															"minLength": 1,
															"maxLength": 2000
														},
														{
															"type": "object",
															"minProperties": 1,
															"maxProperties": 50,
															"propertyNames": {
																"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
															},
															"additionalProperties": {
																"type": "string",
																"minLength": 1,
																"maxLength": 2000
															}
														}
													]
												},
												{
													"type": "array",
													"items": {
														"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
														"oneOf": [
															{
																"type": "string",
																"minLength": 1,
																"maxLength": 2000
															},
															{
																"type": "object",
																"minProperties": 1,
																"maxProperties": 50,
																"propertyNames": {
																	"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																},
																"additionalProperties": {
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																}
															}
														]
													},
													"minItems": 1,
													"maxItems": 20
												}
											]
										},
										"disclaimer": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										"continueButtonLabel": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										}
									}
								}
							]
						},
						"clientTheme": {
							"type": "object",
							"description": "Omit to leave unchanged; pass `null` to clear.",
							"nullable": true,
							"allOf": [
								{
									"type": "object",
									"additionalProperties": false,
									"description": "Cross-client presentation fields used by the in-app SDK and Portal. Clients apply supported visual fields and ignore fields that don't belong to their UI surface.",
									"properties": {
										"themeMode": {
											"type": "string",
											"enum": [
												"dark",
												"light",
												"system"
											],
											"default": "light"
										},
										"theme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"background": {
													"type": "object",
													"additionalProperties": false,
													"minProperties": 1,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"image": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"backgroundBlurStrength": {
													"type": "number",
													"minimum": 0,
													"maximum": 100
												},
												"backgroundBlurColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"parameterStyle": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"displayStyle": {
															"type": "string",
															"enum": [
																"compact",
																"dividerSeparated"
															]
														},
														"dividerColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"borderStyle": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"width": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 100
																},
																"radius": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1000
																}
															}
														},
														"isValueShown": {
															"type": "boolean",
															"default": true
														}
													}
												},
												"colorScheme": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"themeColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"surfaceColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"onSurfaceColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												},
												"doneIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"appImageOptions": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												},
												"loading": {
													"type": "object",
													"additionalProperties": false,
													"minProperties": 1,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"image": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"cardElevation": {
													"type": "number",
													"minimum": 0,
													"maximum": 100
												},
												"cardColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"onCardColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"sessionChipSurfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"sessionChipOnSurfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"termsNoticeColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"hyperlinkColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"hyperlinkColorInt": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295,
													"deprecated": true,
													"description": "Deprecated alias for `hyperlinkColor`."
												},
												"verificationReviewScreenTheme": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"fieldVerifyingIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"fieldVerifiedIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"providerToAppLoaderColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"providerToAppLoader": {
															"type": "object",
															"additionalProperties": false,
															"minProperties": 1,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"image": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"url": {
																			"type": "string",
																			"format": "uri",
																			"maxLength": 2000
																		},
																		"options": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"alignment": {
																					"type": "object",
																					"additionalProperties": false,
																					"properties": {
																						"x": {
																							"type": "number",
																							"minimum": -1,
																							"maximum": 1,
																							"default": 0
																						},
																						"y": {
																							"type": "number",
																							"minimum": -1,
																							"maximum": 1,
																							"default": 0
																						}
																					}
																				},
																				"backgroundColor": {
																					"type": "integer",
																					"format": "int64",
																					"minimum": 0,
																					"maximum": 4294967295
																				},
																				"opacity": {
																					"type": "number",
																					"minimum": 0,
																					"maximum": 1,
																					"default": 1
																				},
																				"fit": {
																					"type": "string",
																					"enum": [
																						"cover",
																						"scale_down"
																					],
																					"default": "cover"
																				},
																				"spin": {
																					"type": "boolean",
																					"default": false,
																					"deprecated": true,
																					"description": "Deprecated legacy client field retained for theme compatibility."
																				}
																			}
																		}
																	}
																}
															}
														},
														"verificationCompleteIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"verifyScreenAppIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"verificationFailedIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"consentViewIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"consentDisclaimerIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"submissionConsentDisclaimerIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"consentContinueButtonTheme": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"foregroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												},
												"verifyAnotherWayStyle": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"headerActionButtonStyle": {
															"type": "object",
															"additionalProperties": false,
															"required": [
																"style"
															],
															"properties": {
																"style": {
																	"type": "string",
																	"enum": [
																		"filled",
																		"outlined"
																	]
																},
																"border": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"color": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"width": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 100
																		},
																		"radius": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1000
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"foregroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																}
															}
														},
														"failedActionButtonStyle": {
															"type": "object",
															"additionalProperties": false,
															"required": [
																"style"
															],
															"properties": {
																"style": {
																	"type": "string",
																	"enum": [
																		"filled",
																		"outlined"
																	]
																},
																"border": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"color": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"width": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 100
																		},
																		"radius": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1000
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"foregroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																}
															}
														}
													}
												}
											}
										},
										"darkTheme": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"background": {
													"type": "object",
													"additionalProperties": false,
													"minProperties": 1,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"image": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"backgroundBlurStrength": {
													"type": "number",
													"minimum": 0,
													"maximum": 100
												},
												"backgroundBlurColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"parameterStyle": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"displayStyle": {
															"type": "string",
															"enum": [
																"compact",
																"dividerSeparated"
															]
														},
														"dividerColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"borderStyle": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"width": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 100
																},
																"radius": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1000
																}
															}
														},
														"isValueShown": {
															"type": "boolean",
															"default": true
														}
													}
												},
												"colorScheme": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"themeColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"surfaceColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"onSurfaceColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												},
												"doneIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"appImageOptions": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"alignment": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"x": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																},
																"y": {
																	"type": "number",
																	"minimum": -1,
																	"maximum": 1,
																	"default": 0
																}
															}
														},
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"opacity": {
															"type": "number",
															"minimum": 0,
															"maximum": 1,
															"default": 1
														},
														"fit": {
															"type": "string",
															"enum": [
																"cover",
																"scale_down"
															],
															"default": "cover"
														},
														"spin": {
															"type": "boolean",
															"default": false,
															"deprecated": true,
															"description": "Deprecated legacy client field retained for theme compatibility."
														}
													}
												},
												"loading": {
													"type": "object",
													"additionalProperties": false,
													"minProperties": 1,
													"properties": {
														"color": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"image": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"cardElevation": {
													"type": "number",
													"minimum": 0,
													"maximum": 100
												},
												"cardColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"onCardColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"sessionChipSurfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"sessionChipOnSurfaceColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"termsNoticeColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"hyperlinkColor": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295
												},
												"hyperlinkColorInt": {
													"type": "integer",
													"format": "int64",
													"minimum": 0,
													"maximum": 4294967295,
													"deprecated": true,
													"description": "Deprecated alias for `hyperlinkColor`."
												},
												"verificationReviewScreenTheme": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"fieldVerifyingIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"fieldVerifiedIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"providerToAppLoaderColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"providerToAppLoader": {
															"type": "object",
															"additionalProperties": false,
															"minProperties": 1,
															"properties": {
																"color": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"image": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"url": {
																			"type": "string",
																			"format": "uri",
																			"maxLength": 2000
																		},
																		"options": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"alignment": {
																					"type": "object",
																					"additionalProperties": false,
																					"properties": {
																						"x": {
																							"type": "number",
																							"minimum": -1,
																							"maximum": 1,
																							"default": 0
																						},
																						"y": {
																							"type": "number",
																							"minimum": -1,
																							"maximum": 1,
																							"default": 0
																						}
																					}
																				},
																				"backgroundColor": {
																					"type": "integer",
																					"format": "int64",
																					"minimum": 0,
																					"maximum": 4294967295
																				},
																				"opacity": {
																					"type": "number",
																					"minimum": 0,
																					"maximum": 1,
																					"default": 1
																				},
																				"fit": {
																					"type": "string",
																					"enum": [
																						"cover",
																						"scale_down"
																					],
																					"default": "cover"
																				},
																				"spin": {
																					"type": "boolean",
																					"default": false,
																					"deprecated": true,
																					"description": "Deprecated legacy client field retained for theme compatibility."
																				}
																			}
																		}
																	}
																}
															}
														},
														"verificationCompleteIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"verifyScreenAppIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														},
														"verificationFailedIcon": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"url": {
																	"type": "string",
																	"format": "uri",
																	"maxLength": 2000
																},
																"options": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"alignment": {
																			"type": "object",
																			"additionalProperties": false,
																			"properties": {
																				"x": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				},
																				"y": {
																					"type": "number",
																					"minimum": -1,
																					"maximum": 1,
																					"default": 0
																				}
																			}
																		},
																		"backgroundColor": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"opacity": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1,
																			"default": 1
																		},
																		"fit": {
																			"type": "string",
																			"enum": [
																				"cover",
																				"scale_down"
																			],
																			"default": "cover"
																		},
																		"spin": {
																			"type": "boolean",
																			"default": false,
																			"deprecated": true,
																			"description": "Deprecated legacy client field retained for theme compatibility."
																		}
																	}
																}
															}
														}
													}
												},
												"consentViewIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"consentDisclaimerIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"submissionConsentDisclaimerIcon": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"url": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														},
														"options": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"alignment": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"x": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		},
																		"y": {
																			"type": "number",
																			"minimum": -1,
																			"maximum": 1,
																			"default": 0
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"opacity": {
																	"type": "number",
																	"minimum": 0,
																	"maximum": 1,
																	"default": 1
																},
																"fit": {
																	"type": "string",
																	"enum": [
																		"cover",
																		"scale_down"
																	],
																	"default": "cover"
																},
																"spin": {
																	"type": "boolean",
																	"default": false,
																	"deprecated": true,
																	"description": "Deprecated legacy client field retained for theme compatibility."
																}
															}
														}
													}
												},
												"consentContinueButtonTheme": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"backgroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														},
														"foregroundColor": {
															"type": "integer",
															"format": "int64",
															"minimum": 0,
															"maximum": 4294967295
														}
													}
												},
												"verifyAnotherWayStyle": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"headerActionButtonStyle": {
															"type": "object",
															"additionalProperties": false,
															"required": [
																"style"
															],
															"properties": {
																"style": {
																	"type": "string",
																	"enum": [
																		"filled",
																		"outlined"
																	]
																},
																"border": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"color": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"width": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 100
																		},
																		"radius": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1000
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"foregroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																}
															}
														},
														"failedActionButtonStyle": {
															"type": "object",
															"additionalProperties": false,
															"required": [
																"style"
															],
															"properties": {
																"style": {
																	"type": "string",
																	"enum": [
																		"filled",
																		"outlined"
																	]
																},
																"border": {
																	"type": "object",
																	"additionalProperties": false,
																	"properties": {
																		"color": {
																			"type": "integer",
																			"format": "int64",
																			"minimum": 0,
																			"maximum": 4294967295
																		},
																		"width": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 100
																		},
																		"radius": {
																			"type": "number",
																			"minimum": 0,
																			"maximum": 1000
																		}
																	}
																},
																"backgroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																},
																"foregroundColor": {
																	"type": "integer",
																	"format": "int64",
																	"minimum": 0,
																	"maximum": 4294967295
																}
															}
														}
													}
												}
											}
										},
										"returnToAppMessage": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"success": {
													"type": "string",
													"maxLength": 2000
												},
												"failure": {
													"type": "string",
													"maxLength": 2000
												}
											}
										},
										"dataSharedMessage": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"savedAndShared": {
													"type": "string",
													"maxLength": 2000
												},
												"shared": {
													"type": "string",
													"maxLength": 2000
												},
												"whatWasShared": {
													"type": "string",
													"maxLength": 2000
												}
											}
										},
										"potentialFailureReasonsLink": {
											"type": "string",
											"format": "uri",
											"maxLength": 2000
										},
										"secureAndPrivateText": {
											"type": "string",
											"maxLength": 2000
										},
										"canShowLoadingOnPageChange": {
											"type": "boolean"
										},
										"submitButtonLabel": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										"cancelButtonLabel": {
											"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
											"oneOf": [
												{
													"type": "string",
													"minLength": 1,
													"maxLength": 2000
												},
												{
													"type": "object",
													"minProperties": 1,
													"maxProperties": 50,
													"propertyNames": {
														"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
													},
													"additionalProperties": {
														"type": "string",
														"minLength": 1,
														"maxLength": 2000
													}
												}
											]
										},
										"extraTranslations": {
											"type": "object",
											"maxProperties": 200,
											"additionalProperties": {
												"$ref": "#/components/schemas/ConsentText"
											}
										},
										"portalInfo": {
											"type": "object",
											"additionalProperties": false,
											"properties": {
												"header": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"description": {
															"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
															"oneOf": [
																{
																	"type": "string",
																	"minLength": 1,
																	"maxLength": 2000
																},
																{
																	"type": "object",
																	"minProperties": 1,
																	"maxProperties": 50,
																	"propertyNames": {
																		"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																	},
																	"additionalProperties": {
																		"type": "string",
																		"minLength": 1,
																		"maxLength": 2000
																	}
																}
															]
														},
														"descriptionLink": {
															"type": "string",
															"format": "uri",
															"maxLength": 2000
														}
													}
												},
												"verificationReviewInfo": {
													"type": "object",
													"additionalProperties": false,
													"properties": {
														"displayStyle": {
															"type": "string",
															"enum": [
																"comfortablyStartAligned"
															]
														},
														"placeholderFields": {
															"type": "array",
															"maxItems": 100,
															"items": {
																"type": "object",
																"additionalProperties": false,
																"properties": {
																	"label": {
																		"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																		"oneOf": [
																			{
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			},
																			{
																				"type": "object",
																				"minProperties": 1,
																				"maxProperties": 50,
																				"propertyNames": {
																					"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																				},
																				"additionalProperties": {
																					"type": "string",
																					"minLength": 1,
																					"maxLength": 2000
																				}
																			}
																		]
																	},
																	"hashed": {
																		"type": "boolean"
																	},
																	"order": {
																		"type": "integer",
																		"minimum": 0
																	}
																}
															}
														},
														"gettingStarted": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"title": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																},
																"subtitle": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																}
															}
														},
														"pageLoading": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"title": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																},
																"subtitle": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																}
															}
														},
														"lookingForInformation": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"title": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																},
																"subtitle": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																}
															}
														},
														"validatingInformation": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"title": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																},
																"subtitle": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																}
															}
														},
														"validationComplete": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"title": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																},
																"subtitle": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																}
															}
														},
														"validatingFailed": {
															"type": "object",
															"additionalProperties": false,
															"properties": {
																"title": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																},
																"subtitle": {
																	"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
																	"oneOf": [
																		{
																			"type": "string",
																			"minLength": 1,
																			"maxLength": 2000
																		},
																		{
																			"type": "object",
																			"minProperties": 1,
																			"maxProperties": 50,
																			"propertyNames": {
																				"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
																			},
																			"additionalProperties": {
																				"type": "string",
																				"minLength": 1,
																				"maxLength": 2000
																			}
																		}
																	]
																}
															}
														},
														"skipGettingStartedOverlay": {
															"type": "boolean",
															"default": false
														},
														"skipPageLoadingOverlay": {
															"type": "boolean",
															"default": false
														},
														"skipCompletionOverlay": {
															"type": "boolean",
															"default": false
														}
													}
												},
												"submissionConsent": {
													"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
													"oneOf": [
														{
															"type": "string",
															"minLength": 1,
															"maxLength": 2000
														},
														{
															"type": "object",
															"minProperties": 1,
															"maxProperties": 50,
															"propertyNames": {
																"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
															},
															"additionalProperties": {
																"type": "string",
																"minLength": 1,
																"maxLength": 2000
															}
														}
													]
												},
												"verifyAnotherWayLabel": {
													"description": "A single piece of consent copy. Use a string for one language, or a locale map compatible with Verification Clients' `TextByLocale`. Locale lookup tries an exact locale, its base language, `en`, then the first entry.",
													"oneOf": [
														{
															"type": "string",
															"minLength": 1,
															"maxLength": 2000
														},
														{
															"type": "object",
															"minProperties": 1,
															"maxProperties": 50,
															"propertyNames": {
																"pattern": "^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$"
															},
															"additionalProperties": {
																"type": "string",
																"minLength": 1,
																"maxLength": 2000
															}
														}
													]
												},
												"verifyAnotherWayLink": {
													"type": "string",
													"format": "uri",
													"maxLength": 2000
												}
											}
										}
									}
								}
							]
						},
						"termsAndConditionLink": {
							"description": "Omit to leave unchanged; pass `null` to clear.",
							"type": "string",
							"format": "uri",
							"maxLength": 2000,
							"nullable": true
						},
						"privacyPolicyLink": {
							"description": "Omit to leave unchanged; pass `null` to clear.",
							"type": "string",
							"format": "uri",
							"maxLength": 2000,
							"nullable": true
						},
						"status": {
							"type": "string",
							"description": "The status of the entity.\n\n- `ACTIVE`: The entity is active.\n\n- `ARCHIVED`: The entity is archived.",
							"enum": [
								"ACTIVE",
								"ARCHIVED"
							]
						}
					}
				}
			},
			"required": [
				"params",
				"query",
				"body"
			],
			"additionalProperties": false
		}),
		annotations: {"openWorldHint":false},
	},
}

export type McpToolName = keyof typeof MCP_TOOLS
export type McpToolShape = (typeof MCP_TOOLS)[McpToolName]
