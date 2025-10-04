import {
  Fragment,
  html,
  useCallback,
  useEffect,
  useMemo,
  useState,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  X,
  RefreshCcw,
  Search,
} from '../core/deps.js';
import { MemberAvatar } from '../components/index.js';
import { formatDateTimeLabel } from '../utils/index.js';

const MEMBERS_PAGE_SIZE = 24;

const MembersPage = ({ onViewProfile, backendAvailable = true, backendOffline = false }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setCursorHistory([null]);
    setPageIndex(0);
  }, [searchTerm]);

  const currentCursor = useMemo(() => {
    if (cursorHistory.length === 0) {
      return null;
    }
    const index = Math.min(Math.max(pageIndex, 0), cursorHistory.length - 1);
    return cursorHistory[index] ?? null;
  }, [cursorHistory, pageIndex]);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const loadMembers = async () => {
      if (!backendAvailable) {
        if (backendOffline) {
          setLoading(false);
          setError('Les membres sont indisponibles tant que le serveur est hors ligne.');
          setMembers([]);
          setNextCursor(null);
        } else {
          setLoading(true);
          setError('');
        }
        return;
      }

      setLoading(true);
      setError('');
      setNextCursor(null);

      try {
        const params = new URLSearchParams();
        params.set('limit', String(MEMBERS_PAGE_SIZE));
        if (currentCursor) {
          params.set('after', currentCursor);
        }
        if (searchTerm) {
          params.set('search', searchTerm);
        }

        const response = await fetch(`/api/members?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = 'Impossible de récupérer les membres pour le moment.';
          try {
            const payload = await response.json();
            if (payload?.message) {
              message = String(payload.message);
            }
          } catch (parseError) {
            console.warn('Failed to parse member list error', parseError);
          }
          throw new Error(message);
        }

        const payload = await response.json();
        if (!isActive) {
          return;
        }

        const list = Array.isArray(payload?.members) ? payload.members : [];
        setMembers(list);

        const next =
          typeof payload?.nextCursor === 'string' && payload.nextCursor.trim().length > 0
            ? payload.nextCursor.trim()
            : null;
        setNextCursor(next);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        console.warn('Impossible de récupérer les membres', err);
        if (!isActive) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Impossible de récupérer les membres pour le moment.';
        setError(message);
        setMembers([]);
        setNextCursor(null);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    loadMembers();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [backendAvailable, backendOffline, currentCursor, searchTerm, refreshNonce]);

  const handleSearchSubmit = useCallback(
    (event) => {
      event.preventDefault();
      setSearchTerm(query.trim());
      setRefreshNonce((value) => value + 1);
    },
    [query],
  );

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setSearchTerm('');
    setRefreshNonce((value) => value + 1);
  }, []);

  const handleNextPage = useCallback(() => {
    if (!nextCursor) {
      return;
    }
    setCursorHistory((prev) => {
      const base = prev.slice(0, pageIndex + 1);
      base.push(nextCursor);
      return base;
    });
    setPageIndex((value) => value + 1);
  }, [nextCursor, pageIndex]);

  const handlePreviousPage = useCallback(() => {
    setPageIndex((value) => Math.max(0, value - 1));
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const handleOpenProfile = useCallback(
    (memberId) => {
      if (typeof onViewProfile === 'function' && memberId) {
        onViewProfile(memberId);
      }
    },
    [onViewProfile],
  );

  const appliedSearch = searchTerm.trim();
  const canGoPrevious = pageIndex > 0;
  const canGoNext = Boolean(nextCursor);
  const isInitialLoading = loading && members.length === 0 && !error;

  return html`
    <${Fragment}>
      <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-10 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
        <div class="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div class="space-y-4">
            <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Communauté</p>
            <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Les membres du serveur</h1>
            <p class="text-sm leading-relaxed text-slate-300">
              Explore la communauté de la Libre Antenne, découvre qui est présent et accède en un clic à leurs profils détaillés.
            </p>
          </div>
          <div class="flex flex-col gap-3 text-xs text-slate-200 sm:flex-row sm:items-center">
            <button
              type="button"
              class=${[
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition',
                loading ? 'border-white/10 bg-white/10 text-slate-300' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white',
              ].join(' ')}
              onClick=${handleRefresh}
              disabled=${loading}
            >
              <${RefreshCcw} class=${`h-3.5 w-3.5 ${loading ? 'animate-spin text-indigo-200' : ''}`} aria-hidden="true" />
              Actualiser
            </button>
          </div>
        </div>
      </section>

      <section class="space-y-6">
        <form class="relative" onSubmit=${handleSearchSubmit}>
          <label class="sr-only" for="member-search">Rechercher un membre</label>
          <div class="relative flex items-center">
            <span class="pointer-events-none absolute left-4 text-slate-400">
              <${Search} class="h-4 w-4" aria-hidden="true" />
            </span>
            <input
              id="member-search"
              type="search"
              value=${query}
              onInput=${(event) => setQuery(event.currentTarget.value)}
              placeholder="Rechercher par pseudo ou nom d'utilisateur"
              class="w-full rounded-3xl border border-white/10 bg-slate-950/60 py-3 pl-11 pr-12 text-sm text-white shadow-inner shadow-black/30 placeholder:text-slate-500 focus:border-fuchsia-300 focus:outline-none focus:ring-1 focus:ring-fuchsia-300"
              autocomplete="off"
            />
            ${query
              ? html`<button
                  type="button"
                  class="absolute right-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  onClick=${handleClearSearch}
                  aria-label="Effacer la recherche"
                >
                  <${X} class="h-4 w-4" aria-hidden="true" />
                </button>`
              : null}
          </div>
        </form>

        ${appliedSearch
          ? html`<p class="text-xs text-slate-400">Résultats pour <span class="font-semibold text-white">“${appliedSearch}”</span>.</p>`
          : null}

        ${error
          ? html`<div class="rounded-3xl border border-rose-400/40 bg-rose-500/10 px-6 py-6 text-sm text-rose-100 shadow-lg shadow-rose-900/30">
              <p>${error}</p>
              <button
                type="button"
                class="mt-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-white/20"
                onClick=${handleRefresh}
              >
                Réessayer
                <${RefreshCcw} class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>`
          : null}

        ${isInitialLoading
          ? html`<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              ${Array.from({ length: 6 }).map((_, index) =>
                html`<div key=${`skeleton-${index}`} class="h-36 animate-pulse rounded-3xl border border-white/5 bg-white/5"></div>`,
              )}
            </div>`
          : null}

        ${!error && members.length > 0
          ? html`<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              ${members.map((member) => {
                const id = typeof member?.id === 'string' ? member.id : '';
                const displayName = (() => {
                  if (typeof member?.displayName === 'string' && member.displayName.trim().length > 0) {
                    return member.displayName.trim();
                  }
                  if (typeof member?.nickname === 'string' && member.nickname.trim().length > 0) {
                    return member.nickname.trim();
                  }
                  if (typeof member?.username === 'string' && member.username.trim().length > 0) {
                    return member.username.trim();
                  }
                  return 'Anonyme';
                })();
                const username = typeof member?.username === 'string' && member.username.trim().length > 0
                  ? member.username.trim()
                  : null;
                const joinedMs = typeof member?.joinedAt === 'string' ? Date.parse(member.joinedAt) : NaN;
                const roleList = Array.isArray(member?.roles)
                  ? member.roles
                      .filter((role) => role && typeof role.id === 'string' && typeof role.name === 'string')
                      .slice(0, 3)
                  : [];
                const remainingRoles = Array.isArray(member?.roles) ? Math.max(member.roles.length - roleList.length, 0) : 0;
                const isBot = Boolean(member?.isBot);

                return html`<article
                  key=${id || displayName}
                  class="flex h-full cursor-pointer flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-slate-950/40 backdrop-blur transition hover:border-white/20 hover:bg-white/10"
                  role="button"
                  tabIndex="0"
                  onClick=${() => handleOpenProfile(id)}
                  onKeyDown=${(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleOpenProfile(id);
                    }
                  }}
                >
                  <div class="flex items-center gap-4">
                    <${MemberAvatar} member=${member} />
                    <div class="min-w-0">
                      <h2 class="truncate text-lg font-semibold text-white">${displayName}</h2>
                      ${username
                        ? html`<p class="truncate text-sm text-slate-400">@${username}</p>`
                        : null}
                    </div>
                  </div>
                  <div class="space-y-3 text-xs text-slate-300">
                    <div class="flex items-center gap-2">
                      <${CalendarDays} class="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      <span>Arrivé(e) : ${Number.isFinite(joinedMs) ? formatDateTimeLabel(joinedMs, { includeSeconds: false }) : 'Date inconnue'}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      ${roleList.length > 0
                        ? roleList.map((role) =>
                            html`<span key=${`${id}-role-${role.id}`} class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-200">
                              ${role.name}
                            </span>`,
                          )
                        : html`<span class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-slate-400">Sans rôle</span>`}
                      ${remainingRoles > 0
                        ? html`<span class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-200">+${remainingRoles}</span>`
                        : null}
                      ${isBot
                        ? html`<span class="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-200">
                            Bot
                            <${BadgeCheck} class="h-3 w-3" aria-hidden="true" />
                          </span>`
                        : null}
                    </div>
                  </div>
                  <div class="mt-auto"></div>
                </article>`;
              })}
            </div>`
          : null}

        ${!error && !isInitialLoading && members.length === 0
          ? html`<div class="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-slate-300">
              ${appliedSearch
                ? html`Aucun membre ne correspond à « ${appliedSearch} » pour le moment.`
                : 'Aucun membre à afficher pour l’instant.'}
            </div>`
          : null}

        <div class="flex flex-col items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-200 sm:flex-row">
          <div class="flex items-center gap-3">
            <span class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
              Page
            </span>
            <span class="text-lg font-semibold text-white">${pageIndex + 1}</span>
            ${loading
              ? html`<span class="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-transparent"></span>`
              : null}
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class=${[
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition',
                canGoPrevious && !loading
                  ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white'
                  : 'border-white/5 bg-white/5 text-slate-500',
              ].join(' ')}
              onClick=${handlePreviousPage}
              disabled=${!canGoPrevious || loading}
            >
              <${ArrowLeft} class="h-3.5 w-3.5" aria-hidden="true" />
              Précédent
            </button>
            <button
              type="button"
              class=${[
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition',
                canGoNext && !loading
                  ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100 hover:bg-fuchsia-500/30 hover:text-white'
                  : 'border-white/5 bg-white/5 text-slate-500',
              ].join(' ')}
              onClick=${handleNextPage}
              disabled=${!canGoNext || loading}
            >
              Suivant
              <${ArrowRight} class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </${Fragment}>
  `;
};

export { MembersPage };
