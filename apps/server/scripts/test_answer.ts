import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { groundedAnswersService } from '../src/modules/groundedAnswers/groundedAnswers.service'
import { prisma } from '../src/config/prisma'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function test() {
  const org = await prisma.organization.findFirst()
  if (!org) throw new Error('No org found')
    
  console.log('Testing answerQuestion...')
  try {
    const result = await groundedAnswersService.answerQuestion(
      { question: 'What payment methods are supported for in-person payments?' },
      { organizationId: org.id }
    )
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('Test failed:', err)
  }
}

test().finally(() => prisma.$disconnect())
