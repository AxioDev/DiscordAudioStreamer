// @ts-nocheck
import {
  Fragment,
  html,
  ArrowRight,
  CreditCard,
  Coins,
  RefreshCcw,
  ShieldCheck,
  Truck,
  Wallet,
} from '../core/deps';

const PRICING_PRINCIPLES = [
  'Les prix sont indiqués en euros, toutes taxes comprises (TTC) et incluent la TVA applicable.',
  'Les frais de livraison sont précisés avant validation du paiement lorsque le produit est expédié physiquement.',
  'Les éventuelles promotions sont appliquées automatiquement au moment du paiement et ne sont pas cumulables.',
  'Les paiements sont débités immédiatement au moment de la confirmation, sauf indication contraire de ton prestataire bancaire.',
];

const PAYMENT_OPTIONS = [
  {
    Icon: CreditCard,
    title: 'Stripe – Cartes bancaires, Apple Pay, Google Pay',
    description:
      'Paiement sécurisé via Stripe avec authentification forte quand elle est requise. Les cartes Visa, Mastercard, CB, Apple Pay et Google Pay sont acceptées.',
    helper:
      'Aucun numéro de carte n’est stocké sur nos serveurs ; Stripe nous transmet uniquement un identifiant de transaction.',
  },
  {
    Icon: Wallet,
    title: 'PayPal – Compte PayPal ou cartes enregistrées',
    description:
      'Tu peux régler via ton solde PayPal, une carte liée à ton compte ou un paiement invité. PayPal agit en tant qu’intermédiaire de paiement.',
    helper:
      'Le débit est immédiat et PayPal t’enverra sa propre confirmation en parallèle de la nôtre.',
  },
  {
    Icon: Coins,
    title: 'CoinGate – Bitcoin, Lightning & plus de 70 altcoins',
    description:
      'Les paiements crypto sont convertis en euros lors de l’encaissement ou conservés selon ta préférence CoinGate. Les montants sont verrouillés au moment de la commande.',
    helper:
      'Assure-toi de finaliser la transaction avant l’expiration du compte à rebours CoinGate pour éviter l’annulation automatique.',
  },
];

const DELIVERY_STEPS = [
  {
    title: 'Production & emballage',
    body:
      'Les articles physiques sont fabriqués à la demande puis emballés avec protection anti-chocs avant expédition. Tu reçois un courriel de confirmation dès la mise en production.',
  },
  {
    title: 'Transport & suivi',
    body:
      'La livraison s’effectue en France métropolitaine et dans l’Union européenne via un transporteur partenaire. Un lien de suivi est envoyé dès la prise en charge du colis.',
  },
  {
    title: 'Produits numériques',
    body:
      'Les accès premium et contenus dématérialisés sont délivrés immédiatement après validation du paiement via un lien sécurisé ou un rôle Discord attribué automatiquement.',
  },
];

const WITHDRAWAL_STEPS = [
  'Préviens-nous sous quatorze jours à compter de la réception en écrivant à axiocontactezmoi@protonmail.com ou via le salon Discord #support.',
  'Indique ton numéro de commande, le produit concerné et la date de réception pour faciliter le traitement.',
  'Remballe le produit dans son état d’origine. Les retours sont à ta charge sauf erreur de notre part ; le remboursement intervient sous quatorze jours après réception.',
];

const WITHDRAWAL_EXCEPTIONS = [
  'Les contenus numériques fournis immédiatement après achat (accès premium, téléchargements) ne bénéficient pas du droit de rétractation une fois le lien ou le rôle livré, conformément à l’article L221-28 du Code de la consommation.',
  'Les produits personnalisés ou clairement adaptés à tes demandes spécifiques ne sont pas repris.',
];

const SERVICE_CHANNELS = [
  'Salon Discord #support – réponses rapides pendant les heures de diffusion en direct.',
  'Email : axiocontactezmoi@protonmail.com – suivi écrit, questions de facturation ou réclamations.',
  'Suivi logistique : lien de tracking communiqué par email dès l’expédition du colis.',
];

const CgvVentePage = () => html`
  <${Fragment}>
    <article class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Conditions générales de vente</h1>
      <p class="text-base leading-relaxed text-slate-200">
        Ces conditions générales de vente (CGV) encadrent les achats réalisés sur la boutique Libre Antenne.
        Elles complètent nos CGU et décrivent précisément les prix TTC, modalités de paiement, délais de
        livraison, droit de rétractation et modes de contact du service client.
      </p>
      <p class="text-base leading-relaxed text-slate-200">
        Toute commande implique l’acceptation sans réserve des présentes CGV. N’hésite pas à nous contacter si
        tu as la moindre question avant de valider ton panier.
      </p>
      <ul class="list-disc space-y-2 pl-6 text-sm text-slate-200">
        ${PRICING_PRINCIPLES.map((item) => html`<li key=${item}>${item}</li>`) }
      </ul>
    </article>

    <section class="grid gap-6 lg:grid-cols-3">
      ${PAYMENT_OPTIONS.map(
        ({ Icon, title, description, helper }) => html`
          <article
            key=${title}
            class="flex h-full flex-col rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur"
          >
            <div class="flex items-center gap-3">
              <span class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white">
                <${Icon} class="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 class="text-lg font-semibold text-white">${title}</h2>
            </div>
            <p class="mt-4 text-sm leading-relaxed text-slate-300">${description}</p>
            <p class="mt-3 text-xs text-slate-400">${helper}</p>
          </article>
        `,
      )}
    </section>

    <section class="grid gap-6 lg:grid-cols-3">
      ${DELIVERY_STEPS.map(
        ({ title, body }) => html`
          <article
            key=${title}
            class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur"
          >
            <h3 class="flex items-center gap-2 text-lg font-semibold text-white">
              <${Truck} class="h-5 w-5 text-emerald-300" aria-hidden="true" />
              ${title}
            </h3>
            <p class="mt-3 text-sm leading-relaxed text-slate-300">${body}</p>
          </article>
        `,
      )}
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h3 class="flex items-center gap-2 text-lg font-semibold text-white">
          <${RefreshCcw} class="h-5 w-5 text-emerald-300" aria-hidden="true" />
          Droit de rétractation
        </h3>
        <p class="mt-3 text-sm leading-relaxed text-slate-300">
          Conformément au Code de la consommation, tu disposes d’un délai de 14 jours à compter de la réception
          pour te rétracter, hors exceptions prévues par la loi.
        </p>
        <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300">
          ${WITHDRAWAL_STEPS.map((item) => html`<li key=${item}>${item}</li>`)}
        </ol>
        <div class="mt-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-xs text-slate-400">
          ${WITHDRAWAL_EXCEPTIONS.map(
            (item) => html`<p key=${item} class="mt-2 first:mt-0">${item}</p>`,
          )}
        </div>
      </div>
      <div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h3 class="flex items-center gap-2 text-lg font-semibold text-white">
          <${ShieldCheck} class="h-5 w-5 text-emerald-300" aria-hidden="true" />
          Service client & suivi
        </h3>
        <p class="mt-3 text-sm leading-relaxed text-slate-300">
          Notre équipe reste disponible avant, pendant et après la commande pour répondre à tes questions,
          suivre un colis ou traiter une réclamation.
        </p>
        <ul class="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${SERVICE_CHANNELS.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
        <a
          class="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-white/20"
          href="mailto:axiocontactezmoi@protonmail.com"
        >
          Nous écrire
          <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </section>

    <p class="text-xs uppercase tracking-[0.25em] text-slate-500">Dernière mise à jour : 10 mars 2025</p>
  </${Fragment}>
`;

export { CgvVentePage };
