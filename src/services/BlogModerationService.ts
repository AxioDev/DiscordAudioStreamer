export interface BlogModerationEvaluationInput {
  title: string;
  excerpt?: string | null;
  contentMarkdown: string;
}

export interface BlogModerationVerdict {
  approved: boolean;
  score: number;
  reasons: string[];
}

const MINIMUM_CONTENT_CHARACTERS = 400;
const MINIMUM_WORD_COUNT = 120;
const MINIMUM_SENTENCE_COUNT = 3;
const MINIMUM_PARAGRAPH_COUNT = 3;
const MINIMUM_UNIQUE_WORD_RATIO = 0.35;
const MAX_TOP_WORD_RATIO = 0.35;
const MAX_REPEATED_LINE_RATIO = 0.45;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const tokenizeWords = (value: string): string[] => {
  const matches = value.match(/\p{L}[\p{L}\p{M}0-9'’\-]*/gu);
  if (!matches) {
    return [];
  }
  return matches.map((word) => word.toLowerCase());
};

const countSentences = (value: string): number => {
  return value
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
};

const countParagraphs = (value: string): number => {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
};

const computeTopWordRatio = (tokens: string[]): number => {
  if (tokens.length === 0) {
    return 0;
  }
  const frequencies = new Map<string, number>();
  let max = 0;
  for (const token of tokens) {
    const next = (frequencies.get(token) ?? 0) + 1;
    frequencies.set(token, next);
    if (next > max) {
      max = next;
    }
  }
  return max / tokens.length;
};

const computeRepeatedLineRatio = (value: string): number => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return 0;
  }
  const frequencies = new Map<string, number>();
  let max = 0;
  for (const line of lines) {
    const next = (frequencies.get(line) ?? 0) + 1;
    frequencies.set(line, next);
    if (next > max) {
      max = next;
    }
  }
  return max / lines.length;
};

const containsLongCharacterRun = (value: string): boolean => {
  return /(.)\1{9,}/.test(value);
};

const normalizeContent = (value: string): string => {
  return value.replace(/\r\n?/g, '\n');
};

export default class BlogModerationService {
  evaluate(input: BlogModerationEvaluationInput): BlogModerationVerdict {
    const normalizedContent = normalizeContent(input.contentMarkdown ?? '');
    const normalizedExcerpt = normalizeWhitespace(input.excerpt ?? '');
    const normalizedTitle = normalizeWhitespace(input.title ?? '');

    const combinedText = normalizeWhitespace(
      [normalizedTitle, normalizedExcerpt, normalizedContent].filter(Boolean).join(' '),
    );

    const tokens = tokenizeWords(combinedText);
    const uniqueTokens = new Set(tokens);
    const uniqueRatio = tokens.length > 0 ? uniqueTokens.size / tokens.length : 0;
    const charCount = normalizedContent.replace(/\s+/g, ' ').trim().length;
    const sentenceCount = countSentences(normalizedContent);
    const paragraphCount = countParagraphs(normalizedContent);
    const topWordRatio = computeTopWordRatio(tokens);
    const repeatedLineRatio = computeRepeatedLineRatio(normalizedContent);

    const reasons: string[] = [];

    if (charCount < MINIMUM_CONTENT_CHARACTERS) {
      reasons.push(
        `Le contenu comporte trop peu d’informations (${charCount} caractères utiles, minimum ${MINIMUM_CONTENT_CHARACTERS}).`,
      );
    }

    if (tokens.length < MINIMUM_WORD_COUNT) {
      reasons.push(
        `Le texte est trop court (${tokens.length} mots détectés, minimum ${MINIMUM_WORD_COUNT}).`,
      );
    }

    if (uniqueRatio > 0 && uniqueRatio < MINIMUM_UNIQUE_WORD_RATIO) {
      reasons.push(
        `Le vocabulaire est trop répétitif (ratio de diversité ${uniqueRatio.toFixed(2)}, minimum ${MINIMUM_UNIQUE_WORD_RATIO}).`,
      );
    }

    if (sentenceCount < MINIMUM_SENTENCE_COUNT) {
      reasons.push(
        `La structure manque de profondeur (${sentenceCount} phrases, minimum ${MINIMUM_SENTENCE_COUNT}).`,
      );
    }

    if (paragraphCount < MINIMUM_PARAGRAPH_COUNT) {
      reasons.push(
        `Le contenu doit comporter davantage de paragraphes (${paragraphCount} détectés, minimum ${MINIMUM_PARAGRAPH_COUNT}).`,
      );
    }

    if (topWordRatio > MAX_TOP_WORD_RATIO && tokens.length >= MINIMUM_WORD_COUNT / 2) {
      reasons.push(
        `Certaines expressions sont répétées trop fréquemment (mot dominant présent dans ${(topWordRatio * 100).toFixed(0)}% du texte).`,
      );
    }

    if (repeatedLineRatio > MAX_REPEATED_LINE_RATIO && paragraphCount > 0) {
      reasons.push(
        `Plusieurs paragraphes sont identiques ou redondants (${(repeatedLineRatio * 100).toFixed(0)}% du contenu répété).`,
      );
    }

    if (containsLongCharacterRun(normalizedContent)) {
      reasons.push('Le contenu contient des répétitions de caractères anormales.');
    }

    const score = Math.max(0, Number((1 - reasons.length * 0.18).toFixed(2)));

    return {
      approved: reasons.length === 0,
      score,
      reasons,
    };
  }

  isApproved(input: BlogModerationEvaluationInput): boolean {
    return this.evaluate(input).approved;
  }
}
