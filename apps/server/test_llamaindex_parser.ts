import { Document, MarkdownNodeParser } from 'llamaindex'

async function main() {
  const doc = new Document({ text: "# Header 1\nThis is a paragraph under header 1.\n## Header 2\nThis is a paragraph under header 2." })
  const parser = new MarkdownNodeParser()
  const nodes = parser.getNodesFromDocuments([doc])
  for (const node of nodes) {
    console.log("Node:", node.text)
    console.log("Metadata:", node.metadata)
  }
}
main()
