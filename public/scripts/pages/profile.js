import {
  Fragment,
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  ArrowLeft,
  RefreshCcw,
} from '../core/deps.js';
import {
  PROFILE_RANGE_PRESETS,
  VOICE_TRANSCRIPTION_PAGE_SIZE_OPTIONS,
  MESSAGE_PAGE_SIZE_OPTIONS,
} from '../core/constants.js';
import {
  normalizeProfileRange,
  toInputValue,
  parseRangeValue,
  formatRangeLabel,
} from '../utils/index.js';
import {
  ProfileIdentityCard,
  ProfileSummaryCards,
  ProfileActivityTimeline,
  DailyBreakdown,
  ProfileVoiceTranscriptionsCard,
  ProfileMessagesCard,
} from '../components/index.js';

const ProfilePage = ({ params, onNavigateHome, onUpdateRange }) => {
  const userId = typeof params?.userId === 'string' && params.userId.trim().length > 0 ? params.userId.trim() : null;
  const [range, setRange] = useState(() => normalizeProfileRange(params ?? {}));
  const [draftSince, setDraftSince] = useState(() => toInputValue(range.sinceMs));
  const [draftUntil, setDraftUntil] = useState(() => toInputValue(range.untilMs));
  const [formError, setFormError] = useState('');
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const previousUserRef = useRef(userId);

  useEffect(() => {
    const userChanged = previousUserRef.current !== userId;
    previousUserRef.current = userId;
    setRange((prev) => {
      const fallback = userChanged ? {} : prev || {};
      const normalized = normalizeProfileRange(params ?? {}, fallback);
      if (prev && normalized.sinceMs === prev.sinceMs && normalized.untilMs === prev.untilMs) {
        return prev;
      }
      return normalized;
    });
  }, [params?.since, params?.until, userId]);

  useEffect(() => {
    setDraftSince(toInputValue(range.sinceMs));
    setDraftUntil(toInputValue(range.untilMs));
  }, [range.sinceMs, range.untilMs]);

  useEffect(() => {
    if (!userId) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }

    const sinceMs = range.sinceMs;
    const untilMs = range.untilMs;
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
      return undefined;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));

    const fetchProfile = async () => {
      try {
        const query = new URLSearchParams();
        query.set('since', String(Math.floor(sinceMs)));
        query.set('until', String(Math.floor(untilMs)));
        const response = await fetch(`/api/users/${encodeURIComponent(userId)}/profile?${query.toString()}`, {
          signal: controller?.signal,
        });
        if (!response.ok) {
          let message = "Impossible de récupérer le profil demandé.";
          let shouldClear = false;
          try {
            const body = await response.json();
            if (body?.message) {
              message = body.message;
            }
          } catch (error) {
            // ignore JSON parsing errors
          }
          if (response.status === 404) {
            shouldClear = true;
            message = 'Profil introuvable sur cette période.';
          }
          const error = new Error(message);
          error.clearData = shouldClear;
          throw error;
        }

        const payload = await response.json();
        setState({ status: 'success', data: payload, error: null });
      } catch (error) {
        if (error && typeof error === 'object' && error.name === 'AbortError') {
          return;
        }
        const message = error instanceof Error && error.message
          ? error.message
          : 'Impossible de récupérer le profil demandé.';
        const shouldClear = Boolean(error && typeof error === 'object' && error.clearData);
        setState((prev) => ({
          status: 'error',
          data: shouldClear ? null : prev.data,
          error: message,
        }));
      }
    };

    fetchProfile();
    return () => controller?.abort();
  }, [userId, range.sinceMs, range.untilMs, refreshNonce]);

  const handleBack = useCallback(
    (event) => {
      event?.preventDefault?.();
      if (typeof onNavigateHome === 'function') {
        onNavigateHome();
      }
    },
    [onNavigateHome],
  );

  const handlePresetClick = useCallback(
    (durationMs) => {
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return;
      }
      const nowMs = Date.now();
      const nextUntil = nowMs;
      const nextSince = Math.max(0, nextUntil - durationMs);
      setRange({ sinceMs: nextSince, untilMs: nextUntil });
      setDraftSince(toInputValue(nextSince));
      setDraftUntil(toInputValue(nextUntil));
      setFormError('');
      if (typeof onUpdateRange === 'function' && userId) {
        onUpdateRange(userId, nextSince, nextUntil);
      }
    },
    [onUpdateRange, userId],
  );

  const handleApplyRange = useCallback(
    (event) => {
      event?.preventDefault?.();
      const sinceMs = parseRangeValue(draftSince);
      const untilMs = parseRangeValue(draftUntil);
      if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
        setFormError('Merci de renseigner deux dates valides.');
        return;
      }
      if (untilMs <= sinceMs) {
        setFormError('La date de fin doit être postérieure à la date de début.');
        return;
      }
      setFormError('');
      setRange({ sinceMs, untilMs });
      setDraftSince(toInputValue(sinceMs));
      setDraftUntil(toInputValue(untilMs));
      if (typeof onUpdateRange === 'function' && userId) {
        onUpdateRange(userId, sinceMs, untilMs);
      }
    },
    [draftSince, draftUntil, onUpdateRange, userId],
  );

  const handleRefresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const isLoading = state.status === 'loading';
  const errorMessage = state.status === 'error' ? state.error : null;
  const data = state.data;
  const activeRange = data?.range ?? range;
  const activeDuration = Number.isFinite(range.untilMs) && Number.isFinite(range.sinceMs)
    ? Math.abs(range.untilMs - range.sinceMs)
    : null;

  return html`
    <${Fragment}>
      <div class="flex items-center justify-between">
        <button
          type="button"
          onClick=${handleBack}
          class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
        >
          <${ArrowLeft} class="h-4 w-4" aria-hidden="true" />
          Retour
        </button>
        ${userId
          ? html`<span class="text-xs uppercase tracking-[0.35em] text-slate-400">ID ${userId}</span>`
          : null}
      </div>

      ${!userId
        ? html`<section class="mt-6 space-y-4 rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-xl shadow-slate-950/40 backdrop-blur-xl">
            <h1 class="text-3xl font-semibold text-white">Profil introuvable</h1>
            <p class="text-sm text-slate-300">Sélectionne un utilisateur depuis la page d'accueil pour afficher ses statistiques.</p>
            <button
              type="button"
              onClick=${handleBack}
              class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              <${ArrowLeft} class="h-4 w-4" aria-hidden="true" />
              Retour à l'accueil
            </button>
          </section>`
        : html`
            <div class="mt-6 grid grid-cols-1 gap-8">
              <${ProfileIdentityCard} profile=${data?.profile ?? null} userId=${userId} />

              <section class="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
                <div class="flex flex-col gap-6">
                  <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-[0.35em] text-indigo-200/80">Période analysée</p>
                      <h2 class="text-2xl font-semibold text-white">Filtrer l'activité</h2>
                      <p class="text-sm text-slate-300">${formatRangeLabel(range.sinceMs, range.untilMs)}</p>
                    </div>
                    <button
                      type="button"
                      onClick=${handleRefresh}
                      class=${[
                        'inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold transition',
                        'bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white',
                        isLoading ? 'opacity-60' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled=${isLoading}
                    >
                      <${RefreshCcw} class=${`h-4 w-4 ${isLoading ? 'animate-spin text-indigo-200' : ''}`} aria-hidden="true" />
                      Actualiser
                    </button>
                  </div>

                  <form class="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]" onSubmit=${handleApplyRange}>
                    <label class="flex flex-col gap-2 text-sm text-slate-200">
                      <span>Depuis</span>
                      <input
                        type="datetime-local"
                        value=${draftSince}
                        onInput=${(event) => setDraftSince(event.currentTarget.value)}
                        class="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white shadow-inner shadow-black/20 focus:border-fuchsia-300 focus:outline-none focus:ring-1 focus:ring-fuchsia-300"
                        required
                      />
                    </label>
                    <label class="flex flex-col gap-2 text-sm text-slate-200">
                      <span>Jusqu'à</span>
                      <input
                        type="datetime-local"
                        value=${draftUntil}
                        onInput=${(event) => setDraftUntil(event.currentTarget.value)}
                        class="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white shadow-inner shadow-black/20 focus:border-fuchsia-300 focus:outline-none focus:ring-1 focus:ring-fuchsia-300"
                        required
                      />
                    </label>
                    <div class="flex items-end">
                      <button
                        type="submit"
                        class="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-fuchsia-400/60 bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/30 hover:text-white"
                      >
                        Appliquer
                      </button>
                    </div>
                  </form>

                  <div class="flex flex-wrap gap-3 text-xs">
                    ${PROFILE_RANGE_PRESETS.map((preset) => {
                      const isActive = activeDuration != null && Math.abs(activeDuration - preset.durationMs) <= 60 * 1000;
                      const classes = [
                        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold transition',
                        isActive
                          ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-white'
                          : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white',
                      ].join(' ');
                      return html`<button
                        key=${preset.label}
                        type="button"
                        class=${classes}
                        onClick=${() => handlePresetClick(preset.durationMs)}
                      >
                        ${preset.label}
                        <span class="sr-only">${preset.description}</span>
                      </button>`;
                    })}
                  </div>

                  ${formError
                    ? html`<p class="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-100">${formError}</p>`
                    : null}
                </div>
              </section>

              ${errorMessage
                ? html`<div class="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100 shadow-lg shadow-rose-900/30">${errorMessage}</div>`
                : null}

              ${isLoading && !data
                ? html`<div class="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    <${RefreshCcw} class="h-4 w-4 animate-spin text-indigo-200" aria-hidden="true" />
                    Chargement du profil…
                  </div>`
                : null}

              ${data
                ? html`
                    <${ProfileSummaryCards} stats=${data.stats} />
                    <${ProfileActivityTimeline}
                      range=${activeRange}
                      presenceSegments=${data.presenceSegments}
                      speakingSegments=${data.speakingSegments}
                      messageEvents=${data.messageEvents}
                    />
                    <${DailyBreakdown}
                      range=${activeRange}
                      presenceSegments=${data.presenceSegments}
                      speakingSegments=${data.speakingSegments}
                      messageEvents=${data.messageEvents}
                    />
                    <${ProfileVoiceTranscriptionsCard} userId=${userId} />
                    <${ProfileMessagesCard} messageEvents=${data.messageEvents} />
                  `
                : null}
            </div>
          `}
    </${Fragment}>
  `;
};

export { ProfilePage };
