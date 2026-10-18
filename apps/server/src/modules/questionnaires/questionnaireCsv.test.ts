import assert from 'node:assert/strict'
import test from 'node:test'
import { questionnaireCsv } from './questionnaireCsv'

test('CSV keeps ordered duplicate and multiline rows while neutralizing formula cells', () => {
  const csv = questionnaireCsv([
    [0, '=SUM(1,2)', 'same\n"question"', 'SUCCESS', '+cmd', '', '', 'REQUIRED', 'NO_SOURCES', '', ''],
    [1, '@test', 'same\n"question"', 'ERROR', '\t=HYPERLINK("x")', '', '', 'REQUIRED', 'NO_SOURCES', '', 'ANSWER_FAILED'],
  ])
  assert.match(csv, /"'=SUM\(1,2\)","same\n""question"""/)
  assert.match(csv, /"'\+cmd"/)
  assert.match(csv, /"'@test"/)
  assert.match(csv, /"'\t=HYPERLINK\(""x""\)"/)
  assert.equal(csv.split('\r\n').filter(line => line.startsWith('"0"') || line.startsWith('"1"')).length, 2)
})
