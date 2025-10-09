import {
  hydrate,
  render,
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Menu,
  X,
  AudioLines,
  Users,
  ShoppingBag,
  BadgeCheck,
  MessageSquare,
  ShieldCheck,
  Activity,
} from './core/deps.js';
import {
  DEFAULT_WINDOW_MINUTES,
  HISTORY_RETENTION_MS,
  TALK_WINDOW_OPTIONS,
  LISTENER_HISTORY_RETENTION_MS,
} from './core/constants.js';
import {
  buildRoutePath,
  convertLegacyHashToPath,
  parseRouteFromLocation,
  normalizeAnonymousSlot,
  ensureOpenSegment,
  closeOpenSegment,
  trimSegments,
  sortSegments,
  sanitizeProfile,
} from './utils/index.js';
import { HomePage } from './pages/home.js';

const ROUTE_LOADERS = {
  about: () => import('./pages/about.js').then((module) => module?.AboutPage ?? null),
  ban: () => import('./pages/ban.js').then((module) => module?.BanPage ?? null),
  blog: () => import('./pages/blog.js').then((module) => module?.BlogPage ?? null),
  'blog-proposal': () =>
    import('./pages/blog-proposal.js').then((module) => module?.BlogProposalPage ?? null),
  classements: () =>
    import('./pages/classements.js').then((module) => module?.ClassementsPage ?? null),
  cgu: () => import('./pages/cgu.js').then((module) => module?.CguPage ?? null),
  members: () => import('./pages/members.js').then((module) => module?.MembersPage ?? null),
  profile: () => import('./pages/profile.js').then((module) => module?.ProfilePage ?? null),
  shop: () => import('./pages/shop.js').then((module) => module?.ShopPage ?? null),
  statistiques: () =>
    import('./pages/statistiques.js').then((module) => module?.StatistiquesPage ?? null),
};

const NAV_LINKS = [
  { label: 'Accueil', route: 'home', href: '/', icon: AudioLines },
  { label: 'Membres', route: 'members', href: '/membres', icon: Users },
  { label: 'Boutique', route: 'shop', href: '/boutique', icon: ShoppingBag },
  { label: 'Classements', route: 'classements', href: '/classements', icon: BadgeCheck },
  { label: 'Statistiques', route: 'statistiques', href: '/statistiques', icon: Activity },
  { label: 'Blog', route: 'blog', href: '/blog', icon: MessageSquare },
  { label: 'Modération', route: 'ban', href: '/bannir', icon: ShieldCheck },
];

const readBootstrapState = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  const state = window.__PRERENDER_STATE__ ?? null;
  if (state) {
    try {
      delete window.__PRERENDER_STATE__;
    } catch (error) {
      window.__PRERENDER_STATE__ = undefined;
    }
  }
  return state && typeof state === 'object' ? state : null;
};

const cloneRouteDescriptor = (descriptor) => {
  if (!descriptor || typeof descriptor !== 'object') {
    return null;
  }
  const name = typeof descriptor.name === 'string' ? descriptor.name : null;
  if (!name) {
    return null;
  }
  const paramsSource = descriptor.params;
  const params = paramsSource && typeof paramsSource === 'object' ? { ...paramsSource } : {};
  return { name, params };
};

const normalizeBootstrapParticipants = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((participant) => {
      if (!participant || typeof participant !== 'object') {
        return null;
      }
      const id = typeof participant.id === 'string'
        ? participant.id
        : participant.id != null
          ? String(participant.id)
          : null;
      if (!id) {
        return null;
      }
      const voiceState = participant.voiceState && typeof participant.voiceState === 'object'
        ? { ...participant.voiceState }
        : {};
      return { ...participant, id, voiceState };
    })
    .filter(Boolean);
};

const normalizeBootstrapListenerStats = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const countValue = Number(value.count);
  const safeCount = Number.isFinite(countValue) ? Math.max(0, Math.round(countValue)) : 0;
  const history = Array.isArray(value.history)
    ? value.history
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const timestamp = Number(entry.timestamp);
          const count = Number(entry.count);
          if (!Number.isFinite(timestamp) || !Number.isFinite(count)) {
            return null;
          }
          return { timestamp, count: Math.max(0, Math.round(count)) };
        })
        .filter(Boolean)
    : [];
  return { count: safeCount, history };
};

const normalizeBootstrapBridgeStatus = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const serverDeafened = Boolean(value.serverDeafened);
  const selfDeafened = Boolean(value.selfDeafened);
  const updatedAtValue = Number(value.updatedAt);
  const updatedAt = Number.isFinite(updatedAtValue) ? updatedAtValue : Date.now();
  return { serverDeafened, selfDeafened, updatedAt };
};

const RAW_BOOTSTRAP_STATE = readBootstrapState();
const BOOTSTRAP_ROUTE = cloneRouteDescriptor(RAW_BOOTSTRAP_STATE?.route);
const BOOTSTRAP_PARTICIPANTS = normalizeBootstrapParticipants(RAW_BOOTSTRAP_STATE?.participants);
const BOOTSTRAP_LISTENER_STATS = normalizeBootstrapListenerStats(RAW_BOOTSTRAP_STATE?.listenerStats);
const BOOTSTRAP_BRIDGE_STATUS = normalizeBootstrapBridgeStatus(RAW_BOOTSTRAP_STATE?.bridgeStatus);
const BOOTSTRAP_PAGES =
  RAW_BOOTSTRAP_STATE?.pages && typeof RAW_BOOTSTRAP_STATE.pages === 'object' && RAW_BOOTSTRAP_STATE.pages !== null
    ? RAW_BOOTSTRAP_STATE.pages
    : {};

const areRouteParamsEqual = (left = {}, right = {}) => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {}),
  ]);
  for (const key of keys) {
    const a = left?.[key] ?? null;
    const b = right?.[key] ?? null;
    if (a !== b) {
      return false;
    }
  }
  return true;
};

const normalizeRouteDescriptor = (name, params = {}) => {
  const path = buildRoutePath(name, params);
  const [pathname, query = ''] = path.split('?');
  const descriptor = parseRouteFromLocation({
    pathname,
    search: query ? `?${query}` : '',
  });
  return { descriptor, path };
};

const getCurrentPath = () => {
  if (typeof window === 'undefined') {
    return '/';
  }
  return `${window.location.pathname}${window.location.search}`;
};

const initializeRoute = () => {
  if (typeof window === 'undefined') {
    return { name: 'home', params: {} };
  }
  convertLegacyHashToPath();
  return parseRouteFromLocation(window.location);
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
  const [participantsMap, setParticipantsMap] = useState(() => {
    const map = new Map();
    for (const participant of BOOTSTRAP_PARTICIPANTS) {
      map.set(participant.id, { ...participant });
    }
    return map;
  });
  const [speakingHistory, setSpeakingHistory] = useState(() => []);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [selectedWindowMinutes, setSelectedWindowMinutes] = useState(DEFAULT_WINDOW_MINUTES);
  const participantsRef = useRef(new Map());
  const [streamInfo, setStreamInfo] = useState({ path: '/stream', format: 'opus', mimeType: 'audio/ogg' });
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [route, setRoute] = useState(() => BOOTSTRAP_ROUTE ?? initializeRoute());
  const [routeTransitionPhase, setRouteTransitionPhase] = useState(0);
  const [anonymousSlot, setAnonymousSlot] = useState(() => normalizeAnonymousSlot());
  const [listenerStats, setListenerStats] = useState(() => (
    BOOTSTRAP_LISTENER_STATS ? { count: BOOTSTRAP_LISTENER_STATS.count, history: BOOTSTRAP_LISTENER_STATS.history.slice() } : { count: 0, history: [] }
  ));
  const [guildSummary, setGuildSummary] = useState(null);
  const [bridgeStatus, setBridgeStatus] = useState(() =>
    BOOTSTRAP_BRIDGE_STATUS
      ? { ...BOOTSTRAP_BRIDGE_STATUS }
      : { serverDeafened: false, selfDeafened: false, updatedAt: Date.now() },
  );
  const [asyncPages, setAsyncPages] = useState({});
  const sidebarTouchStartRef = useRef(null);
  const asyncPagesRef = useRef(asyncPages);
  const pendingPageLoadsRef = useRef(new Map());
  const initialRouteRef = useRef(true);

  useEffect(() => {
    asyncPagesRef.current = asyncPages;
  }, [asyncPages]);

  const loadPageComponent = useCallback(
    (name) => {
      if (!name || !ROUTE_LOADERS[name]) {
        return;
      }
      if (asyncPagesRef.current[name]) {
        return;
      }
      if (pendingPageLoadsRef.current.has(name)) {
        return;
      }

      const loader = ROUTE_LOADERS[name];
      const promise = loader()
        .then((component) => {
          if (!component) {
            return;
          }
          setAsyncPages((previous) => {
            if (previous[name]) {
              return previous;
            }
            return { ...previous, [name]: component };
          });
        })
        .catch((error) => {
          console.warn(`Failed to load ${name} page`, error);
        })
        .finally(() => {
          pendingPageLoadsRef.current.delete(name);
        });

      pendingPageLoadsRef.current.set(name, promise);
    },
    [setAsyncPages],
  );

  const prefetchRoute = useCallback(
    (name) => {
      if (!name) {
        return;
      }
      loadPageComponent(name);
      if (name === 'blog') {
        loadPageComponent('blog-proposal');
      }
    },
    [loadPageComponent],
  );

  useEffect(() => {
    prefetchRoute(route.name);
  }, [route.name, prefetchRoute]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    if (connection?.saveData) {
      return undefined;
    }

    let cancelled = false;
    const cancelers = [];
    const schedule = (callback, delay = 0) => {
      if (typeof window === 'undefined') {
        return () => {};
      }
      if (delay > 0) {
        const timeoutId = window.setTimeout(() => {
          if (!cancelled) {
            callback();
          }
        }, delay);
        return () => window.clearTimeout(timeoutId);
      }
      if (typeof window.requestIdleCallback === 'function') {
        const idleId = window.requestIdleCallback(
          () => {
            if (!cancelled) {
              callback();
            }
          },
          { timeout: 2500 },
        );
        return () => window.cancelIdleCallback(idleId);
      }
      const fallbackId = window.setTimeout(() => {
        if (!cancelled) {
          callback();
        }
      }, 600);
      return () => window.clearTimeout(fallbackId);
    };

    const targets = [
      'members',
      'shop',
      'classements',
      'statistiques',
      'blog',
      'profile',
      'ban',
      'about',
      'cgu',
    ];

    const startPrefetch = () => {
      const loadNext = (index) => {
        if (cancelled || index >= targets.length) {
          return;
        }
        loadPageComponent(targets[index]);
        cancelers.push(schedule(() => loadNext(index + 1), 360));
      };
      loadNext(0);
    };

    cancelers.push(schedule(startPrefetch, 1500));

    return () => {
      cancelled = true;
      for (const cancel of cancelers) {
        if (typeof cancel === 'function') {
          cancel();
        }
      }
    };
  }, [loadPageComponent]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const navigateToRoute = useCallback(
    (name, params = {}, { replace = false, scrollToTop = false, behavior = 'smooth' } = {}) => {
      prefetchRoute(name);
      const { descriptor, path } = normalizeRouteDescriptor(name, params);

      if (typeof window !== 'undefined') {
        const currentPath = getCurrentPath();
        const shouldUpdateHistory = currentPath !== path;
        if (replace) {
          if (shouldUpdateHistory) {
            window.history.replaceState({ route: descriptor }, '', path);
          }
        } else if (shouldUpdateHistory) {
          window.history.pushState({ route: descriptor }, '', path);
        }
      }

      setRoute((previous) => {
        if (previous.name === descriptor.name && areRouteParamsEqual(previous.params, descriptor.params)) {
          return previous;
        }
        return descriptor;
      });

      if (scrollToTop && typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior });
      }
    },
    [prefetchRoute, setRoute],
  );

  useEffect(() => {
    const body = document.body;
    if (!body) {
      return undefined;
    }
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;
    if (menuOpen) {
      body.style.overflow = 'hidden';
      body.style.touchAction = 'none';
    } else {
      body.style.overflow = '';
      body.style.touchAction = '';
    }
    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const updateProfileRoute = useCallback(
    (userId, sinceMs, untilMs, options = {}) => {
      if (!userId) {
        return;
      }
      const sinceParam = Number.isFinite(sinceMs) ? String(Math.floor(sinceMs)) : null;
      const untilParam = Number.isFinite(untilMs) ? String(Math.floor(untilMs)) : null;
      const params = { userId };
      if (sinceParam) {
        params.since = sinceParam;
      }
      if (untilParam) {
        params.until = untilParam;
      }
      prefetchRoute('profile');
      navigateToRoute('profile', params, {
        replace: options.replace ?? false,
        scrollToTop: options.scrollToTop ?? false,
        behavior: options.behavior ?? 'smooth',
      });
    },
    [navigateToRoute, prefetchRoute],
  );

  const handleProfileOpen = useCallback(
    (userId) => {
      updateProfileRoute(userId, null, null, { scrollToTop: true });
    },
    [updateProfileRoute],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleLocationChange = () => {
      convertLegacyHashToPath();
      const nextRoute = parseRouteFromLocation(window.location);
      setRoute((previous) => {
        if (previous.name === nextRoute.name && areRouteParamsEqual(previous.params, nextRoute.params)) {
          return previous;
        }
        return nextRoute;
      });
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  useEffect(() => {
    closeMenu();
  }, [route, closeMenu]);

  useEffect(() => {
    if (initialRouteRef.current) {
      initialRouteRef.current = false;
      return;
    }
    setRouteTransitionPhase((phase) => (phase + 1) % 2);
  }, [route]);

  useEffect(() => {
    participantsRef.current = participantsMap;
  }, [participantsMap]);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const parseCount = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return Math.max(0, Math.round(numeric));
    };

    const loadGuildSummary = async () => {
      try {
        const response = await fetch('/api/guild/summary', {
          method: 'GET',
          signal: controller ? controller.signal : undefined,
          headers: {
            Accept: 'application/json',
          },
        });
        if (!response.ok) {
          throw new Error(`Guild summary request failed with status ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) {
          return;
        }
        const summary = payload && typeof payload === 'object' ? payload.guild ?? payload : null;
        if (!summary || typeof summary !== 'object') {
          setGuildSummary(null);
          return;
        }
        setGuildSummary({
          id: typeof summary.id === 'string' ? summary.id : null,
          name: typeof summary.name === 'string' ? summary.name : null,
          description: typeof summary.description === 'string' ? summary.description : null,
          iconUrl: typeof summary.iconUrl === 'string' ? summary.iconUrl : null,
          bannerUrl: typeof summary.bannerUrl === 'string' ? summary.bannerUrl : null,
          memberCount: parseCount(summary.memberCount),
          approximateMemberCount: parseCount(summary.approximateMemberCount),
          approximatePresenceCount: parseCount(summary.approximatePresenceCount),
        });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return;
        }
        console.warn('Impossible de récupérer les informations du serveur Discord', error);
        if (!cancelled) {
          setGuildSummary(null);
        }
      }
    };

    loadGuildSummary();

    return () => {
      cancelled = true;
      if (controller) {
        controller.abort();
      }
    };
  }, []);

  useEffect(() => {
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
  }, []);

  const handleWindowChange = useCallback((minutes) => {
    if (!Number.isFinite(minutes)) {
      return;
    }
    const normalized = TALK_WINDOW_OPTIONS.includes(minutes) ? minutes : DEFAULT_WINDOW_MINUTES;
    setSelectedWindowMinutes(normalized);
  }, []);

  useEffect(() => {
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

      if (Object.prototype.hasOwnProperty.call(payload, 'bridgeStatus')) {
        const normalizedBridgeStatus = normalizeBootstrapBridgeStatus(payload.bridgeStatus);
        if (normalizedBridgeStatus) {
          setBridgeStatus(normalizedBridgeStatus);
        }
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
  }, []);
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

  const handleOverlayClick = useCallback(() => {
    closeMenu();
  }, [closeMenu]);

  const handleSidebarTouchStart = useCallback((event) => {
    if (!event.touches || event.touches.length === 0) {
      return;
    }
    const touch = event.touches[0];
    sidebarTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }, []);

  const handleSidebarTouchMove = useCallback(
    (event) => {
      const start = sidebarTouchStartRef.current;
      if (!start || !event.touches || event.touches.length === 0) {
        return;
      }
      const touch = event.touches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = Math.abs(touch.clientY - start.y);
      if (deltaY > 90) {
        return;
      }
      if (deltaX < -70) {
        sidebarTouchStartRef.current = null;
        closeMenu();
      }
    },
    [closeMenu],
  );

  const handleSidebarTouchEnd = useCallback(() => {
    sidebarTouchStartRef.current = null;
  }, []);

  const handleNavigate = (event, targetRoute) => {
    event.preventDefault();
    const link = NAV_LINKS.find((entry) => entry.route === targetRoute);
    if (!link) {
      return;
    }
    prefetchRoute(targetRoute);
    navigateToRoute(targetRoute, {}, { scrollToTop: true });
    closeMenu();
  };

  const menuButtonLabel = menuOpen ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation';
  const mobileNavId = 'mobile-navigation';
  const overlayClasses = [
    'fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-300 ease-out lg:hidden',
    menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
  ].join(' ');
  const sidebarClasses = [
    'fixed inset-y-0 left-0 z-40 flex w-[80vw] max-w-sm transform flex-col overflow-y-auto bg-slate-900/95 px-6 py-6 shadow-2xl ring-1 ring-white/10 transition-transform duration-300 ease-in-out sm:w-[70vw] md:w-[30vw] md:max-w-md lg:hidden',
    menuOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none',
  ].join(' ');

  const renderAsyncPage = (name, props = {}, fallback = null) => {
    const Component = name === 'home' ? HomePage : asyncPages[name] ?? null;
    if (Component) {
      return html`<${Component} ...${props} />`;
    }
    if (ROUTE_LOADERS[name]) {
      return (
        fallback ??
        html`<div class="flex min-h-[280px] items-center justify-center text-sm text-slate-400">
          Chargement de la page…
        </div>`
      );
    }
    return null;
  };

  const routeTransitionActive = !initialRouteRef.current;
  const headerAnimationClass = routeTransitionActive
    ? `route-transition-shell route-transition-shell-${routeTransitionPhase}`
    : '';
  const navAnimationClass = routeTransitionActive
    ? `route-link-animate route-link-animate-${routeTransitionPhase}`
    : '';
  const routePhaseValue = routeTransitionActive ? String(routeTransitionPhase) : 'initial';

  return html`
    <div class="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header
        class=${[`sticky top-0 z-20 border-b border-slate-800 bg-slate-900/80 backdrop-blur`, headerAnimationClass]
          .filter(Boolean)
          .join(' ')}
      >
        <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <button
            class="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 lg:hidden"
            aria-controls=${mobileNavId}
            aria-expanded=${menuOpen}
            aria-label=${menuButtonLabel}
            type="button"
            onClick=${() => setMenuOpen((prev) => !prev)}
          >
            ${menuOpen ? html`<${X} class="h-5 w-5" />` : html`<${Menu} class="h-5 w-5" />`}
          </button>
          <a
            class="group flex items-center gap-3 text-lg font-semibold tracking-wide text-white transition hover:text-amber-300 lg:mr-auto"
            href="/"
            onClick=${(event) => handleNavigate(event, 'home')}
          >
            <span
              class="flex items-center gap-3 rounded-full border border-amber-500/40 bg-slate-900/80 px-3 py-1 shadow-[0_0_0_1px_rgba(15,23,42,0.65)] transition group-hover:border-amber-300/80 group-hover:shadow-[0_0_20px_rgba(251,191,36,0.25)]"
            >
              <span
                class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-500 to-rose-500 text-slate-950 shadow-lg shadow-amber-500/40 ring-1 ring-amber-200/70"
              >
                <svg
                  class="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M4 12c2.5-3 5.5-3 8 0s5.5 3 8 0" stroke-opacity="0.95" />
                  <path d="M6 15c2-2.4 4.5-2.4 6.5 0S16.5 17.4 19 15" stroke-opacity="0.75" />
                  <circle cx="12" cy="12" r="1.4" fill="currentColor" fill-opacity="0.85" />
                </svg>
              </span>
              <span class="flex flex-col leading-tight">
                <span class="text-[0.55rem] uppercase tracking-[0.45em] text-amber-200/90 transition group-hover:text-amber-100">Libre</span>
                <span class="text-base font-bold tracking-tight text-white transition group-hover:text-amber-50">Antenne</span>
              </span>
            </span>
          </a>
          <nav class="hidden items-center gap-6 lg:flex">
          ${NAV_LINKS.map((link, index) => {
            const isActive =
              route.name === link.route || (link.route === 'blog' && route.name === 'blog-proposal');
            const href = link.href;
            const baseClasses = 'text-sm font-medium transition hover:text-white';
            const stateClass = isActive ? 'text-white' : 'text-slate-300';
            const animationClass = navAnimationClass;
            return html`
              <a
                key=${link.route}
                class=${[baseClasses, stateClass, animationClass].filter(Boolean).join(' ')}
                href=${href}
                onClick=${(event) => handleNavigate(event, link.route)}
                onMouseEnter=${() => prefetchRoute(link.route)}
                onFocus=${() => prefetchRoute(link.route)}
                aria-current=${isActive ? 'page' : undefined}
                style=${routeTransitionActive ? { '--route-index': String(index) } : null}
              >
                ${link.label}
              </a>
            `;
          })}
          </nav>
        </div>
      </header>
      <div
        class=${overlayClasses}
        onClick=${handleOverlayClick}
        aria-hidden="true"
      ></div>
      <aside
        class=${sidebarClasses}
        role="dialog"
        aria-modal=${menuOpen ? 'true' : 'false'}
        aria-label="Navigation principale"
        id=${mobileNavId}
        aria-hidden=${menuOpen ? 'false' : 'true'}
        inert=${menuOpen ? undefined : true}
        tabIndex=${menuOpen ? 0 : -1}
        onTouchStart=${handleSidebarTouchStart}
        onTouchMove=${handleSidebarTouchMove}
        onTouchEnd=${handleSidebarTouchEnd}
        onTouchCancel=${handleSidebarTouchEnd}
      >
        <div class="flex items-center justify-between gap-4">
          <a
            class="group flex items-center gap-3 text-lg font-semibold tracking-wide text-white transition hover:text-amber-300"
            href="/"
            onClick=${(event) => handleNavigate(event, 'home')}
          >
            <span
              class="flex items-center gap-3 rounded-full border border-amber-500/40 bg-slate-900/80 px-3 py-1 shadow-[0_0_0_1px_rgba(15,23,42,0.65)] transition group-hover:border-amber-300/80 group-hover:shadow-[0_0_20px_rgba(251,191,36,0.25)]"
            >
              <span
                class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-500 to-rose-500 text-slate-950 shadow-lg shadow-amber-500/40 ring-1 ring-amber-200/70"
              >
                <svg
                  class="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M4 12c2.5-3 5.5-3 8 0s5.5 3 8 0" stroke-opacity="0.95" />
                  <path d="M6 15c2-2.4 4.5-2.4 6.5 0S16.5 17.4 19 15" stroke-opacity="0.75" />
                  <circle cx="12" cy="12" r="1.4" fill="currentColor" fill-opacity="0.85" />
                </svg>
              </span>
              <span class="flex flex-col leading-tight">
                <span class="text-[0.55rem] uppercase tracking-[0.45em] text-amber-200/90 transition group-hover:text-amber-100">Libre</span>
                <span class="text-base font-bold tracking-tight text-white transition group-hover:text-amber-50">Antenne</span>
              </span>
            </span>
          </a>
          <button
            class="rounded-lg border border-slate-700 p-2 text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            type="button"
            aria-label="Fermer le menu"
            onClick=${closeMenu}
          >
            <${X} class="h-5 w-5" />
          </button>
        </div>
        <nav class="mt-8 flex flex-col gap-1" aria-label="Navigation mobile">
          ${NAV_LINKS.map((link, index) => {
            const isActive =
              route.name === link.route || (link.route === 'blog' && route.name === 'blog-proposal');
            const href = link.href;
            const baseClasses = 'flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition';
            const stateClass = isActive
              ? 'bg-white/10 text-white shadow-inner shadow-amber-500/10'
              : 'text-slate-200 hover:bg-white/5';
            const Icon = link.icon;
            const iconClass = isActive ? 'text-amber-300' : 'text-slate-400';
            const animationClass = navAnimationClass;
            return html`
              <a
                key=${`sidebar-${link.route}`}
                class=${[baseClasses, stateClass, animationClass].filter(Boolean).join(' ')}
                href=${href}
                onClick=${(event) => handleNavigate(event, link.route)}
                onMouseEnter=${() => prefetchRoute(link.route)}
                onFocus=${() => prefetchRoute(link.route)}
                onTouchStart=${() => prefetchRoute(link.route)}
                aria-current=${isActive ? 'page' : undefined}
                style=${routeTransitionActive ? { '--route-index': String(index) } : null}
              >
                ${Icon ? html`<${Icon} class=${`h-5 w-5 ${iconClass}`} aria-hidden="true" />` : null}
                <span>${link.label}</span>
              </a>`;
          })}
        </nav>
      </aside>

      <main class="flex-1" data-route-phase=${routePhaseValue}>
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-0">
          ${
            route.name === 'cgu'
              ? renderAsyncPage('cgu')
              : route.name === 'ban'
              ? renderAsyncPage('ban')
              : route.name === 'about'
              ? renderAsyncPage('about')
              : route.name === 'blog'
              ? renderAsyncPage('blog', {
                  params: route.params,
                  bootstrap: BOOTSTRAP_PAGES.blog ?? null,
                  onNavigateToPost: (slug) =>
                    navigateToRoute('blog', { slug }, { scrollToTop: true }),
                  onNavigateToProposal: () =>
                    navigateToRoute('blog-proposal', {}, { scrollToTop: true }),
                })
              : route.name === 'blog-proposal'
              ? renderAsyncPage('blog-proposal', {
                  onNavigateToBlog: () => navigateToRoute('blog', {}, { scrollToTop: true }),
                })
              : route.name === 'members'
              ? renderAsyncPage('members', { onViewProfile: handleProfileOpen })
              : route.name === 'shop'
              ? renderAsyncPage('shop', { bootstrap: BOOTSTRAP_PAGES.shop ?? null })
              : route.name === 'profile'
              ? renderAsyncPage('profile', {
                  params: route.params,
                  onNavigateHome: () => navigateToRoute('home', {}, { scrollToTop: true }),
                  onUpdateRange: updateProfileRoute,
                })
              : route.name === 'statistiques'
              ? renderAsyncPage('statistiques', {
                  params: route.params,
                  bootstrap: BOOTSTRAP_PAGES.statistiques ?? null,
                  onSyncRoute: (nextParams, options = {}) =>
                    navigateToRoute('statistiques', nextParams, {
                      replace: true,
                      scrollToTop: options.scrollToTop ?? false,
                    }),
                })
              : route.name === 'classements'
              ? renderAsyncPage('classements', {
                  params: route.params,
                  bootstrap: BOOTSTRAP_PAGES.classements ?? null,
                  onSyncRoute: (nextParams, options = {}) =>
                    navigateToRoute('classements', nextParams, {
                      replace: true,
                      scrollToTop: options.scrollToTop ?? false,
                    }),
                })
              : renderAsyncPage('home', {
                  status,
                  streamInfo,
                  audioKey,
                  speakers,
                  now,
                  anonymousSlot,
                  speakingHistory,
                  isHistoryLoading,
                  selectedWindowMinutes,
                  onWindowChange: handleWindowChange,
                  onViewProfile: handleProfileOpen,
                  listenerStats,
                  guildSummary,
                  bridgeStatus,
                })
          }
        </div>
      </main>

      <footer class="border-t border-slate-800 bg-slate-900/80 py-6 text-center text-sm text-slate-400">
        <div class="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
          <span>Libre Antenne · Tous droits réservés</span>
          <span class="hidden sm:inline">•</span>
          <a
            class="text-slate-300 transition hover:text-white hover:underline"
            href="/cgu"
            onClick=${(event) => {
              event.preventDefault();
              navigateToRoute('cgu', {}, { scrollToTop: true });
            }}
          >
            Conditions générales d’utilisation
          </a>
          <span class="hidden sm:inline">•</span>
          <a
            class="text-slate-300 transition hover:text-white hover:underline"
            href="/about"
            onClick=${(event) => {
              event.preventDefault();
              navigateToRoute('about', {}, { scrollToTop: true });
            }}
          >
            À propos
          </a>
        </div>
      </footer>
    </div>
  `;
};

const mountNode = document.getElementById('app');
if (mountNode) {
  if (mountNode.childNodes && mountNode.childNodes.length > 0) {
    hydrate(html`<${App} />`, mountNode);
  } else {
    render(html`<${App} />`, mountNode);
  }
}
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
