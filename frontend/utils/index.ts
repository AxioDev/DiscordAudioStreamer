// @ts-nocheck
import {
  DEFAULT_PROFILE_RANGE_MS,
  FALLBACK_SEGMENT_MS,
  HISTORY_RETENTION_MS,
} from '../core/constants';

const BLOG_PUBLISH_ALIASES = new Set(['publier', 'publish', 'submit', 'soumettre']);
const MEMBERS_ALIASES = new Set(['membres', 'members']);
const SHOP_ALIASES = new Set(['boutique', 'shop']);
const BAN_ALIASES = new Set(['bannir', 'ban']);
const PROFILE_ALIASES = new Set(['profil', 'profile']);
const CHAT_ALIASES = new Set(['chat', 'assistant', 'assistant-ia']);
const SALONS_ALIASES = new Set(['salons', 'channels', 'text-channels']);
const CGU_ALIASES = new Set([
  'cgu',
  'conditions-generales',
  'conditions-generales-utilisation',
  'conditions-generales-d-utilisation',
  'conditions-generales-d’utilisation',
]);
const CGV_ALIASES = new Set([
  'cgv',
  'conditions-generales-vente',
  'conditions-generales-de-vente',
  'conditions-generales-de-vente-libre-antenne',
  'cgv-vente'
  ]);
  
const MENTIONS_ALIASES = new Set([
  'mentions-legales',
  'mentions',
  'legal',
  'mentions-legales-fr',
]);

const decodePathSegment = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch (error) {
    console.warn('Impossible de décoder le segment d’URL', value, error);
    return null;
  }
};

const normalizeSearchParams = (search) => {
  if (typeof search !== 'string') {
    return '';
  }
  return search.startsWith('?') ? search : search ? `?${search}` : '';
};

export const buildRoutePath = (name, params = {}) => {
  switch (name) {
    case 'home':
      return '/';
    case 'members':
      return '/membres';
    case 'shop':
      return '/boutique';
    case 'classements': {
      const searchParams = new URLSearchParams();
      const normalizedSortBy = params.sortBy ? String(params.sortBy) : undefined;
      const normalizedSortOrder = params.sortOrder ? String(params.sortOrder) : undefined;
      const normalizedSearch = params.search ? String(params.search) : '';
      const normalizedPeriod = params.period ? String(params.period) : undefined;
      if (normalizedSortBy) {
        searchParams.set('sortBy', normalizedSortBy);
      }
      if (normalizedSortOrder) {
        searchParams.set('sortOrder', normalizedSortOrder);
      }
      if (normalizedSearch) {
        searchParams.set('search', normalizedSearch);
      }
      if (normalizedPeriod) {
        searchParams.set('period', normalizedPeriod);
      }
      const query = searchParams.toString();
      return query ? `/classements?${query}` : '/classements';
    }
    case 'blog': {
      const slug = params.slug ? String(params.slug).trim() : '';
      if (slug) {
        return `/blog/${encodeURIComponent(slug)}`;
      }
      return '/blog';
    }
    case 'blog-submit':
      return '/blog/publier';
    case 'ban':
      return '/bannir';
    case 'salons':
      return '/salons';
    case 'about':
      return '/about';
    case 'cgu':
      return '/cgu';
    case 'cgv-vente':
      return '/cgv-vente';
    case 'mentions-legales':
      return '/mentions-legales';
    case 'chat':
      return '/assistant';
    case 'statistiques': {
      const paramsSource = params && typeof params === 'object' ? params : {};
      const searchParams = new URLSearchParams();
      const setParam = (key) => {
        const raw = paramsSource[key];
        if (raw == null) {
          return;
        }
        const value = String(raw).trim();
        if (value.length > 0) {
          searchParams.set(key, value);
        }
      };
      setParam('range');
      setParam('since');
      setParam('until');
      setParam('granularity');
      setParam('activity');
      setParam('channels');
      setParam('userId');
      setParam('heatmap');
      setParam('hype');
      const query = searchParams.toString();
      return query ? `/statistiques?${query}` : '/statistiques';
    }
    case 'profile': {
      const userId = params.userId ? String(params.userId).trim() : '';
      const base = userId ? `/profil/${encodeURIComponent(userId)}` : '/profil';
      const searchParams = new URLSearchParams();
      if (params.since) {
        searchParams.set('since', String(params.since));
      }
      if (params.until) {
        searchParams.set('until', String(params.until));
      }
      const query = searchParams.toString();
      return query ? `${base}?${query}` : base;
    }
    default:
      return '/';
  }
};

export const parseRouteFromLocation = (location) => {
  const safeLocation = location ?? (typeof window !== 'undefined' ? window.location : null);
  if (!safeLocation) {
    return { name: 'home', params: {} };
  }

  const pathname = typeof safeLocation.pathname === 'string' ? safeLocation.pathname : '/';
  const search = typeof safeLocation.search === 'string' ? safeLocation.search : '';
  const segments = pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const searchParams = new URLSearchParams(normalizeSearchParams(search));

  if (segments.length === 0) {
    return { name: 'home', params: {} };
  }

  const head = segments[0].toLowerCase();

  if (CGU_ALIASES.has(head)) {
    return { name: 'cgu', params: {} };
  }
  if (CGV_ALIASES.has(head)) {
    return { name: 'cgv-vente', params: {} };
  }
  if (MENTIONS_ALIASES.has(head)) {
    return { name: 'mentions-legales', params: {} };
  }
  if (head === 'about') {
    return { name: 'about', params: {} };
  }
  if (MEMBERS_ALIASES.has(head)) {
    return { name: 'members', params: {} };
  }
  if (SHOP_ALIASES.has(head)) {
    return { name: 'shop', params: {} };
  }
  if (head === 'classements') {
    return {
      name: 'classements',
      params: {
        search: searchParams.get('search') ?? '',
        sortBy: searchParams.get('sortBy') ?? null,
        sortOrder: searchParams.get('sortOrder') ?? null,
        period: searchParams.get('period') ?? null,
      },
    };
  }
  if (head === 'blog') {
    const second = segments.length > 1 ? segments[1] : null;
    if (second && BLOG_PUBLISH_ALIASES.has(second.toLowerCase())) {
      return { name: 'blog-submit', params: {} };
    }
    return {
      name: 'blog',
      params: {
        slug: decodePathSegment(second),
      },
    };
  }
  if (CHAT_ALIASES.has(head)) {
    return { name: 'chat', params: {} };
  }
  if (SALONS_ALIASES.has(head)) {
    return { name: 'salons', params: {} };
  }
  if (BAN_ALIASES.has(head)) {
    return { name: 'ban', params: {} };
  }
  if (head === 'statistiques') {
    return {
      name: 'statistiques',
      params: {
        range: searchParams.get('range'),
        since: searchParams.get('since'),
        until: searchParams.get('until'),
        granularity: searchParams.get('granularity'),
        activity: searchParams.get('activity'),
        channels: searchParams.get('channels'),
        userId: searchParams.get('userId'),
        heatmap: searchParams.get('heatmap'),
        hype: searchParams.get('hype'),
      },
    };
  }
  if (PROFILE_ALIASES.has(head)) {
    const userId = decodePathSegment(segments[1]);
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    return {
      name: 'profile',
      params: {
        userId,
        since,
        until,
      },
    };
  }
  if (head === 'home') {
    return { name: 'home', params: {} };
  }

  return { name: 'home', params: {} };
};

export const convertLegacyHashToPath = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  const { location } = window;
  if (!location || typeof location.hash !== 'string') {
    return false;
  }

  const hash = location.hash;
  if (!hash.startsWith('#/')) {
    return false;
  }

  const [rawPath = '', rawQuery = ''] = hash.slice(1).split('?');
  const pathname = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const search = normalizeSearchParams(rawQuery);
  const nextRoute = parseRouteFromLocation({ pathname, search });
  const nextPath = buildRoutePath(nextRoute.name, nextRoute.params);
  const currentPath = `${location.pathname}${location.search}`;

  if (currentPath !== nextPath) {
    window.history.replaceState(window.history.state, '', nextPath);
  }

  return true;
};

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

export const buildProfilePath = (userId, sinceMs, untilMs) => {
  if (!userId) {
    return buildRoutePath('profile', {});
  }
  const params = new URLSearchParams();
  if (Number.isFinite(sinceMs)) {
    params.set('since', String(Math.floor(sinceMs)));
  }
  if (Number.isFinite(untilMs)) {
    params.set('until', String(Math.floor(untilMs)));
  }
  const query = params.toString();
  const base = `/profil/${encodeURIComponent(userId)}`;
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

export const normalizeAnonymousSlot = (raw = null) => {
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
