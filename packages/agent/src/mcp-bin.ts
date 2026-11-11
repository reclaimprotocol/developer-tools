import { startMcpServer } from './mcp/start.ts'
import { LOGGER } from './logger.ts'

startMcpServer().catch((err) => {
	LOGGER.error({ err }, 'mcp server failed')
	process.exitCode = 1
})
