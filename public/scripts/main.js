import {
  render,
  html,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Menu,
  X,
} from './core/deps.js';
import {
  DEFAULT_WINDOW_MINUTES,
  HISTORY_RETENTION_MS,
  TALK_WINDOW_OPTIONS,
  LISTENER_HISTORY_RETENTION_MS,
} from './core/constants.js';
import {
  buildProfileHash,
  normalizeAnonymousSlot,
  ensureOpenSegment,
  closeOpenSegment,
  trimSegments,
  sortSegments,
  sanitizeProfile,
} from './utils/index.js';
import { HomePage } from './pages/home.js';
import { MembersPage } from './pages/members.js';
import { ShopPage } from './pages/shop.js';
import { ProfilePage } from './pages/profile.js';
import { BanPage } from './pages/ban.js';
import { AboutPage } from './pages/about.js';
import { ClassementsPage } from './pages/classements.js';
import { BlogPage } from './pages/blog.js';

const NAV_LINKS = [
  { label: 'Accueil', route: 'home', hash: '#/' },
  { label: 'Membres', route: 'members', hash: '#/membres' },
  { label: 'Boutique', route: 'shop', hash: '#/boutique' },
  {
    label: 'Classements',
    route: 'classements',
    hash: '#/classements',
  },
  { label: 'Blog', route: 'blog', hash: '#/blog' },
  { label: 'Modération', route: 'ban', hash: '#/bannir' },
  { label: 'À propos', route: 'about', hash: '#/about' },
];

const ROUTE_ORDER = {
  home: 0,
  members: 1,
  profile: 1.2,
  shop: 2,
  classements: 3,
  blog: 4,
  ban: 5,
  about: 6,
};

const DEFAULT_TRANSITION_THEME = {
  from: 'rgba(236, 72, 153, 0.42)',
  via: 'rgba(14, 165, 233, 0.38)',
  to: 'rgba(250, 204, 21, 0.35)',
};

const ROUTE_TRANSITION_THEMES = {
  home: {
    from: 'rgba(245, 158, 11, 0.45)',
    via: 'rgba(56, 189, 248, 0.35)',
    to: 'rgba(255, 255, 255, 0.35)',
  },
  members: {
    from: 'rgba(129, 140, 248, 0.45)',
    via: 'rgba(236, 72, 153, 0.38)',
    to: 'rgba(244, 114, 182, 0.35)',
  },
  profile: {
    from: 'rgba(14, 165, 233, 0.4)',
    via: 'rgba(59, 130, 246, 0.4)',
    to: 'rgba(34, 211, 238, 0.32)',
  },
  shop: {
    from: 'rgba(251, 191, 36, 0.45)',
    via: 'rgba(250, 204, 21, 0.42)',
    to: 'rgba(249, 115, 22, 0.35)',
  },
  classements: {
    from: 'rgba(59, 130, 246, 0.45)',
    via: 'rgba(165, 180, 252, 0.35)',
    to: 'rgba(125, 211, 252, 0.35)',
  },
  blog: {
    from: 'rgba(236, 72, 153, 0.45)',
    via: 'rgba(251, 113, 133, 0.32)',
    to: 'rgba(96, 165, 250, 0.35)',
  },
  ban: {
    from: 'rgba(248, 113, 113, 0.48)',
    via: 'rgba(250, 204, 21, 0.28)',
    to: 'rgba(244, 63, 94, 0.4)',
  },
  about: {
    from: 'rgba(96, 165, 250, 0.35)',
    via: 'rgba(45, 212, 191, 0.35)',
    to: 'rgba(129, 140, 248, 0.32)',
  },
};

const PAGE_TRANSITION_DURATION_MS = 780;

const getRouteTheme = (name) => ROUTE_TRANSITION_THEMES[name] ?? DEFAULT_TRANSITION_THEME;

const getRouteWeight = (route) => {
  if (!route || typeof route !== 'object') {
    return ROUTE_ORDER.home;
  }
  const value = ROUTE_ORDER[route.name];
  return typeof value === 'number' ? value : ROUTE_ORDER.home;
};

const getTransitionDirection = (fromRoute, toRoute) => {
  const fromWeight = getRouteWeight(fromRoute);
  const toWeight = getRouteWeight(toRoute);
  if (toWeight === fromWeight) {
    return 'forward';
  }
  return toWeight > fromWeight ? 'forward' : 'backward';
};

const buildRouteKey = (route) => {
  if (!route || typeof route !== 'object') {
    return 'route:home';
  }
  if (route.name === 'profile') {
    const userId = route.params?.userId ?? 'anonymous';
    const since = route.params?.since ?? 'all';
    const until = route.params?.until ?? 'now';
    return `route:profile:${userId}:${since}:${until}`;
  }
  if (route.name === 'blog') {
    const slug = route.params?.slug ?? 'index';
    return `route:blog:${slug}`;
  }
  if (route.name === 'classements') {
    const search = route.params?.search ?? '';
    const sortBy = route.params?.sortBy ?? '';
    const sortOrder = route.params?.sortOrder ?? '';
    const period = route.params?.period ?? '';
    return `route:classements:${search}:${sortBy}:${sortOrder}:${period}`;
  }
  return `route:${route.name}`;
};

const getRouteFromHash = () => {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash || hash === '/') {
    return { name: 'home', params: {} };
  }

  const [pathPart, queryString] = hash.split('?');
  const segments = pathPart
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const search = new URLSearchParams(queryString || '');

  if (segments.length === 0) {
    return { name: 'home', params: {} };
  }

  const head = segments[0].toLowerCase();

  if (head === 'about') {
    return { name: 'about', params: {} };
  }
  if (head === 'membres' || head === 'members') {
    return { name: 'members', params: {} };
  }
  if (head === 'boutique') {
    return { name: 'shop', params: {} };
  }
  if (head === 'classements') {
    const params = {
      search: search.get('search') ?? '',
      sortBy: search.get('sortBy') ?? null,
      sortOrder: search.get('sortOrder') ?? null,
      period: search.get('period') ?? null,
    };
    return { name: 'classements', params };
  }
  if (head === 'blog') {
    const slug = segments.length > 1 ? segments[1] : null;
    return {
      name: 'blog',
      params: {
        slug: slug ? decodeURIComponent(slug) : null,
      },
    };
  }
  if (head === 'bannir' || head === 'ban') {
    return { name: 'ban', params: {} };
  }
  if (head === 'profil' || head === 'profile') {
    const userId = segments.length > 1 ? decodeURIComponent(segments[1]) : null;
    const since = search.get('since');
    const until = search.get('until');
    return {
      name: 'profile',
      params: { userId, since, until },
    };
  }
  if (head === 'home') {
    return { name: 'home', params: {} };
  }

  return { name: 'home', params: {} };
};


const normalizeListenerEntry = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const timestamp = Number(raw.timestamp ?? raw.time ?? raw.ts);
  const count = Number(raw.count);

  if (!Number.isFinite(timestamp) || !Number.isFinite(count)) {
    return null;
  }

  return {
    timestamp,
    count: Math.max(0, Math.round(count)),
  };
};

const normalizeListenerHistory = (history) => {
  if (!Array.isArray(history)) {
    return [];
  }

  const entries = history
    .map((entry) => normalizeListenerEntry(entry))
    .filter((entry) => entry !== null);

  entries.sort((a, b) => a.timestamp - b.timestamp);
  return entries;
};

const trimListenerHistory = (history, nowTs) => {
  const reference = Number.isFinite(nowTs) ? nowTs : Date.now();
  const cutoff = reference - LISTENER_HISTORY_RETENTION_MS;
  return history.filter((entry) => entry.timestamp >= cutoff);
};































const App = () => {
  const [status, setStatus] = useState('connecting');
  const [participantsMap, setParticipantsMap] = useState(() => new Map());
  const [speakingHistory, setSpeakingHistory] = useState(() => []);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [selectedWindowMinutes, setSelectedWindowMinutes] = useState(DEFAULT_WINDOW_MINUTES);
  const participantsRef = useRef(new Map());
  const [streamInfo, setStreamInfo] = useState({ path: '/stream', format: 'opus', mimeType: 'audio/ogg' });
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [route, setRoute] = useState(() => getRouteFromHash());
  const [anonymousSlot, setAnonymousSlot] = useState(() => normalizeAnonymousSlot());
  const [listenerStats, setListenerStats] = useState(() => ({ count: 0, history: [] }));
  const [transitionState, setTransitionState] = useState(() => ({
    active: false,
    previous: null,
    direction: 'forward',
    id: 0,
    palette: getRouteTheme(route?.name ?? 'home'),
  }));
  const previousRouteRef = useRef(route);
  const transitionTimerRef = useRef(null);
  const [backendStatus, setBackendStatus] = useState('unknown');
  const backendAvailable = backendStatus === 'available';
  const backendOffline = backendStatus === 'unavailable';

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!backendAvailable) {
      setIsHistoryLoading(false);
      setSpeakingHistory([]);
      return undefined;
    }

    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const parseTimestamp = (input) => {
      const numeric = Number(input);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      if (typeof input === 'string') {
        const parsed = new Date(input);
        const ms = parsed.getTime();
        if (!Number.isNaN(ms)) {
          return ms;
        }
      }
      return null;
    };

    const fetchHistory = async () => {
      if (!cancelled) {
        setIsHistoryLoading(true);
      }
      const params = new URLSearchParams();
      const sinceTs = Date.now() - HISTORY_RETENTION_MS;
      if (Number.isFinite(sinceTs)) {
        params.set('since', String(Math.floor(sinceTs)));
      }

      const query = params.toString();
      const url = query ? `/api/voice-activity/history?${query}` : '/api/voice-activity/history';

      try {
        const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) {
          return;
        }

        const segments = Array.isArray(payload?.segments) ? payload.segments : [];
        if (!segments.length) {
          if (!cancelled) {
            setIsHistoryLoading(false);
          }
          return;
        }

        const nowTs = Date.now();
        setSpeakingHistory((prev) => {
          const normalized = segments
            .map((segment) => {
              if (!segment || typeof segment !== 'object') {
                return null;
              }
              const rawId = typeof segment.userId === 'string' && segment.userId
                ? segment.userId
                : typeof segment.id === 'string'
                ? segment.id
                : null;
              if (!rawId) {
                return null;
              }

              const start = parseTimestamp(
                Object.prototype.hasOwnProperty.call(segment, 'startedAtMs')
                  ? segment.startedAtMs
                  : segment.startedAt,
              );
              if (typeof start !== 'number') {
                return null;
              }

              const end = parseTimestamp(
                Object.prototype.hasOwnProperty.call(segment, 'endedAtMs')
                  ? segment.endedAtMs
                  : segment.endedAt,
              );

              const durationValue = Number(segment.durationMs);
              const durationMs = Number.isFinite(durationValue) ? Math.max(durationValue, 0) : null;

              let resolvedEnd = typeof end === 'number' ? end : null;
              if (resolvedEnd == null && durationMs != null) {
                resolvedEnd = start + durationMs;
              }

              if (typeof resolvedEnd !== 'number' || Number.isNaN(resolvedEnd) || resolvedEnd <= start) {
                return null;
              }

              const profile =
                segment.profile && typeof segment.profile === 'object'
                  ? sanitizeProfile(segment.profile)
                  : { displayName: null, username: null, avatar: null };

              return {
                id: rawId,
                start,
                end: resolvedEnd,
                profile,
              };
            })
            .filter(Boolean);

          if (!normalized.length) {
            return prev;
          }

          const combined = [...prev, ...normalized];
          return sortSegments(trimSegments(combined, nowTs));
        });
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (!cancelled) {
            setIsHistoryLoading(false);
          }
          return;
        }
        console.warn("Impossible de récupérer l'historique vocal", error);
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    };

    fetchHistory();

    return () => {
      cancelled = true;
      if (controller) {
        controller.abort();
      }
    };
  }, [backendAvailable]);

  const handleWindowChange = useCallback((minutes) => {
    if (!Number.isFinite(minutes)) {
      return;
    }
    const normalized = TALK_WINDOW_OPTIONS.includes(minutes) ? minutes : DEFAULT_WINDOW_MINUTES;
    setSelectedWindowMinutes(normalized);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const updateStatus = (nextStatus) => {
      if (cancelled) {
        return;
      }
      setBackendStatus((previous) => (previous === nextStatus ? previous : nextStatus));
    };

    const checkAvailability = async () => {
      try {
        const response = await fetch('/status', { cache: 'no-store' });
        updateStatus(response.ok ? 'available' : 'unavailable');
      } catch (_error) {
        updateStatus('unavailable');
      }
    };

    checkAvailability();
    const intervalId = window.setInterval(checkAvailability, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      if (window.location.pathname === '/classements') {
        const query = window.location.search?.replace(/^\?/, '');
        const hashSuffix = query ? `?${query}` : '';
        const targetHash = `#/classements${hashSuffix}`;
        window.location.hash = targetHash;
        setRoute({ name: 'classements', params: getRouteFromHash().params });
      } else {
        window.location.hash = '#/';
        setRoute({ name: 'home', params: {} });
      }
    }
  }, []);

  const updateProfileRoute = useCallback(
    (userId, sinceMs, untilMs, options = {}) => {
      if (!userId) {
        return;
      }
      const sinceParam = Number.isFinite(sinceMs) ? String(Math.floor(sinceMs)) : null;
      const untilParam = Number.isFinite(untilMs) ? String(Math.floor(untilMs)) : null;
      const nextRoute = { name: 'profile', params: { userId, since: sinceParam, until: untilParam } };
      const nextHash = buildProfileHash(userId, sinceMs, untilMs);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
      setRoute(nextRoute);
      if (options.scrollToTop) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [setRoute],
  );

  const handleProfileOpen = useCallback(
    (userId) => {
      updateProfileRoute(userId, null, null, { scrollToTop: true });
    },
    [updateProfileRoute],
  );

  useEffect(() => {
    const updateRoute = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  useEffect(() => {
    const previousRoute = previousRouteRef.current;
    const previousKey = buildRouteKey(previousRoute);
    const nextKey = buildRouteKey(route);

    if (previousKey === nextKey) {
      previousRouteRef.current = route;
      return undefined;
    }

    const direction = getTransitionDirection(previousRoute, route);
    const palette = getRouteTheme(route?.name ?? 'home');

    setTransitionState((state) => ({
      active: true,
      previous: previousRoute,
      direction,
      id: state.id + 1,
      palette,
    }));

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
    }

    transitionTimerRef.current = setTimeout(() => {
      setTransitionState((state) => ({
        ...state,
        active: false,
        previous: null,
      }));
      transitionTimerRef.current = null;
    }, PAGE_TRANSITION_DURATION_MS);

    previousRouteRef.current = route;

    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [route]);

  useEffect(() => {
    participantsRef.current = participantsMap;
  }, [participantsMap]);

  useEffect(() => {
    if (!backendAvailable) {
      setStatus(backendStatus === 'unavailable' ? 'error' : 'connecting');
      setParticipantsMap(() => new Map());
      participantsRef.current = new Map();
      setListenerStats({ count: 0, history: [] });
      setAnonymousSlot(normalizeAnonymousSlot());
      return undefined;
    }

    const source = new EventSource('/events');
    source.onopen = () => setStatus('connected');
    source.onerror = () => {
      if (source.readyState === EventSource.CONNECTING) {
        setStatus('reconnecting');
      } else if (source.readyState === EventSource.CLOSED) {
        setStatus('error');
      }
    };

    const applyState = (payload) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      if (payload.listeners) {
        const normalizedHistory = normalizeListenerHistory(payload.listeners.history);
        const trimmedHistory = trimListenerHistory(normalizedHistory, Date.now());
        const countValue = Number(payload.listeners.count);
        const safeCount = Number.isFinite(countValue) ? Math.max(0, Math.round(countValue)) : 0;
        setListenerStats({ count: safeCount, history: trimmedHistory });
      }

      if (Array.isArray(payload.speakers)) {
        const nowTs = Date.now();
        const previous = participantsRef.current;
        const next = new Map();
        const speakingSnapshot = new Map();

        for (const speaker of payload.speakers) {
          if (!speaker?.id) continue;
          const normalized = {
            ...speaker,
            voiceState: speaker.voiceState ?? {},
            isSpeaking: Boolean(speaker.isSpeaking),
          };
          next.set(speaker.id, normalized);
          if (normalized.isSpeaking) {
            speakingSnapshot.set(speaker.id, normalized);
          }
        }

        participantsRef.current = next;
        setParticipantsMap(next);
        setSpeakingHistory((prev) => {
          let segments = trimSegments(prev, nowTs);
          if (previous instanceof Map) {
            previous.forEach((participant, id) => {
              if (participant?.isSpeaking && !speakingSnapshot.has(id)) {
                segments = closeOpenSegment(segments, id, nowTs, participant);
              }
            });
          }
          speakingSnapshot.forEach((participant, id) => {
            segments = ensureOpenSegment(segments, id, participant.startedAt ?? nowTs, participant);
          });
          return sortSegments(trimSegments(segments, nowTs));
        });
        setIsHistoryLoading(false);
        setLastUpdate(nowTs);
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'anonymousSlot')) {
        setAnonymousSlot(normalizeAnonymousSlot(payload.anonymousSlot));
      }
    };

    source.addEventListener('state', (event) => {
      try {
        const data = JSON.parse(event.data);
        applyState(data);
      } catch (err) {
        console.error('state event parse error', err);
      }
    });

    const applyListenerUpdate = (payload) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const countValue = Number(payload.count);
      const entrySource = payload.entry || {
        timestamp: payload.timestamp,
        count: payload.count,
      };
      const entry = normalizeListenerEntry(entrySource);

      setListenerStats((prev) => {
        const safeCount = Number.isFinite(countValue) ? Math.max(0, Math.round(countValue)) : prev.count;
        let nextHistory = Array.isArray(prev.history) ? prev.history.slice() : [];

        if (entry) {
          const inserted = Boolean(payload.inserted);
          if (inserted) {
            nextHistory = [...nextHistory, entry];
          } else if (nextHistory.length > 0) {
            nextHistory = [...nextHistory.slice(0, -1), entry];
          } else {
            nextHistory = [entry];
          }
        }

        const trimmedHistory = trimListenerHistory(nextHistory, Date.now());
        return {
          count: safeCount,
          history: trimmedHistory,
        };
      });
    };

    source.addEventListener('listeners', (event) => {
      try {
        const data = JSON.parse(event.data);
        applyListenerUpdate(data);
      } catch (err) {
        console.error('listeners event parse error', err);
      }
    });

    source.addEventListener('speaking', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'start' && data.user?.id) {
          const user = data.user;
          const userId = user.id;
          const eventNow = Date.now();
          const startTime = Number.isFinite(user.startedAt) ? user.startedAt : eventNow;
          setParticipantsMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(userId) || { voiceState: {} };
            const updated = {
              ...existing,
              ...user,
              isSpeaking: true,
              voiceState: user.voiceState ?? existing.voiceState ?? {},
            };
            next.set(userId, updated);
            participantsRef.current = next;
            return next;
          });
          setSpeakingHistory((prev) => {
            let segments = trimSegments(prev, eventNow);
            segments = ensureOpenSegment(segments, userId, startTime, user);
            return sortSegments(trimSegments(segments, eventNow));
          });
          setIsHistoryLoading(false);
          setLastUpdate(eventNow);
        } else if (data?.type === 'end') {
          const targetId = data.user?.id ?? data.userId;
          if (targetId) {
            const eventNow = Date.now();
            const endTimestamp = Number.isFinite(data.user?.lastSpokeAt) ? data.user.lastSpokeAt : eventNow;
            setParticipantsMap((prev) => {
              const next = new Map(prev);
              const existing = next.get(targetId);
              if (!existing) {
                return prev;
              }
              const updated = {
                ...existing,
                ...data.user,
                isSpeaking: false,
                voiceState: (data.user && data.user.voiceState) ?? existing.voiceState ?? {},
                lastSpokeAt: data.user?.lastSpokeAt ?? eventNow,
              };
              next.set(targetId, updated);
              participantsRef.current = next;
              return next;
            });
            setSpeakingHistory((prev) => {
              let segments = trimSegments(prev, eventNow);
              segments = closeOpenSegment(segments, targetId, endTimestamp, data.user ?? {}, { createIfMissing: true });
              return sortSegments(trimSegments(segments, eventNow));
            });
            setIsHistoryLoading(false);
            setLastUpdate(eventNow);
          }
        }
      } catch (err) {
        console.error('speaking event parse error', err);
      }
    });

    source.addEventListener('info', (event) => {
      try {
        const data = JSON.parse(event.data);
        setStreamInfo((prev) => ({
          path: data?.path ?? prev.path,
          format: data?.format ?? prev.format,
          mimeType: data?.mimeType ?? prev.mimeType,
        }));
      } catch (err) {
        console.error('info event parse error', err);
      }
    });

    source.addEventListener('anonymous-slot', (event) => {
      try {
        const data = JSON.parse(event.data);
        setAnonymousSlot(normalizeAnonymousSlot(data));
      } catch (err) {
        console.error('anonymous slot event parse error', err);
      }
    });
    return () => source.close();
  }, [backendAvailable, backendStatus]);
  const speakers = useMemo(() => {
    const values = Array.from(participantsMap.values()).map((participant) => ({
      ...participant,
      voiceState: participant.voiceState ?? {},
    }));
    values.sort((a, b) => {
      const nameA = (a.displayName || a.username || '').trim();
      const nameB = (b.displayName || b.username || '').trim();
      const normalizedA = nameA.toLocaleLowerCase('fr-FR');
      const normalizedB = nameB.toLocaleLowerCase('fr-FR');
      const nameComparison = normalizedA.localeCompare(normalizedB, 'fr', {
        sensitivity: 'base',
      });
      if (nameComparison !== 0) {
        return nameComparison;
      }
      const idA = String(a.id ?? '');
      const idB = String(b.id ?? '');
      return idA.localeCompare(idB);
    });
    return values;
  }, [participantsMap]);

  const audioKey = `${streamInfo.path}|${streamInfo.mimeType}`;

  const handleNavigate = (event, targetRoute) => {
    event.preventDefault();
    const link = NAV_LINKS.find((entry) => entry.route === targetRoute);
    if (!link) {
      return;
    }
    if (window.location.hash !== link.hash) {
      window.location.hash = link.hash;
    } else {
      setRoute({ name: targetRoute, params: {} });
    }
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderRouteContent = (targetRoute) => {
    if (!targetRoute || typeof targetRoute !== 'object') {
      return html`<${HomePage}
        status=${status}
        streamInfo=${streamInfo}
        audioKey=${audioKey}
        speakers=${speakers}
        now=${now}
        anonymousSlot=${anonymousSlot}
        speakingHistory=${speakingHistory}
        isHistoryLoading=${isHistoryLoading}
        selectedWindowMinutes=${selectedWindowMinutes}
        onWindowChange=${handleWindowChange}
        onViewProfile=${handleProfileOpen}
        listenerStats=${listenerStats}
        backendAvailable=${backendAvailable}
        backendOffline=${backendOffline}
      />`;
    }

    switch (targetRoute.name) {
      case 'ban':
        return html`<${BanPage} />`;
      case 'about':
        return html`<${AboutPage} />`;
      case 'blog':
        return html`<${BlogPage}
          params=${targetRoute.params}
          backendAvailable=${backendAvailable}
          backendOffline=${backendOffline}
        />`;
      case 'members':
        return html`<${MembersPage}
          onViewProfile=${handleProfileOpen}
          backendAvailable=${backendAvailable}
          backendOffline=${backendOffline}
        />`;
      case 'shop':
        return html`<${ShopPage} backendAvailable=${backendAvailable} backendOffline=${backendOffline} />`;
      case 'profile':
        return html`<${ProfilePage}
          params=${targetRoute.params}
          onNavigateHome=${() => {
            window.location.hash = '#/';
            setRoute({ name: 'home', params: {} });
          }}
          onUpdateRange=${updateProfileRoute}
          backendAvailable=${backendAvailable}
          backendOffline=${backendOffline}
        />`;
      case 'classements':
        return html`<${ClassementsPage}
          params=${targetRoute.params}
          backendAvailable=${backendAvailable}
          backendOffline=${backendOffline}
        />`;
      case 'home':
      default:
        return html`<${HomePage}
          status=${status}
          streamInfo=${streamInfo}
          audioKey=${audioKey}
          speakers=${speakers}
          now=${now}
          anonymousSlot=${anonymousSlot}
          speakingHistory=${speakingHistory}
          isHistoryLoading=${isHistoryLoading}
          selectedWindowMinutes=${selectedWindowMinutes}
          onWindowChange=${handleWindowChange}
          onViewProfile=${handleProfileOpen}
          listenerStats=${listenerStats}
          backendAvailable=${backendAvailable}
          backendOffline=${backendOffline}
        />`;
    }
  };

  const currentPageTemplate = renderRouteContent(route);
  const previousPageTemplate =
    transitionState.active && transitionState.previous
      ? renderRouteContent(transitionState.previous)
      : null;

  const currentLayerClasses = ['page-transition-layer', 'page-transition-layer--current'];
  if (transitionState.active) {
    currentLayerClasses.push(
      'is-animating',
      'page-transition-layer--enter',
      `page-transition-layer--${transitionState.direction}`,
    );
  } else {
    currentLayerClasses.push('page-transition-layer--idle');
  }

  const previousLayerClasses = ['page-transition-layer', 'page-transition-layer--previous', 'page-transition-layer--exit', `page-transition-layer--${transitionState.direction}`];
  if (transitionState.active) {
    previousLayerClasses.push('is-animating');
  }

  const veilStyle = transitionState.palette
    ? {
        '--veil-from': transitionState.palette.from,
        '--veil-via': transitionState.palette.via,
        '--veil-to': transitionState.palette.to,
      }
    : undefined;

  return html`
    <div class="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header class="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <a
            class="flex items-center gap-2 text-lg font-semibold tracking-wide text-white transition hover:text-amber-300"
            href="#/"
            onClick=${(event) => handleNavigate(event, 'home')}
          >
            <span class="rounded bg-amber-400 px-2 py-1 text-sm font-bold text-amber-950">LA</span>
            Libre Antenne
          </a>
          <nav class="hidden items-center gap-6 md:flex">
            ${NAV_LINKS.map((link) => {
              const isActive = route.name === link.route;
              const href = link.external && link.href ? link.href : link.hash;
              const baseClasses = 'text-sm font-medium transition hover:text-white';
              const stateClass = isActive ? 'text-white' : 'text-slate-300';
              return html`
                <a
                  key=${link.route}
                  class=${[baseClasses, stateClass].join(' ')}
                  href=${href}
                  onClick=${(event) => handleNavigate(event, link.route)}
                  aria-current=${isActive ? 'page' : undefined}
                >
                  ${link.label}
                </a>
              `;
            })}
          </nav>
          <button
            class="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 md:hidden"
            aria-expanded=${menuOpen}
            aria-label="Ouvrir le menu de navigation"
            onClick=${() => setMenuOpen((prev) => !prev)}
          >
            ${menuOpen ? html`<${X} class="h-5 w-5" />` : html`<${Menu} class="h-5 w-5" />`}
          </button>
        </div>
        ${
          menuOpen
            ? html`
                <nav class="border-t border-slate-800 bg-slate-900/95 md:hidden">
                  <div class="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3">
                    ${NAV_LINKS.map((link) => {
                      const isActive = route.name === link.route;
                      const href = link.external && link.href ? link.href : link.hash;
                      const baseClasses = 'rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-slate-800';
                      const stateClass = isActive ? 'bg-slate-800 text-white' : 'text-slate-200';
                      return html`
                        <a
                          key=${`mobile-${link.route}`}
                          class=${[baseClasses, stateClass].join(' ')}
                          href=${href}
                          onClick=${(event) => handleNavigate(event, link.route)}
                          aria-current=${isActive ? 'page' : undefined}
                        >
                          ${link.label}
                        </a>
                      `;
                    })}
                  </div>
                </nav>
              `
            : null
        }
      </header>

      <main class="flex-1">
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
          <div class="page-transition-stack w-full">
            ${
              previousPageTemplate
                ? html`<div
                    key=${`previous-${transitionState.id}-${buildRouteKey(transitionState.previous)}`}
                    class=${previousLayerClasses.join(' ')}
                  >
                    ${previousPageTemplate}
                  </div>`
                : null
            }
            <div key=${`current-${buildRouteKey(route)}`} class=${currentLayerClasses.join(' ')}>
              ${currentPageTemplate}
            </div>
            ${
              transitionState.active
                ? html`<div
                    key=${`veil-${transitionState.id}`}
                    class=${[`page-transition-veil`, `page-transition-veil--${transitionState.direction}`, 'is-animating'].join(' ')}
                    style=${veilStyle}
                  >
                    <span class="page-transition-veil__glow"></span>
                    <span class="page-transition-veil__beam"></span>
                    <span class="page-transition-veil__spark"></span>
                  </div>`
                : null
            }
          </div>
        </div>
      </main>

      <footer class="border-t border-slate-800 bg-slate-900/80 py-6 text-center text-sm text-slate-400">
        Libre Antenne · Tous droits réservés
      </footer>
    </div>
  `;
};
render(html`<${App} />`, document.getElementById('app'));
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.info('Service worker enregistré', registration.scope);
      })
      .catch((error) => {
        console.warn('Service worker introuvable', error);
      });
  });
}
(() => {
  const button = document.getElementById('test-beep-trigger');
  if (!button) {
    return;
  }

  let pending = false;
  button.addEventListener('click', async () => {
    if (pending) {
      return;
    }

    pending = true;
    const previousOpacity = button.style.opacity;
    button.style.opacity = '0.65';

    try {
      const response = await fetch('/test-beep', { method: 'POST' });
      if (!response.ok) {
        console.warn('Réponse inattendue pour le bip de test', response.status);
      }
    } catch (error) {
      console.warn('Impossible de déclencher le bip de test', error);
    } finally {
      setTimeout(() => {
        button.style.opacity = previousOpacity;
      }, 150);
      pending = false;
    }
  });
})();
