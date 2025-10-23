// @ts-nocheck
import { Activity, AlertCircle } from './deps';

export const TALK_WINDOW_OPTIONS = [5, 10, 15, 30, 60];
export const DEFAULT_WINDOW_MINUTES = TALK_WINDOW_OPTIONS.includes(15)
  ? 15
  : TALK_WINDOW_OPTIONS[0];
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const LISTENER_HISTORY_RETENTION_MS = 24 * HOUR_MS;
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
    ring: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-400',
  },
  connected: {
    label: '',
    srLabel: 'Flux en cours',
    Icon: Activity,
    ring: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  reconnecting: {
    label: 'Reconnexion…',
    ring: 'bg-sky-100 text-sky-700 border-sky-300',
    dot: 'bg-sky-400',
  },
  error: {
    label: 'Hors ligne',
    ring: 'bg-rose-100 text-rose-700 border-rose-300',
    dot: 'bg-rose-400',
  },
  muted: {
    label: 'Bot mute',
    srLabel: 'Bot mute casque serveur',
    Icon: AlertCircle,
    ring: 'bg-rose-100 text-rose-700 border-rose-300',
    dot: 'bg-rose-400',
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
