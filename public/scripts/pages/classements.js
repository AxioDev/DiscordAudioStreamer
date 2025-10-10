import {
  Fragment,
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from '../core/deps.js';
import { buildRoutePath } from '../utils/index.js';

const SORTABLE_COLUMNS = new Set([
  'schScoreNorm',
  'arrivalEffect',
  'departureEffect',
  'activityScore',
  'displayName',
]);

const normalizeSortBy = (value) => {
  if (typeof value === 'string' && SORTABLE_COLUMNS.has(value)) {
    return value;
  }
  return 'schScoreNorm';
};

const normalizeSortOrder = (value) => (value === 'asc' ? 'asc' : 'desc');

const normalizePeriod = (value) => {
  if (typeof value !== 'string') {
    return '30';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'tout') {
    return 'all';
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '30';
  }
  const clamped = Math.min(Math.max(parsed, 1), 365);
  return String(clamped);
};

const normalizeSearch = (value) => (typeof value === 'string' ? value : '');

const deriveInitialState = (params = {}) => {
  return {
    search: normalizeSearch(params.search),
    sortBy: normalizeSortBy(params.sortBy),
    sortOrder: normalizeSortOrder(params.sortOrder),
    period: normalizePeriod(params.period),
  };
};

const pad = (value) => String(value).padStart(2, '0');

const parseDate = (value) => {
  if (!value) {
    return null;
  }
  const candidate = new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const topThreeStyles = [
  {
    highlight: 'border-[#0085C7] bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(0,133,199,0.35)]',
    accent: 'from-[#0085C7]/35 via-[#0085C7]/10 to-transparent',
    ring: 'ring-4 ring-[#0085C7]/50',
    badge: 'bg-gradient-to-br from-sky-400 via-[#0085C7] to-cyan-400 text-slate-950',
  },
  {
    highlight: 'border-[#F4C300] bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(244,195,0,0.35)]',
    accent: 'from-[#F4C300]/35 via-[#F4C300]/10 to-transparent',
    ring: 'ring-4 ring-[#F4C300]/40',
    badge: 'bg-gradient-to-br from-amber-300 via-[#F4C300] to-yellow-200 text-slate-950',
  },
  {
    highlight: 'border-black bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(0,0,0,0.45)]',
    accent: 'from-black/40 via-slate-900/60 to-transparent',
    ring: 'ring-4 ring-white/20',
    badge: 'bg-gradient-to-br from-slate-700 via-slate-500 to-slate-300 text-white/90',
  },
];

const getLeaderAvatar = (leader) => {
  const candidates = [leader?.avatar, leader?.avatarUrl, leader?.profile?.avatar];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
};

const computeAvatarSeed = (leader, rank) => {
  const userId = typeof leader?.userId === 'string' ? leader.userId : '';
  if (userId) {
    return Array.from(userId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  }
  const safeRank = Number.isFinite(rank) ? Math.max(0, rank - 1) : 0;
  return safeRank;
};

const fallbackAvatarBackgrounds = [
  'from-sky-500/60 via-slate-900/60 to-indigo-500/60',
  'from-fuchsia-500/60 via-slate-900/60 to-pink-500/60',
  'from-emerald-400/60 via-slate-900/60 to-cyan-500/60',
  'from-amber-400/60 via-slate-900/60 to-orange-500/60',
  'from-purple-500/60 via-slate-900/60 to-violet-500/60',
];

const getLeaderInitials = (leader) => {
  const displayName = typeof leader?.displayName === 'string' ? leader.displayName.trim() : '';
  const username = typeof leader?.username === 'string' ? leader.username.trim().replace(/^@/, '') : '';
  const source = displayName || username;
  if (!source) {
    return '∅';
  }
  const segments = source.split(/\s+/).filter(Boolean);
  if (segments.length === 1) {
    return segments[0].slice(0, 2).toUpperCase();
  }
  const first = segments[0]?.[0] ?? '';
  const last = segments[segments.length - 1]?.[0] ?? '';
  const initials = `${first}${last}`.trim();
  return initials.length > 0 ? initials.toUpperCase() : source.slice(0, 2).toUpperCase();
};

const getTrendPresentation = (positionTrend) => {
  const movement = positionTrend?.movement ?? 'same';
  const delta = Number.isFinite(positionTrend?.delta) ? Number(positionTrend.delta) : null;
  switch (movement) {
    case 'up':
      return {
        icon: '↑',
        label: 'Monte',
        className: 'text-emerald-300',
        delta: delta !== null && delta !== 0 ? `+${delta}` : '+0',
      };
    case 'down':
      return {
        icon: '↓',
        label: 'Descend',
        className: 'text-rose-300',
        delta: delta !== null && delta !== 0 ? `${delta}` : '0',
      };
    case 'new':
      return {
        icon: '★',
        label: 'Nouveau',
        className: 'text-amber-300',
        delta: '—',
      };
    default:
      return {
        icon: '→',
        label: 'Stable',
        className: 'text-slate-300',
        delta: '0',
      };
  }
};

const ClassementsPage = ({ params = {}, onSyncRoute, bootstrap = null }) => {
  const initialState = useMemo(() => deriveInitialState(params), [params.search, params.sortBy, params.sortOrder, params.period]);

  const bootstrapPayload = useMemo(() => {
    if (!bootstrap || typeof bootstrap !== 'object') {
      return null;
    }

    const querySource = bootstrap.query && typeof bootstrap.query === 'object' ? bootstrap.query : {};
    const normalizedQuery = {
      search: normalizeSearch(querySource.search),
      sortBy: normalizeSortBy(querySource.sortBy),
      sortOrder: normalizeSortOrder(querySource.sortOrder),
      period: normalizePeriod(querySource.period),
    };

    const leaders = Array.isArray(bootstrap.leaders) ? bootstrap.leaders : [];
    const snapshot = bootstrap.snapshot && typeof bootstrap.snapshot === 'object'
      ? {
          bucketStart: typeof bootstrap.snapshot.bucketStart === 'string' ? bootstrap.snapshot.bucketStart : null,
          comparedTo:
            typeof bootstrap.snapshot.comparedTo === 'string' && bootstrap.snapshot.comparedTo
              ? bootstrap.snapshot.comparedTo
              : null,
        }
      : null;

    return {
      query: normalizedQuery,
      leaders,
      snapshot,
    };
  }, [bootstrap]);

  const bootstrapRef = useRef(bootstrapPayload);
  const bootstrapQuery = bootstrapRef.current?.query ?? null;
  const hasBootstrapData = Boolean(bootstrapRef.current && Array.isArray(bootstrapRef.current.leaders) && bootstrapRef.current.leaders.length > 0);

  const [search, setSearch] = useState(bootstrapQuery ? bootstrapQuery.search : initialState.search);
  const [debouncedSearch, setDebouncedSearch] = useState(
    bootstrapQuery ? bootstrapQuery.search.trim() : initialState.search.trim(),
  );
  const [sortBy, setSortBy] = useState(bootstrapQuery ? bootstrapQuery.sortBy : initialState.sortBy);
  const [sortOrder, setSortOrder] = useState(bootstrapQuery ? bootstrapQuery.sortOrder : initialState.sortOrder);
  const [period, setPeriod] = useState(bootstrapQuery ? bootstrapQuery.period : initialState.period);
  const [leaders, setLeaders] = useState(() => (bootstrapRef.current?.leaders ?? []));
  const [snapshot, setSnapshot] = useState(() => bootstrapRef.current?.snapshot ?? null);
  const [isLoading, setIsLoading] = useState(!hasBootstrapData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const hasLoadedRef = useRef(hasBootstrapData);
  const controllerRef = useRef(null);

  useEffect(() => {
    const normalized = deriveInitialState(params);
    setSearch((prev) => (prev === normalized.search ? prev : normalized.search));
    setDebouncedSearch(normalized.search.trim());
    setSortBy((prev) => (prev === normalized.sortBy ? prev : normalized.sortBy));
    setSortOrder((prev) => (prev === normalized.sortOrder ? prev : normalized.sortOrder));
    setPeriod((prev) => (prev === normalized.period ? prev : normalized.period));
  }, [params.search, params.sortBy, params.sortOrder, params.period]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('fr-FR', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }),
    [],
  );

  const formatScore = useCallback(
    (value) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return '0';
      }
      if (Math.abs(numericValue) >= 1000) {
        return numberFormatter.format(Math.round(numericValue));
      }
      return numberFormatter.format(numericValue);
    },
    [numberFormatter],
  );

  const formatSigned = useCallback(
    (value) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return '0';
      }
      const formatted = formatScore(Math.abs(numericValue));
      if (numericValue > 0) {
        return `+${formatted}`;
      }
      if (numericValue < 0) {
        return `-${formatted}`;
      }
      return formatted;
    },
    [formatScore],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setRefreshTick((previous) => previous + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    controllerRef.current = controller;

    const run = async () => {
      const bootstrapData = bootstrapRef.current;
      const matchesBootstrap =
        bootstrapData &&
        bootstrapData.query.sortBy === sortBy &&
        bootstrapData.query.sortOrder === sortOrder &&
        bootstrapData.query.period === period &&
        bootstrapData.query.search.trim() === debouncedSearch.trim();

      if (!hasLoadedRef.current && matchesBootstrap && refreshTick === 0) {
        hasLoadedRef.current = true;
        setIsLoading(false);
        setIsRefreshing(false);
        setError(null);
        return;
      }

      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) {
        setIsLoading(true);
        setIsRefreshing(false);
      } else {
        setIsRefreshing(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('sortBy', sortBy);
        params.set('sortOrder', sortOrder);
        if (debouncedSearch) {
          params.set('search', debouncedSearch);
        }
        if (period) {
          params.set('period', period);
        }
        const queryString = params.toString();
        const url = queryString
          ? `/api/voice-activity/hype-leaders?${queryString}`
          : '/api/voice-activity/hype-leaders';

        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to load hype leaders');
        }
        const payload = await response.json();
        if (controller.signal.aborted) {
          return;
        }
        const nextLeaders = Array.isArray(payload?.leaders) ? payload.leaders : [];
        setLeaders(nextLeaders);
        setSnapshot(payload?.snapshot ?? null);
        hasLoadedRef.current = true;
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        console.error(fetchError);
        setError(fetchError);
        setLeaders([]);
        setSnapshot(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    run();

    return () => {
      controller.abort();
      controllerRef.current = null;
    };
  }, [debouncedSearch, sortBy, sortOrder, period, refreshTick]);

  useEffect(() => {
    const nextParams = {
      sortBy,
      sortOrder,
      period,
      search: debouncedSearch,
    };

    if (typeof onSyncRoute === 'function') {
      onSyncRoute(nextParams);
      return;
    }

    if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
      const path = buildRoutePath('classements', nextParams);
      window.history.replaceState({ route: { name: 'classements', params: nextParams } }, '', path);
      const popEvent =
        typeof window.PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
      window.dispatchEvent(popEvent);
    }
  }, [debouncedSearch, onSyncRoute, period, sortBy, sortOrder]);

  const metaLabel = useMemo(() => {
    const count = Math.min(leaders.length, 100);
    const bucketDate = parseDate(snapshot?.bucketStart) ?? new Date();
    const comparison = parseDate(snapshot?.comparedTo);
    const formatter = new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'long',
    });
    const formattedDate = formatter.format(bucketDate);

    let comparisonSegment = '';
    if (comparison) {
      const diffMs = bucketDate.getTime() - comparison.getTime();
      const diffHours = diffMs / 3_600_000;
      if (Number.isFinite(diffHours)) {
        const relativeFormatter = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
        const rounded = Math.round(diffHours);
        comparisonSegment =
          rounded === 0
            ? ' · Variations sur l’heure en cours'
            : ` · Variations ${relativeFormatter.format(-rounded, 'hour')}`;
      }
    }

    return `${count} profils · Mise à jour ${formattedDate}${comparisonSegment}`;
  }, [leaders.length, snapshot]);

  const leaderboardContent = useMemo(() => {
    if (isLoading && !hasLoadedRef.current) {
      return html`
        <div class="grid gap-4 rounded-3xl border border-white/5 bg-slate-950/60 p-10 text-center shadow-neon">
          <div class="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-fuchsia-500/60 border-t-transparent"></div>
          <p class="text-sm text-slate-300">Chargement du classement…</p>
        </div>
      `;
    }

    if (error) {
      return html`
        <div class="rounded-3xl border border-red-500/30 bg-red-500/10 px-10 py-12 text-center text-red-100">
          <p class="text-base font-semibold">Impossible de charger le classement</p>
          <p class="mt-2 text-sm text-red-100/80">Actualise ou réessaie plus tard.</p>
        </div>
      `;
    }

    if (!leaders || leaders.length === 0) {
      return html`
        <div class="rounded-3xl border border-dashed border-white/10 bg-slate-950/60 px-10 py-16 text-center">
          <div class="mx-auto h-14 w-14 rounded-full border border-white/10 bg-white/5"></div>
          <p class="mt-6 text-lg font-semibold text-white">Pas encore de hype mesurée</p>
          <p class="mt-2 text-sm text-slate-400">Connecte-toi au salon vocal pour lancer les festivités.</p>
        </div>
      `;
    }

    return html`
      <${Fragment}>
        ${leaders.slice(0, 100).map((leader, index) => {
          const candidateRank = Number(leader?.rank ?? leader?.absoluteRank);
          const rank = Number.isFinite(candidateRank) && candidateRank > 0 ? Math.floor(candidateRank) : index + 1;
          const style = rank <= 3 ? topThreeStyles[rank - 1] : null;
          const highlight = style ? style.highlight : 'border-white/5 bg-slate-900/50';
          const accent = style ? style.accent : 'from-transparent to-transparent';
          const trend = getTrendPresentation(leader?.positionTrend ?? null);
          const rawUsername = typeof leader?.username === 'string' ? leader.username.trim() : '';
          const normalizedUsername = rawUsername.startsWith('@')
            ? rawUsername
            : rawUsername
            ? `@${rawUsername}`
            : '';
          const activityScore = formatScore(leader?.activityScore);
          const key = leader?.userId ?? leader?.id ?? `${leader?.displayName ?? 'leader'}-${rank}`;
          const avatarUrl = getLeaderAvatar(leader);
          const hasAvatarImage = typeof avatarUrl === 'string' && avatarUrl.length > 0;
          const avatarSeed = computeAvatarSeed(leader, rank);
          const fallbackBackground = fallbackAvatarBackgrounds[Math.abs(avatarSeed) % fallbackAvatarBackgrounds.length];
          const ring = style?.ring ?? 'ring-2 ring-white/10';
          const badge = style?.badge ?? 'bg-slate-900/90 text-white border border-white/20';
          const altName = (() => {
            const name = typeof leader?.displayName === 'string' ? leader.displayName.trim() : '';
            if (name) {
              return name;
            }
            const username = normalizedUsername.replace(/^@/, '');
            return username || `profil ${pad(rank)}`;
          })();

          const userId = typeof leader?.userId === 'string' ? leader.userId : '';
          const profileHref = userId ? buildRoutePath('profile', { userId }) : null;

          const card = html`
            <article
              key=${profileHref ? null : key}
              class=${`leader-card relative overflow-hidden rounded-3xl border ${highlight}`}
              style=${{ '--leader-index': String(index) }}
            >
              <div class=${`absolute inset-0 bg-gradient-to-r ${accent} opacity-[0.22]`}></div>
              <div class="relative flex flex-col gap-6 p-6">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div class="flex items-center gap-4">
                    <div class="relative">
                      <div class=${`relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-950/70 ${ring} ring-offset-2 ring-offset-slate-950`}>
                        ${hasAvatarImage
                          ? html`<img
                              src=${avatarUrl}
                              alt=${`Avatar de ${altName}`}
                              class="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />`
                          : html`<span
                              class=${`flex h-full w-full items-center justify-center bg-gradient-to-br ${fallbackBackground} text-lg font-semibold text-white/90`}
                            >
                              ${getLeaderInitials(leader)}
                            </span>`}
                      </div>
                      <span
                        class=${`absolute -bottom-1 -right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-xs font-bold shadow-lg shadow-black/50 ${badge}`}
                      >
                        #${pad(rank)}
                      </span>
                    </div>
                    <div class="space-y-1.5">
                      <h3 class="text-lg font-semibold text-white">${leader?.displayName ?? 'Inconnu·e'}</h3>
                      ${normalizedUsername
                        ? html`<p class="text-xs font-medium text-slate-400/80">${normalizedUsername}</p>`
                        : null}
                      <p class="text-[0.65rem] uppercase tracking-[0.3em] text-slate-400/70">Activité ${activityScore}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-start gap-1 rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-[0.65rem] font-semibold leading-tight text-white/80 sm:items-end sm:self-start sm:text-right">
                    <span class=${`flex items-center gap-1 ${trend.className}`}>
                      <span aria-hidden="true">${trend.icon}</span>
                      <span>${trend.delta}</span>
                    </span>
                    <span class="text-[0.55rem] uppercase tracking-[0.25em] text-slate-400/70">${trend.label}</span>
                  </div>
                </div>
                <dl class="grid grid-cols-2 gap-5 text-sm sm:grid-cols-4">
                  <div>
                    <dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Score hype</dt>
                    <dd class="mt-1 text-base font-semibold text-sky-300">${formatScore(leader?.schScoreNorm)}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Effet arrivée</dt>
                    <dd class="mt-1 text-base font-semibold text-purple-200">${formatSigned(leader?.arrivalEffect)}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Effet départ</dt>
                    <dd class="mt-1 text-base font-semibold text-emerald-200">${formatSigned(leader?.departureEffect)}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Indice d'activité</dt>
                    <dd class="mt-1 text-base font-semibold text-fuchsia-300">${activityScore}</dd>
                  </div>
                </dl>
              </div>
            </article>
          `;

          if (profileHref) {
            return html`
              <a key=${key} class="leader-card-link" href=${profileHref} aria-label=${`Voir le profil de ${altName}`}>
                ${card}
              </a>
            `;
          }

          return card;
        })}
      </${Fragment}>
    `;
  }, [error, formatScore, formatSigned, isLoading, leaders]);

  return html`
    <div class="classements-page flex flex-col gap-10">
      <section class="rounded-3xl bg-white/5 p-[1px]">
        <div class="relative overflow-hidden rounded-[1.45rem] bg-slate-950/80 p-8 shadow-neon">
          <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/15 via-fuchsia-500/10 to-purple-500/20"></div>
          <div class="relative flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div class="max-w-2xl space-y-6">
              <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Classement officiel</p>
              <h1 class="text-3xl font-black leading-tight text-white sm:text-4xl">
                Top 100 des personnes les plus hype & cool
              </h1>
              <p class="text-base text-slate-300 sm:text-lg">
                Ce classement mesure l'énergie que chaque voix apporte au serveur : l'impact sur la fréquentation, la durée de parole et la vibe générale.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="space-y-6">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 class="text-2xl font-bold text-white">Classement Hype</h2>
          <span class="text-sm text-slate-400">${metaLabel}</span>
        </div>

        <div class="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/70 p-6 md:grid-cols-4 xl:grid-cols-5">
          <label class="flex flex-col gap-2 md:col-span-2">
            <span class="text-xs uppercase tracking-[0.3em] text-slate-400">Recherche</span>
            <input
              type="search"
              inputmode="search"
              autocomplete="off"
              spellcheck="false"
              placeholder="Rechercher un pseudo"
              class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder-slate-500 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              value=${search}
              onInput=${(event) => setSearch(event.target.value)}
            />
          </label>
          <label class="flex flex-col gap-2">
            <span class="text-xs uppercase tracking-[0.3em] text-slate-400">Trier par</span>
            <select
              class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              value=${sortBy}
              onChange=${(event) => setSortBy(normalizeSortBy(event.target.value))}
            >
              <option value="schScoreNorm">Score hype</option>
              <option value="arrivalEffect">Effet d'arrivée</option>
              <option value="departureEffect">Effet de départ</option>
              <option value="activityScore">Score d'activité</option>
              <option value="displayName">Pseudo</option>
            </select>
          </label>
          <div class="flex flex-col gap-2">
            <span class="text-xs uppercase tracking-[0.3em] text-slate-400">Ordre</span>
            <button
              type="button"
              class="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-medium text-white transition hover:border-sky-500/60 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              onClick=${() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              aria-pressed=${sortOrder === 'asc'}
            >
              <span class="pointer-events-none select-none">
                ${sortOrder === 'asc' ? 'Ordre ascendant' : 'Ordre descendant'}
              </span>
              <span aria-hidden="true" class="text-base leading-none">${sortOrder === 'asc' ? '↑' : '↓'}</span>
            </button>
          </div>
          <label class="flex flex-col gap-2">
            <span class="text-xs uppercase tracking-[0.3em] text-slate-400">Période</span>
            <select
              class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              value=${period}
              onChange=${(event) => setPeriod(normalizePeriod(event.target.value))}
            >
              <option value="all">Toujours</option>
              <option value="7">7 jours</option>
              <option value="30">30 jours</option>
              <option value="90">90 jours</option>
              <option value="365">365 jours</option>
            </select>
          </label>
        </div>

        ${isRefreshing && hasLoadedRef.current
          ? html`<p class="text-xs uppercase tracking-[0.3em] text-slate-400">Actualisation des données…</p>`
          : null}

        <div class="grid gap-6">${leaderboardContent}</div>
      </section>
    </div>
  `;
};

export { ClassementsPage };
