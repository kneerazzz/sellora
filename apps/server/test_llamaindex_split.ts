import { Document, MarkdownNodeParser, SentenceSplitter } from 'llamaindex'

async function main() {
  const doc = new Document({ text: "# Header 1\nThis is a very long paragraph. ".repeat(20) })
  const mdParser = new MarkdownNodeParser()
  const mdNodes = mdParser.getNodesFromDocuments([doc])
  
  const splitter = new SentenceSplitter({ chunkSize: 50, chunkOverlap: 10 })
  const finalNodes = splitter.getNodesFromDocuments(mdNodes as any)
  
  for (const node of finalNodes) {
    console.log("Length:", node.text.length, "Meta:", node.metadata)
  }
}
main()
