import { Document, MarkdownNodeParser, SentenceSplitter } from 'llamaindex'

export type ChunkedBlock = {
  text: string
  chunkIndex: number
  tokenCount: number
  overlapTokens: number
  headingPath: string[]
  sectionTitle: string | null
}

export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export async function structureAwareChunk(
  text: string,
  options?: { maxTokens?: number; overlapTokens?: number }
): Promise<ChunkedBlock[]> {
  const maxTokens = options?.maxTokens ?? 500
  const overlapTokens = options?.overlapTokens ?? 100

  // Fallback to text parsing if empty
  if (!text.trim()) {
    return []
  }

  const doc = new Document({ text })
  const mdParser = new MarkdownNodeParser()
  const mdNodes = mdParser.getNodesFromDocuments([doc])

  const splitter = new SentenceSplitter({ chunkSize: maxTokens, chunkOverlap: overlapTokens })
  // SentenceSplitter can handle nodes output from MarkdownNodeParser
  const finalNodes = splitter.getNodesFromDocuments(mdNodes as any)

  return finalNodes.map((node, idx) => {
    // Extract heading path from metadata (e.g. Header_1, Header_2)
    const headingPath: string[] = []
    let hIndex = 1
    while (node.metadata && node.metadata[`Header_${hIndex}`]) {
      headingPath.push(node.metadata[`Header_${hIndex}`])
      hIndex++
    }

    return {
      text: node.text,
      chunkIndex: idx,
      tokenCount: estimateTokenCount(node.text),
      overlapTokens: idx > 0 ? overlapTokens : 0, 
      headingPath,
      sectionTitle: headingPath.length > 0 ? headingPath[headingPath.length - 1]! : null,
    }
  })
}
