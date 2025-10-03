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

const getInitialSoulDecision = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage?.getItem('soulContract') ?? null;
  } catch (error) {
    console.warn("Impossible de lire le pacte d'âme", error);
    return null;
  }
};

const NAV_LINKS = [
  { label: 'Accueil', route: 'home', hash: '#/' },
  { label: 'Membres', route: 'members', hash: '#/membres' },
  { label: 'Boutique', route: 'shop', hash: '#/boutique' },
  {
    label: 'Classements',
    route: 'classements',
    hash: '#/classements',
    href: '/classements',
    external: true,
  },
  { label: 'Modération', route: 'ban', hash: '#/bannir' },
  { label: 'À propos', route: 'about', hash: '#/about' },
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
  const [soulDecision, setSoulDecision] = useState(getInitialSoulDecision);
  const [showSoulModal, setShowSoulModal] = useState(() => !getInitialSoulDecision());
  const [soulMessage, setSoulMessage] = useState('');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/';
      setRoute({ name: 'home', params: {} });
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
    participantsRef.current = participantsMap;
  }, [participantsMap]);

  useEffect(() => {
    if (soulDecision) {
      setShowSoulModal(false);
    } else {
      setShowSoulModal(true);
    }
  }, [soulDecision]);

  useEffect(() => {
    if (!soulMessage) {
      return undefined;
    }
    const timer = setTimeout(() => setSoulMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [soulMessage]);

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

  const handleSoulDecision = useCallback((accepted) => {
    const choice = accepted ? 'accepted' : 'declined';
    setSoulDecision(choice);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('soulContract', choice);
      }
    } catch (error) {
      console.warn("Impossible de stocker le pacte d'âme", error);
    }
    setSoulMessage(
      accepted
        ? "Merci pour ta confiance éternelle. Le dieu 8.6 t'offrira peut-être une tournée. 🍻"
        : 'Refus enregistré. Tu gardes ton âme, mais reste pour la musique !'
    );
    setShowSoulModal(false);
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

  const handleNavigate = (event, targetRoute) => {
    event.preventDefault();
    const link = NAV_LINKS.find((entry) => entry.route === targetRoute);
    if (!link) {
      return;
    }
    if (link.external && link.href) {
      window.location.href = link.href;
      setMenuOpen(false);
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

  const soulModalTemplate = showSoulModal
    ? html`
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div class="w-full max-w-md space-y-4 rounded-xl bg-slate-900 p-6 text-center shadow-2xl">
            <h2 class="text-2xl font-semibold">Pacte sacré</h2>
            <p class="text-sm text-slate-300 sm:text-base">
              (Promis, c'est surtout pour l'ambiance. Les démons adorent les vibes chill.)
            </p>
            <div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                class="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-lg transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                onClick=${() => handleSoulDecision(true)}
              >
                J'offre mon âme (et une tournée)
              </button>
              <button
                class="inline-flex items-center justify-center rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                onClick=${() => handleSoulDecision(false)}
              >
                Nope, je suis team libre arbitre
              </button>
            </div>
          </div>
        </div>
      `
    : null;

  const soulMessageTemplate = soulMessage
    ? html`
        <div class="pointer-events-none fixed bottom-4 right-4 z-30 max-w-xs rounded-lg bg-slate-900/90 px-4 py-3 text-sm shadow-xl">
          ${soulMessage}
        </div>
      `
    : null;

  return html`
    <div class="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      ${soulModalTemplate}
      ${soulMessageTemplate}

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
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-10 py-10">
          ${
            route.name === 'ban'
              ? html`<${BanPage} />`
              : route.name === 'about'
              ? html`<${AboutPage} />`
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
