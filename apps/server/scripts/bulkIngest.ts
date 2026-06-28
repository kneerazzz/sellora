import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function main() {
  const { prisma } = await import('../src/config/prisma')
  const { documentsService } = await import('../src/modules/documents/documents.service')

  console.log('Fetching organization and user context...')
  const org = await prisma.organization.findFirst({
    orderBy: {
      createdAt: 'desc'
    }
  })
  
  if (!org) {
    throw new Error('No organization found in the database. Have you seeded the DB?')
  }

  const user = await prisma.user.findFirst({ where: { organizationId: org.id } })
  if (!user) {
    throw new Error('No user found in the database.')
  }

  const docsDir = path.resolve(__dirname, '../../../documents/stripe_docs')
  
  if (!fs.existsSync(docsDir)) {
    console.error(`\nDirectory not found: ${docsDir}`)
    console.log('Please ensure your Python crawler has finished downloading the docs first!')
    process.exit(1)
  }

  const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'))

  console.log(`\nFound ${files.length} Markdown documents. Starting bulk ingestion...`)
  console.log(`Organization: ${org.name}`)
  console.log(`User: ${user.email}\n`)

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file) continue

    const text = fs.readFileSync(path.join(docsDir, file), 'utf-8')
    console.log(`[${i + 1}/${files.length}] Ingesting ${file}...`)
    
    try {
      await documentsService.uploadDocument({
        filename: file,
        displayName: file.replace('.md', ''),
        mimeType: 'text/markdown',
        fileType: 'MARKDOWN',
        content: text,
      }, { organizationId: org.id, userId: user.id })
      
      successCount++
    } catch (err: any) {
      console.error(`❌ Failed to ingest ${file}:`, err.message || err)
      failCount++
    }
  }

  console.log('\n=======================================')
  console.log('🎉 Bulk Ingestion Complete!')
  console.log(`✅ Successfully ingested: ${successCount}`)
  console.log(`❌ Failed: ${failCount}`)
  console.log('=======================================')

  await prisma.$disconnect()
}

main().catch(console.error)
