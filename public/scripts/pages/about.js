import {
  Fragment,
  html,
  ArrowRight,
} from '../core/deps.js';

const AboutPage = () => html`
  <${Fragment}>
    <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">À propos de Libre Antenne</h1>
      <p class="text-base leading-relaxed text-slate-200">
        Libre Antenne est une zone franche où les voix prennent le pouvoir. Le flux est volontairement brut,
        capté en direct sur notre serveur Discord pour amplifier les histoires, les confidences et les improvisations qui naissent.
      </p>
      <p class="text-base leading-relaxed text-slate-200">
        Notre équipe façonne un espace accueillant pour les marginaux créatifs, les gamers insomniaques et toutes les personnes
        qui ont besoin d’un micro ouvert. Ici, aucune intervention n’est scriptée : la seule règle est de respecter la vibe
        collective et de laisser la spontanéité guider la conversation.
      </p>
      <a
        class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/20 hover:text-white"
        href="https://discord.gg/"
        target="_blank"
        rel="noreferrer"
      >
        Rejoindre la communauté
        <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
      </a>
    </section>

    <section class="grid gap-6 md:grid-cols-2">
      <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-xl font-semibold text-white">Un laboratoire créatif</h2>
        <p class="mt-3 text-sm text-slate-300">
          Sessions freestyle, confessions lunaires, débats improvisés : chaque passage est un moment unique façonné par la communauté.
          Le direct nous permet de capturer cette énergie sans filtre.
        </p>
      </div>
      <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-xl font-semibold text-white">Technologie artisanale</h2>
        <p class="mt-3 text-sm text-slate-300">
          Notre mixeur audio fait circuler chaque voix avec finesse. Les outils open source et les contributions des membres
          permettent d’améliorer constamment la qualité du flux.
        </p>
      </div>
      <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-xl font-semibold text-white">Communauté inclusive</h2>
        <p class="mt-3 text-sm text-slate-300">
          Peu importe ton accent, ton parcours ou ton rythme de vie : tu es accueilli·e tant que tu joues collectif et que tu respectes
          celles et ceux qui partagent le micro.
        </p>
      </div>
      <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-xl font-semibold text-white">Un projet vivant</h2>
        <p class="mt-3 text-sm text-slate-300">
          Les bénévoles, auditeurs et créateurs participent à l’évolution de Libre Antenne. Chaque nouvelle voix façonne la suite
          de l’aventure et inspire les fonctionnalités à venir.
        </p>
      </div>
    </section>
  </${Fragment}>
`;

export { AboutPage };
