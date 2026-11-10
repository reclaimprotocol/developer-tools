/**
 * `USE_OLD_DEVTOOLS` — single source of truth for which backend the MCP
 * server targets.
 *
 * Builder is the default. Only `true` or `1` explicitly selects old devtools;
 * an unset value or typo stays on Builder.
 *
 * The actual env read lives in `../consts.ts` (the single env-access module);
 * this widely-imported path re-exports it for back-compat.
 */
export { useOldDevtools } from '../consts.ts'
