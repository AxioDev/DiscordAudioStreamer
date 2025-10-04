import {
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
  Sparkles,
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
import { BlogProposalPage } from './pages/blog-proposal.js';

const NAV_LINKS = [
  { label: 'Accueil', route: 'home', hash: '#/', icon: AudioLines },
  { label: 'Membres', route: 'members', hash: '#/membres', icon: Users },
  { label: 'Boutique', route: 'shop', hash: '#/boutique', icon: ShoppingBag },
  {
    label: 'Classements',
    route: 'classements',
    hash: '#/classements',
    icon: BadgeCheck,
  },
  { label: 'Blog', route: 'blog', hash: '#/blog', icon: MessageSquare },
  { label: 'Modération', route: 'ban', hash: '#/bannir', icon: ShieldCheck },
  { label: 'À propos', route: 'about', hash: '#/about', icon: Sparkles },
];

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
    const second = segments.length > 1 ? segments[1] : null;
    if (second) {
      const normalized = second.toLowerCase();
      if (['proposer', 'proposal', 'soumettre'].includes(normalized)) {
        return { name: 'blog-proposal', params: {} };
      }
    }
    return {
      name: 'blog',
      params: {
        slug: second ? decodeURIComponent(second) : null,
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
  const [guildSummary, setGuildSummary] = useState(null);
  const sidebarTouchStartRef = useRef(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

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
    closeMenu();
  }, [route, closeMenu]);

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
    if (window.location.hash !== link.hash) {
      window.location.hash = link.hash;
    } else {
      setRoute({ name: targetRoute, params: {} });
    }
    closeMenu();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
          <nav class="hidden items-center gap-6 lg:flex">
          ${NAV_LINKS.map((link) => {
            const isActive =
              route.name === link.route || (link.route === 'blog' && route.name === 'blog-proposal');
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
            class="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 lg:hidden"
            aria-controls=${mobileNavId}
            aria-expanded=${menuOpen}
            aria-label=${menuButtonLabel}
            type="button"
            onClick=${() => setMenuOpen((prev) => !prev)}
          >
            ${menuOpen ? html`<${X} class="h-5 w-5" />` : html`<${Menu} class="h-5 w-5" />`}
          </button>
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
            class="flex items-center gap-2 text-lg font-semibold tracking-wide text-white transition hover:text-amber-300"
            href="#/"
            onClick=${(event) => handleNavigate(event, 'home')}
          >
            <span class="rounded bg-amber-400 px-2 py-1 text-sm font-bold text-amber-950">LA</span>
            Libre Antenne
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
          ${NAV_LINKS.map((link) => {
            const isActive =
              route.name === link.route || (link.route === 'blog' && route.name === 'blog-proposal');
            const href = link.external && link.href ? link.href : link.hash;
            const baseClasses = 'flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition';
            const stateClass = isActive
              ? 'bg-white/10 text-white shadow-inner shadow-amber-500/10'
              : 'text-slate-200 hover:bg-white/5';
            const Icon = link.icon;
            const iconClass = isActive ? 'text-amber-300' : 'text-slate-400';
            return html`
              <a
                key=${`sidebar-${link.route}`}
                class=${[baseClasses, stateClass].join(' ')}
                href=${href}
                onClick=${(event) => handleNavigate(event, link.route)}
                aria-current=${isActive ? 'page' : undefined}
              >
                ${Icon ? html`<${Icon} class=${`h-5 w-5 ${iconClass}`} aria-hidden="true" />` : null}
                <span>${link.label}</span>
              </a>`;
          })}
        </nav>
      </aside>

      <main class="flex-1">
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-0">
          ${
            route.name === 'ban'
              ? html`<${BanPage} />`
              : route.name === 'about'
              ? html`<${AboutPage} />`
              : route.name === 'blog'
              ? html`<${BlogPage} params=${route.params} />`
              : route.name === 'blog-proposal'
              ? html`<${BlogProposalPage} />`
              : route.name === 'members'
              ? html`<${MembersPage} onViewProfile=${handleProfileOpen} />`
              : route.name === 'shop'
              ? html`<${ShopPage} />`
              : route.name === 'profile'
              ? html`<${ProfilePage}
                  params=${route.params}
                  onNavigateHome=${() => {
                    window.location.hash = '#/';
                    setRoute({ name: 'home', params: {} });
                  }}
                  onUpdateRange=${updateProfileRoute}
                />`
              : route.name === 'classements'
              ? html`<${ClassementsPage} params=${route.params} />`
              : html`<${HomePage}
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
                  guildSummary=${guildSummary}
                />`
          }
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
