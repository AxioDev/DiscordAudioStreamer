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
