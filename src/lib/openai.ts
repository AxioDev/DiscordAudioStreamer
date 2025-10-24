import OpenAI from 'openai';
import config from '../config';

type OpenAIClient = InstanceType<typeof OpenAI>;

interface EmbeddingsClient {
  create: (params: { model: string; input: string }) => Promise<{ data: Array<{ embedding: number[] }> }>;
}

interface ResponsesCreateParams {
  model: string;
  input: string;
  temperature?: number;
  max_output_tokens?: number;
}

interface ResponsesClient {
  create: (params: ResponsesCreateParams) => Promise<{ output_text?: string | null }>;
}

type EnhancedOpenAIClient = OpenAIClient & {
  embeddings: EmbeddingsClient;
  responses: ResponsesClient;
};

export interface ConversationMessage {
  role: 'assistant' | 'user';
  content: string;
}

const embeddingModel = 'text-embedding-3-small';
const chatModel = 'gpt-4o-mini';
const chatTemperature = 0.2;
const maxOutputTokens = 600;

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

function buildConversationHistory(conversation: ConversationMessage[]): string {
  if (conversation.length === 0) {
    return '';
  }

  return conversation
    .slice(-10)
    .map((message, index) => {
      const label = message.role === 'assistant' ? 'Assistant' : 'Utilisateur';
      return `${index + 1}. ${label} : ${message.content.trim()}`;
    })
    .join('\n');
}

export async function generateAnswer(
  context: string,
  question: string,
  conversation: ConversationMessage[] = [],
): Promise<string> {
  const openAiClient = getClient();
  const sanitizedQuestion = question.trim();
  const conversationHistory = buildConversationHistory(conversation);
  const contextSection = context || 'Aucun contexte pertinent trouvé.';

  const promptSections = [
    'Tu es un assistant spécialisé dans la connaissance produit de Music League et de notre serveur Discord.',
    'Analyse attentivement le contexte fourni. Utilise uniquement les informations pertinentes pour construire ta réponse.',
    conversationHistory
      ? `Historique récent de la conversation :\n${conversationHistory}`
      : '',
    `Contextes disponibles :\n${contextSection}`,
    `Question actuelle :\n${sanitizedQuestion}`,
    'Contraintes :\n- Réponds en français avec un ton professionnel mais accessible.\n- Cite explicitement les passages utilisés (ex. « Passages 1 et 3 »).\n- Si l’information n’est pas présente, indique clairement que tu ne la possèdes pas et suggère, si possible, comment l’obtenir.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await openAiClient.responses.create({
    model: chatModel,
    input: promptSections,
    temperature: chatTemperature,
    max_output_tokens: maxOutputTokens,
  });

  const answer = response.output_text?.trim();
  if (!answer) {
    throw new Error('Failed to generate answer from OpenAI.');
  }

  return answer;
}
