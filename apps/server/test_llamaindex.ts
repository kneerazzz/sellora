import { OllamaEmbedding } from '@llamaindex/ollama'

async function main() {
  const embedModel = new OllamaEmbedding({ model: "all-minilm" })
  const result = await embedModel.getTextEmbedding("Hello world")
  console.log("Embedded dimension:", result.length)
}
main().catch(console.error)
