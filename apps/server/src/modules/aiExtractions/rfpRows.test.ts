import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
  PROVIDER_QUESTION_MAX: '3',
})

const { rfpExtractionInputSchema } = await import('./rfpExtraction.schema')
const { answerRfpRows } = await import('./rfpRows')

test('RFP rows retain caller IDs, duplicate questions, order and explicit failure status', async () => {
  const rows = [
    { rowId: 'sheet-7', question: 'Same question?' },
    { rowId: 'sheet-8', question: 'Same question?' },
    { rowId: 'sheet-9', question: 'Another question?' },
  ]
  assert.equal(rfpExtractionInputSchema.safeParse({ body: { rows } }).success, true)
  assert.equal(rfpExtractionInputSchema.safeParse({ body: { rows: [...rows, rows[0]] } }).success, false)
  assert.equal(rfpExtractionInputSchema.safeParse({ body: { rows: [{ question: 'Missing ID' }] } }).success, false)

  let attempts = 0
  const results = await answerRfpRows(rows, async () => {
    attempts += 1
    if (attempts === 2) return { answer: 'Insufficient context', refused: true, confidence: 'LOW' as const, citations: [], reviewRequired: true as const, aiInteractionId: 'refusal' }
    if (attempts === 3) return { answer: null, refused: false } as never
    return { answer: 'Supported answer', refused: false, confidence: 'LOW' as const, citations: [], reviewRequired: true as const, aiInteractionId: 'success' }
  })
  assert.equal(attempts, 3)
  assert.deepEqual(results.map(({ rowId, index, question, status }) => ({ rowId, index, question, status })), [
    { rowId: 'sheet-7', index: 0, question: 'Same question?', status: 'success' },
    { rowId: 'sheet-8', index: 1, question: 'Same question?', status: 'refusal' },
    { rowId: 'sheet-9', index: 2, question: 'Another question?', status: 'error' },
  ])
  assert.equal(results[2].errorCode, 'ANSWER_FAILED')
  assert.deepEqual(results[2].citations, [])
  const thrown = await answerRfpRows(rows.slice(0, 1), async () => { throw new Error('provider outage') })
  assert.equal(thrown[0].status, 'error')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(answerRfpRows(rows.slice(0, 1), async () => { throw new Error('unexpected call') }, controller.signal))
})

test('saved RFP consumer reads versioned results and keeps refusal and error rows', () => {
  const workflow = JSON.parse(readFileSync(new URL('../../../../../n8n/sellora_rfp_workflow.json', import.meta.url), 'utf8'))
  const body = workflow.nodes.find((node: { name: string }) => node.name === 'Sellora – POST /ai/extractions/rfp').parameters.jsonBody
  assert.match(body, /"content"/)
  assert.doesNotMatch(body, /rfpText":/)
  const code = workflow.nodes.find((node: { name: string }) => node.name === 'Parse & Shape Answers').parameters.jsCode
  const response = { success: true, data: { version: 1, extractionAiInteractionId: 'extract-1', results: [
    { rowId: '7', index: 0, question: 'Same?', status: 'success', answer: 'Yes', confidence: 'LOW', citations: [] },
    { rowId: '8', index: 1, question: 'Same?', status: 'refusal', answer: 'No context', confidence: 'LOW', citations: [] },
    { rowId: '9', index: 2, question: 'Other?', status: 'error', answer: null, errorCode: 'ANSWER_FAILED', citations: [] },
  ] } }
  const run = (item: unknown) => vm.runInNewContext(`(function () { ${code} })()`, {
    $input: { all: () => [{ json: item }] },
    $: () => ({ first: () => ({ json: { fileName: 'fixture.pdf', fileId: 'file-1' } }) }),
  }) as Array<{ json: { rows: Array<{ rowId: string; status: string; answer: string }>; summary: { errorCount: number } } }>
  const shaped = run(response)[0].json
  assert.deepEqual(Array.from(shaped.rows, row => row.rowId), ['7', '8', '9'])
  assert.deepEqual(Array.from(shaped.rows, row => row.status), ['success', 'refusal', 'error'])
  assert.equal(shaped.rows[2].answer, '')
  assert.equal(shaped.summary.errorCount, 1)
  const spreadsheetCode = workflow.nodes.find((node: { name: string }) => node.name === 'Build Spreadsheet Data').parameters.jsCode
  const sheet = vm.runInNewContext(`(function () { ${spreadsheetCode} })()`, {
    $input: { first: () => ({ json: shaped }) },
  }) as Array<{ json: { allRows: Array<Array<unknown>> } }>
  assert.equal(sheet[0].json.allRows.length, 4)
  assert.equal(sheet[0].json.allRows[3][1], '9')
  assert.equal(sheet[0].json.allRows[3][3], 'error')
  assert.throws(() => run({ success: true, data: { ...response.data, results: response.data.results.slice(1) } }), /row contract/)
})
