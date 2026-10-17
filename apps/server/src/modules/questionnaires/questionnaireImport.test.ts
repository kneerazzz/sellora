import assert from 'node:assert/strict'
import { test } from 'node:test'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
})
const { parseQuestionnaireImport, questionnaireRowLimit } = await import('./questionnaireImport')

test('bounded text import preserves line positions and duplicate questions', () => {
  const result = parseQuestionnaireImport({ format: 'TEXT', content: '\uFEFFSame?\r\nSame?\r\n' })
  assert.deepEqual(result.rows, [
    { rowId: 'line-1', question: 'Same?' },
    { rowId: 'line-2', question: 'Same?' },
  ])
  assert.throws(() => parseQuestionnaireImport({ format: 'TEXT', content: 'First?\n\nThird?' }))
  assert.throws(() => parseQuestionnaireImport({ format: 'TEXT', content: 'Question?\n'.repeat(questionnaireRowLimit + 1) }))
  assert.throws(() => parseQuestionnaireImport({ format: 'TEXT', content: 'x'.repeat(65_537) }))
  assert.throws(() => parseQuestionnaireImport({ format: 'TEXT', content: 'bad\uFFFD' }))
})

test('CSV import accepts quoted commas and newlines with stable IDs', () => {
  const result = parseQuestionnaireImport({ format: 'CSV', content: 'rowId,question\r\nA,"Does it support, exports?"\r\nB,"What about\n""quotes""?"\r\n' })
  assert.deepEqual(result.rows, [
    { rowId: 'A', question: 'Does it support, exports?' },
    { rowId: 'B', question: 'What about\n"quotes"?' },
  ])
  for (const content of [
    'question\nQ?', 'rowId,question\nA,', 'rowId,question\nA,B,C',
    'rowId,question\nA,"unclosed', 'rowId,question\nA,"closed"junk',
  ]) assert.throws(() => parseQuestionnaireImport({ format: 'CSV', content }))
})
