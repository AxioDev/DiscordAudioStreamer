import {
  DEFAULT_PROFILE_RANGE_MS,
  FALLBACK_SEGMENT_MS,
  HISTORY_RETENTION_MS,
} from '../core/constants.js';

export const formatDuration = (ms) => {
  if (!ms || Number.isNaN(ms)) return '';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const formatRelative = (timestamp, now) => {
  if (!timestamp) return '—';
  const diff = Math.max(0, now - timestamp);
  if (diff < 30_000) return 'il y a quelques secondes';
  if (diff < 5 * 60_000) return 'il y a moins de 5 min';
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const parseRangeValue = (value) => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const buildProfileHash = (userId, sinceMs, untilMs) => {
  if (!userId) {
    return '#/profil';
  }
  const base = `#/profil/${encodeURIComponent(userId)}`;
  const params = new URLSearchParams();
  if (Number.isFinite(sinceMs)) {
    params.set('since', String(Math.floor(sinceMs)));
  }
  if (Number.isFinite(untilMs)) {
    params.set('until', String(Math.floor(untilMs)));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

export const sanitizeProfile = (raw = {}) => {
  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim().length > 0
    ? raw.displayName.trim()
    : null;
  const username = typeof raw.username === 'string' && raw.username.trim().length > 0
    ? raw.username.trim()
    : null;
  const avatar = typeof raw.avatar === 'string' && raw.avatar.trim().length > 0
    ? raw.avatar.trim()
    : null;
  return { displayName, username, avatar };
};

export const mergeProfiles = (base = {}, incoming = {}) => {
  const sanitizedIncoming = sanitizeProfile(incoming);
  const sanitizedBase = sanitizeProfile(base);
  return {
    displayName: sanitizedIncoming.displayName ?? sanitizedBase.displayName ?? null,
    username: sanitizedIncoming.username ?? sanitizedBase.username ?? null,
    avatar: sanitizedIncoming.avatar ?? sanitizedBase.avatar ?? null,
  };
};

export const trimSegments = (segments, now) => {
  const threshold = now - HISTORY_RETENTION_MS;
  return segments.filter((segment) => {
    const end = typeof segment.end === 'number' ? segment.end : now;
    return end >= threshold;
  });
};

export const ensureOpenSegment = (segments, userId, startTime, profile) => {
  const safeStart = Number.isFinite(startTime) ? startTime : Date.now();
  const sanitizedProfile = sanitizeProfile(profile);
  let found = false;
  const next = segments.map((segment) => {
    if (segment.id === userId && segment.end == null) {
      found = true;
      return {
        ...segment,
        start: Number.isFinite(segment.start) ? Math.min(segment.start, safeStart) : safeStart,
        profile: mergeProfiles(segment.profile, sanitizedProfile),
      };
    }
    return segment;
  });
  if (!found) {
    return [
      ...next,
      {
        id: userId,
        start: safeStart,
        end: null,
        profile: sanitizedProfile,
      },
    ];
  }
  return next;
};

export const closeOpenSegment = (segments, userId, endTime, profile, { createIfMissing = false } = {}) => {
  const safeEnd = Number.isFinite(endTime) ? endTime : Date.now();
  const sanitizedProfile = sanitizeProfile(profile);
  let closed = false;
  const next = segments.map((segment) => {
    if (segment.id === userId && segment.end == null) {
      closed = true;
      const boundedEnd = Math.max(safeEnd, Number.isFinite(segment.start) ? segment.start : safeEnd);
      return {
        ...segment,
        end: boundedEnd,
        profile: mergeProfiles(segment.profile, sanitizedProfile),
      };
    }
    return segment;
  });

  if (!closed && createIfMissing) {
    const fallbackStart = Math.max(0, safeEnd - FALLBACK_SEGMENT_MS);
    return [
      ...next,
      {
        id: userId,
        start: Math.min(fallbackStart, safeEnd),
        end: safeEnd,
        profile: sanitizedProfile,
      },
    ];
  }

  return next;
};

export const sortSegments = (segments) => segments.slice().sort((a, b) => (a.start || 0) - (b.start || 0));

export const normalizeAnonymousSlot = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return {
      occupied: false,
      alias: null,
      claimedAt: null,
      expiresAt: null,
      remainingMs: null,
      connectionPending: false,
      message: null,
    };
  }

  return {
    occupied: Boolean(raw.occupied),
    alias: typeof raw.alias === 'string' ? raw.alias : null,
    claimedAt: Number.isFinite(raw.claimedAt) ? raw.claimedAt : null,
    expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : null,
    remainingMs: Number.isFinite(raw.remainingMs) ? raw.remainingMs : null,
    connectionPending: Boolean(raw.connectionPending),
    message: typeof raw.message === 'string' ? raw.message : null,
  };
};

export const toInputValue = (ms) => {
  if (!Number.isFinite(ms)) {
    return '';
  }
  try {
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 16);
  } catch (error) {
    console.warn('Impossible de formater la valeur datetime', error);
    return '';
  }
};

export const formatDateTimeLabel = (ms, { includeDate = true, includeSeconds = false } = {}) => {
  if (!Number.isFinite(ms)) {
    return '—';
  }
  try {
    const options = includeDate
      ? { dateStyle: 'medium', timeStyle: includeSeconds ? 'medium' : 'short' }
      : { timeStyle: includeSeconds ? 'medium' : 'short' };
    return new Date(ms).toLocaleString('fr-FR', options);
  } catch (error) {
    console.warn('Impossible de formater la date', error);
    return new Date(ms).toISOString();
  }
};

export const formatRangeLabel = (sinceMs, untilMs) => {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    return 'Période inconnue';
  }
  const sinceDate = new Date(sinceMs);
  const untilDate = new Date(untilMs);
  const sameDay = sinceDate.toDateString() === untilDate.toDateString();
  if (sameDay) {
    const dateLabel = sinceDate.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const from = sinceDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const to = untilDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${dateLabel} · ${from} – ${to}`;
  }
  const from = sinceDate.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  const to = untilDate.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  return `Du ${from} au ${to}`;
};

export const formatDayLabel = (ms) => {
  if (!Number.isFinite(ms)) {
    return 'Date inconnue';
  }
  const label = new Date(ms).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const normalizeProfileRange = (params = {}, fallback = {}) => {
  const now = Date.now();
  const fallbackUntil = Number.isFinite(fallback.untilMs) ? fallback.untilMs : now;
  const untilCandidate = parseRangeValue(params.until);
  const sinceCandidate = parseRangeValue(params.since);
  const untilMs = Number.isFinite(untilCandidate) ? untilCandidate : fallbackUntil;
  let sinceMs = Number.isFinite(sinceCandidate) ? sinceCandidate : fallback.sinceMs;
  if (!Number.isFinite(sinceMs)) {
    sinceMs = untilMs - DEFAULT_PROFILE_RANGE_MS;
  }
  if (!Number.isFinite(sinceMs)) {
    sinceMs = now - DEFAULT_PROFILE_RANGE_MS;
  }
  if (sinceMs >= untilMs) {
    sinceMs = Math.max(0, untilMs - DEFAULT_PROFILE_RANGE_MS);
  }
  return {
    sinceMs: Math.max(0, sinceMs),
    untilMs: Math.max(untilMs, sinceMs + 1),
  };
};
