import { Activity } from './deps.js';

export const TALK_WINDOW_OPTIONS = [5, 10, 15, 30, 60];
export const DEFAULT_WINDOW_MINUTES = TALK_WINDOW_OPTIONS.includes(15)
  ? 15
  : TALK_WINDOW_OPTIONS[0];
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const HISTORY_RETENTION_MS = Math.max(
  (Math.max(...TALK_WINDOW_OPTIONS) + 5) * 60 * 1000,
  24 * 60 * 60 * 1000,
);
export const HOURS_IN_DAY = 24;
export const FALLBACK_SEGMENT_MS = 1000;
export const DEFAULT_PROFILE_RANGE_MS = 30 * DAY_MS;

export const STATUS_LABELS = {
  connecting: {
    label: 'Connexion…',
    ring: 'bg-amber-400/20 text-amber-200 border-amber-400/50',
    dot: 'bg-amber-300',
  },
  connected: {
    label: '',
    srLabel: 'Flux en cours',
    Icon: Activity,
    ring: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/40',
    dot: 'bg-emerald-300',
  },
  reconnecting: {
    label: 'Reconnexion…',
    ring: 'bg-sky-400/15 text-sky-200 border-sky-400/40',
    dot: 'bg-sky-300',
  },
  error: {
    label: 'Hors ligne',
    ring: 'bg-rose-500/20 text-rose-100 border-rose-400/50',
    dot: 'bg-rose-300',
  },
};

export const PROFILE_RANGE_PRESETS = [
  { label: '24h', description: 'Dernières 24 heures', durationMs: 24 * HOUR_MS },
  { label: '48h', description: 'Dernières 48 heures', durationMs: 48 * HOUR_MS },
  { label: '7 j', description: '7 derniers jours', durationMs: 7 * DAY_MS },
  { label: '30 j', description: '30 derniers jours', durationMs: 30 * DAY_MS },
];

export const VOICE_TRANSCRIPTION_PAGE_SIZE_OPTIONS = [5, 10, 20];
export const MESSAGE_PAGE_SIZE_OPTIONS = [10, 25, 50];
