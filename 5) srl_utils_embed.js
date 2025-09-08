import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embedTexts(texts){
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts
  });
  return resp.data.map(e => '[' + e.embedding.join(',') + ']'); // pgvector array literal
}
