import dotenv from 'dotenv';

dotenv.config();

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStringList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const outputFormat = (process.env.OUT_FORMAT || 'opus').toLowerCase();

const defaultExcludedUserIds = ['1419381362116268112', '1282959031207596066'];
const excludedUserIdsEnv = process.env.EXCLUDED_USER_IDS;
const excludedUserIds =
  excludedUserIdsEnv !== undefined
    ? parseStringList(excludedUserIdsEnv)
    : defaultExcludedUserIds;

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
  frameSamples: number;
  frameBytes: number;
}

export interface ShopStripeConfig {
  secretKey?: string;
  priceIds: Record<string, string>;
}

export interface ShopCoingateConfig {
  apiKey?: string;
  environment: 'sandbox' | 'live';
  callbackUrl?: string;
}

export interface ShopPaypalConfig {
  clientId?: string;
  clientSecret?: string;
  environment: 'sandbox' | 'live';
  brandName?: string;
}

export interface ShopConfig {
  currency: string;
  locale: string;
  stripe: ShopStripeConfig;
  coingate: ShopCoingateConfig;
  paypal: ShopPaypalConfig;
}

export interface DatabaseConfig {
  url?: string;
  ssl: boolean;
}

export interface OpenAIConfig {
  apiKey?: string;
  articleModel: string;
  imageModel: string;
  dailyArticleHourUtc: number;
  dailyArticleMinuteUtc: number;
  dailyArticleTags: string[];
  personaModel: string;
  personaIntervalMinutes: number;
  personaMaxUsersPerRun: number;
  personaLookbackDays: number;
}

export interface KaldiConfig {
  host: string;
  port: number;
  sampleRate: number;
  enabled: boolean;
}

export interface AdminConfig {
  username: string | null;
  password: string | null;
}

export interface SecretArticleTriggerConfig {
  path: string | null;
  password: string | null;
}

export interface Config {
  botToken: string;
  guildId?: string;
  voiceChannelId?: string;
  port: number;
  ffmpegPath: string;
  outputFormat: 'opus' | 'mp3' | string;
  opusBitrate: string;
  mp3Bitrate: string;
  mixFrameMs: number;
  streamEndpoint: string;
  headerBufferMaxBytes: number;
  keepAliveInterval: number;
  audio: AudioConfig;
  mimeTypes: Record<string, string>;
  excludedUserIds: string[];
  shop: ShopConfig;
  database: DatabaseConfig;
  openAI: OpenAIConfig;
  publicBaseUrl: string;
  siteName: string;
  siteLocale: string;
  siteLanguage: string;
  twitterSite?: string;
  twitterCreator?: string;
  kaldi: KaldiConfig;
  admin: AdminConfig;
  secretArticleTrigger: SecretArticleTriggerConfig;
}

const config: Config = {
  botToken: process.env.BOT_TOKEN ?? '',
  guildId: process.env.GUILD_ID,
  voiceChannelId: process.env.VOICE_CHANNEL_ID,
  port: parseInteger(process.env.PORT, 3000),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  outputFormat,
  opusBitrate: process.env.OPUS_BITRATE || '64000',
  mp3Bitrate: process.env.MP3_BITRATE || '96000',
  mixFrameMs: parseInteger(process.env.MIX_FRAME_MS, 20),
  streamEndpoint: '/stream',
  headerBufferMaxBytes: parseInteger(process.env.HEADER_BUFFER_MAX_BYTES, 64 * 1024),
  keepAliveInterval: 20000,
  audio: {
    sampleRate: 48000,
    channels: 2,
    bytesPerSample: 2,
    frameSamples: 0,
    frameBytes: 0,
  },
  mimeTypes: {
    opus: 'audio/ogg',
    mp3: 'audio/mpeg',
  },
  excludedUserIds,
  shop: {
    currency: 'eur',
    locale: 'fr-FR',
    stripe: {
      secretKey: process.env.SHOP_STRIPE_SECRET_KEY || undefined,
      priceIds: Object.entries({
        mug: process.env.SHOP_STRIPE_PRICE_MUG,
        tshirt: process.env.SHOP_STRIPE_PRICE_TSHIRT,
        pack: process.env.SHOP_STRIPE_PRICE_PACK,
        moderation: process.env.SHOP_STRIPE_PRICE_MODERATION,
      }).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value) {
          acc[key] = value;
        }
        return acc;
      }, {}),
    },
    coingate: {
      apiKey: process.env.SHOP_COINGATE_API_KEY || undefined,
      environment: process.env.SHOP_COINGATE_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
      callbackUrl: process.env.SHOP_COINGATE_CALLBACK_URL || undefined,
    },
    paypal: {
      clientId: process.env.SHOP_PAYPAL_CLIENT_ID || undefined,
      clientSecret: process.env.SHOP_PAYPAL_CLIENT_SECRET || undefined,
      environment: process.env.SHOP_PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
      brandName: process.env.SHOP_PAYPAL_BRAND_NAME || undefined,
    },
  },
  database: {
    url: process.env.DATABASE_URL || undefined,
    ssl:
      process.env.DATABASE_SSL === 'true' ||
      (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false'),
  },
  openAI: {
    apiKey: process.env.OPENAI_API_KEY || undefined,
    articleModel: process.env.OPENAI_ARTICLE_MODEL || 'gpt-4.1-mini',
    imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    dailyArticleHourUtc: Math.min(Math.max(parseInteger(process.env.OPENAI_DAILY_ARTICLE_HOUR_UTC, 0), 0), 23),
    dailyArticleMinuteUtc: Math.min(
      Math.max(parseInteger(process.env.OPENAI_DAILY_ARTICLE_MINUTE_UTC, 30), 0),
      59,
    ),
    dailyArticleTags: parseStringList(process.env.OPENAI_DAILY_ARTICLE_TAGS || 'journal,libre-antenne'),
    personaModel:
      process.env.OPENAI_PERSONA_MODEL || process.env.OPENAI_ARTICLE_MODEL || 'gpt-4.1-mini',
    personaIntervalMinutes: Math.min(
      Math.max(parseInteger(process.env.OPENAI_PERSONA_INTERVAL_MINUTES, 30), 5),
      24 * 60,
    ),
    personaMaxUsersPerRun: Math.min(
      Math.max(parseInteger(process.env.OPENAI_PERSONA_MAX_USERS_PER_RUN, 4), 1),
      25,
    ),
    personaLookbackDays: Math.min(
      Math.max(parseInteger(process.env.OPENAI_PERSONA_LOOKBACK_DAYS, 45), 1),
      365,
    ),
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://libre-antenne.xyz/',
  siteName: process.env.SITE_NAME || 'Libre Antenne',
  siteLocale: process.env.SITE_LOCALE || 'fr_FR',
  siteLanguage: process.env.SITE_LANGUAGE || 'fr-FR',
  twitterSite: process.env.TWITTER_SITE || '@libreantenne',
  twitterCreator: process.env.TWITTER_CREATOR || process.env.TWITTER_SITE || '@libreantenne',
  kaldi: {
    host: process.env.KALDI_HOST || 'kaldiws.internal',
    port: parseInteger(process.env.KALDI_PORT, 2700),
    sampleRate: parseInteger(process.env.KALDI_SAMPLE_RATE, 16000),
    enabled: process.env.KALDI_ENABLED !== 'false',
  },
  admin: {
    username: (() => {
      const value = process.env.ADMIN_USERNAME ?? '';
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    })(),
    password: (() => {
      const value = process.env.ADMIN_PASSWORD ?? '';
      return value.length > 0 ? value : null;
    })(),
  },
  secretArticleTrigger: {
    path: (() => {
      const rawPath = process.env.SECRET_ARTICLE_PATH ?? '';
      const trimmed = rawPath.trim();
      if (trimmed.length === 0) {
        return null;
      }
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    })(),
    password: (() => {
      const value = process.env.SECRET_ARTICLE_PASSWORD ?? '';
      return value.length > 0 ? value : null;
    })(),
  },
};

config.audio.frameSamples = Math.floor(
  config.audio.sampleRate * (config.mixFrameMs / 1000),
);
config.audio.frameBytes =
  config.audio.frameSamples * config.audio.channels * config.audio.bytesPerSample;

if (!config.botToken) {
  console.error('BOT_TOKEN is required in the environment');
  process.exit(1);
}

export default config;
