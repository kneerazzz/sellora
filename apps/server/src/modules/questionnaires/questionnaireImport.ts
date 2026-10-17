import { z } from 'zod'
import { env } from '../../config/env'
import { ApiError } from '../../utils/apiError'

export const questionnaireImportSchema = z.object({
  format: z.enum(['CSV', 'TEXT']),
  content: z.string().min(1).max(65_536),
  documentIds: z.array(z.string().cuid()).max(20).default([]),
}).strict()

export type QuestionnaireImport = z.input<typeof questionnaireImportSchema>
export type ImportedRow = { rowId: string; question: string }
export const questionnaireRowLimit = Math.min(50, env.PROVIDER_QUESTION_MAX)

function csvRecords(content: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  const pushField = () => { record.push(field); field = ''; closedQuote = false }
  const pushRecord = () => { pushField(); records.push(record); record = [] }
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') { field += '"'; index += 1 }
        else { quoted = false; closedQuote = true }
      } else field += char
    } else if (char === '"') {
      if (field || closedQuote) throw ApiError.unprocessable('Invalid CSV quoting')
      quoted = true
    } else if (char === ',' || char === '\n' || char === '\r') {
      if (char === ',') pushField()
      else {
        if (char === '\r') {
          if (content[index + 1] !== '\n') throw ApiError.unprocessable('CSV requires LF or CRLF lines')
          index += 1
        }
        pushRecord()
      }
    } else {
      if (closedQuote) throw ApiError.unprocessable('Invalid CSV text after closing quote')
      field += char
    }
  }
  if (quoted) throw ApiError.unprocessable('Unclosed CSV quote')
  if (record.length || field || closedQuote) pushRecord()
  return records
}

export function parseQuestionnaireImport(input: QuestionnaireImport): { rows: ImportedRow[]; format: 'CSV' | 'TEXT'; documentIds: string[] } {
  const parsed = questionnaireImportSchema.parse(input)
  if (Buffer.byteLength(parsed.content, 'utf8') > 65_536 || Buffer.from(parsed.content, 'utf8').toString('utf8') !== parsed.content || /[\u0000\uFFFD]/u.test(parsed.content)) {
    throw ApiError.unprocessable('Questionnaire input must be UTF-8 text of at most 64 KiB')
  }
  const content = parsed.content.startsWith('\uFEFF') ? parsed.content.slice(1) : parsed.content
  let rows: ImportedRow[]
  if (parsed.format === 'TEXT') {
    if (content.replace(/\r\n/gu, '').includes('\r')) throw ApiError.unprocessable('Text input requires LF or CRLF lines')
    const lines = content.split(/\r?\n/u)
    if (lines.at(-1) === '') lines.pop()
    rows = lines.map((question, index) => ({ rowId: `line-${index + 1}`, question }))
  } else {
    const records = csvRecords(content)
    if (records[0]?.length !== 2 || records[0][0] !== 'rowId' || records[0][1] !== 'question') {
      throw ApiError.unprocessable('CSV header must be rowId,question')
    }
    rows = records.slice(1).map(record => {
      if (record.length !== 2) throw ApiError.unprocessable('CSV rows must have two columns')
      return { rowId: record[0]!, question: record[1]! }
    })
  }
  if (!rows.length || rows.length > questionnaireRowLimit || rows.some(row =>
    !row.rowId.trim() || row.rowId.length > 200 || row.question.trim().length < 3 || row.question.length > 1000)) {
    throw ApiError.unprocessable(`Questionnaire requires 1–${questionnaireRowLimit} rows, IDs at most 200 characters and questions of 3–1000 characters`)
  }
  return { rows, format: parsed.format, documentIds: parsed.documentIds }
}
