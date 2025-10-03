import {
  Fragment,
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from '../core/deps.js';

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
  },
  {
    highlight: 'border-[#F4C300] bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(244,195,0,0.35)]',
    accent: 'from-[#F4C300]/35 via-[#F4C300]/10 to-transparent',
  },
  {
    highlight: 'border-black bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(0,0,0,0.45)]',
    accent: 'from-black/40 via-slate-900/60 to-transparent',
  },
];

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

const ClassementsPage = ({ params = {} }) => {
  const initialState = useMemo(() => deriveInitialState(params), [params.search, params.sortBy, params.sortOrder, params.period]);
  const [search, setSearch] = useState(initialState.search);
  const [debouncedSearch, setDebouncedSearch] = useState(initialState.search.trim());
  const [sortBy, setSortBy] = useState(initialState.sortBy);
  const [sortOrder, setSortOrder] = useState(initialState.sortOrder);
  const [period, setPeriod] = useState(initialState.period);
  const [leaders, setLeaders] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const hasLoadedRef = useRef(false);
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
    const hashBase = '#/classements';
    const nextHash = queryString ? `${hashBase}?${queryString}` : hashBase;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [debouncedSearch, sortBy, sortOrder, period]);

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
          const rank = index + 1;
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

          return html`
            <article key=${key} class=${`leader-card relative overflow-hidden rounded-3xl border ${highlight}`}>
              <div class=${`absolute inset-0 bg-gradient-to-r ${accent} opacity-[0.22]`}></div>
              <div class="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex flex-1 items-center gap-5">
                  <div class="flex items-center gap-3">
                    <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-lg font-extrabold text-white">
                      ${pad(rank)}
                    </span>
                    <span class=${`flex flex-col text-[0.65rem] font-semibold leading-tight ${trend.className}`}>
                      <span class="flex items-center gap-1">
                        <span aria-hidden="true">${trend.icon}</span>
                        <span>${trend.delta}</span>
                      </span>
                      <span class="text-[0.55rem] uppercase tracking-[0.2em] text-slate-400/70">${trend.label}</span>
                    </span>
                  </div>
                  <div>
                    <h3 class="text-lg font-semibold text-white">${leader?.displayName ?? 'Inconnu·e'}</h3>
                    ${normalizedUsername
                      ? html`<p class="mt-1 text-xs font-medium text-slate-400/80">${normalizedUsername}</p>`
                      : null}
                    <p class="mt-1 text-xs uppercase tracking-[0.25em] text-slate-400">Activité ${activityScore}</p>
                  </div>
                </div>
                <dl class="grid flex-1 grid-cols-2 gap-5 text-sm sm:grid-cols-4">
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
        })}
      </${Fragment}>
    `;
  }, [error, formatScore, formatSigned, isLoading, leaders]);

  return html`
    <div class="classements-page flex flex-col gap-10">
      <section class="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div class="rounded-3xl bg-white/5 p-[1px]">
          <div class="rounded-[1.45rem] bg-slate-950/80 p-8 shadow-neon">
            <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Classement officiel</p>
            <h1 class="mt-4 text-3xl font-black leading-tight text-white sm:text-4xl">
              Top 100 des personnes les plus hype &amp; cool
            </h1>
            <p class="mt-6 max-w-xl text-base text-slate-300 sm:text-lg">
              Ce classement mesure l'énergie que chaque voix apporte au serveur : l'impact sur la fréquentation, la durée de parole et la vibe générale.
            </p>
            <div class="mt-8 flex flex-wrap items-center gap-4">
              <div class="hype-pulse inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-sky-500/20 via-fuchsia-500/20 to-purple-500/20 px-5 py-3 text-sm font-semibold text-sky-200">
                <span class="inline-flex h-3 w-3 animate-ping rounded-full bg-sky-400"></span>
                Mise à jour en direct
              </div>
              <div class="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-widest text-slate-300">
                <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
                Data temps réel
              </div>
            </div>
          </div>
        </div>
        <aside class="flex flex-col gap-4">
          <div class="rounded-3xl bg-white/5 p-[1px]">
            <div class="rounded-[1.45rem] bg-slate-950/80 p-6">
              <h2 class="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Algorithme hype</h2>
              <p class="mt-3 text-sm text-slate-300">
                Le score hype combine l'effet de ton arrivée, l'impact quand tu quittes, ta capacité à retenir les autres et ton activité vocale.
              </p>
            </div>
          </div>
          <div class="rounded-3xl bg-white/5 p-[1px]">
            <details class="group rounded-[1.45rem] bg-slate-950/85">
              <summary class="flex cursor-pointer items-center justify-between gap-4 rounded-[1.45rem] px-6 py-5 text-sm font-semibold uppercase tracking-[0.3em] text-slate-400 transition hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60">
                <span>Formule transparente</span>
                <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-xs text-slate-400 transition group-open:rotate-45 group-open:text-slate-200" aria-hidden="true">+</span>
              </summary>
              <div class="px-6 pb-6">
                <p class="text-sm text-slate-300">
                  Pour les classements <span class="font-semibold text-sky-200">Hype</span> &amp; <span class="font-semibold text-fuchsia-200">Cool</span>, nous combinons quatre signaux puis nous normalisons par le nombre de sessions.
                </p>
                <div class="mt-4 space-y-2 text-xs text-slate-200">
                  <div class="rounded-2xl border border-white/10 bg-slate-900/80 p-4 font-mono text-sky-100 shadow-inner shadow-sky-500/10">
                    SCH brut = 0.4 × effet_arrivée + 0.3 × effet_départ + 0.2 × rétention_minutes + 0.1 × score_activité
                  </div>
                  <div class="rounded-2xl border border-white/10 bg-slate-900/80 p-4 font-mono text-sky-100 shadow-inner shadow-sky-500/10">
                    Score hype = SCH brut ÷ ln(1 + sessions)
                  </div>
                </div>
                <ul class="mt-4 space-y-2 text-sm text-slate-300">
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400"></span>
                    <span>L'effet d'arrivée mesure la variation de fréquentation dans les 3 minutes suivant ton arrivée.</span>
                  </li>
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                    <span>L'effet de départ détecte si la salle se vide ou reste pleine juste après ton départ.</span>
                  </li>
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2.5 w-2.5 rounded-full bg-amber-400"></span>
                    <span>La rétention compare la durée moyenne des autres quand tu es présent·e versus quand tu es absent·e.</span>
                  </li>
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2.5 w-2.5 rounded-full bg-fuchsia-400"></span>
                    <span>Le score d'activité valorise les minutes parlées sans sur-récompenser les très longues sessions.</span>
                  </li>
                </ul>
              </div>
            </details>
          </div>
          <div class="rounded-3xl bg-gradient-to-br from-sky-500/20 via-fuchsia-500/20 to-purple-500/20 p-[1px]">
            <div class="rounded-[1.45rem] bg-slate-950/85 p-6">
              <h2 class="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Comment grimper ?</h2>
              <ul class="mt-3 space-y-2 text-sm text-slate-200/90">
                <li class="flex items-start gap-3">
                  <span class="mt-1 h-2 w-2 rounded-full bg-sky-400"></span>
                  Fais grimper l'audience quand tu te connectes.
                </li>
                <li class="flex items-start gap-3">
                  <span class="mt-1 h-2 w-2 rounded-full bg-fuchsia-400"></span>
                  Reste actif dans la discussion, sans spam.
                </li>
                <li class="flex items-start gap-3">
                  <span class="mt-1 h-2 w-2 rounded-full bg-purple-400"></span>
                  Propulse de la bonne humeur et des vibes mémorables.
                </li>
              </ul>
            </div>
          </div>
        </aside>
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
