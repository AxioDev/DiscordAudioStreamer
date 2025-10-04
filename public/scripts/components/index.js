import {
  html,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Chart,
  THREE,
  Activity,
  AlertCircle,
  AudioLines,
  BadgeCheck,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  Coffee,
  Coins,
  CreditCard,
  Headphones,
  Menu,
  Mic,
  MicOff,
  MonitorPlay,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  Shirt,
  Search,
  Sparkles,
  Truck,
  Users,
  Wallet,
  MessageSquare,
  Video,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from '../core/deps.js';
import {
  STATUS_LABELS,
  TALK_WINDOW_OPTIONS,
  HOUR_MS,
  HOURS_IN_DAY,
} from '../core/constants.js';
import {
  formatDuration,
  formatRelative,
  trimSegments,
  ensureOpenSegment,
  closeOpenSegment,
  sortSegments,
  normalizeAnonymousSlot,
  formatDateTimeLabel,
  formatRangeLabel,
  formatDayLabel,
  mergeProfiles,
} from '../utils/index.js';

Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.color = '#e2e8f0';
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.25)';

const StatusBadge = ({ status, className = '' }) => {
  const config = STATUS_LABELS[status] ?? STATUS_LABELS.connecting;
  const rawLabel = typeof config.label === 'string' ? config.label : '';
  const trimmedLabel = rawLabel.trim();
  const srText = config.srLabel ?? (trimmedLabel ? trimmedLabel : 'Statut');
  return html`
    <div
      class=${`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium backdrop-blur ${config.ring} ${className}`}
      aria-label=${srText}
    >
      <span class=${`h-2.5 w-2.5 rounded-full shadow-md ${config.dot}`}></span>
      <span class="flex items-center gap-1">
        ${config.Icon ? html`<${config.Icon} class="h-4 w-4" aria-hidden="true" />` : null}
        <span class="sr-only">${srText}</span>
        ${trimmedLabel
          ? html`<span aria-hidden="true">${rawLabel}</span>`
          : null}
      </span>
    </div>
  `;
};

const useSmoothReorder = (ids) => {
  const containerRef = useRef(null);
  const positionsRef = useRef(new Map());

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const elements = Array.from(container.querySelectorAll('[data-speaker-id]'));
    const nextPositions = new Map();

    for (const element of elements) {
      const id = element.getAttribute('data-speaker-id');
      if (!id) continue;
      nextPositions.set(id, element.getBoundingClientRect());
    }

    if (!prefersReducedMotion) {
      for (const element of elements) {
        const id = element.getAttribute('data-speaker-id');
        if (!id) continue;
        const previous = positionsRef.current.get(id);
        const current = nextPositions.get(id);
        if (!previous || !current) continue;
        const deltaX = previous.left - current.left;
        const deltaY = previous.top - current.top;
        if ((deltaX === 0 && deltaY === 0) || typeof element.animate !== 'function') continue;
        element.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: 'translate(0, 0)' },
          ],
          {
            duration: 1600,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          },
        );
      }
    }

    positionsRef.current = nextPositions;
  }, [ids.join('|')]);

  return containerRef;
};

const SpeakerCard = ({ speaker, now, cardId, onViewProfile }) => {
  const voiceState = speaker.voiceState ?? {};
  const isSpeaking = Boolean(speaker.isSpeaking);
  const duration = isSpeaking && speaker.startedAt ? formatDuration(now - speaker.startedAt) : null;
  const lastSpoke = !isSpeaking && speaker.lastSpokeAt ? formatRelative(speaker.lastSpokeAt, now) : null;

  const cardState = isSpeaking ? 'speaking' : 'idle';
  const cardAccentClass = isSpeaking
    ? 'border-fuchsia-400/60 bg-gradient-to-br from-indigo-500/20 via-slate-950 to-fuchsia-500/15'
    : 'border-white/10 bg-slate-950/75';

  const badgeConfig = (() => {
    if (isSpeaking) {
      return {
        srLabel: 'Intervention en cours',
        label: '',
        Icon: Activity,
        classes: 'bg-emerald-500 text-emerald-900',
        ping: true,
        dot: 'bg-emerald-800',
      };
    }
    if (voiceState.selfMute || voiceState.mute) {
      return {
        srLabel: 'Micro coupé',
        label: 'Muet',
        Icon: MicOff,
        classes: 'bg-slate-200/90 text-slate-900',
        ping: false,
        dot: 'bg-slate-900/70',
      };
    }
    if (voiceState.selfDeaf || voiceState.deaf) {
      return {
        srLabel: 'Casque coupé',
        label: 'Casque',
        Icon: Headphones,
        classes: 'bg-slate-200/90 text-slate-900',
        ping: false,
        dot: 'bg-slate-900/70',
      };
    }
    return {
      srLabel: 'À l’écoute',
      label: 'Écoute',
      Icon: Headphones,
      classes: 'bg-slate-200/90 text-slate-900',
      ping: false,
      dot: 'bg-slate-900/70',
    };
  })();

  const secondaryInfo = (() => {
    if (isSpeaking) {
      return {
        Icon: Activity,
        text: duration ? `Depuis ${duration}` : null,
        srLabel: duration
          ? `Intervention en cours depuis ${duration}`
          : 'Intervention en cours',
      };
    }
    if (lastSpoke) {
      return {
        Icon: Clock3,
        text: lastSpoke,
        srLabel: `Dernière intervention ${lastSpoke}`,
      };
    }
    return {
      Icon: Clock3,
      text: 'Pas encore intervenu',
      srLabel: 'Pas encore intervenu',
    };
  })();

  const { Icon: SecondaryIcon, text: secondaryText, srLabel: secondarySrLabel } = secondaryInfo;

  const voiceBadges = [];
  if (voiceState.selfMute || voiceState.mute) {
    voiceBadges.push({ key: 'mute', label: 'Muet', Icon: MicOff });
  }
  if (voiceState.selfDeaf || voiceState.deaf) {
    voiceBadges.push({ key: 'deaf', label: 'Casque off', Icon: Headphones });
  }
  if (voiceState.streaming) {
    voiceBadges.push({ key: 'stream', label: 'Partage', Icon: MonitorPlay });
  }
  if (voiceState.video) {
    voiceBadges.push({ key: 'video', label: 'Caméra', Icon: Video });
  }

  const safeDisplayName = typeof speaker.displayName === 'string' && speaker.displayName.trim().length
    ? speaker.displayName.trim()
    : 'Intervenant anonyme';
  const safeUsername = typeof speaker.username === 'string' && speaker.username.trim().length
    ? speaker.username.trim()
    : 'anonyme';

  const handleProfileClick = () => {
    if (typeof onViewProfile === 'function') {
      onViewProfile(speaker.id ?? cardId);
    }
  };

  const initials = safeDisplayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return html`
    <article
      class=${`speaker-card group relative overflow-hidden rounded-3xl border ${cardAccentClass} shadow-xl shadow-indigo-900/30 transition duration-300 hover:border-fuchsia-400/60 hover:shadow-glow`}
      data-state=${cardState}
      data-speaker-id=${cardId ?? speaker.id}
    >
      <div class="absolute -right-14 -top-14 h-32 w-32 rounded-full bg-fuchsia-500/40 blur-3xl transition-opacity duration-300 group-hover:opacity-100"></div>
      <button
        type="button"
        class="relative z-10 flex w-full items-center gap-5 rounded-3xl px-5 py-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        onClick=${handleProfileClick}
      >
        <div class="relative h-20 w-20 flex-shrink-0">
          <div class="absolute inset-0 rounded-full bg-gradient-to-br from-fuchsia-500 via-indigo-400 to-sky-400 opacity-60 blur-xl transition group-hover:opacity-90"></div>
          ${speaker.avatar
            ? html`<img
                src=${speaker.avatar}
                alt=${`Avatar de ${safeDisplayName}`}
                class="relative h-20 w-20 rounded-full border-2 border-white/70 object-cover shadow-lg shadow-fuchsia-900/30"
                loading="lazy"
              />`
            : html`<div class="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/70 bg-white/10 text-xl font-semibold text-white shadow-inner shadow-slate-950/40">
                ${initials || '??'}
              </div>`}
          <div
            class=${`absolute -bottom-1 -right-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider shadow-lg ${badgeConfig.classes}`}
          >
            <span class="relative flex h-2 w-2">
              <span
                class=${`absolute inline-flex h-full w-full rounded-full ${
                  badgeConfig.ping ? 'animate-ping bg-emerald-200 opacity-75' : 'bg-slate-400/70 opacity-0'
                }`}
              ></span>
              <span class=${`relative inline-flex h-2 w-2 rounded-full ${badgeConfig.dot}`}></span>
            </span>
            <span class="sr-only">${badgeConfig.srLabel}</span>
            <${badgeConfig.Icon} class="h-3.5 w-3.5" aria-hidden="true" />
            ${badgeConfig.label && badgeConfig.label.trim()
              ? html`<span aria-hidden="true">${badgeConfig.label}</span>`
              : null}
          </div>
        </div>
        <div class="relative flex flex-1 flex-col gap-2">
          <div class="flex flex-wrap items-baseline gap-2">
            <h3 class="text-2xl font-semibold text-white">${safeDisplayName}</h3>
            <span class="text-sm text-slate-300">@${safeUsername}</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs text-slate-200">
            <span class="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 backdrop-blur">
              <${SecondaryIcon} class="h-3.5 w-3.5" aria-hidden="true" />
              ${secondaryText ? html`<span>${secondaryText}</span>` : null}
              <span class="sr-only">${secondarySrLabel}</span>
            </span>
          </div>
          ${voiceBadges.length
            ? html`<div class="flex flex-wrap items-center gap-2 text-slate-200/80">
                ${voiceBadges.map(
                  ({ key, label, Icon }) => html`<span
                    key=${key}
                    class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-slate-100 backdrop-blur transition hover:bg-white/15"
                    title=${label}
                    aria-label=${label}
                  >
                    <${Icon} class="h-3.5 w-3.5" aria-hidden="true" />
                    <span aria-hidden="true">${label}</span>
                  </span>`,
                )}
              </div>`
            : null}
        </div>
      </button>
    </article>
  `;
};
const SpeakersSection = ({ speakers, now, onViewProfile }) => {
  const speakerIds = useMemo(() => speakers.map((speaker) => String(speaker.id ?? '')), [speakers]);
  const containerRef = useSmoothReorder(speakerIds);

  if (!speakers.length) {
    return html`
      <div class="mt-6 flex flex-col items-center justify-center gap-4 rounded-3xl border border-white/10 bg-black/40 px-8 py-12 text-center text-sm text-slate-300 backdrop-blur">
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-fuchsia-200">
          <${Users} class="h-7 w-7" aria-hidden="true" />
        </div>
        <p class="max-w-sm text-base text-slate-300">
          Aucun participant n'est connecté au salon vocal pour le moment. Dès qu’une personne rejoindra, elle apparaîtra ici.
        </p>
      </div>
    `;
  }

  return html`
    <div ref=${containerRef} class="mt-6 grid gap-6 sm:grid-cols-2">
      ${speakers.map((speaker) =>
        html`<${SpeakerCard}
          key=${speaker.id}
          speaker=${speaker}
          now=${now}
          cardId=${speaker.id}
          onViewProfile=${onViewProfile}
        />`,
      )}
    </div>
  `;
};

const DailyActivityChart = ({ history, now, isHistoryLoading }) => {
  const scrollContainerRef = useRef(null);
  const currentBinRef = useRef(null);
  const setCurrentBinRef = useCallback((element) => {
    currentBinRef.current = element ?? null;
  }, []);

  const chart = useMemo(() => {
    const effectiveNow = Number.isFinite(now) ? now : Date.now();
    const anchor = new Date(effectiveNow);
    anchor.setHours(0, 0, 0, 0);
    const dayStart = anchor.getTime();
    const dayEnd = dayStart + HOURS_IN_DAY * HOUR_MS;

    const bins = Array.from({ length: HOURS_IN_DAY }, (_, index) => {
      const start = dayStart + index * HOUR_MS;
      return {
        index,
        start,
        end: start + HOUR_MS,
        duration: 0,
      };
    });

    const segments = Array.isArray(history) ? history : [];
    for (const segment of segments) {
      if (!segment) continue;
      const rawStart = Number.isFinite(segment.start) ? segment.start : effectiveNow;
      const rawEndCandidate = Number.isFinite(segment.end) ? segment.end : effectiveNow;
      const safeEnd = Math.max(rawEndCandidate, rawStart);
      const normalizedStart = Math.max(rawStart, dayStart);
      const normalizedEnd = Math.min(safeEnd, dayEnd);
      if (Number.isNaN(normalizedStart) || Number.isNaN(normalizedEnd) || normalizedEnd <= normalizedStart) {
        continue;
      }

      for (const bin of bins) {
        if (bin.start >= normalizedEnd) {
          break;
        }
        if (bin.end <= normalizedStart) {
          continue;
        }
        const overlapStart = Math.max(normalizedStart, bin.start);
        const overlapEnd = Math.min(normalizedEnd, bin.end);
        if (overlapEnd > overlapStart) {
          bin.duration += overlapEnd - overlapStart;
        }
      }
    }

    const binsWithMeta = bins.map((bin) => {
      const hourLabel = new Date(bin.start)
        .toLocaleTimeString('fr-FR', { hour: '2-digit' })
        .replace(/\s*[hH]$/, '');
      return {
        ...bin,
        label: `${hourLabel}h`,
        isCurrent: effectiveNow >= bin.start && effectiveNow < bin.end,
        isPast: effectiveNow >= bin.end,
      };
    });

    const totalDuration = binsWithMeta.reduce((acc, bin) => acc + bin.duration, 0);
    const maxDuration = binsWithMeta.reduce((acc, bin) => Math.max(acc, bin.duration), 0);
    const peakBin = binsWithMeta.reduce((best, bin) => {
      if (bin.duration <= 0) {
        return best;
      }
      if (!best || bin.duration > best.duration) {
        return bin;
      }
      return best;
    }, null);

    return {
      bins: binsWithMeta,
      totalDuration,
      maxDuration,
      peakBin,
    };
  }, [history, now]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const container = scrollContainerRef.current;
    const current = currentBinRef.current;
    if (!container || !current) return;

    const containerRect = container.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    const currentCenter = currentRect.left - containerRect.left + container.scrollLeft + currentRect.width / 2;
    const targetScrollLeft = currentCenter - container.clientWidth / 2;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const clampedTarget = Math.max(0, Math.min(targetScrollLeft, maxScroll));

    if (Math.abs(container.scrollLeft - clampedTarget) <= 1) {
      return;
    }

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) {
      container.scrollLeft = clampedTarget;
    } else {
      container.scrollTo({ left: clampedTarget, behavior: 'smooth' });
    }
  }, [chart]);

  const totalLabel = chart.totalDuration > 0 ? formatDuration(chart.totalDuration) : '0s';
  const peakLabel = chart.peakBin ? `${formatDuration(chart.peakBin.duration)} vers ${chart.peakBin.label}` : null;
  const hasData = chart.maxDuration > 0;

  return html`
    <section class="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-8 shadow-xl shadow-slate-950/50 backdrop-blur-xl">
      <div class="pointer-events-none absolute -left-24 top-[-6rem] h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -right-24 bottom-[-8rem] h-64 w-64 rounded-full bg-fuchsia-500/20 blur-[110px]"></div>
      <div class="relative flex flex-col gap-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-2">
            <p class="text-xs uppercase tracking-[0.35em] text-indigo-200/80">Chronologie</p>
            <h2 class="text-2xl font-semibold text-white">Activité vocale par heure</h2>
            <p class="text-sm text-slate-300">
              Observe la répartition des interventions tout au long de la journée actuelle. Le graphique se met à jour en temps réel.
            </p>
          </div>
          <div class="flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-xs text-slate-300">
            <span>
              <span class="font-semibold text-white">${totalLabel}</span>
              de prise de parole aujourd'hui
            </span>
            ${peakLabel
              ? html`<span>Pic : ${peakLabel}</span>`
              : html`<span>Aucune activité détectée pour le moment</span>`}
          </div>
        </div>
        <div class="relative">
          ${
            isHistoryLoading
              ? html`<div
                  role="status"
                  aria-live="polite"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-slate-950/80 backdrop-blur-sm"
                >
                  <div class="h-10 w-10 animate-spin rounded-full border-2 border-indigo-300/70 border-t-transparent"></div>
                  <p class="text-sm font-medium text-slate-200/90">
                    Chargement des activités vocales…
                  </p>
                  <span class="sr-only">Chargement des activités vocales</span>
                </div>`
              : null
          }
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-950/80 to-transparent"></div>
          <div ref=${scrollContainerRef} class="overflow-x-auto">
            <div class="flex min-w-[48rem] items-end gap-2 pb-6 sm:gap-3 md:gap-4">
              ${chart.bins.map((bin) => {
                const rawPercent = chart.maxDuration > 0 ? (bin.duration / chart.maxDuration) * 100 : 0;
                const heightPercent = bin.duration > 0 ? Math.max(6, Math.round(rawPercent)) : 0;
                const barStyle = `height: ${heightPercent}%`;
                const barClass = [
                  'w-full rounded-t-2xl transition-all duration-700 ease-out',
                  bin.duration > 0
                    ? 'bg-gradient-to-t from-indigo-500/70 via-fuchsia-500/60 to-fuchsia-400/80 shadow-[0_0_18px_rgba(236,72,153,0.35)]'
                    : 'bg-white/10',
                  bin.isCurrent ? 'ring-2 ring-fuchsia-300/80 shadow-[0_0_24px_rgba(236,72,153,0.45)]' : '',
                  !bin.isPast && !bin.isCurrent ? 'opacity-40' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const tooltip = bin.duration > 0 ? `≈ ${formatDuration(bin.duration)}` : 'Aucune activité';
                return html`
                  <div
                    key=${bin.start}
                    ref=${bin.isCurrent ? setCurrentBinRef : null}
                    class="flex min-w-[2.5rem] flex-1 flex-col items-center gap-2 text-xs text-slate-300"
                  >
                    <div
                      class="flex h-48 w-full items-end rounded-2xl bg-white/5 p-1"
                      title=${tooltip}
                      aria-label=${`${bin.label} · ${tooltip}`}
                    >
                      <div class=${barClass} style=${barStyle}></div>
                    </div>
                    <span class=${`font-semibold ${bin.isCurrent ? 'text-white' : 'text-slate-200'}`}>${bin.label}</span>
                  </div>
                `;
              })}
            </div>
          </div>
          ${hasData
            ? null
            : html`<p class="mt-4 text-center text-sm text-slate-400">
                Les premières prises de parole de la journée apparaîtront ici dès qu'une voix sera détectée.
              </p>`}
        </div>
      </div>
    </section>
  `;
};

const RealTimeTalkChart = ({ history, speakers, now, selectedWindowMinutes, onWindowChange, onViewProfile }) => {
  const windowMs = selectedWindowMinutes * 60 * 1000;

  const speakerIndex = useMemo(() => {
    const map = new Map();
    for (const speaker of speakers) {
      if (speaker?.id) {
        map.set(speaker.id, speaker);
      }
    }
    return map;
  }, [speakers]);

  const chartData = useMemo(() => {
    const cutoff = now - windowMs;
    const totals = new Map();
    const profiles = new Map();

    for (const segment of history) {
      if (!segment || !segment.id) continue;
      const start = Number.isFinite(segment.start) ? segment.start : now;
      const end = Number.isFinite(segment.end) ? segment.end : now;
      if (end <= cutoff) {
        continue;
      }
      const effectiveStart = Math.max(start, cutoff);
      const effectiveEnd = Math.min(end, now);
      if (effectiveEnd <= effectiveStart) {
        continue;
      }
      const duration = effectiveEnd - effectiveStart;
      totals.set(segment.id, (totals.get(segment.id) ?? 0) + duration);
      profiles.set(segment.id, mergeProfiles(profiles.get(segment.id), segment.profile));
    }

    const items = Array.from(totals.entries()).map(([id, duration]) => {
      const profile = profiles.get(id) ?? speakerIndex.get(id) ?? {};
      const display = (profile.displayName && profile.displayName.trim())
        ? profile.displayName.trim()
        : (profile.username && profile.username.trim())
        ? profile.username.trim()
        : `Intervenant ${String(id).slice(-4).padStart(4, '0')}`;
      return {
        id,
        label: display,
        avatar: profile.avatar ?? null,
        duration,
      };
    });

    items.sort((a, b) => b.duration - a.duration);

    const totalDuration = items.reduce((acc, item) => acc + item.duration, 0);
    const maxDuration = items.length ? Math.max(...items.map((item) => item.duration)) : 0;

    return {
      items,
      totalDuration,
      maxDuration,
    };
  }, [history, now, windowMs, speakerIndex]);

  const minutesLabel = selectedWindowMinutes > 1 ? `${selectedWindowMinutes} dernières minutes` : 'Dernière minute';
  const totalLabel = chartData.totalDuration > 0 ? formatDuration(chartData.totalDuration) : '0s';
  const activeCount = chartData.items.length;
  const topSpeaker = chartData.items[0];

  const percentageFor = (value) => {
    if (!chartData.totalDuration || !Number.isFinite(value) || chartData.totalDuration <= 0) {
      return '0%';
    }
    const ratio = Math.max(0, Math.min(1, value / chartData.totalDuration));
    return `${Math.round(ratio * 100)}%`;
  };

  return html`
    <section class="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/90 via-indigo-950/60 to-fuchsia-950/40 p-8 shadow-xl shadow-slate-950/50 backdrop-blur-xl">
      <div class="pointer-events-none absolute -left-20 top-[-8rem] h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -right-24 bottom-[-10rem] h-72 w-72 rounded-full bg-fuchsia-500/25 blur-[120px]"></div>
      <div class="relative flex flex-col gap-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-2">
            <p class="text-xs uppercase tracking-[0.35em] text-indigo-200/80">Analyse temps réel</p>
            <h2 class="text-2xl font-semibold text-white">Temps de parole cumulés</h2>
            <p class="text-sm text-slate-300">Visualise la répartition des interventions vocales sur la période sélectionnée.</p>
          </div>
          <div class="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200">
            <label class="flex items-center gap-2">
              <span class="text-xs uppercase tracking-[0.3em] text-indigo-200">Fenêtre</span>
              <select
                class="rounded-full border border-white/20 bg-slate-900/60 px-3 py-1 text-sm font-medium text-white shadow-inner shadow-slate-950/40 focus:border-fuchsia-400 focus:outline-none"
                value=${String(selectedWindowMinutes)}
                onChange=${(event) => {
                  const minutes = Number(event.currentTarget.value);
                  if (Number.isFinite(minutes) && minutes > 0) {
                    onWindowChange(minutes);
                  }
                }}
              >
                ${TALK_WINDOW_OPTIONS.map((option) => html`<option key=${option} value=${String(option)}>${option} min</option>`)}
              </select>
            </label>
            <div class="flex flex-col text-xs text-slate-300">
              <span class="font-semibold text-white">${minutesLabel}</span>
              <span>${activeCount} intervenant${activeCount > 1 ? 's' : ''}</span>
            </div>
            <div class="flex flex-col text-xs text-slate-300">
              <span class="font-semibold text-white">Temps cumulé</span>
              <span>${totalLabel}</span>
            </div>
            ${topSpeaker
              ? html`<div class="flex flex-col text-xs text-slate-300">
                  <span class="font-semibold text-white">Top voix</span>
                  <button
                    type="button"
                    class="mt-1 inline-flex w-max items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-white transition hover:border-fuchsia-400/40 hover:bg-fuchsia-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    onClick=${() => {
                      if (typeof onViewProfile === 'function') {
                        onViewProfile(topSpeaker.id);
                      }
                    }}
                  >
                    ${topSpeaker.label}
                  </button>
                </div>`
              : null}
          </div>
        </div>

        ${chartData.items.length
          ? html`
              <div class="relative space-y-4">
                ${chartData.items.map((item) => {
                  const rawWidth = chartData.maxDuration > 0 ? Math.round((item.duration / chartData.maxDuration) * 100) : 0;
                  const widthPercent = item.duration > 0 ? Math.max(4, rawWidth) : 0;
                  const durationLabel = formatDuration(item.duration);
                  return html`
                    <button
                      key=${item.id}
                      type="button"
                      class="group flex w-full flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                      onClick=${() => {
                        if (typeof onViewProfile === 'function') {
                          onViewProfile(item.id);
                        }
                      }}
                    >
                      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div class="flex items-center gap-3">
                          ${item.avatar
                            ? html`<img src=${item.avatar} alt="Avatar ${item.label}" class="h-10 w-10 rounded-full border border-white/20 object-cover" />`
                            : html`<div class="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-sm font-semibold uppercase text-slate-200">
                                ${item.label.slice(0, 2)}
                              </div>`}
                          <div>
                            <p class="text-sm font-semibold text-white">${item.label}</p>
                            <p class="text-xs text-slate-300">${durationLabel} · ${percentageFor(item.duration)}</p>
                          </div>
                        </div>
                        <div class="text-sm font-semibold text-indigo-200">${percentageFor(item.duration)}</div>
                      </div>
                      <div class="h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          class="h-full rounded-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400 shadow-lg shadow-fuchsia-500/40 transition-all duration-500"
                          style=${{ width: `${widthPercent}%` }}
                        ></div>
                      </div>
                    </button>
                  `;
                })}
              </div>
            `
          : html`
              <div class="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/20 bg-black/30 px-8 py-12 text-center text-sm text-slate-300">
                <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-indigo-200">
                  <${Clock3} class="h-7 w-7" aria-hidden="true" />
                </div>
                <p class="max-w-sm text-base text-slate-200">
                  Aucun temps de parole enregistré sur la période. Reviens plus tard ou réduis la fenêtre d'analyse.
                </p>
              </div>
            `}
      </div>
    </section>
  `;
};

const ListenerTrendCard = ({ stats, now }) => {
  const gradientId = useMemo(
    () => `listener-gradient-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  const { history, count } = stats || {};
  const currentCount = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;

  const chart = useMemo(() => {
    const sanitized = Array.isArray(history)
      ? history
          .map((entry) => {
            const timestamp = Number(entry?.timestamp ?? entry?.time ?? entry?.ts);
            const countValue = Number(entry?.count);
            if (!Number.isFinite(timestamp) || !Number.isFinite(countValue)) {
              return null;
            }
            return {
              timestamp,
              count: Math.max(0, Math.round(countValue)),
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.timestamp - b.timestamp)
      : [];

    if (sanitized.length === 0) {
      const fallbackTimestamp = Number.isFinite(now) ? now : Date.now();
      return {
        points: [],
        polylinePoints: '',
        areaPath: '',
        width: 800,
        height: 220,
        maxCount: currentCount,
        average: currentCount,
        start: fallbackTimestamp,
        end: fallbackTimestamp,
        firstEntry: null,
        lastEntry: null,
      };
    }

    const effectiveNow = Number.isFinite(now) ? now : Date.now();
    const windowMs = 6 * HOUR_MS;
    const cutoff = effectiveNow - windowMs;
    let filtered = sanitized.filter((entry) => entry.timestamp >= cutoff);

    if (!filtered.length) {
      filtered = sanitized.slice(-Math.min(240, sanitized.length));
    }

    if (filtered.length === 1) {
      filtered = [
        filtered[0],
        { timestamp: filtered[0].timestamp + 1, count: filtered[0].count },
      ];
    }

    const width = 800;
    const height = 220;
    const firstEntry = filtered[0];
    const lastEntry = filtered[filtered.length - 1];
    const range = lastEntry.timestamp - firstEntry.timestamp;
    const maxCount = filtered.reduce((acc, item) => Math.max(acc, item.count), 0);
    const totalCount = filtered.reduce((acc, item) => acc + item.count, 0);
    const average = filtered.length > 0 ? totalCount / filtered.length : 0;

    const points = filtered.map((item, index) => {
      const ratio = range > 0 ? (item.timestamp - firstEntry.timestamp) / range : filtered.length <= 1 ? 0 : index / (filtered.length - 1);
      const x = Math.round(ratio * width);
      const yRatio = maxCount > 0 ? item.count / maxCount : 0;
      const y = Math.round(height - yRatio * height);
      return { x, y, ...item };
    });

    const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
    const areaPath = ['M 0', height, ...points.map((point) => `L ${point.x} ${point.y}`), `L ${width} ${height}`, 'Z'].join(' ');

    return {
      points,
      polylinePoints,
      areaPath,
      width,
      height,
      maxCount,
      average,
      start: firstEntry.timestamp,
      end: lastEntry.timestamp,
      firstEntry,
      lastEntry,
    };
  }, [history, now, currentCount]);

  const peakCount = Math.max(chart.maxCount ?? 0, currentCount);
  const averageLabel = chart.average > 0
    ? chart.average
        .toFixed(1)
        .replace(/\.0$/, '')
        .replace('.', ',')
    : '0';
  const rangeMs = chart.end > chart.start ? chart.end - chart.start : 0;
  const windowLabel = rangeMs > 0 ? formatDuration(rangeMs) : 'instantané';
  const lastUpdateLabel = chart.lastEntry ? formatRelative(chart.lastEntry.timestamp, now) : 'à l’instant';
  const rangeStartLabel = chart.firstEntry
    ? new Date(chart.firstEntry.timestamp).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const rangeEndLabel = chart.lastEntry
    ? new Date(chart.lastEntry.timestamp).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const hasChartData = chart.points.length > 0 && chart.polylinePoints;
  const sampleLabel = chart.points.length === 1 ? 'point' : 'points';
  const windowDescription = windowLabel === 'instantané' ? 'instantanée' : windowLabel;

  return html`
    <section class="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/90 via-indigo-950/60 to-fuchsia-950/40 p-8 shadow-xl shadow-slate-950/50 backdrop-blur-xl">
      <div class="pointer-events-none absolute -left-24 top-[-6rem] h-56 w-56 rounded-full bg-indigo-500/15 blur-3xl"></div>
      <div class="pointer-events-none absolute -right-24 bottom-[-8rem] h-72 w-72 rounded-full bg-fuchsia-500/20 blur-[120px]"></div>
      <div class="relative flex flex-col gap-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-2">
            <p class="text-xs uppercase tracking-[0.35em] text-indigo-200/80">Audience</p>
            <h2 class="text-2xl font-semibold text-white">Écoutes du flux en direct</h2>
            <p class="text-sm text-slate-300">
              Visualise l’évolution du nombre d’auditeurs en temps réel sur les dernières heures.
            </p>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-200">
              <div class="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-indigo-200/80">
                <${Headphones} class="h-4 w-4" aria-hidden="true" />
                En cours
              </div>
              <p class="mt-2 text-3xl font-semibold text-white">${currentCount}</p>
              <p class="text-xs text-slate-300">Mis à jour ${lastUpdateLabel}</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-200">
              <span class="text-xs uppercase tracking-[0.3em] text-indigo-200/80">Pic observé</span>
              <p class="mt-2 text-3xl font-semibold text-white">${peakCount}</p>
              <p class="text-xs text-slate-300">Fenêtre ${windowDescription}</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-200">
              <span class="text-xs uppercase tracking-[0.3em] text-indigo-200/80">Moyenne</span>
              <p class="mt-2 text-3xl font-semibold text-white">${averageLabel}</p>
              <p class="text-xs text-slate-300">Échantillon ${chart.points.length} ${sampleLabel}</p>
            </div>
          </div>
        </div>

        ${hasChartData
          ? html`
              <div class="relative rounded-3xl border border-white/10 bg-black/30 p-6">
                <svg
                  class="h-56 w-full"
                  viewBox=${`0 0 ${chart.width} ${chart.height}`}
                  preserveAspectRatio="none"
                  role="presentation"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id=${gradientId} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stop-color="rgba(129, 140, 248, 0.8)" />
                      <stop offset="100%" stop-color="rgba(236, 72, 153, 0.05)" />
                    </linearGradient>
                  </defs>
                  ${chart.areaPath
                    ? html`<path d=${chart.areaPath} fill=${`url(#${gradientId})`} stroke="none" opacity="0.8" />`
                    : null}
                  <polyline
                    points=${chart.polylinePoints}
                    fill="none"
                    stroke="url(#${gradientId})"
                    stroke-width="6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity="0.9"
                  ></polyline>
                </svg>
                <div class="mt-4 flex items-center justify-between text-xs text-slate-300">
                  <span>${rangeStartLabel ?? '—'}</span>
                  <span>${rangeEndLabel ?? '—'}</span>
                </div>
              </div>`
          : html`
              <p class="mt-6 rounded-3xl border border-dashed border-white/15 bg-black/20 p-6 text-sm text-slate-300">
                Les premières écoutes seront visibles ici dès qu’un auditeur se connectera au flux.
              </p>`}
      </div>
    </section>
  `;
};

const AnonymousBooth = ({ slot, now }) => {
  const [session, setSession] = useState(() => ({
    token: null,
    alias: null,
    expiresAt: null,
    stage: 'idle',
    error: null,
    info: null,
    micGranted: false,
    wsConnected: false,
    level: 0,
  }));

  const tokenRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const audioContextRef = useRef(null);
  const wsRef = useRef(null);
  const levelLastUpdateRef = useRef(0);
  const mountedRef = useRef(true);

  const ensurePrimaryStreamPlayback = useCallback(async () => {
    const audio = document.querySelector('audio[data-role="primary-stream"]');
    if (!audio) {
      return;
    }

    try {
      audio.muted = false;
      if (audio.paused) {
        await audio.play();
      }
    } catch (error) {
      console.warn('Impossible de maintenir la lecture du flux principal', error);
    }
  }, []);

  const stopAudioProcessing = useCallback(async () => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (error) {
        console.warn('Impossible de déconnecter le processeur audio', error);
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      try {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
      } catch (error) {
        console.warn('Impossible de stopper la capture micro', error);
      }
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch (error) {
        console.warn("Impossible de fermer l'AudioContext", error);
      }
      audioContextRef.current = null;
    }

    if (mountedRef.current) {
      setSession((prev) => ({ ...prev, micGranted: false, level: 0 }));
    }
  }, []);

  const cleanup = useCallback(
    async ({ notifyServer = false, reason = null } = {}) => {
      const socket = wsRef.current;
      if (socket) {
        wsRef.current = null;
        try {
          socket.onopen = null;
          socket.onclose = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.close();
        } catch (error) {
          console.warn('Impossible de fermer la connexion WebSocket anonyme', error);
        }
      }

      await stopAudioProcessing();
      await ensurePrimaryStreamPlayback();

      const tokenValue = tokenRef.current;
      tokenRef.current = null;

      if (notifyServer && tokenValue) {
        try {
          await fetch('/anonymous-slot', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenValue }),
          });
        } catch (error) {
          console.warn('Impossible de libérer le micro anonyme', error);
        }
      }

      if (mountedRef.current) {
        setSession((prev) => ({
          ...prev,
          token: null,
          alias: null,
          expiresAt: null,
          stage: 'idle',
          wsConnected: false,
          micGranted: false,
          level: 0,
          info: reason ?? prev.info,
          error: null,
        }));
      }
    },
    [stopAudioProcessing, ensurePrimaryStreamPlayback],
  );

  useEffect(() => () => {
    mountedRef.current = false;
    cleanup({ notifyServer: Boolean(tokenRef.current), reason: 'Micro libéré.' });
  }, [cleanup]);

  useEffect(() => {
    tokenRef.current = session.token;
  }, [session.token]);

  useEffect(() => {
    if (!session.token) {
      return;
    }

    if (!slot?.occupied) {
      cleanup({ notifyServer: false, reason: 'Micro libéré automatiquement.' });
      return;
    }

    if (slot.alias && session.alias && slot.alias !== session.alias) {
      cleanup({ notifyServer: false, reason: "Le micro est désormais occupé par quelqu'un d'autre." });
    }
  }, [slot?.occupied, slot?.alias, session.token, session.alias, cleanup]);

  useEffect(() => {
    if (!session.token || !session.alias) {
      return;
    }
    if (!slot?.alias || slot.alias !== session.alias) {
      return;
    }
    if (slot.expiresAt && slot.expiresAt !== session.expiresAt) {
      setSession((prev) => ({ ...prev, expiresAt: slot.expiresAt }));
    }
  }, [slot?.expiresAt, slot?.alias, session.alias, session.token, session.expiresAt]);

  const prepareMicrophone = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Ton navigateur ne supporte pas l'enregistrement audio.");
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      throw new Error('Accès au micro refusé. Autorise ton micro pour intervenir.');
    }

    mediaStreamRef.current = stream;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext indisponible sur ce navigateur.');
    }

    const audioContext = new AudioContextClass({ sampleRate: 48000 });
    audioContextRef.current = audioContext;
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn("Impossible de reprendre l'AudioContext", error);
      }
    }

    await ensurePrimaryStreamPlayback();

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(1024, 1, 1);
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    processor.connect(gain);
    gain.connect(audioContext.destination);
    source.connect(processor);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer?.getChannelData?.(0);
      const output = event.outputBuffer?.getChannelData?.(0);
      if (!input) {
        return;
      }

      if (output) {
        for (let i = 0; i < output.length; i++) {
          output[i] = 0;
        }
      }

      const frameLength = input.length;
      const buffer = new ArrayBuffer(frameLength * 4);
      const view = new DataView(buffer);
      let sumSquares = 0;
      for (let i = 0; i < frameLength; i++) {
        const sample = input[i];
        sumSquares += sample * sample;
        const clamped = Math.max(-1, Math.min(1, sample));
        const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        view.setInt16(i * 4, intSample, true);
        view.setInt16(i * 4 + 2, intSample, true);
      }

      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(buffer);
        } catch (error) {
          console.warn("Impossible d'envoyer un chunk audio anonyme", error);
        }
      }

      const level = frameLength > 0 ? Math.sqrt(sumSquares / frameLength) : 0;
      const nowPerf = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (nowPerf - levelLastUpdateRef.current > 120) {
        levelLastUpdateRef.current = nowPerf;
        if (mountedRef.current) {
          setSession((prev) => ({ ...prev, level }));
        }
      }
    };

    if (mountedRef.current) {
      setSession((prev) => ({ ...prev, micGranted: true }));
    }
  }, [ensurePrimaryStreamPlayback]);

  const connectWebSocket = useCallback(() => {
    const tokenValue = tokenRef.current;
    if (!tokenValue) {
      if (mountedRef.current) {
        setSession((prev) => ({ ...prev, stage: 'idle', error: 'Session anonyme introuvable.', info: null }));
      }
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/anonymous-stream?token=${encodeURIComponent(tokenValue)}`,
    );
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;

    socket.onopen = () => {
      if (!mountedRef.current) {
        return;
      }
      ensurePrimaryStreamPlayback().catch((error) => {
        console.warn('Impossible de reprendre le flux principal après connexion WS', error);
      });
      setSession((prev) => ({
        ...prev,
        stage: 'streaming',
        wsConnected: true,
        info: 'Tu es en direct. Reste cool et anonyme.',
        error: null,
      }));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'terminated') {
          cleanup({ notifyServer: false, reason: payload.message || 'Session terminée.' });
        }
      } catch (error) {
        console.warn('Message WebSocket anonyme invalide', error);
      }
    };

    socket.onerror = (event) => {
      console.warn('Erreur WebSocket anonyme', event);
      if (mountedRef.current) {
        setSession((prev) => ({ ...prev, error: 'Connexion instable avec le bot.', wsConnected: false }));
      }
    };

    socket.onclose = (event) => {
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      stopAudioProcessing();
      ensurePrimaryStreamPlayback().catch((error) => {
        console.warn('Impossible de reprendre le flux principal après fermeture du micro', error);
      });
      tokenRef.current = null;
      if (mountedRef.current) {
        setSession((prev) => ({
          ...prev,
          token: null,
          alias: null,
          expiresAt: null,
          stage: 'idle',
          wsConnected: false,
          micGranted: false,
          level: 0,
          info: event?.reason || 'Connexion au micro fermée.',
        }));
      }
    };
  }, [cleanup, stopAudioProcessing, ensurePrimaryStreamPlayback]);

  const handleClaim = async () => {
    if (session.stage !== 'idle') {
      return;
    }

    if (mountedRef.current) {
      setSession((prev) => ({
        ...prev,
        stage: 'claiming',
        error: null,
        info: 'Réservation du micro en cours…',
      }));
    }

    let payload = {};
    try {
      const response = await fetch('/anonymous-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Le micro est déjà pris. Réessaie dans un instant.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Impossible de réserver le micro anonyme.';
      if (mountedRef.current) {
        setSession((prev) => ({ ...prev, stage: 'idle', error: message, info: null }));
      }
      return;
    }

    tokenRef.current = payload?.token || null;
    if (!tokenRef.current) {
      if (mountedRef.current) {
        setSession((prev) => ({ ...prev, stage: 'idle', error: 'Réponse du serveur invalide.', info: null }));
      }
      return;
    }

    if (mountedRef.current) {
      setSession((prev) => ({
        ...prev,
        token: payload.token,
        alias: payload.alias || 'Anonyme',
        expiresAt: payload.expiresAt || null,
        stage: 'preparing',
        error: null,
        info: 'Activation du micro en cours…',
      }));
    }

    try {
      await prepareMicrophone();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible d'initialiser ton micro.";
      await cleanup({ notifyServer: true, reason: message });
      if (mountedRef.current) {
        setSession((prev) => ({ ...prev, error: message, stage: 'idle', info: null }));
      }
      return;
    }

    if (mountedRef.current) {
      setSession((prev) => ({ ...prev, stage: 'connecting', info: 'Connexion au bot…' }));
    }

    connectWebSocket();
  };

  const handleRelease = () => {
    cleanup({ notifyServer: true, reason: 'Micro libéré.' });
  };

  const isOwner = Boolean(session.token && session.alias && slot?.alias === session.alias);
  const slotTaken = Boolean(slot?.occupied && (!session.alias || slot.alias !== session.alias));
  const stage = session.stage;
  const isBusy = stage === 'claiming';
  const canCancel = stage === 'preparing' || stage === 'connecting';
  const expiresAt = isOwner ? session.expiresAt ?? slot?.expiresAt ?? null : slot?.expiresAt ?? null;
  const timeRemainingMs = expiresAt ? Math.max(0, expiresAt - now) : slot?.remainingMs ?? null;
  const timeRemainingLabel = timeRemainingMs ? formatDuration(timeRemainingMs) : null;
  const levelPercent = Math.min(100, Math.round(Math.min(1, session.level) * 100));

  return html`
    <section class="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <div class="pointer-events-none absolute -left-24 top-[-10rem] h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -right-24 bottom-[-8rem] h-72 w-72 rounded-full bg-fuchsia-500/20 blur-[120px]"></div>
      <div class="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="flex-1 space-y-4">
          <div class="flex flex-wrap items-center gap-3 text-[0.65rem] uppercase tracking-[0.35em] text-indigo-200">
            <span class="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-500/20 px-3 py-1 text-indigo-100">
              <${Mic} class="h-3.5 w-3.5" aria-hidden="true" />
              Micro anonyme
            </span>
            <span class="inline-flex items-center gap-1 text-[0.6rem] text-slate-300">
              <${ShieldCheck} class="h-3 w-3" aria-hidden="true" />
              <span>Identité masquée</span>
            </span>
          </div>
          <h2 class="text-2xl font-semibold text-white sm:text-3xl">Micro anonyme instantané</h2>
          <p class="text-sm text-slate-300">
            Réserve le slot, parle via le bot et reste totalement anonyme. Un seul micro secret à la fois.
          </p>

          ${slotTaken
            ? html`<div class="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <div class="flex items-center gap-2 text-slate-100">
                  <${Activity} class="h-4 w-4 text-fuchsia-200" aria-hidden="true" />
                  <span>${slot.alias ?? 'Anonyme'} est en direct</span>
                </div>
                <div class="flex items-center gap-2 text-[0.75rem] text-slate-300">
                  <${Clock3} class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>${timeRemainingLabel ? `Temps restant estimé : ${timeRemainingLabel}` : 'Temps restant : —'}</span>
                </div>
                ${slot.connectionPending
                  ? html`<p class="text-xs text-slate-300/80">
                      La connexion est en cours, le micro sera actif d’ici quelques secondes.
                    </p>`
                  : null}
              </div>`
            : null}

          ${session.info
            ? html`<div class="rounded-2xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
                ${session.info}
              </div>`
            : null}

          ${session.error
            ? html`<div class="flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <${AlertCircle} class="h-4 w-4" aria-hidden="true" />
                <span>${session.error}</span>
              </div>`
            : null}
        </div>

        <div class="w-full max-w-md rounded-2xl border border-white/10 bg-black/45 p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
          ${isOwner
            ? html`<div class="flex items-center justify-between rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                <span class="flex items-center gap-2">
                  <${ShieldCheck} class="h-4 w-4" aria-hidden="true" />
                  <span>Alias secret</span>
                </span>
                <span class="font-semibold text-emerald-200">${session.alias}</span>
              </div>`
            : null}

          ${isOwner && timeRemainingLabel
            ? html`<div class="mt-3 flex items-center justify-between rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-fuchsia-100">
                <span class="flex items-center gap-2">
                  <${Clock3} class="h-3.5 w-3.5" aria-hidden="true" />
                  Chrono
                </span>
                <span class="text-sm tracking-normal">${timeRemainingLabel}</span>
              </div>`
            : null}

          ${isOwner
            ? html`<div class="mt-4 space-y-4">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-[0.35em] text-slate-300">Niveau du micro</p>
                  <div class="mt-2 mic-meter">
                    <div class="mic-meter-bar" style=${{ width: `${levelPercent}%` }}></div>
                  </div>
                </div>
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/20 px-5 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2 focus:ring-offset-slate-950"
                  onClick=${handleRelease}
                >
                  Raccrocher
                </button>
              </div>`
            : isBusy
            ? html`<div class="flex flex-col gap-3">
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/10 px-5 py-2.5 text-sm font-semibold text-slate-200"
                  disabled
                >
                  <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-transparent"></span>
                  Réservation en cours…
                </button>
              </div>`
            : canCancel
            ? html`<div class="flex flex-col gap-3">
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/10 px-5 py-2.5 text-sm font-semibold text-slate-200"
                  disabled
                >
                  <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-transparent"></span>
                  Connexion au bot…
                </button>
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
                  onClick=${() => cleanup({ notifyServer: true, reason: 'Connexion annulée.' })}
                >
                  Annuler
                </button>
              </div>`
            : html`<div class="flex flex-col gap-3">
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-full border border-fuchsia-400/60 bg-fuchsia-500/20 px-5 py-2.5 text-sm font-semibold text-fuchsia-100 shadow-lg shadow-fuchsia-900/40 transition hover:bg-fuchsia-500/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick=${handleClaim}
                  disabled=${slotTaken}
                >
                  ${slotTaken ? 'Micro occupé' : 'Prendre la parole anonymement'}
                  ${!slotTaken ? html`<${Mic} class="h-4 w-4" aria-hidden="true" />` : null}
                </button>
                <p class="text-xs text-slate-400">
                  ${slotTaken
                    ? 'Attends la fin du passage actuel pour réserver à ton tour.'
                    : 'Ton intervention est routée via le bot : aucune trace, aucun pseudo.'}
                </p>
              </div>`}
        </div>
      </div>
    </section>
  `;
};

const PAYMENT_PROVIDERS = {
  stripe: {
    label: 'Stripe',
    helper: 'Cartes bancaires, Apple Pay et Google Pay.',
    accent:
      'border-indigo-400/50 bg-indigo-500/20 hover:bg-indigo-500/30 focus:ring-indigo-300',
    Icon: CreditCard,
  },
  paypal: {
    label: 'PayPal',
    helper: 'Compte PayPal ou carte via PayPal Checkout.',
    accent:
      'border-sky-400/50 bg-sky-500/20 hover:bg-sky-500/30 focus:ring-sky-300',
    Icon: Wallet,
  },
  coingate: {
    label: 'CoinGate',
    helper: 'Crypto, Lightning Network et virements SEPA.',
    accent:
      'border-emerald-400/50 bg-emerald-500/20 hover:bg-emerald-500/30 focus:ring-emerald-300',
    Icon: Coins,
  },
};

const MODERATION_SERVICES = [
  {
    id: 'mute-15m',
    title: 'Mute 15 minutes',
    price: '1,50\u00A0€',
    description: 'Coupe immédiatement le micro sans exclure la personne du salon.',
    accent: 'border-emerald-400/40 bg-emerald-500/10',
    categoryLabel: 'Option mute',
  },
  {
    id: 'ban-60s',
    title: 'Bannissement 60 secondes',
    price: '1,10\u00A0€',
    description: 'Un rappel express pour calmer les débordements immédiats.',
    accent: 'border-emerald-400/40 bg-emerald-500/10',
    categoryLabel: 'Option bannissement',
  },
  {
    id: 'ban-5m',
    title: 'Bannissement 5 minutes',
    price: '2,20\u00A0€',
    description: 'Idéal pour faire retomber la pression et rétablir le calme.',
    accent: 'border-sky-400/40 bg-sky-500/10',
    categoryLabel: 'Option bannissement',
  },
  {
    id: 'ban-10m',
    title: 'Bannissement 10 minutes',
    price: '3,30\u00A0€',
    description: 'Parfait pour rappeler les règles sans exclure définitivement.',
    accent: 'border-indigo-400/40 bg-indigo-500/10',
    categoryLabel: 'Option bannissement',
  },
  {
    id: 'ban-1h',
    title: 'Bannissement 1 heure',
    price: '11,00\u00A0€',
    description: 'Temps suffisant pour protéger la discussion et consulter l’équipe.',
    accent: 'border-fuchsia-400/40 bg-fuchsia-500/10',
    categoryLabel: 'Option bannissement',
  },
  {
    id: 'ban-24h',
    title: 'Bannissement 24 heures',
    price: '22,00\u00A0€',
    description: 'Mesure ferme pour les récidivistes ou incidents graves.',
    accent: 'border-amber-400/40 bg-amber-500/10',
    categoryLabel: 'Option bannissement',
  },
  {
    id: 'ban-1w',
    title: 'Bannissement 1 semaine',
    price: '55,00\u00A0€',
    description: 'Sanction longue durée pour comportements incompatibles avec la vibe.',
    accent: 'border-rose-400/40 bg-rose-500/10',
    categoryLabel: 'Option bannissement',
  },
];

const readCheckoutFeedbackFromHash = () => {
  try {
    const hash = window.location.hash || '';
    const [path = '', query = ''] = hash.split('?');
    if (!path.toLowerCase().includes('boutique')) {
      return null;
    }

    const params = new URLSearchParams(query);
    const status = (params.get('checkout') || '').toLowerCase();
    if (!status) {
      return null;
    }

    let type = 'info';
    let message = '';
    if (status === 'success') {
      type = 'success';
      message = 'Merci pour ton soutien ! La commande est bien prise en compte.';
    } else if (status === 'cancelled') {
      type = 'info';
      message = 'Paiement annulé. Tu peux réessayer quand tu veux.';
    } else {
      type = 'error';
      message = 'Une erreur est survenue lors du paiement. Aucun débit n’a été effectué.';
    }

    if (typeof window.history?.replaceState === 'function') {
      window.history.replaceState(null, '', '#/boutique');
    }

    return { type, message };
  } catch (error) {
    console.warn('Impossible de lire le statut de paiement', error);
    return null;
  }
};

const ShopProductCard = ({
  product,
  checkoutState,
  onCheckout,
  canCheckout = true,
  isOffline = false,
}) => {
  const providerSections = (product.providers || [])
    .map((provider) => {
      const details = PAYMENT_PROVIDERS[provider];
      if (!details) {
        return null;
      }
      const isPending =
        checkoutState.pending &&
        checkoutState.productId === product.id &&
        checkoutState.provider === provider;
      const ButtonIcon = details.Icon;
      const disabled = !canCheckout || isPending;
      const label = isPending
        ? 'Redirection…'
        : disabled
        ? isOffline
          ? 'Indisponible'
          : 'Connexion…'
        : `Payer avec ${details.label}`;
      return html`
        <div key=${`${product.id}-${provider}`} class="flex flex-col gap-1">
          <button
            type="button"
            class=${`flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${details.accent}`}
            onClick=${() => onCheckout(product.id, provider)}
            disabled=${disabled}
          >
            ${label}
            <${ButtonIcon} class="h-4 w-4" aria-hidden="true" />
          </button>
          <span class="text-xs text-slate-400">${details.helper}</span>
        </div>
      `;
    })
    .filter(Boolean);

  return html`
    <article class="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
      <div class="flex items-center justify-between">
        <span class="text-4xl" aria-hidden="true">${product.emoji || '🛒'}</span>
        ${product.highlight
          ? html`<span class="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-fuchsia-100">
              <${Sparkles} class="h-3 w-3" aria-hidden="true" />
              <span class="tracking-normal">Coup de cœur</span>
            </span>`
          : null}
      </div>
      ${Array.isArray(product.badges) && product.badges.length > 0
        ? html`<div class="mt-4 flex flex-wrap gap-2">
            ${product.badges.map((badge, index) =>
              html`<span
                key=${`${product.id}-badge-${index}`}
                class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-slate-200/90"
              >
                <${BadgeCheck} class="h-3 w-3 text-emerald-300" aria-hidden="true" />
                <span class="tracking-normal">${badge}</span>
              </span>`
            )}
          </div>`
        : null}
      <h3 class="mt-5 text-xl font-semibold text-white">${product.name}</h3>
      <p class="mt-2 text-sm leading-relaxed text-slate-300">${product.description}</p>
      <div class=${`mt-4 rounded-3xl border border-white/10 px-5 py-4 ${product.accentSoft || 'bg-white/10'}`}>
        <p class="text-3xl font-bold text-white">${product.price?.formatted || '—'}</p>
        <p class="text-xs uppercase tracking-[0.35em] text-slate-300">TTC</p>
      </div>
      <ul class="mt-5 space-y-2 text-sm text-slate-200">
        ${(product.includes || []).map((item, index) =>
          html`<li key=${`${product.id}-feature-${index}`} class="flex items-start gap-2">
            <${ShieldCheck} class="mt-0.5 h-4 w-4 text-indigo-300" aria-hidden="true" />
            <span>${item}</span>
          </li>`
        )}
      </ul>
      <p class="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <${Truck} class="h-4 w-4" aria-hidden="true" />
        ${product.shippingEstimate || 'Livraison estimée communiquée après commande'}
      </p>
      <div class="mt-6 flex flex-col gap-3">
        ${providerSections.length > 0
          ? providerSections
          : html`<div class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-center text-sm text-slate-300">
              Paiements bientôt disponibles pour ce produit.
            </div>`}
      </div>
      ${checkoutState.error && checkoutState.productId === product.id
        ? html`<p class="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            ${checkoutState.error}
          </p>`
        : null}
    </article>
  `;
};


const MemberAvatar = ({ member }) => {
  const displayName = typeof member?.displayName === 'string' ? member.displayName : '';
  const username = typeof member?.username === 'string' ? member.username : '';
  const nickname = typeof member?.nickname === 'string' ? member.nickname : '';
  const sourceName = displayName || nickname || username;
  const initials = sourceName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase?.() ?? '')
    .join('') || 'LA';

  if (typeof member?.avatarUrl === 'string' && member.avatarUrl) {
    return html`<img
      src=${member.avatarUrl}
      alt=${sourceName || 'Avatar membre'}
      class="h-14 w-14 rounded-2xl border border-white/10 object-cover shadow-inner shadow-black/30"
      loading="lazy"
      decoding="async"
    />`;
  }

  return html`<div
    class="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/40 via-purple-500/30 to-fuchsia-500/30 text-base font-semibold text-white shadow-inner shadow-black/30"
    aria-hidden="true"
  >
    ${initials}
  </div>`;
};

const MEMBERS_PAGE_SIZE = 24;


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

const AudioPlayer = ({
  streamInfo,
  audioKey,
  status,
  canPlayStream = true,
  isServerOffline = false,
}) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.75);
  const lastVolumeRef = useRef(0.75);
  const playbackUnavailable = !canPlayStream;
  const awaitingStream = playbackUnavailable && !isServerOffline;
  const showErrorState = hasError || (playbackUnavailable && isServerOffline);

  const isIgnorablePlayError = (error) => {
    if (!error) return false;
    const name = error.name || '';
    return name === 'AbortError' || name === 'NotAllowedError';
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handlePlaying = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setHasError(false);
    };

    const handleWaiting = () => {
      if (!audio.paused) {
        setIsLoading(true);
      }
    };

    const handlePause = () => {
      setIsPlaying(false);
      setIsLoading(false);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleError = () => {
      setHasError(true);
      setIsPlaying(false);
      setIsLoading(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('canplaythrough', handleCanPlay);
    audio.addEventListener('stalled', handleWaiting);
    audio.addEventListener('suspend', handleWaiting);
    audio.addEventListener('error', handleError);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('canplaythrough', handleCanPlay);
      audio.removeEventListener('stalled', handleWaiting);
      audio.removeEventListener('suspend', handleWaiting);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!canPlayStream) {
      if (!audio.paused) {
        audio.pause();
      }
      audio.removeAttribute('src');
      setIsPlaying(false);
      setIsLoading(awaitingStream);
      return;
    }

    setHasError(false);

    if (!audio.paused) {
      audio.pause();
    }
    audio.src = streamInfo.path;
    audio.load();
    setIsLoading(true);

    return () => {
      audio.pause();
    };
  }, [audioKey, streamInfo.path, canPlayStream, isServerOffline, awaitingStream]);

  const clearBrowserCaches = async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map((cacheName) =>
            caches.delete(cacheName).catch((error) => {
              console.warn(`Impossible de supprimer le cache ${cacheName}`, error);
              return false;
            }),
          ),
        );
      } catch (error) {
        console.warn('Impossible de vider les caches du navigateur', error);
      }
    }

    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((registration) =>
            registration.unregister().catch((error) => {
              console.warn('Impossible de désinscrire un service worker', error);
              return false;
            }),
          ),
        );
      } catch (error) {
        console.warn('Impossible de récupérer les service workers', error);
      }
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!canPlayStream) {
      return;
    }

    if (hasError) {
      setHasError(false);
    }

    if (isPlaying) {
      audio.pause();
      return;
    }

    setIsLoading(true);

    try {
      await clearBrowserCaches();
    } catch (error) {
      console.warn('Impossible de vider le cache du navigateur avant la lecture', error);
    }

    try {
      audio.currentTime = 0;
      audio.load();
    } catch (error) {
      console.warn('Impossible de recharger la source audio', error);
    }

    try {
      await audio.play();
    } catch (error) {
      if (isIgnorablePlayError(error)) {
        setIsLoading(false);
        return;
      }
      console.error('Impossible de lancer la lecture', error);
      setHasError(true);
      setIsLoading(false);
    }
  };

  const handleRetry = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!canPlayStream) {
      return;
    }

    setHasError(false);
    setIsLoading(true);

    try {
      await clearBrowserCaches();
    } catch (error) {
      console.warn('Impossible de vider le cache du navigateur avant la relance', error);
    }

    if (!audio.paused) {
      audio.pause();
    }
    audio.src = streamInfo.path;

    try {
      audio.currentTime = 0;
      audio.load();
    } catch (error) {
      console.warn('Impossible de recharger la source audio avant la relance', error);
    }

    try {
      await audio.play();
    } catch (error) {
      if (isIgnorablePlayError(error)) {
        setIsLoading(false);
        return;
      }
      console.error('La relance du flux a échoué', error);
      setHasError(true);
      setIsLoading(false);
    }
  };

  const handleVolumeChange = (event) => {
    const value = Number(event?.target?.value ?? 0) / 100;
    const nextVolume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    setVolume(nextVolume);
    if (nextVolume === 0) {
      setIsMuted(true);
    } else {
      lastVolumeRef.current = nextVolume;
      if (isMuted) {
        setIsMuted(false);
      }
    }
  };

  const toggleMute = () => {
    if (isMuted || volume === 0) {
      const restored = lastVolumeRef.current > 0 ? lastVolumeRef.current : 0.5;
      setVolume(restored);
      setIsMuted(false);
    } else {
      lastVolumeRef.current = volume > 0 ? volume : lastVolumeRef.current;
      setIsMuted(true);
    }
  };

  const renderVolumeIcon = () => {
    if (showErrorState) {
      return html`<${AlertCircle} class="h-5 w-5" aria-hidden="true" />`;
    }

    if (isMuted || volume === 0) {
      return html`<${VolumeX} class="h-5 w-5" aria-hidden="true" />`;
    }

    if (volume < 0.4) {
      return html`<${Volume} class="h-5 w-5" aria-hidden="true" />`;
    }

    if (volume < 0.75) {
      return html`<${Volume1} class="h-5 w-5" aria-hidden="true" />`;
    }

    return html`<${Volume2} class="h-5 w-5" aria-hidden="true" />`;
  };

  const statusConfig = STATUS_LABELS[status] ?? STATUS_LABELS.connecting;
  const statusText = showErrorState
    ? isServerOffline
      ? 'Flux indisponible (serveur hors ligne).'
      : 'Flux indisponible. Relance le flux pour réessayer.'
    : awaitingStream || isLoading
    ? 'Connexion au flux…'
    : isPlaying
    ? 'Lecture en cours'
    : 'En pause';

  return html`
    <div class="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
      <div class="pointer-events-none absolute -left-32 top-[-8rem] h-72 w-72 rounded-full bg-fuchsia-500/25 blur-3xl"></div>
      <div class="pointer-events-none absolute -right-36 bottom-[-10rem] h-80 w-80 rounded-full bg-indigo-500/25 blur-[110px]"></div>
      <div class="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
          <div class="flex items-center gap-5">
            <button
              type="button"
              class="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-fuchsia-500 via-indigo-500 to-sky-400 text-white shadow-lg shadow-fuchsia-900/40 transition focus:outline-none focus:ring-2 focus:ring-fuchsia-300 focus:ring-offset-2 focus:ring-offset-slate-950 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label=${isPlaying ? 'Mettre le flux en pause' : 'Lancer la lecture du flux'}
              onClick=${togglePlay}
              disabled=${playbackUnavailable || (isLoading && !isPlaying && !hasError)}
            >
              ${
                showErrorState
                  ? html`<${AlertCircle} class="h-7 w-7" aria-hidden="true" />`
                  : isLoading && !isPlaying
                  ? html`<span class="h-6 w-6 animate-spin rounded-full border-2 border-white/70 border-t-transparent"></span>`
                  : isPlaying
                  ? html`<${Pause} class="h-7 w-7" aria-hidden="true" />`
                  : html`<${Play} class="h-7 w-7" aria-hidden="true" />`
              }
            </button>
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-3">
                <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-emerald-100">
                  <span class="relative flex h-1.5 w-1.5">
                    <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-100 opacity-75"></span>
                    <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
                  </span>
                  <${Activity} class="h-3 w-3" aria-hidden="true" />
                  <span class="sr-only">Flux audio actif</span>
                </span>
                ${(() => {
                  const statusLabel = statusConfig.label ?? statusConfig.srLabel;
                  if (!statusLabel) {
                    return null;
                  }
                  if (statusLabel.trim().toLowerCase() === 'en direct') {
                    return null;
                  }
                  return html`
                    <span class="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[0.7rem] font-medium uppercase tracking-[0.35em] text-slate-200">
                      ${statusConfig.Icon
                        ? html`<span class="flex items-center gap-1">
                              <${statusConfig.Icon} class="h-3.5 w-3.5" aria-hidden="true" />
                              <span>${statusLabel}</span>
                            </span>`
                        : statusLabel}
                    </span>
                  `;
                })()}
                ${
                  isPlaying
                    ? html`<div class="audio-wave flex items-end gap-1 text-fuchsia-200">
                        <span class="h-4 bg-current"></span>
                        <span class="h-6 bg-current"></span>
                        <span class="h-5 bg-current"></span>
                        <span class="h-7 bg-current"></span>
                      </div>`
                    : null
                }
              </div>
              <p class="text-sm text-slate-200">
                Libre Antenne diffuse le salon vocal en continu. Branche-toi et profite du chaos.
              </p>
              <p class=${`text-xs font-medium ${showErrorState ? 'text-rose-200' : 'text-slate-300'}`}>${statusText}</p>
            </div>
          </div>
        </div>
        <div class="relative w-full max-w-md rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur">
          <div class="flex flex-wrap items-center justify-between gap-2 text-[0.65rem] uppercase tracking-[0.35em] text-slate-300">
            <span class="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-fuchsia-100">
              ${streamInfo.format === 'mp3' ? 'MP3' : 'OPUS'}
            </span>
            <span class="truncate text-[0.6rem] text-slate-400">Endpoint : ${streamInfo.path}</span>
          </div>
          <div class="mt-4 flex items-center gap-3">
            <button
              type="button"
              class="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300 focus:ring-offset-2 focus:ring-offset-slate-950"
              aria-label=${isMuted || volume === 0 ? 'Activer le son' : 'Couper le son'}
              onClick=${toggleMute}
            >
              ${renderVolumeIcon()}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value=${Math.round(volume * 100)}
              onInput=${handleVolumeChange}
              class="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-fuchsia-400 focus:outline-none focus:ring-0"
              aria-label="Volume"
            />
            <span class="w-12 text-right text-xs text-slate-300">${Math.round(volume * 100)}%</span>
          </div>
        </div>
      </div>
      ${
        showErrorState
          ? html`<div class="relative mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              <div class="flex items-center gap-2 font-semibold">
                <${AlertCircle} class="h-5 w-5" aria-hidden="true" />
                ${playbackUnavailable ? 'Flux indisponible (serveur hors ligne)' : 'Flux indisponible'}
              </div>
              ${
                playbackUnavailable
                  ? html`<p class="text-xs text-rose-100/80">Le serveur de diffusion est momentanément inaccessible. Réessaie dans quelques instants.</p>`
                  : html`<button
                      type="button"
                      class="inline-flex items-center gap-2 rounded-full border border-rose-200/40 bg-rose-200/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-rose-100 transition hover:bg-rose-200/20"
                      onClick=${handleRetry}
                    >
                      Relancer le flux
                      <${RefreshCcw} class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>`
              }
            </div>`
          : null
      }
      <audio ref=${audioRef} preload="auto" playsinline crossorigin="anonymous" aria-hidden="true" data-role="primary-stream"></audio>
    </div>
  `;
};

const createBeerCanTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const texture = new THREE.CanvasTexture(canvas);

  const paintNightGradient = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);

    const baseGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    baseGradient.addColorStop(0, '#020617');
    baseGradient.addColorStop(0.35, '#0b1120');
    baseGradient.addColorStop(0.7, '#0f172a');
    baseGradient.addColorStop(1, '#0a1022');
    context.fillStyle = baseGradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.globalAlpha = 0.2;
    for (let index = 0; index < 32; index += 1) {
      const x = (index / 32) * canvas.width;
      const brightness = 0.45 + 0.55 * Math.sin(index * 0.55);
      const channel = Math.floor(120 + brightness * 70);
      context.fillStyle = `rgba(${channel}, ${channel + 10}, ${channel + 25}, 0.55)`;
      context.fillRect(x, 0, canvas.width / 64, canvas.height);
    }
    context.restore();
  };

  paintNightGradient();
  texture.needsUpdate = true;

  const referenceImage = new Image();
  referenceImage.crossOrigin = 'anonymous';
  referenceImage.decoding = 'async';
  referenceImage.src = 'https://i.ibb.co/Z1LyfZmh/image.png';
  referenceImage.onload = () => {
    paintNightGradient();
    context.drawImage(referenceImage, 0, 0, canvas.width, canvas.height);

    const blueOverlay = context.createLinearGradient(0, 0, 0, canvas.height);
    blueOverlay.addColorStop(0, 'rgba(15, 23, 42, 0.55)');
    blueOverlay.addColorStop(0.5, 'rgba(11, 17, 32, 0.45)');
    blueOverlay.addColorStop(1, 'rgba(15, 23, 42, 0.65)');
    context.fillStyle = blueOverlay;
    context.fillRect(0, 0, canvas.width, canvas.height);

    texture.needsUpdate = true;
  };

  referenceImage.onerror = () => {
    paintNightGradient();
    texture.needsUpdate = true;
  };

  return texture;
};

const formatDurationLabel = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  const formatted = formatDuration(ms);
  return formatted || '—';
};

const ProfileIdentityCard = ({ profile, userId }) => {
  const mergedProfile = mergeProfiles({}, profile ?? {});
  const displayName = mergedProfile.displayName ?? 'Utilisateur inconnu';
  const username = mergedProfile.username ? `@${mergedProfile.username}` : null;
  const avatarUrl = mergedProfile.avatar ?? null;

  const identifier = userId ? `ID ${userId}` : null;

  const initialsSource = displayName || username || identifier || 'Utilisateur';
  const initials = initialsSource
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase?.() ?? '')
    .join('')
    .slice(0, 2)
    || 'UA';

  const [isAvatarOpen, setIsAvatarOpen] = useState(false);

  useEffect(() => {
    if (!isAvatarOpen || typeof document === 'undefined') {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsAvatarOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAvatarOpen]);

  const handleOpenAvatar = useCallback(() => {
    if (!avatarUrl) {
      return;
    }
    setIsAvatarOpen(true);
  }, [avatarUrl]);

  const handleCloseAvatar = useCallback(() => {
    setIsAvatarOpen(false);
  }, []);

  return html`
    <section class="relative rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950/90 to-indigo-950/40 p-6 shadow-xl shadow-indigo-900/30 backdrop-blur">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          ${avatarUrl
            ? html`<button
                type="button"
                onClick=${handleOpenAvatar}
                class="group relative flex shrink-0 items-center justify-center rounded-3xl border border-white/10 bg-black/30 p-1 shadow-lg shadow-slate-950/60 transition hover:border-indigo-300/60 hover:shadow-indigo-500/30"
                aria-label="Agrandir l’avatar"
              >
                <img
                  src=${avatarUrl}
                  alt=${displayName}
                  style=${{ width: '256px', height: '256px' }}
                  class="rounded-[1.25rem] object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <span class="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-gradient-to-br from-transparent via-transparent to-black/30 opacity-0 transition group-hover:opacity-100"></span>
                <span class="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/50 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-slate-100 opacity-0 transition group-hover:opacity-100">
                  Voir
                </span>
              </button>`
            : html`<div
                class="flex h-32 w-32 items-center justify-center rounded-3xl border border-white/10 bg-white/10 text-3xl font-semibold text-white shadow-inner shadow-slate-950/60 sm:h-40 sm:w-40"
                aria-hidden="true"
              >
                ${initials}
              </div>`}
          <div class="text-center sm:text-left">
            <p class="text-xs uppercase tracking-[0.3em] text-indigo-200/80">Profil Discord</p>
            <h1 class="mt-1 text-3xl font-semibold text-white">${displayName}</h1>
            ${username ? html`<p class="text-sm text-slate-300">${username}</p>` : null}
            ${identifier ? html`<p class="text-xs text-slate-500">${identifier}</p>` : null}
          </div>
        </div>
      </div>

      ${isAvatarOpen && avatarUrl
        ? html`<div
            class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 backdrop-blur"
            role="dialog"
            aria-modal="true"
            aria-label="Avatar agrandi"
          >
            <button
              type="button"
              onClick=${handleCloseAvatar}
              class="absolute right-6 top-6 inline-flex items-center justify-center rounded-full border border-white/10 bg-black/40 p-2 text-slate-100 transition hover:bg-white/10"
              aria-label="Fermer l’aperçu de l’avatar"
            >
              <${X} class="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick=${handleCloseAvatar}
              class="max-h-[90vh] max-w-[90vw] overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/40 p-3 shadow-2xl shadow-black/40"
            >
              <img
                src=${avatarUrl}
                alt=${displayName}
                class="max-h-[80vh] max-w-[80vw] rounded-[1.5rem] object-contain"
                loading="lazy"
                decoding="async"
              />
            </button>
          </div>`
        : null}
    </section>
  `;
};

const ProfileSummaryCards = ({ stats = {} }) => {
  const presenceDuration = formatDurationLabel(stats?.totalPresenceMs);
  const speakingDuration = formatDurationLabel(stats?.totalSpeakingMs);
  const messageCount = Number.isFinite(stats?.messageCount) ? stats.messageCount : 0;
  const presenceSessions = Number.isFinite(stats?.presenceSessions) ? stats.presenceSessions : 0;
  const speakingSessions = Number.isFinite(stats?.speakingSessions) ? stats.speakingSessions : 0;
  const activeDayCount = Number.isFinite(stats?.activeDayCount)
    ? stats.activeDayCount
    : Array.isArray(stats?.uniqueActiveDays)
    ? stats.uniqueActiveDays.length
    : 0;
  const firstActivity = formatDateTimeLabel(stats?.firstActivityAt?.ms, { includeDate: true, includeSeconds: false });
  const lastActivity = formatDateTimeLabel(stats?.lastActivityAt?.ms, { includeDate: true, includeSeconds: false });

  const cards = [
    {
      key: 'presence',
      label: 'Temps en vocal',
      value: presenceDuration,
      helper: `${presenceSessions} session${presenceSessions === 1 ? '' : 's'}`,
      icon: Headphones,
      accent: 'from-indigo-500/20 via-slate-900 to-indigo-500/10',
    },
    {
      key: 'speaking',
      label: 'Temps de parole',
      value: speakingDuration,
      helper: `${speakingSessions} prise${speakingSessions === 1 ? '' : 's'} de parole`,
      icon: Mic,
      accent: 'from-fuchsia-500/20 via-slate-900 to-fuchsia-500/10',
    },
    {
      key: 'messages',
      label: 'Messages envoyés',
      value: messageCount,
      helper: messageCount === 1 ? '1 message' : `${messageCount} messages`,
      icon: MessageSquare,
      accent: 'from-emerald-500/20 via-slate-900 to-emerald-500/10',
    },
    {
      key: 'days',
      label: 'Jours actifs',
      value: activeDayCount,
      helper: [firstActivity, lastActivity].filter(Boolean).join(' · '),
      icon: CalendarDays,
      accent: 'from-sky-500/20 via-slate-900 to-sky-500/10',
    },
  ];

  return html`
    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">Résumé de l’activité</h2>
      <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${cards.map((card) => {
          const IconComponent = card.icon;
          return html`
            <article
              key=${card.key}
              class=${`flex flex-col gap-2 rounded-2xl border border-white/10 bg-gradient-to-br ${card.accent} p-4 text-sm text-slate-200`}
            >
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs uppercase tracking-[0.3em] text-slate-300">${card.label}</p>
                <span class="rounded-full border border-white/10 bg-white/10 p-2 text-indigo-200">
                  <${IconComponent} class="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <p class="text-2xl font-semibold text-white">${card.value}</p>
              <p class="text-xs text-slate-400">${card.helper || 'Aucune donnée disponible'}</p>
            </article>
          `;
        })}
      </div>
    </section>
  `;
};

const PROFILE_ACTIVITY_GRANULARITIES = [
  {
    id: 'hour',
    label: 'Vue horaire',
    description: 'Agrégation par heure',
    durationMs: HOUR_MS,
  },
  {
    id: 'day',
    label: 'Vue quotidienne',
    description: 'Agrégation par jour',
    durationMs: HOUR_MS * HOURS_IN_DAY,
  },
];

const ProfileActivityTimeline = ({
  range = {},
  presenceSegments = [],
  speakingSegments = [],
  messageEvents = [],
}) => {
  const [granularity, setGranularity] = useState('hour');
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const granularityConfig = PROFILE_ACTIVITY_GRANULARITIES.find((item) => item.id === granularity)
    ?? PROFILE_ACTIVITY_GRANULARITIES[0];

  const chartState = useMemo(() => {
    const bucketSize = granularityConfig.durationMs;
    const allTimestamps = [];

    const collectTimestamp = (timestamp) => {
      if (Number.isFinite(timestamp)) {
        allTimestamps.push(timestamp);
      }
    };

    (presenceSegments || []).forEach((segment) => {
      collectTimestamp(Number.isFinite(segment?.joinedAtMs) ? segment.joinedAtMs : null);
      collectTimestamp(Number.isFinite(segment?.leftAtMs) ? segment.leftAtMs : null);
    });

    (speakingSegments || []).forEach((segment) => {
      collectTimestamp(Number.isFinite(segment?.startedAtMs) ? segment.startedAtMs : null);
      if (Number.isFinite(segment?.endedAtMs)) {
        collectTimestamp(segment.endedAtMs);
      } else if (Number.isFinite(segment?.startedAtMs) && Number.isFinite(segment?.durationMs)) {
        collectTimestamp(segment.startedAtMs + Math.max(0, segment.durationMs));
      }
    });

    (messageEvents || []).forEach((event) => {
      collectTimestamp(Number.isFinite(event?.timestampMs) ? event.timestampMs : null);
    });

    const fallbackSince = allTimestamps.length > 0 ? Math.min(...allTimestamps) : null;
    const fallbackUntil = allTimestamps.length > 0 ? Math.max(...allTimestamps) : null;

    let sinceMs = Number.isFinite(range?.sinceMs) ? range.sinceMs : fallbackSince;
    let untilMs = Number.isFinite(range?.untilMs) ? range.untilMs : fallbackUntil;

    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
      return {
        labels: [],
        datasets: [],
        buckets: [],
        totals: { messages: 0, voiceJoin: 0, voiceLeave: 0, speakingMs: 0 },
        hasData: false,
      };
    }

    if (untilMs <= sinceMs) {
      untilMs = sinceMs + bucketSize;
    }

    const safeStart = Math.floor(sinceMs / bucketSize) * bucketSize;
    const safeEnd = Math.ceil(untilMs / bucketSize) * bucketSize;
    const totalBuckets = Math.max(1, Math.ceil((safeEnd - safeStart) / bucketSize));

    const buckets = Array.from({ length: totalBuckets }, (_, index) => {
      const start = safeStart + index * bucketSize;
      return {
        start,
        end: start + bucketSize,
        messages: 0,
        voiceJoin: 0,
        voiceLeave: 0,
        speakingMs: 0,
      };
    });

    const clampIndex = (timestamp, options = {}) => {
      if (!Number.isFinite(timestamp) || buckets.length === 0) {
        return 0;
      }
      const { inclusiveEnd = false } = options;
      if (timestamp <= safeStart) {
        return 0;
      }
      if (timestamp >= safeEnd) {
        return buckets.length - 1;
      }
      const relative = timestamp - safeStart;
      const rawIndex = inclusiveEnd
        ? Math.ceil(relative / bucketSize) - 1
        : Math.floor(relative / bucketSize);
      return Math.max(0, Math.min(buckets.length - 1, rawIndex));
    };

    (messageEvents || []).forEach((event) => {
      const timestamp = Number.isFinite(event?.timestampMs) ? event.timestampMs : null;
      if (!Number.isFinite(timestamp)) {
        return;
      }
      const bucketIndex = clampIndex(timestamp);
      buckets[bucketIndex].messages += 1;
    });

    (presenceSegments || []).forEach((segment) => {
      const joinedAt = Number.isFinite(segment?.joinedAtMs) ? segment.joinedAtMs : null;
      if (Number.isFinite(joinedAt)) {
        const index = clampIndex(joinedAt);
        buckets[index].voiceJoin += 1;
      }
      const leftAt = Number.isFinite(segment?.leftAtMs) ? segment.leftAtMs : null;
      if (Number.isFinite(leftAt)) {
        const index = clampIndex(leftAt, { inclusiveEnd: true });
        buckets[index].voiceLeave += 1;
      }
    });

    (speakingSegments || []).forEach((segment) => {
      const startedAt = Number.isFinite(segment?.startedAtMs) ? segment.startedAtMs : null;
      if (!Number.isFinite(startedAt)) {
        return;
      }
      let endedAt = Number.isFinite(segment?.endedAtMs) ? segment.endedAtMs : null;
      const duration = Number.isFinite(segment?.durationMs) ? Math.max(0, segment.durationMs) : null;
      if (!Number.isFinite(endedAt) && Number.isFinite(duration)) {
        endedAt = startedAt + duration;
      }
      if (!Number.isFinite(endedAt)) {
        endedAt = startedAt;
      }

      const normalizedStart = Math.max(startedAt, safeStart);
      const normalizedEnd = Math.min(Math.max(endedAt, startedAt), safeEnd);
      if (normalizedEnd <= normalizedStart) {
        return;
      }

      const startIndex = clampIndex(normalizedStart);
      const endIndex = clampIndex(normalizedEnd, { inclusiveEnd: true });

      for (let index = startIndex; index <= endIndex; index += 1) {
        const bucket = buckets[index];
        if (!bucket) {
          continue;
        }
        const overlapStart = Math.max(bucket.start, normalizedStart);
        const overlapEnd = Math.min(bucket.end, normalizedEnd);
        if (overlapEnd > overlapStart) {
          bucket.speakingMs += overlapEnd - overlapStart;
        }
      }
    });

    const formatBucketLabel = (bucket) => {
      const startDate = new Date(bucket.start);
      if (granularityConfig.id === 'day') {
        return startDate.toLocaleDateString('fr-FR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        });
      }
      const datePart = startDate.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
      });
      const hourPart = startDate
        .toLocaleTimeString('fr-FR', { hour: '2-digit' })
        .replace(/\s*[hH]$/, '');
      return `${datePart} · ${hourPart}h`;
    };

    const labels = buckets.map((bucket) => formatBucketLabel(bucket));

    const totals = buckets.reduce(
      (acc, bucket) => {
        acc.messages += bucket.messages;
        acc.voiceJoin += bucket.voiceJoin;
        acc.voiceLeave += bucket.voiceLeave;
        acc.speakingMs += bucket.speakingMs;
        return acc;
      },
      { messages: 0, voiceJoin: 0, voiceLeave: 0, speakingMs: 0 },
    );

    const datasets = [
      {
        type: 'bar',
        label: 'Messages envoyés',
        data: buckets.map((bucket) => bucket.messages),
        backgroundColor: 'rgba(56, 189, 248, 0.65)',
        borderColor: 'rgba(56, 189, 248, 0.9)',
        borderWidth: 1,
        stack: 'events',
        metaType: 'count',
      },
      {
        type: 'bar',
        label: 'Connexions vocales',
        data: buckets.map((bucket) => bucket.voiceJoin),
        backgroundColor: 'rgba(16, 185, 129, 0.65)',
        borderColor: 'rgba(16, 185, 129, 0.9)',
        borderWidth: 1,
        stack: 'events',
        metaType: 'count',
      },
      {
        type: 'bar',
        label: 'Déconnexions vocales',
        data: buckets.map((bucket) => bucket.voiceLeave),
        backgroundColor: 'rgba(148, 163, 184, 0.6)',
        borderColor: 'rgba(148, 163, 184, 0.85)',
        borderWidth: 1,
        stack: 'events',
        metaType: 'count',
      },
      {
        type: 'line',
        label: 'Temps de parole (minutes)',
        data: buckets.map((bucket) => Number((bucket.speakingMs / 60000).toFixed(2))),
        borderColor: 'rgba(244, 114, 182, 1)',
        backgroundColor: 'rgba(244, 114, 182, 0.3)',
        tension: 0.3,
        yAxisID: 'y1',
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        metaType: 'duration',
      },
    ];

    const hasData = buckets.some((bucket) =>
      bucket.messages > 0 || bucket.voiceJoin > 0 || bucket.voiceLeave > 0 || bucket.speakingMs > 0,
    );

    return { labels, datasets, buckets, totals, hasData };
  }, [granularityConfig, presenceSegments, speakingSegments, messageEvents, range?.sinceMs, range?.untilMs]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        stacked: true,
        ticks: { maxRotation: 0, autoSkip: true, color: '#94a3b8' },
        grid: { color: 'rgba(148, 163, 184, 0.2)' },
        title: {
          display: true,
          text: granularityConfig.id === 'day' ? 'Jours' : 'Heures',
          color: '#cbd5f5',
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { precision: 0 },
        title: {
          display: true,
          text: 'Nombre d’évènements',
          color: '#cbd5f5',
        },
      },
      y1: {
        beginAtZero: true,
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: {
          callback: (value) => `${value} min`,
        },
        title: {
          display: true,
          text: 'Temps de parole',
          color: '#f472b6',
        },
      },
    },
    plugins: {
      legend: {
        labels: { color: '#e2e8f0', usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          title: (items) => {
            if (!items?.length) {
              return '';
            }
            const index = items[0].dataIndex;
            return chartState.labels[index] ?? '';
          },
          label: (context) => {
            const dataset = context.dataset || {};
            const rawValue = typeof context.raw === 'number' ? context.raw : context.parsed?.y ?? 0;
            if (dataset.metaType === 'duration') {
              if (!rawValue) {
                return `${dataset.label}: 0 min`;
              }
              if (rawValue < 1) {
                const seconds = Math.round(rawValue * 60);
                return `${dataset.label}: ${seconds} s`;
              }
              return `${dataset.label}: ${rawValue.toFixed(1)} min`;
            }
            return `${dataset.label}: ${rawValue}`;
          },
        },
      },
    },
  }), [granularityConfig, chartState.labels]);

  useEffect(() => {
    if (!canvasRef.current || typeof window === 'undefined') {
      return undefined;
    }
    if (chartRef.current) {
      return undefined;
    }
    const context = canvasRef.current.getContext('2d');
    if (!context) {
      return undefined;
    }
    const chart = new Chart(context, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: chartOptions,
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    chart.options = chartOptions;
    chart.update('none');
  }, [chartOptions]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    chart.data.labels = chartState.labels;
    chart.data.datasets = chartState.datasets;
    chart.update();
  }, [chartState]);

  const sinceLabel = Number.isFinite(range?.sinceMs)
    ? formatDateTimeLabel(range.sinceMs, { includeDate: true, includeSeconds: false })
    : null;
  const untilLabel = Number.isFinite(range?.untilMs)
    ? formatDateTimeLabel(range.untilMs, { includeDate: true, includeSeconds: false })
    : null;

  const totals = chartState.totals;

  const handleGranularityChange = useCallback((nextGranularity) => {
    setGranularity(nextGranularity);
  }, []);

  const granularityButtons = PROFILE_ACTIVITY_GRANULARITIES.map((item) => {
    const isActive = item.id === granularityConfig.id;
    return html`<button
      key=${item.id}
      type="button"
      onClick=${() => handleGranularityChange(item.id)}
      class=${`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        isActive
          ? 'border-indigo-300/60 bg-indigo-500/20 text-indigo-100 shadow-[0_0_12px_rgba(99,102,241,0.35)]'
          : 'border-white/10 bg-white/5 text-slate-200 hover:border-indigo-300/40 hover:text-white'
      }`}
      aria-pressed=${isActive}
    >
      ${item.label}
    </button>`;
  });

  return html`
    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
      <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-white">Chronologie des activités</h2>
          <p class="text-xs text-slate-400">
            ${[sinceLabel, untilLabel].filter(Boolean).join(' → ') || 'Période inconnue'}
          </p>
          <p class="mt-1 text-[0.7rem] uppercase tracking-[0.35em] text-indigo-200/70">
            ${granularityConfig.description}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">${granularityButtons}</div>
      </div>

      ${!chartState.hasData
        ? html`<p class="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
            Aucune activité n’a été enregistrée pour cette période.
          </p>`
        : html`
            <div class="mt-6 space-y-6">
              <div class="relative h-80 w-full overflow-hidden rounded-3xl border border-white/10 bg-black/20 p-4 shadow-inner shadow-black/30">
                <canvas ref=${canvasRef} class="h-full w-full"></canvas>
              </div>
              <dl class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-2xl border border-sky-400/40 bg-sky-500/10 p-4 text-sm text-slate-100">
                  <dt class="text-xs uppercase tracking-[0.3em] text-sky-200">Messages envoyés</dt>
                  <dd class="mt-2 text-2xl font-semibold text-white">${totals.messages}</dd>
                </div>
                <div class="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-slate-100">
                  <dt class="text-xs uppercase tracking-[0.3em] text-emerald-200">Connexions vocales</dt>
                  <dd class="mt-2 text-2xl font-semibold text-white">${totals.voiceJoin}</dd>
                </div>
                <div class="rounded-2xl border border-slate-400/40 bg-slate-500/10 p-4 text-sm text-slate-100">
                  <dt class="text-xs uppercase tracking-[0.3em] text-slate-200">Déconnexions vocales</dt>
                  <dd class="mt-2 text-2xl font-semibold text-white">${totals.voiceLeave}</dd>
                </div>
                <div class="rounded-2xl border border-fuchsia-400/40 bg-fuchsia-500/10 p-4 text-sm text-slate-100">
                  <dt class="text-xs uppercase tracking-[0.3em] text-fuchsia-200">Temps de parole</dt>
                  <dd class="mt-2 text-2xl font-semibold text-white">${formatDurationLabel(totals.speakingMs)}</dd>
                </div>
              </dl>
            </div>
          `}
    </section>
  `;
};

const ProfileVoiceTranscriptionsCard = ({ userId }) => {
  const [state, setState] = useState({ status: 'idle', entries: [], error: null });
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!userId) {
      setState({ status: 'idle', entries: [], error: null });
      return () => {};
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let isActive = true;

    const loadTranscriptions = async () => {
      setState((prev) => ({ status: 'loading', entries: prev.entries || [], error: null }));
      try {
        const query = new URLSearchParams({ limit: '10' });
        const response = await fetch(`/api/users/${encodeURIComponent(userId)}/voice-transcriptions?${query.toString()}`, {
          signal: controller?.signal,
        });
        if (!response.ok) {
          let message = 'Impossible de récupérer les retranscriptions vocales.';
          try {
            const body = await response.json();
            if (body?.message) {
              message = body.message;
            }
          } catch (error) {
            // ignore JSON errors
          }
          throw new Error(message);
        }
        const payload = await response.json();
        if (!isActive) {
          return;
        }
        const entries = Array.isArray(payload?.entries) ? payload.entries : [];
        setState({ status: 'success', entries, error: null });
      } catch (error) {
        if (!isActive) {
          return;
        }
        const message = error instanceof Error && error.message
          ? error.message
          : 'Impossible de récupérer les retranscriptions vocales.';
        setState({ status: 'error', entries: [], error: message });
      }
    };

    loadTranscriptions();
    return () => {
      isActive = false;
      controller?.abort();
    };
  }, [userId, refreshNonce]);

  const handleRefresh = () => {
    setRefreshNonce((value) => value + 1);
  };

  const isLoading = state.status === 'loading';
  const entries = Array.isArray(state.entries) ? state.entries : [];

  return html`
    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-white">Retranscriptions vocales</h2>
          <p class="text-xs text-slate-400">Dernières prises de parole transcrites automatiquement.</p>
        </div>
        <button
          type="button"
          onClick=${handleRefresh}
          class=${`inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold transition ${
            isLoading ? 'bg-white/5 text-slate-300' : 'bg-white/10 text-slate-200 hover:bg-white/20'
          }`}
          disabled=${isLoading}
        >
          <${RefreshCcw} class=${`h-4 w-4 ${isLoading ? 'animate-spin text-indigo-200' : ''}`} aria-hidden="true" />
          Rafraîchir
        </button>
      </div>

      ${state.error
        ? html`<p class="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            ${state.error}
          </p>`
        : null}

      ${!state.error && entries.length === 0 && !isLoading
        ? html`<p class="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            Aucune retranscription disponible pour le moment.
          </p>`
        : null}

      ${entries.length > 0
        ? html`<ul class="mt-4 space-y-3">
            ${entries.map((entry) => {
              const timestamp = Number.isFinite(entry?.timestampMs) ? entry.timestampMs : null;
              const content = typeof entry?.content === 'string' ? entry.content.trim() : '';
              return html`<li
                key=${entry.transcriptionId || `${entry.channelId}-${entry.timestamp}`}
                class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200"
              >
                <p class="font-medium text-white">${content || 'Transcription vide'}</p>
                ${timestamp
                  ? html`<p class="text-xs text-slate-400">
                      ${formatDateTimeLabel(timestamp, { includeDate: true, includeSeconds: true })}
                    </p>`
                  : null}
              </li>`;
            })}
          </ul>`
        : null}
    </section>
  `;
};

const ProfileMessagesCard = ({ messageEvents = [] }) => {
  const messages = useMemo(() => {
    if (!Array.isArray(messageEvents)) {
      return [];
    }
    return messageEvents
      .filter((event) => Number.isFinite(event?.timestampMs))
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 20);
  }, [messageEvents]);

  return html`
    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">Derniers messages</h2>
      ${messages.length === 0
        ? html`<p class="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            Aucun message n’a été enregistré pendant cette période.
          </p>`
        : html`<ul class="mt-4 space-y-3">
            ${messages.map((event, index) => {
              const content = typeof event?.content === 'string' ? event.content.trim() : '';
              const timestamp = Number.isFinite(event?.timestampMs) ? event.timestampMs : null;
              return html`<li
                key=${event.messageId || `${index}-${event.timestampMs}`}
                class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200"
              >
                <p class="font-medium text-white">${content || 'Message sans contenu'}</p>
                ${timestamp
                  ? html`<p class="text-xs text-slate-400">
                      ${formatDateTimeLabel(timestamp, { includeDate: true, includeSeconds: true })}
                    </p>`
                  : null}
              </li>`;
            })}
          </ul>`}
    </section>
  `;
};

const DailyBreakdown = ({
  range = {},
  presenceSegments = [],
  speakingSegments = [],
  messageEvents = [],
}) => {
  const dayMs = HOUR_MS * HOURS_IN_DAY;

  const breakdown = useMemo(() => {
    const sinceMs = Number.isFinite(range?.sinceMs) ? range.sinceMs : null;
    const untilMs = Number.isFinite(range?.untilMs) ? range.untilMs : null;
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
      return [];
    }

    const clampEnd = (end) => {
      if (Number.isFinite(end)) {
        return Math.min(end, untilMs);
      }
      return untilMs;
    };

    const buckets = new Map();

    const getDayStart = (ms) => {
      const date = new Date(ms);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    };

    const ensureBucket = (dayStart) => {
      let bucket = buckets.get(dayStart);
      if (!bucket) {
        const startBound = Math.max(sinceMs, dayStart);
        const endBound = Math.min(untilMs, dayStart + dayMs);
        bucket = {
          key: dayStart,
          dateMs: dayStart,
          startMs: startBound,
          endMs: endBound,
          presenceMs: 0,
          speakingMs: 0,
          messageCount: 0,
        };
        buckets.set(dayStart, bucket);
      }
      return bucket;
    };

    const accumulateDuration = (startMs, endMs, field) => {
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return;
      }
      const safeStart = Math.max(startMs, sinceMs);
      const safeEnd = Math.min(endMs, untilMs);
      if (safeEnd <= safeStart) {
        return;
      }

      let cursor = safeStart;
      while (cursor < safeEnd) {
        const dayStart = getDayStart(cursor);
        const bucket = ensureBucket(dayStart);
        const dayEnd = Math.min(safeEnd, bucket.dateMs + dayMs, untilMs);
        const slice = Math.max(0, dayEnd - cursor);
        bucket[field] += slice;
        cursor = dayEnd;
      }
    };

    presenceSegments.forEach((segment) => {
      const start = Number.isFinite(segment?.joinedAtMs) ? segment.joinedAtMs : segment?.startMs;
      const end = clampEnd(segment?.leftAtMs ?? segment?.endMs);
      accumulateDuration(start, end, 'presenceMs');
    });

    speakingSegments.forEach((segment) => {
      const start = Number.isFinite(segment?.startedAtMs) ? segment.startedAtMs : segment?.startMs;
      const endCandidate = Number.isFinite(segment?.durationMs)
        ? start + Math.max(0, segment.durationMs)
        : segment?.endedAtMs ?? segment?.endMs;
      const end = clampEnd(endCandidate);
      accumulateDuration(start, end, 'speakingMs');
    });

    messageEvents.forEach((event) => {
      const timestamp = Number.isFinite(event?.timestampMs) ? event.timestampMs : null;
      if (!Number.isFinite(timestamp)) {
        return;
      }
      if (timestamp < sinceMs || timestamp > untilMs) {
        return;
      }
      const bucket = ensureBucket(getDayStart(timestamp));
      bucket.messageCount += 1;
    });

    const entries = Array.from(buckets.values());
    entries.sort((a, b) => b.dateMs - a.dateMs);
    return entries;
  }, [range?.sinceMs, range?.untilMs, dayMs, presenceSegments, speakingSegments, messageEvents]);

  const totals = useMemo(() => {
    return breakdown.reduce(
      (acc, day) => {
        acc.presenceMs += day.presenceMs;
        acc.speakingMs += day.speakingMs;
        acc.messageCount += day.messageCount;
        return acc;
      },
      { presenceMs: 0, speakingMs: 0, messageCount: 0 },
    );
  }, [breakdown]);

  if (breakdown.length === 0) {
    return html`
      <section class="mt-8 rounded-3xl border border-white/10 bg-slate-950/70 p-6 text-sm text-slate-200 shadow-xl shadow-slate-950/40">
        <h2 class="text-lg font-semibold text-white">Activité quotidienne</h2>
        <p class="mt-3 text-sm text-slate-300">
          Aucune activité enregistrée sur la période sélectionnée.
        </p>
      </section>
    `;
  }

  return html`
    <section class="mt-8 space-y-5">
      <div class="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950/90 to-indigo-950/40 p-6 shadow-xl shadow-indigo-900/30">
        <div class="flex flex-wrap items-center gap-6">
          <div class="flex-1 min-w-[10rem]">
            <p class="text-xs uppercase tracking-[0.3em] text-slate-400">Total présence</p>
            <p class="mt-2 text-2xl font-semibold text-white">${formatDurationLabel(totals.presenceMs)}</p>
          </div>
          <div class="flex-1 min-w-[10rem]">
            <p class="text-xs uppercase tracking-[0.3em] text-slate-400">Total parole</p>
            <p class="mt-2 text-2xl font-semibold text-white">${formatDurationLabel(totals.speakingMs)}</p>
          </div>
          <div class="flex-1 min-w-[10rem]">
            <p class="text-xs uppercase tracking-[0.3em] text-slate-400">Messages</p>
            <p class="mt-2 text-2xl font-semibold text-white">${Number.isFinite(totals.messageCount) ? totals.messageCount : '—'}</p>
          </div>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        ${breakdown.map((day) => {
          const rangeDuration = Math.max(0, (day.endMs ?? day.startMs) - day.startMs);
          const presencePercent = rangeDuration > 0 ? Math.min(100, Math.round((day.presenceMs / rangeDuration) * 100)) : 0;
          const speakingPercent = rangeDuration > 0 ? Math.min(100, Math.round((day.speakingMs / rangeDuration) * 100)) : 0;
          return html`
            <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-lg shadow-slate-950/40">
              <header class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-white">${formatDayLabel(day.dateMs)}</p>
                  <p class="text-xs text-slate-400">
                    ${rangeDuration > 0 ? `${(rangeDuration / dayMs).toFixed(2)} j de suivi` : 'Période partielle'}
                  </p>
                </div>
                <div class="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-100">
                  ${day.messageCount} message${day.messageCount > 1 ? 's' : ''}
                </div>
              </header>

              <div class="mt-4 space-y-3">
                <div>
                  <div class="flex items-center justify-between text-xs text-slate-300">
                    <span>Présence vocale</span>
                    <span class="font-semibold text-slate-100">${formatDurationLabel(day.presenceMs)}</span>
                  </div>
                  <div class="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      class="h-full rounded-full bg-indigo-400/70"
                      style=${{ width: `${presencePercent}%` }}
                      aria-hidden="true"
                    ></div>
                  </div>
                  <span class="sr-only">Présence vocale ${presencePercent}% du temps suivi</span>
                </div>

                <div>
                  <div class="flex items-center justify-between text-xs text-slate-300">
                    <span>Temps de parole</span>
                    <span class="font-semibold text-slate-100">${formatDurationLabel(day.speakingMs)}</span>
                  </div>
                  <div class="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      class="h-full rounded-full bg-fuchsia-400/70"
                      style=${{ width: `${speakingPercent}%` }}
                      aria-hidden="true"
                    ></div>
                  </div>
                  <span class="sr-only">Temps de parole ${speakingPercent}% du temps suivi</span>
                </div>
              </div>
            </article>
          `;
        })}
      </div>
    </section>
  `;
};

const BeerCanDisplay = () => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
    camera.position.set(0, 0, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const setRendererSize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    container.style.touchAction = 'pan-y';
    container.style.cursor = 'grab';

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.35);
    keyLight.position.set(3.5, 4.5, 5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x6366f1, 1.2, 8, 2);
    rimLight.position.set(-4, -3, -2);
    scene.add(rimLight);

    const fillLight = new THREE.PointLight(0x38bdf8, 1.1, 10, 2);
    fillLight.position.set(-1.5, 1.8, 3.5);
    scene.add(fillLight);

    const glowLight = new THREE.PointLight(0xa855f7, 1.4, 6, 2.5);
    glowLight.position.set(0, 0.4, 2.8);
    scene.add(glowLight);

    const canGroup = new THREE.Group();
    scene.add(canGroup);

    const canGeometry = new THREE.CylinderGeometry(0.6, 0.6, 2, 128, 1, false);
    const canTexture = createBeerCanTexture();
    if (canTexture) {
      canTexture.wrapS = THREE.RepeatWrapping;
      canTexture.wrapT = THREE.ClampToEdgeWrapping;
      canTexture.repeat.x = 1;
      canTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? canTexture.anisotropy;
    }
    const sideMaterial = new THREE.MeshStandardMaterial({
      map: canTexture || undefined,
      color: canTexture ? 0xffffff : 0x1e293b,
      emissive: new THREE.Color(0x1e3a8a).multiplyScalar(0.18),
      metalness: 0.72,
      roughness: 0.22,
      envMapIntensity: 1.2,
    });
    const topMaterial = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.95,
      roughness: 0.18,
      emissive: new THREE.Color(0x312e81).multiplyScalar(0.22),
    });
    const canMesh = new THREE.Mesh(canGeometry, [sideMaterial, topMaterial, topMaterial]);
    canGroup.add(canMesh);

    const lipGeometry = new THREE.TorusGeometry(0.58, 0.025, 22, 100);
    const lipMaterial = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.9,
      roughness: 0.2,
    });
    const topLip = new THREE.Mesh(lipGeometry, lipMaterial);
    topLip.position.y = 1;
    topLip.rotation.x = Math.PI / 2;
    canGroup.add(topLip);
    const bottomLip = topLip.clone();
    bottomLip.position.y = -1;
    canGroup.add(bottomLip);

    const topCapGeometry = new THREE.CircleGeometry(0.35, 48);
    const topCapMaterial = new THREE.MeshStandardMaterial({
      color: 0xcbd5f5,
      metalness: 0.95,
      roughness: 0.28,
    });
    const topCap = new THREE.Mesh(topCapGeometry, topCapMaterial);
    topCap.position.y = 1.01;
    topCap.rotation.x = -Math.PI / 2;
    canGroup.add(topCap);

    const waveGroup = new THREE.Group();
    waveGroup.position.y = -0.15;
    scene.add(waveGroup);

    const waveMeshes = [];
    const waveMaterials = [];
    const waveGeometries = [];
    for (let index = 0; index < 3; index += 1) {
      const innerRadius = 0.75 + index * 0.03;
      const ringGeometry = new THREE.RingGeometry(innerRadius, innerRadius + 0.02, 128);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0x60a5fa : 0xa855f7,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
      ringMesh.rotation.x = Math.PI / 2;
      waveGroup.add(ringMesh);
      waveMeshes.push(ringMesh);
      waveMaterials.push(ringMaterial);
      waveGeometries.push(ringGeometry);
    }

    const particleCount = 180;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);
    for (let index = 0; index < particleCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.35 + Math.random() * 0.6;
      const height = (Math.random() - 0.3) * 1.2;
      particlePositions[index * 3] = Math.cos(angle) * radius;
      particlePositions[index * 3 + 1] = height;
      particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
      particleSpeeds[index] = 0.00035 + Math.random() * 0.00055;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: 0x7c3aed,
      size: 0.06,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.position.y = -0.2;
    scene.add(particles);

    const defaultRotation = { x: 0.35, y: -0.4 };
    const targetRotation = { ...defaultRotation };
    const currentRotation = { ...defaultRotation };
    canGroup.rotation.set(defaultRotation.x, defaultRotation.y, 0);

    const updateRotationFromPointer = (clientX, clientY) => {
      const rect = container.getBoundingClientRect();
      const relativeX = (clientX - rect.left) / rect.width - 0.5;
      const relativeY = (clientY - rect.top) / rect.height - 0.5;
      targetRotation.y = THREE.MathUtils.clamp(relativeX * 1.2, -1.1, 1.1);
      targetRotation.x = THREE.MathUtils.clamp(defaultRotation.x - relativeY * 1.2, -0.2, 0.85);
    };

    const handlePointerMove = (event) => {
      if (event.isPrimary === false) {
        return;
      }
      updateRotationFromPointer(event.clientX, event.clientY);
    };

    window.addEventListener('pointermove', handlePointerMove);

    const handleResize = () => {
      setRendererSize();
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    let animationFrameId = 0;
    const startTime = performance.now();
    const animate = (time) => {
      animationFrameId = requestAnimationFrame(animate);
      currentRotation.x += (targetRotation.x - currentRotation.x) * 0.075;
      currentRotation.y += (targetRotation.y - currentRotation.y) * 0.075;
      canGroup.rotation.x = currentRotation.x + Math.sin(time * 0.00045) * 0.05;
      canGroup.rotation.y = currentRotation.y + Math.cos(time * 0.00035) * 0.04;
      canGroup.position.y = Math.sin(time * 0.0006) * 0.05;

      const elapsed = time - startTime;
      waveMeshes.forEach((mesh, index) => {
        const material = waveMaterials[index];
        const progress = ((elapsed / 1800 + index / waveMeshes.length) % 1 + 1) % 1;
        const scale = 1 + progress * 1.85;
        mesh.scale.setScalar(scale);
        material.opacity = 0.65 * (1 - progress);
      });

      const positions = particleGeometry.attributes.position.array;
      for (let index = 0; index < particleCount; index += 1) {
        const yIndex = index * 3 + 1;
        positions[yIndex] += particleSpeeds[index] * Math.max(1, 1 + Math.sin(time * 0.0015));
        if (positions[yIndex] > 1.6) {
          positions[yIndex] = -0.8 + Math.random() * 0.4;
          const angle = Math.random() * Math.PI * 2;
          const radius = 0.35 + Math.random() * 0.6;
          positions[index * 3] = Math.cos(angle) * radius;
          positions[index * 3 + 2] = Math.sin(angle) * radius;
        }
      }
      particleGeometry.attributes.position.needsUpdate = true;

      const pulse = 0.9 + Math.sin(time * 0.0012) * 0.25;
      rimLight.intensity = 0.9 * pulse;
      fillLight.intensity = 0.75 * pulse + 0.55;
      glowLight.intensity = 1.1 * pulse;

      renderer.render(scene, camera);
    };
    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      canGeometry.dispose();
      lipGeometry.dispose();
      topCapGeometry.dispose();
      sideMaterial.dispose();
      topMaterial.dispose();
      lipMaterial.dispose();
      topCapMaterial.dispose();
      waveGeometries.forEach((geometry) => geometry.dispose());
      waveMaterials.forEach((material) => material.dispose());
      particleGeometry.dispose();
      particleMaterial.dispose();
      canTexture?.dispose?.();
      renderer.dispose();
      container.style.touchAction = '';
      container.style.cursor = '';
      container.innerHTML = '';
    };
  }, []);

  return html`
    <div class="relative flex flex-col items-start gap-3 sm:-mx-4 lg:-mx-8 lg:-translate-x-16 xl:-mx-10 xl:-translate-x-20">
      <div class="relative">
        <div
          ref=${containerRef}
          class="pointer-events-auto h-48 w-48 -translate-x-2 sm:h-60 sm:w-60 sm:-translate-x-3 lg:h-72 lg:w-72 lg:-translate-x-4 xl:h-80 xl:w-80 xl:-translate-x-6"
          role="presentation"
        ></div>
        <span class="sr-only">Canette de bière interactive qui réagit aux mouvements de la souris.</span>
      </div>
    </div>
  `;
};


export {
  StatusBadge,
  SpeakersSection,
  DailyActivityChart,
  RealTimeTalkChart,
  ListenerTrendCard,
  AnonymousBooth,
  ShopProductCard,
  MemberAvatar,
  AudioPlayer,
  BeerCanDisplay,
  ProfileIdentityCard,
  ProfileSummaryCards,
  ProfileActivityTimeline,
  DailyBreakdown,
  ProfileVoiceTranscriptionsCard,
  ProfileMessagesCard,
  MODERATION_SERVICES,
};
