import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'

type Answer = Awaited<ReturnType<typeof groundedAnswersService.answerQuestion>>
type RfpRow = { rowId: string; question: string }

export async function answerRfpRows(
  rows: RfpRow[],
  answerQuestion: (question: string) => Promise<Answer>,
  signal?: AbortSignal
) {
  const results = []
  for (const [index, row] of rows.entries()) {
    if (signal?.aborted) throw signal.reason ?? new Error('RFP answering cancelled')
    try {
      const answer = await answerQuestion(row.question)
      if (typeof answer?.answer !== 'string' || !answer.answer.trim() || typeof answer.refused !== 'boolean' ||
        !['LOW', 'MEDIUM', 'HIGH'].includes(answer.confidence) || !Array.isArray(answer.citations)) {
        throw new Error('Malformed answer result')
      }
      results.push({
        rowId: row.rowId, index, question: row.question,
        status: answer.refused ? 'refusal' as const : 'success' as const,
        answer: answer.answer, refused: answer.refused,
        confidence: answer.confidence, citations: answer.citations,
        errorCode: null,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      console.error('Failed to answer RFP row', { index, error: error instanceof Error ? error.name : 'unknown' })
      results.push({
        rowId: row.rowId, index, question: row.question,
        status: 'error' as const, answer: null, refused: false,
        confidence: null, citations: [], errorCode: 'ANSWER_FAILED' as const,
      })
    }
  }
  return results
}
