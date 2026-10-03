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

/** Require lexical coverage of each explicit question part, including fallback. */
export function hasQuestionPartEvidence(question: string, texts: string[]): boolean {
  const parts = question.split(/[?;\n]+|\b(?:and|also|plus)\b|&/i)
    .map(part => part.trim()).filter(part => tokenizeForRetrieval(part).length > 0)
  const context = texts.join('\n')
  return parts.length > 0 && parts.every(part => hasQuestionEvidence(part, context))
}
