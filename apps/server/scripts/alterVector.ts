import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function dropChunks() {
  const { prisma } = await import('../src/config/prisma')
  console.log('Force deleting all chunks...')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "document_chunks" CASCADE;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "document_chunks" ALTER COLUMN "embedding" TYPE vector(768);`)
  console.log('Migration complete.')
  await prisma.$disconnect()
}

dropChunks().catch(console.error)
