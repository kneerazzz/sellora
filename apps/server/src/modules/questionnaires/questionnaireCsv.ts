const headers = ['index', 'rowId', 'question', 'status', 'answer', 'draftId', 'revisionId', 'reviewStatus', 'sourceStatus', 'sources', 'errorCode']

function cell(value: string | number) {
  const text = String(value)
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function questionnaireCsv(rows: Array<Array<string | number>>) {
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
