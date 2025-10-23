// @ts-nocheck
import {
  Fragment,
  html,
  AlertCircle,
  Mic,
  MicOff,
  ShieldCheck,
  Sparkles,
  Users,
  Headphones,
  X,
  ArrowRight,
} from '../core/deps';
import { MODERATION_SERVICES } from '../components/index';

const BanPage = () => html`
  <${Fragment}>
    <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Modération</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Modération</h1>
      <p class="text-base leading-relaxed text-slate-200">
        Besoin d’écarter un fauteur de trouble sans casser l’ambiance ? Choisis la sanction la plus adaptée.
        Mute express ou bannissement encadré : l’équipe Libre Antenne se charge de l’exécution, du suivi et
        du rapport staff.
      </p>
      <div class="flex flex-wrap gap-3 text-xs text-slate-200">
        <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5">
          <${MicOff} class="h-4 w-4" aria-hidden="true" />
          Mise en sourdine express
        </span>
        <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5">
          <${ShieldCheck} class="h-4 w-4" aria-hidden="true" />
          Process encadré
        </span>
        <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5">
          <${Sparkles} class="h-4 w-4" aria-hidden="true" />
          Rapport modération inclus
        </span>
      </div>
    </section>

    <section class="space-y-6 rounded-3xl border border-indigo-400/30 bg-indigo-500/10 p-6 shadow-lg shadow-indigo-900/30 backdrop-blur">
      <div class="space-y-2">
        <p class="text-xs uppercase tracking-[0.35em] text-indigo-200">Nouvelle gamme</p>
        <h2 class="text-2xl font-semibold text-white">Gamme « Droits de modération »</h2>
        <p class="text-sm leading-relaxed text-indigo-100/80">
          Active à la demande les actions clés du staff pour garder le contrôle du salon vocal sans attendre.
        </p>
      </div>
      <ul class="grid gap-4 sm:grid-cols-2">
        <li class="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/20 text-indigo-100">
            <${MicOff} class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="space-y-1">
            <p class="text-sm font-semibold text-white">Mute</p>
            <p class="text-xs leading-relaxed text-slate-300">Coupure immédiate du micro pour stopper un débordement.</p>
          </div>
        </li>
        <li class="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-100">
            <${Mic} class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="space-y-1">
            <p class="text-sm font-semibold text-white">Démute</p>
            <p class="text-xs leading-relaxed text-slate-300">Restauration encadrée de la parole après validation du staff.</p>
          </div>
        </li>
        <li class="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-fuchsia-400/40 bg-fuchsia-500/20 text-fuchsia-100">
            <${Users} class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="space-y-1">
            <p class="text-sm font-semibold text-white">Expulser</p>
            <p class="text-xs leading-relaxed text-slate-300">Éjection ciblée pour préserver la sécurité du vocal.</p>
          </div>
        </li>
        <li class="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/20 text-sky-100">
            <${Headphones} class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="space-y-1">
            <p class="text-sm font-semibold text-white">Mute casque</p>
            <p class="text-xs leading-relaxed text-slate-300">Silence le retour audio d’un membre sans couper son micro.</p>
          </div>
        </li>
        <li class="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 sm:col-span-2">
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-rose-400/40 bg-rose-500/20 text-rose-100">
            <${X} class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="space-y-1">
            <p class="text-sm font-semibold text-white">Déconnecter</p>
            <p class="text-xs leading-relaxed text-slate-300">Retire complètement du salon vocal les profils non conformes.</p>
          </div>
        </li>
      </ul>
    </section>

    <section class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      ${MODERATION_SERVICES.map(
        (service) => html`<article
          key=${service.id}
          class="flex h-full flex-col rounded-3xl border border-white/10 bg-black/40 p-6 shadow-lg shadow-slate-950/40 backdrop-blur"
        >
          <p class="text-xs uppercase tracking-[0.35em] text-slate-300">${
            service.categoryLabel || 'Option modération'
          }</p>
          <h3 class="mt-2 text-lg font-semibold text-white">${service.title}</h3>
          <p class="mt-3 text-sm leading-relaxed text-slate-300">${service.description}</p>
          <div class=${`mt-5 rounded-2xl border px-4 py-4 text-center ${service.accent}`}>
            <p class="text-3xl font-bold text-white">${service.price}</p>
            <p class="mt-1 text-xs uppercase tracking-[0.35em] text-slate-200">TTC</p>
            <p class="sr-only">Tarif incluant la majoration de 10 %.</p>
          </div>
          <div class="mt-5 flex items-center gap-2 text-xs text-slate-400">
            <${ShieldCheck} class="h-4 w-4 text-emerald-300" aria-hidden="true" />
            <span>Application confirmée après validation avec le staff.</span>
          </div>
        </article>`,
      )}
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
          <h2 class="flex items-center gap-2 text-xl font-semibold text-white">
            <${ShieldCheck} class="h-5 w-5 text-emerald-300" aria-hidden="true" />
            Comment ça marche ?
          </h2>
          <ol class="space-y-3 pl-5 text-sm leading-relaxed text-slate-200 marker:text-fuchsia-200">
            <li>
              Ouvre un ticket staff sur Discord en précisant le pseudo, la durée souhaitée et le motif de la sanction.
            </li>
            <li>
              Règle le montant correspondant au palier choisi via la boutique (Stripe, PayPal ou CoinGate).
            </li>
            <li>
              La modération applique l’action demandée, documente l’intervention et te confirme le suivi dans la foulée.
            </li>
          </ol>
        </div>
        <div class="space-y-4 rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/50 backdrop-blur">
          <h2 class="flex items-center gap-2 text-xl font-semibold text-white">
            <${AlertCircle} class="h-5 w-5 text-amber-300" aria-hidden="true" />
            Bon à savoir
          </h2>
          <ul class="space-y-3 text-sm leading-relaxed text-slate-200">
            <li>
              Les durées sont cumulables si la situation exige une sanction plus longue que le barème standard.
            </li>
            <li>
              Aucune action n’est appliquée sans trace écrite : un log privé reste disponible pour l’équipe.
            </li>
            <li>
              En cas de litige, le staff se réserve le droit de prolonger ou d’annuler la sanction après enquête.
            </li>
          </ul>
        </div>
      </section>

    <section class="rounded-3xl border border-white/10 bg-black/50 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="space-y-2">
          <h2 class="text-xl font-semibold text-white">Prêt à lancer une action de modération ?</h2>
          <p class="text-sm leading-relaxed text-slate-300">
            Contacte immédiatement la modération pour confirmer les détails et sécuriser la communauté.
          </p>
        </div>
        <a
          class="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/50 bg-fuchsia-500/20 px-5 py-2 text-sm font-semibold text-fuchsia-100 shadow-lg shadow-fuchsia-900/30 transition hover:bg-fuchsia-500/30 hover:text-white"
          href="https://discord.gg/btjTZ5C"
          target="_blank"
          rel="noopener noreferrer"
        >
          Contacter la modération
          <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  </${Fragment}>
`;


export { BanPage };
