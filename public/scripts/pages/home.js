import {
  Fragment,
  html,
  Activity,
  ArrowRight,
  Users,
  Headphones,
} from '../core/deps.js';
import {
  StatusBadge,
  BeerCanDisplay,
  AudioPlayer,
  DailyActivityChart,
  RealTimeTalkChart,
  AnonymousBooth,
  SpeakersSection,
  ListenerTrendCard,
} from '../components/index.js';

const HomePage = ({
  status,
  streamInfo,
  audioKey,
  speakers,
  now,
  anonymousSlot,
  speakingHistory,
  isHistoryLoading,
  selectedWindowMinutes,
  onWindowChange,
  onViewProfile,
  listenerStats = { count: 0, history: [] },
  guildSummary = null,
}) => {
  const connectedCount = speakers.length;
  const activeSpeakersCount = speakers.reduce(
    (count, speaker) => count + (speaker?.isSpeaking ? 1 : 0),
    0,
  );
  const listenerCount = Number.isFinite(listenerStats?.count)
    ? Math.max(0, Math.round(listenerStats.count))
    : 0;

  const normalizeCount = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Math.max(0, Math.round(numeric));
  };

  const exactMemberCount = normalizeCount(guildSummary?.memberCount);
  const approximateMemberCount = normalizeCount(guildSummary?.approximateMemberCount);
  const resolvedMemberCount = exactMemberCount ?? approximateMemberCount;
  const isApproximateMemberCount = exactMemberCount === null && approximateMemberCount !== null;
  const memberCountDisplay =
    resolvedMemberCount !== null
      ? new Intl.NumberFormat('fr-FR').format(resolvedMemberCount)
      : null;
  const memberCountAria = isApproximateMemberCount
    ? `Environ ${memberCountDisplay ?? 'indisponible'}`
    : memberCountDisplay ?? 'indisponible';

  return html`
    <${Fragment}>
    <section
      class="relative overflow-visible rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/50 backdrop-blur-xl"
    >
      <div class="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-fuchsia-500/25 blur-3xl"></div>
      <${StatusBadge}
        status=${status}
        className="absolute right-4 top-4 sm:right-6 sm:top-6"
      />
      <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div class="space-y-4">
          <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Libre Antenne</h1>
          <p class="max-w-xl text-base text-slate-200">
            Le chaos en direct : un refuge sans filtre pour drogués, marginaux, alcooliques, gamers et esprits libres.
          </p>
          <a
            class="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/60 bg-fuchsia-500/20 px-5 py-2 text-sm font-semibold text-fuchsia-100 shadow-lg shadow-fuchsia-900/40 transition hover:bg-fuchsia-500/30 hover:text-white"
            href="https://discord.gg/btjTZ5C"
            target="_blank"
            rel="noopener noreferrer"
          >
            Rejoindre le Discord
            <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
          </a>
          <div class="flex flex-wrap items-center gap-3 text-sm text-slate-200/90">
            <div class="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5">
              <${Users} class="h-4 w-4 text-amber-300" aria-hidden="true" />
              <span aria-hidden="true" class="font-semibold text-white">
                ${memberCountDisplay ? `${isApproximateMemberCount ? '≈ ' : ''}${memberCountDisplay}` : 'Indisponible'}
              </span>
              <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-amber-200/80"
                >Membres</span
              >
              <span class="sr-only">${`Nombre total de membres sur le serveur Discord : ${memberCountAria}`}</span>
            </div>
          </div>
        </div>
        <${BeerCanDisplay} />
      </div>
    </section>

    <section class="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <div class="pointer-events-none absolute -right-20 bottom-0 h-56 w-56 rounded-full bg-indigo-400/30 blur-3xl"></div>
      <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold text-white">Flux audio en direct</h2>
          <p class="text-sm text-slate-300">
            Clique sur lecture si le flux ne démarre pas automatiquement. Volume conseillé : casque 💜
          </p>
        </div>
      </div>
    <${AudioPlayer} streamInfo=${streamInfo} audioKey=${audioKey} status=${status} />
  </section>

  <${DailyActivityChart}
    history=${speakingHistory}
    now=${now}
    isHistoryLoading=${isHistoryLoading}
  />

    <${RealTimeTalkChart}
    history=${speakingHistory}
    speakers=${speakers}
    now=${now}
      selectedWindowMinutes=${selectedWindowMinutes}
      onWindowChange=${onWindowChange}
      onViewProfile=${onViewProfile}
    />

    <${AnonymousBooth} slot=${anonymousSlot} now=${now} />

    <section class="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-white">Intervenants en temps réel</h2>
          <p class="text-sm text-slate-300">
            Toutes les personnes connectées au salon vocal apparaissent ici et l’animation se déclenche dès qu’une voix est détectée.
          </p>
        </div>
        <div class="flex items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-xs tracking-[0.3em] text-indigo-200">
          <span class="sr-only">Statistiques vocales</span>
          <span class="flex items-center gap-2">
            <${Users} class="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" class="text-sm font-semibold tracking-normal">${connectedCount}</span>
            <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-indigo-200/80">Co</span>
            <span class="sr-only">personnes connectées</span>
          </span>
          <span aria-hidden="true" class="text-indigo-300">·</span>
          <span class="flex items-center gap-2">
            <${Activity} class="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" class="text-sm font-semibold tracking-normal">${activeSpeakersCount}</span>
            <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-indigo-200/80">Actifs</span>
            <span class="sr-only">personnes actives</span>
          </span>
          <span aria-hidden="true" class="text-indigo-300">·</span>
          <span class="flex items-center gap-2">
            <${Headphones} class="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" class="text-sm font-semibold tracking-normal">${listenerCount}</span>
            <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-indigo-200/80">Flux</span>
            <span class="sr-only">auditeurs du flux</span>
          </span>
        </div>
      </div>
      <${SpeakersSection} speakers=${speakers} now=${now} onViewProfile=${onViewProfile} />
    </section>

    <${ListenerTrendCard} stats=${listenerStats} now=${now} />
    </${Fragment}>
  `;
};

export { HomePage };
