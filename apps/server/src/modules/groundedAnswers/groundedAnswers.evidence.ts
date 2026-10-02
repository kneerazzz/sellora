import { tokenizeForRetrieval } from '../../utils/localRetrieval'

const QUESTION_WORDS = new Set(['does', 'did', 'was', 'were', 'will', 'would', 'could', 'should', 'please', 'tell'])

/**
 * Conservative candidate eligibility, independent of retrieval/reranker scores.
 * This lexical baseline is not claim verification or a probability. It can
 * refuse paraphrases; calibration and source-conflict evaluation remain required.
 */
export function hasQuestionEvidence(question: string, text: string): boolean {
  const terms = [...new Set(tokenizeForRetrieval(question).filter((term) => !QUESTION_WORDS.has(term)))]
  if (!terms.length) return false
  const sourceTerms = new Set(tokenizeForRetrieval(text))
  const matches = terms.filter((term) => sourceTerms.has(term)).length
  return matches >= Math.min(2, terms.length) && matches / terms.length >= 0.5
}
