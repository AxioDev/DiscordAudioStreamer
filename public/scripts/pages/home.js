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
  MicrophoneDisplay,
  AudioPlayer,
  DailyActivityChart,
  RealTimeTalkChart,
  AnonymousBooth,
  SpeakersSection,
  ListenerTrendCard,
} from '../components/index.js';

const HIGHLIGHTS = [
  {
    title: 'Talk-show communautaire en continu',
    description:
      'Des animateurs tournants et une modération bienveillante pour offrir un espace libre, mais sécurisé, à toutes les voix nocturnes.',
  },
  {
    title: 'Histoires, jeux et culture web',
    description:
      'Débats improvisés, actualités pop et découvertes musicales : chaque soirée propose un nouveau terrain de jeu collectif.',
  },
  {
    title: 'Participation ouverte',
    description:
      'Rejoins le salon vocal, propose ton sujet et passe à l’antenne : la communauté décide avec qui et comment la discussion évolue.',
  },
];

const WEEKLY_PROGRAMME = [
  {
    day: 'Lundi',
    title: 'Table ronde communauté',
    time: '21h30',
    description: 'Revue des moments forts du week-end et ouverture micro pour planifier la semaine.',
  },
  {
    day: 'Mercredi',
    title: 'Atelier création & audio',
    time: '22h00',
    description: 'Montage, musique ou storytelling : chacun peut présenter un projet et récolter des retours.',
  },
  {
    day: 'Vendredi',
    title: 'Libre antenne nocturne',
    time: '23h00',
    description: 'Afterwork décomplexé : débats, jeux improvisés et histoires borderline jusqu’au bout de la nuit.',
  },
  {
    day: 'Dimanche',
    title: 'Débrief modération & invités',
    time: '20h30',
    description: 'Bilan de la semaine, teasing des interviews à venir et sélection des propositions de sujets.',
  },
];

const COMMUNITY_QUOTES = [
  {
    quote:
      '« Un mix improbable entre radio pirate et salon Discord : on débarque pour écouter et on finit toujours par prendre le micro. »',
    author: 'Vega',
    role: 'Auditrice depuis 2022',
  },
  {
    quote:
      '« Ici, les débats partent dans tous les sens mais l’équipe garde le cadre. C’est le seul endroit où je peux tester des idées en direct. »',
    author: 'Nox',
    role: 'Animateur bénévole',
  },
  {
    quote:
      '« Les FAQ, les replays et le blog m’aident à suivre l’actu communautaire même quand je rate le live. »',
    author: 'Lune',
    role: 'Contributrice blog',
  },
];

const FAQ_ITEMS = [
  {
    question: 'Comment participer à l’émission ?',
    answer:
      'Rejoins le Discord, vérifie le salon #brief pour connaître le sujet du moment puis connecte-toi au vocal « Libre Antenne ». Une équipe de modération t’accompagne avant ton passage à l’antenne.',
  },
  {
    question: 'Puis-je proposer un thème ou un article ?',
    answer:
      'Oui ! Utilise le formulaire « Proposer un article » dans la section blog ou poste directement ton idée dans #pitch. Les propositions sont discutées chaque dimanche.',
  },
  {
    question: 'Y a-t-il un replay ?',
    answer:
      'Les meilleures séquences sont résumées dans le blog et certaines émissions sont rediffusées lors des pauses. Suis la newsletter Discord pour connaître les prochains replays.',
  },
];

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
  bridgeStatus = { serverDeafened: false, selfDeafened: false, updatedAt: Date.now() },
}) => {
  const effectiveStatus = bridgeStatus?.serverDeafened ? 'muted' : status;
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
      class="glass-panel relative overflow-visible px-8 py-12"
    >
      <div class="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#007aff]/15 blur-3xl"></div>
      <${StatusBadge}
        status=${effectiveStatus}
        className="absolute right-4 top-4 sm:right-6 sm:top-6"
      />
      <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div class="space-y-4">
          <h1 class="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Libre Antenne</h1>
          <p class="max-w-xl text-base text-slate-600">
            Radio communautaire en direct depuis Discord : talk-shows nocturnes, débats improvisés et ateliers créatifs ouverts à
            toutes et tous.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <a
              class="soft-button gap-2 px-5 py-2 text-sm"
              href="https://discord.gg/btjTZ5C"
              target="_blank"
              rel="noopener noreferrer"
            >
              Rejoindre le Discord
              <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              class="soft-button-secondary gap-2 px-5 py-2 text-sm"
              href="#programme"
            >
              Découvrir la programmation
              <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <div class="soft-chip">
              <${Users} class="h-4 w-4 text-[#007aff]" aria-hidden="true" />
              <span aria-hidden="true" class="font-semibold text-slate-900">
                ${memberCountDisplay ? `${isApproximateMemberCount ? '≈ ' : ''}${memberCountDisplay}` : 'Indisponible'}
              </span>
              <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-slate-500"
                >Membres</span
              >
              <span class="sr-only">${`Nombre total de membres sur le serveur Discord : ${memberCountAria}`}</span>
            </div>
          </div>
        </div>
        <${MicrophoneDisplay} />
      </div>
    </section>

    <section class="glass-panel space-y-6 p-8">
      <div class="space-y-2">
        <h2 class="text-2xl font-semibold text-slate-900">Pourquoi écouter Libre Antenne ?</h2>
        <p class="text-sm text-slate-600">
          Nous diffusons le flux Discord tel qu’il se vit, avec une équipe qui garantit le cadre et accompagne chaque prise de
          parole. Voici ce que tu trouveras en rejoignant la communauté.
        </p>
      </div>
      <div class="grid gap-4 md:grid-cols-3">
        ${HIGHLIGHTS.map(
          (item) => html`
            <article class="flex h-full flex-col justify-between rounded-2xl bg-white/85 p-6 text-slate-600 shadow-[0_18px_42px_rgba(15,23,42,0.08)] ring-1 ring-white/60">
              <div class="space-y-3">
                <h3 class="text-lg font-semibold text-slate-900">${item.title}</h3>
                <p class="text-sm leading-relaxed text-slate-600">${item.description}</p>
              </div>
            </article>
          `,
        )}
      </div>
    </section>

    <section id="programme" class="glass-panel space-y-6 p-8">
      <div class="space-y-2">
        <h2 class="text-2xl font-semibold text-slate-900">Programmation hebdomadaire</h2>
        <p class="text-sm text-slate-600">
          Les créneaux sont évolutifs et s’adaptent aux envies du moment. Abonne-toi aux annonces Discord pour être averti des
          sessions spéciales.
        </p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        ${WEEKLY_PROGRAMME.map(
          (slot) => html`
            <article class="rounded-2xl bg-white/85 p-6 shadow-[0_18px_42px_rgba(15,23,42,0.08)] ring-1 ring-white/60">
              <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">${slot.day}</p>
              <div class="mt-2 flex items-baseline justify-between gap-4">
                <h3 class="text-lg font-semibold text-slate-900">${slot.title}</h3>
                <span class="soft-chip text-xs font-semibold text-[#007aff]">
                  ${slot.time}
                </span>
              </div>
              <p class="mt-3 text-sm leading-relaxed text-slate-600">${slot.description}</p>
            </article>
          `,
        )}
      </div>
    </section>

    <section class="glass-panel space-y-6 p-8">
      <div class="space-y-2">
        <h2 class="text-2xl font-semibold text-slate-900">Ils prennent le micro</h2>
        <p class="text-sm text-slate-600">
          La radio appartient à celles et ceux qui la font vivre. Quelques retours de la communauté.
        </p>
      </div>
      <div class="grid gap-4 md:grid-cols-3">
        ${COMMUNITY_QUOTES.map(
          (entry) => html`
            <figure class="flex h-full flex-col justify-between rounded-2xl bg-white/85 p-6 shadow-[0_18px_42px_rgba(15,23,42,0.08)] ring-1 ring-white/60">
              <blockquote class="text-sm italic text-slate-600">${entry.quote}</blockquote>
              <figcaption class="mt-4 text-xs uppercase tracking-[0.35em] text-slate-500">
                <span class="block text-sm font-semibold tracking-normal text-slate-900">${entry.author}</span>
                <span class="text-slate-500">${entry.role}</span>
              </figcaption>
            </figure>
          `,
        )}
      </div>
    </section>

    <section class="glass-panel relative overflow-hidden p-8">
      <div class="pointer-events-none absolute -right-20 bottom-0 h-56 w-56 rounded-full bg-[#007aff]/12 blur-3xl"></div>
      <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold text-slate-900">Flux audio en direct</h2>
          <p class="text-sm text-slate-600">
            Clique sur lecture si le flux ne démarre pas automatiquement. Volume conseillé : casque.
          </p>
        </div>
      </div>
    <${AudioPlayer}
      streamInfo=${streamInfo}
      audioKey=${audioKey}
      status=${effectiveStatus}
      bridgeStatus=${bridgeStatus}
    />
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

    <section class="glass-panel space-y-4 p-8">
      <h2 class="text-2xl font-semibold text-slate-900">Questions fréquentes</h2>
      <div class="space-y-3">
        ${FAQ_ITEMS.map(
          (item) => html`
            <details class="group rounded-2xl bg-white/85 p-5 text-slate-600 shadow-[0_18px_42px_rgba(15,23,42,0.08)] ring-1 ring-white/60 transition">
              <summary class="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]/40">
                ${item.question}
                <span class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 transition group-open:text-[#007aff]">
                  Ouvrir
                </span>
              </summary>
              <p class="mt-3 text-sm leading-relaxed text-slate-600">${item.answer}</p>
            </details>
          `,
        )}
      </div>
    </section>

    <section class="glass-panel relative overflow-hidden p-8">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-slate-900">Intervenants en temps réel</h2>
          <p class="text-sm text-slate-600">
            Toutes les personnes connectées au salon vocal apparaissent ici et l’animation se déclenche dès qu’une voix est détectée.
          </p>
        </div>
        <div class="soft-chip flex items-center gap-3 px-4 py-1.5 text-xs tracking-[0.25em] text-slate-500">
          <span class="sr-only">Statistiques vocales</span>
          <span class="flex items-center gap-2">
            <${Users} class="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" class="text-sm font-semibold tracking-normal text-slate-900">${connectedCount}</span>
            <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-slate-500">Co</span>
            <span class="sr-only">personnes connectées</span>
          </span>
          <span aria-hidden="true" class="text-slate-400">·</span>
          <span class="flex items-center gap-2">
            <${Activity} class="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" class="text-sm font-semibold tracking-normal text-slate-900">${activeSpeakersCount}</span>
            <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-slate-500">Actifs</span>
            <span class="sr-only">personnes actives</span>
          </span>
          <span aria-hidden="true" class="text-slate-400">·</span>
          <span class="flex items-center gap-2">
            <${Headphones} class="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" class="text-sm font-semibold tracking-normal text-slate-900">${listenerCount}</span>
            <span aria-hidden="true" class="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-slate-500">Flux</span>
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
