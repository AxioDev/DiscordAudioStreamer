import OpenAI from 'openai';
import config from '../config';

type OpenAIClient = InstanceType<typeof OpenAI>;

interface EmbeddingsClient {
  create: (params: { model: string; input: string }) => Promise<{ data: Array<{ embedding: number[] }> }>;
}

interface ResponsesClient {
  create: (params: { model: string; input: string }) => Promise<{ output_text?: string | null }>;
}

type EnhancedOpenAIClient = OpenAIClient & {
  embeddings: EmbeddingsClient;
  responses: ResponsesClient;
};

const embeddingModel = 'text-embedding-3-small';
const chatModel = 'gpt-4o-mini';

let client: EnhancedOpenAIClient | null = null;

function getClient(): EnhancedOpenAIClient {
  const apiKey = config.openAI?.apiKey;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  if (!client) {
    client = new OpenAI({ apiKey }) as EnhancedOpenAIClient;
  }

  return client;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('Cannot compute embedding for empty text.');
  }

  const openAiClient = getClient();
  const response = await openAiClient.embeddings.create({
    model: embeddingModel,
    input: trimmedText,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Failed to compute embedding from OpenAI.');
  }

  return embedding;
}

export async function generateAnswer(context: string, question: string): Promise<string> {
  const openAiClient = getClient();
  const prompt = `CONTEXTE :\n${context || 'Aucun contexte pertinent trouvé.'}\n\nQUESTION :\n${question}\n\nINSTRUCTION :\nRéponds de façon claire et concise en te basant uniquement sur le contexte ci-dessus.\nSi l'information n'est pas disponible, indique que tu ne sais pas.`;

  const response = await openAiClient.responses.create({
    model: chatModel,
    input: prompt,
  });

  const answer = response.output_text?.trim();
  if (!answer) {
    throw new Error('Failed to generate answer from OpenAI.');
  }

  return answer;
}
