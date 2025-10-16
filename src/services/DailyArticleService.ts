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

export type DailyArticleGenerationStatus = 'generated' | 'skipped' | 'failed';

export type DailyArticleGenerationReason =
  | 'DISABLED'
  | 'ALREADY_RUNNING'
  | 'MISSING_DEPENDENCIES'
  | 'ALREADY_EXISTS'
  | 'NO_TRANSCRIPTS';

export interface DailyArticleGenerationResult {
  status: DailyArticleGenerationStatus;
  slug: string | null;
  title?: string;
  publishedAt?: string;
  tags?: string[];
  reason?: DailyArticleGenerationReason;
  error?: string;
}

export interface DailyArticleServiceStatus {
  enabled: boolean;
  running: boolean;
  nextRunAt: string | null;
  lastResult: DailyArticleGenerationResult | null;
  dependencies: {
    openAI: boolean;
    blogRepository: boolean;
    voiceActivityRepository: boolean;
  };
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

  private readonly enabled: boolean;

  private nextRunAt: Date | null = null;

  private lastResult: DailyArticleGenerationResult | null = null;

  constructor(options: DailyArticleServiceOptions) {
    this.blogRepository = options.blogRepository ?? null;
    this.blogService = options.blogService ?? null;
    this.voiceActivityRepository = options.voiceActivityRepository ?? null;
    this.config = options.config;
    this.openai = this.config.openAI.apiKey
      ? new OpenAI({ apiKey: this.config.openAI.apiKey })
      : null;
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

    this.enabled = reasons.length === 0 && Boolean(this.openai);

    if (!this.enabled) {
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
    this.nextRunAt = null;
  }

  private scheduleInitialRun(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const delay = 30_000;
    this.timer = setTimeout(() => this.execute(), delay);
    this.nextRunAt = new Date(Date.now() + delay);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private scheduleNextRun(): void {
    if (!this.enabled || !this.openai || !this.blogRepository || !this.voiceActivityRepository) {
      this.nextRunAt = null;
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const now = new Date();
    const nextRun = this.computeNextRunTime(now);
    const delay = Math.max(nextRun.getTime() - now.getTime(), 30_000);

    this.nextRunAt = new Date(now.getTime() + delay);
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
      const result = await this.performGenerationCycle({ manual: true });
      this.lastResult = result;
    } catch (error) {
      const failure: DailyArticleGenerationResult = {
        status: 'failed',
        slug: null,
        error: (error as Error)?.message ?? 'UNKNOWN_ERROR',
      };
      this.lastResult = failure;
      console.error('DailyArticleService: génération échouée', error);
    } finally {
      this.running = false;
      this.scheduleNextRun();
    }
  }

  public async triggerManualGeneration(): Promise<DailyArticleGenerationResult> {
    if (!this.enabled || !this.openai || !this.blogRepository || !this.voiceActivityRepository) {
      const result: DailyArticleGenerationResult = {
        status: 'skipped',
        slug: null,
        reason: this.enabled ? 'MISSING_DEPENDENCIES' : 'DISABLED',
      };
      this.lastResult = result;
      return result;
    }

    if (this.running) {
      return {
        status: 'skipped',
        slug: this.lastResult?.slug ?? null,
        reason: 'ALREADY_RUNNING',
      };
    }

    this.running = true;
    try {
      const result = await this.performGenerationCycle({ manual: true });
      this.lastResult = result;
      return result;
    } catch (error) {
      const failure: DailyArticleGenerationResult = {
        status: 'failed',
        slug: null,
        error: (error as Error)?.message ?? 'UNKNOWN_ERROR',
      };
      this.lastResult = failure;
      console.error('DailyArticleService: génération manuelle échouée', error);
      return failure;
    } finally {
      this.running = false;
      this.scheduleNextRun();
    }
  }

  public getStatus(): DailyArticleServiceStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      nextRunAt: this.nextRunAt ? this.nextRunAt.toISOString() : null,
      lastResult: this.lastResult,
      dependencies: {
        openAI: Boolean(this.openai),
        blogRepository: Boolean(this.blogRepository),
        voiceActivityRepository: Boolean(this.voiceActivityRepository),
      },
    };
  }

  private buildSlug(targetDate: Date): string {
    const isoDate = targetDate.toISOString().slice(0, 10);
    return `journal-${isoDate}`;
  }

  private getDateBoundsForTarget(targetDate: Date): { targetDate: Date; rangeStart: Date; rangeEnd: Date } {
    const normalizedTarget = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const rangeStart = new Date(normalizedTarget);
    const rangeEnd = new Date(normalizedTarget);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

    return { targetDate: normalizedTarget, rangeStart, rangeEnd };
  }

  private getAutomaticDateBounds(): { targetDate: Date; rangeStart: Date; rangeEnd: Date } {
    const now = new Date();
    const todayUtcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const targetDate = new Date(todayUtcStart);
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
    return this.getDateBoundsForTarget(targetDate);
  }

  private getManualCandidateBounds(): Array<{ targetDate: Date; rangeStart: Date; rangeEnd: Date }> {
    const candidates: Array<{ targetDate: Date; rangeStart: Date; rangeEnd: Date }> = [];
    const automatic = this.getAutomaticDateBounds();
    candidates.push(automatic);

    const now = new Date();
    const todayUtcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const todayBounds = this.getDateBoundsForTarget(todayUtcStart);

    // Avoid pushing duplicate bounds if we're exactly at midnight UTC.
    if (todayBounds.targetDate.getTime() !== automatic.targetDate.getTime()) {
      candidates.push(todayBounds);
    }

    return candidates;
  }

  private async performGenerationCycle(options: { manual?: boolean } = {}): Promise<DailyArticleGenerationResult> {
    if (!this.enabled || !this.openai || !this.blogRepository || !this.voiceActivityRepository) {
      return { status: 'skipped', slug: null, reason: 'MISSING_DEPENDENCIES' };
    }

    const manual = options.manual === true;
    const candidateBounds = manual ? this.getManualCandidateBounds() : [this.getAutomaticDateBounds()];

    let lastSlug: string | null = null;
    let lastReason: DailyArticleGenerationReason | undefined;

    for (const { targetDate, rangeStart, rangeEnd } of candidateBounds) {
      const slug = this.buildSlug(targetDate);
      lastSlug = slug;

      const existing = await this.blogRepository.getPostBySlug(slug);
      if (existing) {
        lastReason = 'ALREADY_EXISTS';
        if (manual) {
          // Allow manual generation to fall back to the next candidate date.
          continue;
        }
        return { status: 'skipped', slug, reason: 'ALREADY_EXISTS' };
      }

      const transcripts = await this.voiceActivityRepository.listVoiceTranscriptionsForRange({
        since: rangeStart,
        until: rangeEnd,
        limit: MAX_TRANSCRIPT_SNIPPETS,
      });

      const filteredTranscripts = transcripts.filter((entry) => (entry.content ?? '').trim().length > 0);
      if (filteredTranscripts.length === 0) {
        lastReason = 'NO_TRANSCRIPTS';
        console.warn(
          'DailyArticleService: aucune transcription disponible pour %s, tentative suivante.',
          targetDate.toISOString().slice(0, 10),
        );
        if (manual) {
          continue;
        }
        return { status: 'skipped', slug, reason: 'NO_TRANSCRIPTS' };
      }

      const payload: ArticleGenerationPayload = {
        transcripts: filteredTranscripts,
        targetDate,
      };

      const article = await this.generateArticleWithOpenAI(payload);
      if (!article) {
        console.warn('DailyArticleService: génération du contenu échouée.');
        return { status: 'failed', slug, error: 'ARTICLE_GENERATION_FAILED' };
      }

      const coverImageUrl = await this.generateCoverImage(article.coverImagePrompt);

      const normalizedTags = Array.from(
        new Set([
          ...this.config.openAI.dailyArticleTags,
          ...article.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
        ]),
      );

      const publishedAt = new Date();

      await this.blogRepository.upsertPost({
        slug,
        title: article.title.trim(),
        excerpt: this.normalizeExcerpt(article.excerpt),
        contentMarkdown: article.contentMarkdown.trim(),
        coverImageUrl: coverImageUrl ?? null,
        tags: normalizedTags,
        seoDescription: article.seoDescription ?? null,
        publishedAt,
        updatedAt: publishedAt,
      });

      if (this.blogService) {
        // Ensure any cached initialization steps are completed.
        await this.blogService.initialize();
      }

      console.log(`DailyArticleService: article généré et publié pour ${slug}.`);

      return {
        status: 'generated',
        slug,
        title: article.title.trim(),
        tags: normalizedTags,
        publishedAt: publishedAt.toISOString(),
      };
    }

    return {
      status: 'skipped',
      slug: lastSlug,
      reason: lastReason ?? 'NO_TRANSCRIPTS',
    };
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
