import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = await buildApp(config, { logger: { level: process.env.LOG_LEVEL ?? 'info' } })

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.once(signal, () => {
		void app.close().then(() => process.exit(0))
	})
}

await app.listen({ port: config.port, host: config.host })
