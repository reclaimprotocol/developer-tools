import pino, { stdTimeFunctions } from 'pino'
import { LOG_LEVEL } from './consts.ts'

// stderr, not pino's default stdout: the MCP server speaks JSON-RPC over
// stdout, so a log line there corrupts the protocol stream.
export const LOGGER = pino({
	name: '@reclaimprotocol/agent',
	timestamp: stdTimeFunctions.isoTime,
	base: { hostname: undefined, pid: undefined },
}, pino.destination(2))
LOGGER.level = LOG_LEVEL
