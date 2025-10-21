import OpenAI from 'openai';
import type { Config } from '../config';
import type VoiceActivityRepository from './VoiceActivityRepository';
import type {
  PersonaInsightItem,
  PersonaProfileData,
  UserMessageActivityEntry,
  UserPersonaCandidateRecord,
  UserPersonaProfileInsertRecord,
  UserVoiceTranscriptionEntry,
  VoiceTranscriptionCursor,
} from './VoiceActivityRepository';

interface UserPersonaServiceOptions {
  config: Config;
  voiceActivityRepository: VoiceActivityRepository | null;
}

interface FormattedSamples {
  formatted: string;
  count: number;
  totalChars: number;
  lastTimestamp: Date | null;
}

interface AggregatedSamples {
  transcripts: UserVoiceTranscriptionEntry[];
  messages: UserMessageActivityEntry[];
  totalChars: number;
  lastActivityAt: Date | null;
}

const PERSONA_VERSION = '2024-12-03';
const INITIAL_DELAY_MS = 45_000;
const MIN_TOTAL_CHAR_THRESHOLD = 400;
const MIN_ACTIVITY_DELTA_MS = 30 * 60 * 1000;
const MAX_PROFILE_STALE_MS = 12 * 60 * 60 * 1000;
const MAX_TRANSCRIPT_CHAR_BUDGET = 8_000;
const MAX_MESSAGE_CHAR_BUDGET = 6_000;
const MAX_TRANSCRIPT_FETCH = 150;
const MAX_MESSAGE_FETCH = 200;

const PERSONA_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'detail', 'confidence', 'evidence'],
  properties: {
    title: { type: 'string' },
    detail: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      minItems: 0,
    },
  },
} as const;

const PERSONA_ITEM_ARRAY_SCHEMA = {
  type: 'array',
  items: PERSONA_ITEM_SCHEMA,
  minItems: 0,
} as const;

const PERSONA_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'summary',
    'highlights',
    'identity',
    'interests',
    'expertise',
    'personality',
    'preferences',
    'conversationStarters',
    'lifestyle',
    'notableQuotes',
    'disclaimers',
  ],
  properties: {
    version: { type: 'string' },
    summary: { type: 'string' },
    highlights: PERSONA_ITEM_ARRAY_SCHEMA,
    identity: {
      type: 'object',
      additionalProperties: false,
      required: ['selfDescription', 'roles', 'languages', 'locations'],
      properties: {
        selfDescription: { type: 'string' },
        roles: PERSONA_ITEM_ARRAY_SCHEMA,
        languages: PERSONA_ITEM_ARRAY_SCHEMA,
        locations: PERSONA_ITEM_ARRAY_SCHEMA,
      },
    },
    interests: PERSONA_ITEM_ARRAY_SCHEMA,
    expertise: PERSONA_ITEM_ARRAY_SCHEMA,
    personality: {
      type: 'object',
      additionalProperties: false,
      required: ['traits', 'communication', 'values'],
      properties: {
        traits: PERSONA_ITEM_ARRAY_SCHEMA,
        communication: PERSONA_ITEM_ARRAY_SCHEMA,
        values: PERSONA_ITEM_ARRAY_SCHEMA,
      },
    },
    preferences: {
      type: 'object',
      additionalProperties: false,
      required: ['likes', 'dislikes', 'collaborationTips', 'contentFormats'],
      properties: {
        likes: PERSONA_ITEM_ARRAY_SCHEMA,
        dislikes: PERSONA_ITEM_ARRAY_SCHEMA,
        collaborationTips: PERSONA_ITEM_ARRAY_SCHEMA,
        contentFormats: PERSONA_ITEM_ARRAY_SCHEMA,
      },
    },
    conversationStarters: PERSONA_ITEM_ARRAY_SCHEMA,
    lifestyle: PERSONA_ITEM_ARRAY_SCHEMA,
    notableQuotes: {
      type: 'array',
      minItems: 0,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'context', 'sourceType', 'timestamp'],
        properties: {
          quote: { type: 'string' },
          context: { type: 'string' },
          sourceType: { type: 'string', enum: ['voice', 'text'] },
          timestamp: { type: 'string' },
        },
      },
    },
    disclaimers: PERSONA_ITEM_ARRAY_SCHEMA,
  },
} as const;

function toPersonaItems(value: unknown): PersonaInsightItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: PersonaInsightItem[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
    const confidenceRaw = typeof record.confidence === 'string' ? record.confidence.toLowerCase().trim() : '';
    const confidence: 'low' | 'medium' | 'high' = confidenceRaw === 'high'
      ? 'high'
      : confidenceRaw === 'medium'
      ? 'medium'
      : 'low';
    const evidence = Array.isArray(record.evidence)
      ? record.evidence
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      : [];

    if (!title && !detail) {
      continue;
    }

    const item: PersonaInsightItem = {
      title: title || detail.slice(0, 60) || 'Information',
      detail: detail || title || 'Information',
      confidence,
    };
    if (evidence.length > 0) {
      item.evidence = evidence;
    }
    items.push(item);
  }

  return items;
}

function toNotableQuotes(value: unknown): PersonaProfileData['notableQuotes'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const quote = typeof record.quote === 'string' ? record.quote.trim() : '';
      if (!quote) {
        return null;
      }
      const context = typeof record.context === 'string' ? record.context.trim() || null : null;
      const sourceTypeRaw = typeof record.sourceType === 'string' ? record.sourceType.trim().toLowerCase() : '';
      const sourceType: 'voice' | 'text' = sourceTypeRaw === 'voice' ? 'voice' : 'text';
      const timestamp = typeof record.timestamp === 'string' ? record.timestamp.trim() || null : null;

      return {
        quote,
        context,
        sourceType,
        timestamp,
      };
    })
    .filter((item): item is PersonaProfileData['notableQuotes'][number] => Boolean(item));
}

function normalizePersonaProfile(raw: unknown): PersonaProfileData | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const identityRaw = (record.identity ?? {}) as Record<string, unknown>;
  const personalityRaw = (record.personality ?? {}) as Record<string, unknown>;
  const preferencesRaw = (record.preferences ?? {}) as Record<string, unknown>;

  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  const version = typeof record.version === 'string' ? record.version.trim() : PERSONA_VERSION;

  const identity = {
    selfDescription:
      typeof identityRaw.selfDescription === 'string' && identityRaw.selfDescription.trim().length > 0
        ? identityRaw.selfDescription.trim()
        : null,
    roles: toPersonaItems(identityRaw.roles),
    languages: toPersonaItems(identityRaw.languages),
    locations: toPersonaItems(identityRaw.locations),
  };

  const personality = {
    traits: toPersonaItems(personalityRaw.traits),
    communication: toPersonaItems(personalityRaw.communication),
    values: toPersonaItems(personalityRaw.values),
  };

  const preferences = {
    likes: toPersonaItems(preferencesRaw.likes),
    dislikes: toPersonaItems(preferencesRaw.dislikes),
    collaborationTips: toPersonaItems(preferencesRaw.collaborationTips),
    contentFormats: toPersonaItems(preferencesRaw.contentFormats),
  };

  const highlights = toPersonaItems(record.highlights);
  const interests = toPersonaItems(record.interests);
  const expertise = toPersonaItems(record.expertise);
  const conversationStarters = toPersonaItems(record.conversationStarters);
  const lifestyle = toPersonaItems(record.lifestyle);
  const disclaimers = toPersonaItems(record.disclaimers);
  const notableQuotes = toNotableQuotes(record.notableQuotes);

  if (!summary && highlights.length === 0 && interests.length === 0) {
    return null;
  }

  return {
    version,
    summary: summary || 'Aucune information fournie.',
    highlights,
    identity,
    interests,
    expertise,
    personality,
    preferences,
    conversationStarters,
    lifestyle,
    notableQuotes,
    disclaimers,
  };
}

function sanitizeContent(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function formatTimestamp(date: Date | null): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'inconnu';
  }
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

export default class UserPersonaService {
  private readonly config: Config;

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  private readonly openai: OpenAI | null;

  private timer: NodeJS.Timeout | null = null;

  private running = false;

  constructor(options: UserPersonaServiceOptions) {
    this.config = options.config;
    this.voiceActivityRepository = options.voiceActivityRepository ?? null;
    this.openai = this.config.openAI.apiKey ? new OpenAI({ apiKey: this.config.openAI.apiKey }) : null;

    if (!this.openai || !this.voiceActivityRepository) {
      const reasons: string[] = [];
      if (!this.openai) {
        reasons.push('clé API OpenAI manquante');
      }
      if (!this.voiceActivityRepository) {
        reasons.push('référentiel d’activité indisponible');
      }
      if (reasons.length > 0) {
        console.warn(`UserPersonaService désactivé (${reasons.join(', ')}).`);
      }
      return;
    }

    this.scheduleInitialRun();
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleInitialRun(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => this.execute(), INITIAL_DELAY_MS);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private scheduleNextRun(): void {
    if (!this.openai || !this.voiceActivityRepository) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const intervalMinutes = this.config.openAI.personaIntervalMinutes;
    const delay = Math.max(intervalMinutes * 60 * 1000, 60_000);

    this.timer = setTimeout(() => this.execute(), delay);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private async execute(): Promise<void> {
    if (this.running) {
      return;
    }

    if (!this.openai || !this.voiceActivityRepository) {
      return;
    }

    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      console.error('UserPersonaService: execution failed', error);
    } finally {
      this.running = false;
      this.scheduleNextRun();
    }
  }

  private async runOnce(): Promise<void> {
    if (!this.openai || !this.voiceActivityRepository) {
      return;
    }

    const now = new Date();
    const lookbackDays = this.config.openAI.personaLookbackDays;
    const lookbackSince = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const fetchLimit = Math.max(this.config.openAI.personaMaxUsersPerRun * 3, this.config.openAI.personaMaxUsersPerRun);
    const candidates = await this.voiceActivityRepository.listUserPersonaCandidates({
      limit: fetchLimit,
      since: lookbackSince,
    });

    if (candidates.length === 0) {
      return;
    }

    const selected: UserPersonaCandidateRecord[] = [];
    for (const candidate of candidates) {
      if (this.shouldProcessCandidate(candidate, now)) {
        selected.push(candidate);
      }
      if (selected.length >= this.config.openAI.personaMaxUsersPerRun) {
        break;
      }
    }

    for (const candidate of selected) {
      try {
        await this.processCandidate(candidate, lookbackSince, now);
      } catch (error) {
        console.error('UserPersonaService: failed to process candidate', {
          userId: candidate.userId,
          error,
        });
      }
    }
  }

  private shouldProcessCandidate(candidate: UserPersonaCandidateRecord, now: Date): boolean {
    if (!candidate || !candidate.lastActivityAt) {
      return false;
    }

    const lastActivityTime = candidate.lastActivityAt.getTime();
    if (!Number.isFinite(lastActivityTime)) {
      return false;
    }

    if (!candidate.personaUpdatedAt) {
      return true;
    }

    const updatedTime = candidate.personaUpdatedAt.getTime();
    if (!Number.isFinite(updatedTime)) {
      return true;
    }

    if (candidate.personaVersion !== PERSONA_VERSION) {
      return true;
    }

    if (lastActivityTime - updatedTime >= MIN_ACTIVITY_DELTA_MS) {
      return true;
    }

    if (now.getTime() - updatedTime >= MAX_PROFILE_STALE_MS) {
      return true;
    }

    return false;
  }

  private async processCandidate(candidate: UserPersonaCandidateRecord, since: Date, now: Date): Promise<void> {
    if (!this.openai || !this.voiceActivityRepository) {
      return;
    }

    const samples = await this.collectSamples(candidate.userId, since, now);
    if (samples.totalChars < MIN_TOTAL_CHAR_THRESHOLD) {
      return;
    }

    const transcriptSection = this.formatSamples(
      samples.transcripts,
      MAX_TRANSCRIPT_CHAR_BUDGET,
      'Retranscriptions vocales (ordre antéchronologique)'
    );
    const messageSection = this.formatMessageSamples(samples.messages, MAX_MESSAGE_CHAR_BUDGET);

    const prompt = this.buildPrompt({
      userId: candidate.userId,
      lookbackSince: since,
      now,
      transcriptSection,
      messageSection,
      totals: {
        voice: samples.transcripts.length,
        text: samples.messages.length,
        chars: samples.totalChars,
        lastActivity: samples.lastActivityAt,
      },
    });

    const response = await this.openai.responses.create({
      model: this.config.openAI.personaModel,
      input: [
        {
          role: 'system',
          content:
            "Tu es un analyste conversationnel chargé de dresser des fiches d'identité sociales complètes et factuelles en français. " +
            'Tu t’en tiens strictement aux informations observées dans les extraits fournis. Si une information est incertaine, ' +
            'tu indiques un niveau de confiance faible. Tu ne fais aucune supposition non étayée.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'user_persona_profile',
          schema: PERSONA_RESPONSE_SCHEMA,
        },
      },
    });

    const rawOutput = response.output_text?.trim();
    if (!rawOutput) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOutput);
    } catch (error) {
      console.error('UserPersonaService: invalid JSON payload', error);
      return;
    }

    const persona = normalizePersonaProfile(parsed);
    if (!persona) {
      return;
    }

    const payload: UserPersonaProfileInsertRecord = {
      userId: candidate.userId,
      guildId: candidate.guildId,
      persona,
      summary: persona.summary,
      model: this.config.openAI.personaModel,
      version: persona.version || PERSONA_VERSION,
      generatedAt: new Date(),
      lastActivityAt: samples.lastActivityAt,
      voiceSampleCount: samples.transcripts.length,
      messageSampleCount: samples.messages.length,
      inputCharacterCount: samples.totalChars,
    };

    await this.voiceActivityRepository.upsertUserPersonaProfile(payload);
  }

  private async collectSamples(userId: string, since: Date, now: Date): Promise<AggregatedSamples> {
    const transcripts = await this.fetchRecentTranscripts(userId, since);
    const messages = await this.fetchRecentMessages(userId, since, now);

    let totalChars = 0;
    let lastActivityAt: Date | null = null;

    for (const entry of transcripts) {
      const content = sanitizeContent(entry.content);
      totalChars += content.length;
      if (entry.timestamp instanceof Date && !Number.isNaN(entry.timestamp.getTime())) {
        if (!lastActivityAt || entry.timestamp > lastActivityAt) {
          lastActivityAt = entry.timestamp;
        }
      }
    }

    for (const entry of messages) {
      const content = sanitizeContent(entry.content);
      totalChars += content.length;
      if (entry.timestamp instanceof Date && !Number.isNaN(entry.timestamp.getTime())) {
        if (!lastActivityAt || entry.timestamp > lastActivityAt) {
          lastActivityAt = entry.timestamp;
        }
      }
    }

    return { transcripts, messages, totalChars, lastActivityAt };
  }

  private async fetchRecentTranscripts(userId: string, since: Date): Promise<UserVoiceTranscriptionEntry[]> {
    if (!this.voiceActivityRepository) {
      return [];
    }

    const results: UserVoiceTranscriptionEntry[] = [];
    let cursor: VoiceTranscriptionCursor | null = null;

    while (results.length < MAX_TRANSCRIPT_FETCH) {
      const remaining = MAX_TRANSCRIPT_FETCH - results.length;
      const batch = await this.voiceActivityRepository.listUserVoiceTranscriptions({
        userId,
        limit: remaining,
        before: cursor,
      });

      if (!batch.entries.length) {
        break;
      }

      for (const entry of batch.entries) {
        const timestamp = entry.timestamp;
        if (!(timestamp instanceof Date)) {
          continue;
        }
        if (timestamp < since) {
          return results;
        }
        const content = sanitizeContent(entry.content);
        if (content.length === 0) {
          continue;
        }
        results.push({ ...entry, content });
      }

      if (!batch.hasMore || !batch.nextCursor) {
        break;
      }
      cursor = batch.nextCursor;
    }

    return results;
  }

  private async fetchRecentMessages(
    userId: string,
    since: Date,
    now: Date,
  ): Promise<UserMessageActivityEntry[]> {
    if (!this.voiceActivityRepository) {
      return [];
    }

    const entries = await this.voiceActivityRepository.listUserMessageActivity({
      userId,
      since,
      until: now,
    });

    return entries
      .map((entry) => ({ ...entry, content: sanitizeContent(entry.content) }))
      .filter((entry) => entry.content.length > 0)
      .slice(-MAX_MESSAGE_FETCH);
  }

  private formatSamples(
    entries: UserVoiceTranscriptionEntry[],
    charBudget: number,
    heading: string,
  ): FormattedSamples {
    const sorted = entries
      .filter((entry) => entry.timestamp instanceof Date && !Number.isNaN(entry.timestamp.getTime()))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const lines: string[] = [];
    let remaining = charBudget;
    let lastTimestamp: Date | null = null;

    for (const entry of sorted) {
      const content = sanitizeContent(entry.content);
      if (!content) {
        continue;
      }

      const snippet = content.length > 320 ? `${content.slice(0, 320)}…` : content;
      const line = `- [${formatTimestamp(entry.timestamp)}] ${snippet}`;
      if (line.length > remaining && lines.length > 0) {
        break;
      }
      remaining -= line.length;
      lines.push(line);
      if (!lastTimestamp || (entry.timestamp && entry.timestamp > lastTimestamp)) {
        lastTimestamp = entry.timestamp;
      }
    }

    return {
      formatted: lines.length > 0 ? `${heading}:\n${lines.join('\n')}` : `${heading}:\n- Aucune donnée exploitable.`,
      count: lines.length,
      totalChars: entries.reduce((sum, entry) => sum + sanitizeContent(entry.content).length, 0),
      lastTimestamp,
    };
  }

  private formatMessageSamples(
    entries: UserMessageActivityEntry[],
    charBudget: number,
  ): FormattedSamples {
    const sorted = entries
      .filter((entry) => entry.timestamp instanceof Date && !Number.isNaN(entry.timestamp.getTime()))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const lines: string[] = [];
    let remaining = charBudget;
    let lastTimestamp: Date | null = null;

    for (const entry of sorted) {
      const content = sanitizeContent(entry.content);
      if (!content) {
        continue;
      }
      const snippet = content.length > 240 ? `${content.slice(0, 240)}…` : content;
      const line = `- [${formatTimestamp(entry.timestamp)}] ${snippet}`;
      if (line.length > remaining && lines.length > 0) {
        break;
      }
      remaining -= line.length;
      lines.push(line);
      if (!lastTimestamp || entry.timestamp > lastTimestamp) {
        lastTimestamp = entry.timestamp;
      }
    }

    return {
      formatted:
        lines.length > 0
          ? `Messages textuels (ordre antéchronologique):\n${lines.join('\n')}`
          : 'Messages textuels (ordre antéchronologique):\n- Aucun message pertinent.',
      count: lines.length,
      totalChars: entries.reduce((sum, entry) => sum + sanitizeContent(entry.content).length, 0),
      lastTimestamp,
    };
  }

  private buildPrompt({
    userId,
    lookbackSince,
    now,
    transcriptSection,
    messageSection,
    totals,
  }: {
    userId: string;
    lookbackSince: Date;
    now: Date;
    transcriptSection: FormattedSamples;
    messageSection: FormattedSamples;
    totals: { voice: number; text: number; chars: number; lastActivity: Date | null };
  }): string {
    const lines: string[] = [];
    lines.push(`Utilisateur analysé : ${userId}`);
    lines.push(
      `Fenêtre étudiée : ${lookbackSince.toISOString()} → ${now.toISOString()} (UTC)`,
    );
    lines.push('Statistiques matière première :');
    lines.push(`- Retranscriptions vocales utilisées : ${transcriptSection.count}`);
    lines.push(`- Messages textuels utilisés : ${messageSection.count}`);
    lines.push(`- Caractères analysés : ${totals.chars}`);
    lines.push(`- Dernière activité observée : ${formatTimestamp(totals.lastActivity)}`);
    lines.push('');
    lines.push(
      'Consignes supplémentaires : synthétise les éléments clés sur la personne (centres d’intérêt, compétences, personnalité, habitudes, sujets à éviter, etc.). ' +
        'Ne déduis rien qui ne soit pas corroboré par les extraits. Classe chaque observation avec un niveau de confiance. '
    );
    lines.push('');
    lines.push(transcriptSection.formatted);
    lines.push('');
    lines.push(messageSection.formatted);
    return lines.join('\n');
  }
}
