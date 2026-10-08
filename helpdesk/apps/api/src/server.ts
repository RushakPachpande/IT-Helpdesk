import { buildApp } from './app.js'
import { config } from './config.js'
import { attachRealtime } from './realtime.js'
import { stopBoss } from './services/boss.js'
import { prisma } from './db.js'
import { assertEncryptionKey } from './crypto.js'

assertEncryptionKey()
const app = await buildApp()
const stopRealtime = await attachRealtime(app)

await app.listen({ port: config.port, host: '0.0.0.0' })
app.log.info(`Helpdesk API listening on :${config.port} (LAN URL ${config.publicUrl})`)

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`)
  await stopRealtime()
  await app.close()
  await stopBoss()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
