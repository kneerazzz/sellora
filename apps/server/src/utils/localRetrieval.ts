const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'can',
  'for',
  'from',
  'have',
  'how',
  'into',
  'our',
  'that',
  'the',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'you',
  'your',
])

export function tokenizeForRetrieval(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
}

export function scoreByTokenOverlap(questionTokens: string[], text: string): number {
  const lowerText = text.toLowerCase()

  return questionTokens.reduce((score, token) => {
    return lowerText.includes(token) ? score + 1 : score
  }, 0)
}

export function buildSnippet(text: string, maxLength = 450): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact
}

export function buildExtractiveAnswer(question: string, snippets: string[]): string {
  return [
    `Based on the indexed documents, the answer to "${question}" is:`,
    snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n'),
  ].join('\n\n')
}
