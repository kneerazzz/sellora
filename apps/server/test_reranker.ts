import { AutoTokenizer, AutoModelForSequenceClassification, env } from '@xenova/transformers';

env.allowLocalModels = false;

async function run() {
  const model_id = 'Xenova/bge-reranker-base';
  const tokenizer = await AutoTokenizer.from_pretrained(model_id);
  const model = await AutoModelForSequenceClassification.from_pretrained(model_id, { quantized: true });

  const question = "what is panda?";
  const texts = [
    "hi",
    "The giant panda (Ailuropoda melanoleuca), sometimes called a panda bear or simply panda, is a bear species endemic to China.",
    "panda is a bear"
  ];

  for (const text of texts) {
    const inputs = tokenizer(question, { text_pair: text });
    const { logits } = await model(inputs);
    console.log(`Logits for "${text}":`, logits.data[0]);
  }
}

run().catch(console.error);
