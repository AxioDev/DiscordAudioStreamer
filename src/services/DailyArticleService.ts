import OpenAI from 'openai';
import type { Config } from '../config';
import BlogRepository from './BlogRepository';
import BlogService from './BlogService';
import type VoiceActivityRepository from './VoiceActivityRepository';
import type { VoiceTranscriptionRecord } from './VoiceActivityRepository';

interface DailyArticleServiceOptions {
  config: Config;
  blogRepository: BlogRepository | null;
  blogService?: BlogService | null;
  voiceActivityRepository: VoiceActivityRepository | null;
}

interface GeneratedArticleResult {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  coverImagePrompt: string;
  tags: string[];
  seoDescription: string | null;
}

interface ArticleGenerationPayload {
  transcripts: VoiceTranscriptionRecord[];
  targetDate: Date;
}

const MIN_SUMMARY_CHAR_LENGTH = 80;
const MAX_TRANSCRIPT_SNIPPETS = 2000;
const MAX_TRANSCRIPTS_CHAR_LENGTH = 12_000;

export default class DailyArticleService {
  private readonly blogRepository: BlogRepository | null;

  private readonly blogService: BlogService | null;

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  private readonly config: Config;

  private readonly openai: OpenAI | null;

  private timer: NodeJS.Timeout | null = null;

  private running = false;

  constructor(options: DailyArticleServiceOptions) {
    this.blogRepository = options.blogRepository ?? null;
    this.blogService = options.blogService ?? null;
    this.voiceActivityRepository = options.voiceActivityRepository ?? null;
    this.config = options.config;
    this.openai = this.config.openAI.apiKey
      ? new OpenAI({ apiKey: this.config.openAI.apiKey })
      : null;

    if (!this.blogRepository || !this.voiceActivityRepository || !this.openai) {
      const reasons: string[] = [];
      if (!this.config.openAI.apiKey) {
        reasons.push('clé API OpenAI manquante');
      }
      if (!this.blogRepository) {
        reasons.push('référentiel de blog indisponible');
      }
      if (!this.voiceActivityRepository) {
        reasons.push('référentiel des transcriptions indisponible');
      }
      if (reasons.length > 0) {
        console.warn(`DailyArticleService désactivé (${reasons.join(', ')}).`);
      }
      return;
    }

    this.scheduleInitialRun();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleInitialRun(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.execute(), 30_000);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private scheduleNextRun(): void {
    if (!this.openai || !this.blogRepository || !this.voiceActivityRepository) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const now = new Date();
    const nextRun = this.computeNextRunTime(now);
    const delay = Math.max(nextRun.getTime() - now.getTime(), 30_000);

    this.timer = setTimeout(() => this.execute(), delay);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private computeNextRunTime(reference: Date): Date {
    const hour = this.config.openAI.dailyArticleHourUtc;
    const minute = this.config.openAI.dailyArticleMinuteUtc;
    const next = new Date(
      Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate(),
        hour,
        minute,
        0,
        0,
      ),
    );

    if (next <= reference) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    return next;
  }

  private async execute(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.generateDailyArticle();
    } catch (error) {
      console.error('DailyArticleService: génération échouée', error);
    } finally {
      this.running = false;
      this.scheduleNextRun();
    }
  }

  private buildSlug(targetDate: Date): string {
    const isoDate = targetDate.toISOString().slice(0, 10);
    return `journal-${isoDate}`;
  }

  private getDateBounds(): { targetDate: Date; rangeStart: Date; rangeEnd: Date } {
    const now = new Date();
    const todayUtcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const targetDate = new Date(todayUtcStart);
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
    const rangeStart = new Date(targetDate);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

    return { targetDate, rangeStart, rangeEnd };
  }

  private async generateDailyArticle(): Promise<void> {
    if (!this.openai || !this.blogRepository || !this.voiceActivityRepository) {
      return;
    }

    const { targetDate, rangeStart, rangeEnd } = this.getDateBounds();
    const slug = this.buildSlug(targetDate);

    const existing = await this.blogRepository.getPostBySlug(slug);
    if (existing) {
      return;
    }

    const transcripts = await this.voiceActivityRepository.listVoiceTranscriptionsForRange({
      since: rangeStart,
      until: rangeEnd,
      limit: MAX_TRANSCRIPT_SNIPPETS,
    });

    const filteredTranscripts = transcripts.filter((entry) => (entry.content ?? '').trim().length > 0);
    if (filteredTranscripts.length === 0) {
      console.warn('DailyArticleService: aucune transcription disponible pour cette journée, génération annulée.');
      return;
    }

    const payload: ArticleGenerationPayload = {
      transcripts: filteredTranscripts,
      targetDate,
    };

    const article = await this.generateArticleWithOpenAI(payload);
    if (!article) {
      console.warn('DailyArticleService: génération du contenu échouée.');
      return;
    }

    const coverImageUrl = await this.generateCoverImage(article.coverImagePrompt);

    const normalizedTags = Array.from(
      new Set([
        ...this.config.openAI.dailyArticleTags,
        ...article.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
      ]),
    );

    const publishedAt = new Date(rangeEnd.getTime() - 60 * 60 * 1000);
    const updatedAt = new Date();

    await this.blogRepository.upsertPost({
      slug,
      title: article.title.trim(),
      excerpt: this.normalizeExcerpt(article.excerpt),
      contentMarkdown: article.contentMarkdown.trim(),
      coverImageUrl: coverImageUrl ?? null,
      tags: normalizedTags,
      seoDescription: article.seoDescription ?? null,
      publishedAt,
      updatedAt,
    });

    if (this.blogService) {
      // Ensure any cached initialization steps are completed.
      await this.blogService.initialize();
    }

    console.log(`DailyArticleService: article généré et publié pour ${slug}.`);
  }

  private normalizeExcerpt(raw: string): string | null {
    const trimmed = raw?.trim?.() ?? '';
    if (!trimmed) {
      return null;
    }
    if (trimmed.length >= MIN_SUMMARY_CHAR_LENGTH) {
      return trimmed;
    }
    return trimmed;
  }

  private async generateArticleWithOpenAI(payload: ArticleGenerationPayload): Promise<GeneratedArticleResult | null> {
    if (!this.openai) {
      return null;
    }

    const formattedDate = payload.targetDate.toISOString().slice(0, 10);
    const condensedTranscripts = this.buildTranscriptSummary(payload.transcripts);

    const response = await this.openai.responses.create({
      model: this.config.openAI.articleModel,
      input: [
        {
          role: 'system',
          content:
            "Tu es un journaliste radio chargé de rédiger un article quotidien extrêmement humain et incarné, en français, à partir de retranscriptions audio. Tu t'adresses à un lectorat curieux et empathique. L'article doit être structuré, riche en détails sensoriels et factuels, tout en restant fidèle aux paroles partagées.",
        },
        {
          role: 'user',
          content: `Date: ${formattedDate}\n\nRetranscriptions du jour:\n${condensedTranscripts}\n\nConsignes:\n- Rédige un article journalistique long (entre 800 et 1 200 mots) en adoptant un ton chaleureux, humain et incarné.\n- Structure l'article avec un titre, un chapeau et plusieurs intertitres.\n- Mets en avant les histoires, émotions et points clés exprimés dans la journée.\n- Ne fabrique pas de citations : paraphrase avec précision.\n- Termine par un paragraphe d'ouverture vers le lendemain.\n- Propose un prompt d'illustration pour une image générée par IA qui capture l'atmosphère générale du jour.\n- Fournis un résumé percutant (2 phrases maximum) et une description SEO (max 160 caractères).\n\nRéponds strictement en JSON au format suivant : {"title": string, "excerpt": string, "content_markdown": string, "cover_image_prompt": string, "tags": string[], "seo_description": string}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'daily_article',
          schema: {
            type: 'object',
            required: ['title', 'excerpt', 'content_markdown', 'cover_image_prompt', 'tags', 'seo_description'],
            properties: {
              title: { type: 'string' },
              excerpt: { type: 'string' },
              content_markdown: { type: 'string' },
              cover_image_prompt: { type: 'string' },
              tags: {
                type: 'array',
                items: { type: 'string' },
                minItems: 0,
              },
              seo_description: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
    });

    const outputText = response.output_text?.trim();
    if (!outputText) {
      return null;
    }

    try {
      const parsed = JSON.parse(outputText) as {
        title: string;
        excerpt: string;
        content_markdown: string;
        cover_image_prompt: string;
        tags?: string[];
        seo_description?: string;
      };

      return {
        title: parsed.title?.trim() ?? 'Chronique du jour',
        excerpt: parsed.excerpt?.trim() ?? '',
        contentMarkdown: parsed.content_markdown ?? '',
        coverImagePrompt:
          parsed.cover_image_prompt?.trim() ||
          'Une scène radiophonique chaleureuse, ambiance nocturne, lumières tamisées, style photojournalistique.',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        seoDescription: parsed.seo_description?.trim() ?? null,
      };
    } catch (error) {
      console.error('DailyArticleService: impossible de parser la réponse JSON', error);
      return null;
    }
  }

  private async generateCoverImage(prompt: string): Promise<string | null> {
    if (!this.openai) {
      return null;
    }

    try {
      const response = await this.openai.images.generate({
        model: this.config.openAI.imageModel,
        prompt,
        size: '1024x1024',
      });
      const url = response.data?.[0]?.url;
      return typeof url === 'string' ? url : null;
    } catch (error) {
      console.error('DailyArticleService: génération de l\'image échouée', error);
      return null;
    }
  }

  private buildTranscriptSummary(transcripts: VoiceTranscriptionRecord[]): string {
    const lines: string[] = [];
    let currentLength = 0;

    for (const entry of transcripts) {
      if (!entry.content) {
        continue;
      }
      const time = entry.timestamp.toISOString().slice(11, 16);
      const speaker = entry.userId ? `Intervenant ${entry.userId.slice(0, 6)}` : 'Intervenant inconnu';
      const sanitizedContent = entry.content.replace(/\s+/g, ' ').trim();
      const line = `- [${time}] ${speaker} : ${sanitizedContent}`;
      const nextLength = currentLength + line.length + 1;
      if (nextLength > MAX_TRANSCRIPTS_CHAR_LENGTH) {
        break;
      }
      lines.push(line);
      currentLength = nextLength;
    }

    return lines.join('\n');
  }
}
