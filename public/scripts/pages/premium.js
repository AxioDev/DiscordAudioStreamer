import {
  Fragment,
  html,
  Sparkles,
  ShieldCheck,
  Users,
  Clock3,
  ShoppingBag,
  MessageSquare,
} from '../core/deps.js';

const HERO_PARAGRAPHS = [
  "Le programme premium finance l'infrastructure audio, la modération nocturne et les ateliers animés par la communauté.",
  "Les abonnements sont sans engagement : chaque contribution débloque des accès dédiés et renforce la diffusion libre de la radio.",
];

const BENEFITS = [
  {
    icon: Sparkles,
    title: 'Accès prioritaire',
    description:
      'Rejoins les masterclasses, sessions feedback et tests de nouveautés avant tout le monde avec un canal de coordination dédié.',
  },
  {
    icon: ShieldCheck,
    title: 'Coulisses & replays privés',
    description:
      'Retrouve les briefs d’émission, les replays audio en accès limité et les notes de modération pour approfondir chaque thème.',
  },
  {
    icon: Users,
    title: 'Soutien transparent',
    description:
      'Chaque contribution finance le serveur audio, la maintenance du bot et les outils de diffusion communautaires.',
  },
];

const INCLUSIONS = [
  'Badge premium sur Discord et sur la plateforme web',
  'Accès anticipé aux ateliers thématiques et aux tests techniques',
  'Newsletter backstage avec récap des débats et coulisses du direct',
  'Role spécial pour voter sur la programmation et les invités',
];

const FAQ_ITEMS = [
  {
    question: 'Comment activer mon accès premium ?',
    answer:
      'Passe par la boutique Libre Antenne pour choisir une formule. Une fois le paiement confirmé, l’équipe ajoute ton rôle premium sur Discord dans les 24 heures.',
  },
  {
    question: 'Puis-je arrêter mon soutien quand je veux ?',
    answer:
      'Oui. Les formules sont sans engagement : tu peux annuler ton abonnement depuis ton fournisseur de paiement et conserveras l’accès jusqu’à la fin de la période en cours.',
  },
  {
    question: 'Que finance concrètement mon abonnement ?',
    answer:
      'Les contributions couvrent l’hébergement du serveur audio, les licences logicielles, la diffusion web en continu et une partie des goodies offerts aux bénévoles actifs.',
  },
];

const PremiumPage = () => html`
  <${Fragment}>
    <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Soutenir Libre Antenne</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Accès Premium & soutien communautaire</h1>
      ${HERO_PARAGRAPHS.map(
        (paragraph) => html`
          <p class="text-base leading-relaxed text-slate-200">${paragraph}</p>
        `,
      )}
      <div class="flex flex-wrap gap-3">
        <a
          class="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/30 hover:text-white"
          href="/boutique"
        >
          Choisir une formule
          <${ShoppingBag} class="h-4 w-4" aria-hidden="true" />
        </a>
        <a
          class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/20 hover:text-white"
          href="https://discord.gg/"
          target="_blank"
          rel="noreferrer"
        >
          Contacter l'équipe
          <${MessageSquare} class="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </section>

    <section class="grid gap-6 md:grid-cols-3">
      ${BENEFITS.map(
        ({ icon: Icon, title, description }) => html`
          <article class="space-y-4 rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
            <span class="inline-flex h-12 w-12 items-center justify-center rounded-full bg-fuchsia-500/15 text-fuchsia-200">
              <${Icon} class="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 class="text-xl font-semibold text-white">${title}</h2>
            <p class="text-sm leading-relaxed text-slate-300">${description}</p>
          </article>
        `,
      )}
    </section>

    <section class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div class="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-2xl font-semibold text-white">Ce que comprend l'accès premium</h2>
        <ul class="space-y-3 text-sm text-slate-200">
          ${INCLUSIONS.map(
            (item) => html`
              <li class="flex items-start gap-3">
                <span class="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-500/20 text-fuchsia-200">
                  <${ShieldCheck} class="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span class="leading-relaxed">${item}</span>
              </li>
            `,
          )}
        </ul>
      </div>
      <div class="space-y-4 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-inner shadow-slate-950/50">
        <h2 class="text-2xl font-semibold text-white">Rythme & accompagnement</h2>
        <p class="text-sm leading-relaxed text-slate-300">
          L'équipe premium suit personnellement chaque nouveau membre : un brief Discord est organisé pour activer les rôles et
          présenter les prochains rendez-vous communautaires.
        </p>
        <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/20 text-fuchsia-200">
            <${Clock3} class="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p class="font-semibold text-white">Activation sous 24h ouvrées</p>
            <p class="text-xs text-slate-300">Un salon dédié permet de suivre l'état de ton adhésion et d'échanger avec l'équipe support.</p>
          </div>
        </div>
        <p class="text-sm leading-relaxed text-slate-300">
          Les contributions sont regroupées chaque mois dans un rapport transparent partagé sur le serveur : infrastructure,
          licences et dotations bénévoles.
        </p>
      </div>
    </section>

    <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-6 py-8 shadow-xl shadow-slate-950/40 backdrop-blur">
      <h2 class="text-2xl font-semibold text-white">Questions fréquentes</h2>
      <div class="space-y-5">
        ${FAQ_ITEMS.map(
          ({ question, answer }) => html`
            <details class="group rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-slate-200 shadow-sm shadow-slate-950/30">
              <summary class="cursor-pointer select-none text-base font-semibold text-white">
                ${question}
              </summary>
              <p class="mt-3 text-sm leading-relaxed text-slate-300">${answer}</p>
            </details>
          `,
        )}
      </div>
    </section>
  </${Fragment}>
`;

export { PremiumPage };
