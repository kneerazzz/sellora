import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function cleanEverything() {
  const { prisma } = await import('../src/config/prisma')
  console.log('Cleaning up database...')
  
  // Delete all documents (cascade will automatically delete all document_chunks)
  const result = await prisma.document.deleteMany({})
  console.log(`Deleted ${result.count} duplicate documents.`)
  
  console.log('Database is completely empty and ready for a fresh ingestion.')
  await prisma.$disconnect()
}

cleanEverything().catch(console.error)
