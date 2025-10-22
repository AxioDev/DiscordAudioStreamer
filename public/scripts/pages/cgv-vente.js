import { Fragment, html } from '../core/deps.js';

const pricingPoints = [
  "Tous les tarifs sont indiqués en euros toutes taxes comprises (TVA non applicable, art. 293 B du CGI) et incluent les frais de préparation.",
  "Les frais de livraison sont calculés lors du passage de commande en fonction de l'adresse et du transporteur sélectionné.",
  "Les prix peuvent évoluer à tout moment mais les produits sont facturés sur la base du tarif affiché au moment de la validation du paiement.",
  "Une facture numérique récapitulative est envoyée automatiquement à l'adresse e-mail communiquée lors du paiement.",
];

const paymentProviders = [
  {
    title: 'Paiement sécurisé Stripe',
    description:
      'Règlement par carte bancaire, Apple Pay ou Google Pay via Stripe. Les données de carte ne transitent jamais par nos serveurs et les transactions sont chiffrées (TLS 1.2+).',
  },
  {
    title: 'Compte PayPal',
    description:
      'Connexion à ton compte PayPal pour régler en une étape. PayPal peut proposer un paiement en plusieurs fois selon ton éligibilité. Les éventuels frais PayPal sont affichés avant confirmation.',
  },
  {
    title: 'Crypto via CoinGate',
    description:
      'Paiement en Bitcoin, Lightning ou plus de 70 crypto-actifs via CoinGate. La conversion en euros est instantanée ; les frais de réseau sont indiqués avant validation.',
  },
];

const paymentCommitments = [
  "Le débit intervient au moment de la confirmation par le prestataire de paiement.",
  "Les tentatives frauduleuses entraînent l'annulation immédiate de la commande et la suspension de l'accès à la boutique.",
  "Pour toute demande de justificatif comptable complémentaire, contacte-nous dans les 14 jours suivant l'achat.",
];

const deliveryClauses = [
  "Les produits physiques sont fabriqués à la demande puis expédiés sous 5 à 7 jours ouvrés. Le délai de livraison dépend ensuite du transporteur (généralement 2 à 5 jours ouvrés en France métropolitaine).",
  "Un e-mail de suivi est envoyé dès que le colis est pris en charge. Il contient le numéro de suivi et le lien vers le transporteur.",
  "Assure-toi que l'adresse fournie est exacte ; un second envoi lié à une erreur d'adresse pourra être facturé au tarif réel du transporteur.",
  "Les produits numériques ou services immatériels sont livrés par e-mail immédiatement après la confirmation du paiement.",
];

const withdrawalSteps = [
  "Tu disposes d'un délai de rétractation de 14 jours calendaires à compter de la réception du colis (ou de la confirmation pour un service immatériel non entamé).",
  "Envoie ta demande à axiocontactezmoi@protonmail.com ou via le salon Discord #support en précisant ton numéro de commande et le produit concerné.",
  "Les articles doivent être renvoyés dans leur emballage d'origine, non utilisés et accompagnés de la preuve d'achat. Les frais de retour restent à ta charge sauf erreur de notre part.",
  "Les produits personnalisés ou scellés qui ont été ouverts après livraison ne peuvent pas faire l'objet d'un droit de rétractation, conformément à l'article L221-28 du Code de la consommation.",
];

const serviceChannels = [
  'Salon #support sur Discord pour un échange quasi instantané avec la coordination.',
  'Courriel dédié : axiocontactezmoi@protonmail.com (réponse sous 72 heures ouvrées).',
  'Suivi de commande renforcé possible par téléphone sur rendez-vous (coordonnées communiquées après prise de contact).',
];

const disputeNotes = [
  "En cas de colis endommagé, formule des réserves précises auprès du transporteur dans les 48 heures et préviens-nous pour ouvrir une enquête.",
  "Les litiges peuvent être soumis au service de médiation de la consommation dont les coordonnées seront communiquées sur demande.",
  "La plateforme européenne de règlement en ligne des litiges est accessible sur https://ec.europa.eu/consumers/odr/.",
];

const CgvVentePage = () => html`
  <${Fragment}>
    <article class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Conditions générales de vente</h1>
      <p class="text-base leading-relaxed text-slate-200">
        Ces conditions encadrent toute commande passée sur la boutique Libre Antenne. Elles détaillent les prix TTC,
        les moyens de paiement acceptés, les modalités de livraison, ton droit de rétractation et la façon de joindre
        notre service client. En validant un achat, tu reconnais les avoir lues et acceptées.
      </p>
    </article>

    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">1. Prix & facturation TTC</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
        ${pricingPoints.map((item) => html`<li key=${item}>${item}</li>`)}
      </ul>
    </section>

    <section class="grid gap-6 lg:grid-cols-3">
      ${paymentProviders.map(
        (method) => html`
          <article
            key=${method.title}
            class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur"
          >
            <h3 class="text-base font-semibold text-white">${method.title}</h3>
            <p class="mt-3 text-sm leading-relaxed text-slate-300">${method.description}</p>
          </article>
        `,
      )}
    </section>

    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">2. Modalités de paiement</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
        ${paymentCommitments.map((item) => html`<li key=${item}>${item}</li>`)}
      </ul>
    </section>

    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">3. Livraison & disponibilité</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
        ${deliveryClauses.map((item) => html`<li key=${item}>${item}</li>`)}
      </ul>
    </section>

    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">4. Droit de rétractation</h2>
      <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
        ${withdrawalSteps.map((item) => html`<li key=${item}>${item}</li>`)}
      </ol>
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">5. Service client & suivi</h2>
        <p class="text-sm leading-relaxed text-slate-300">
          Notre équipe bénévole reste disponible pour toute question avant ou après ton achat. Indique ton numéro de commande
          pour accélérer le traitement de ta demande.
        </p>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${serviceChannels.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </article>
      <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">6. Litiges & médiation</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${disputeNotes.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </article>
    </section>

    <p class="text-xs uppercase tracking-[0.25em] text-slate-500">Dernière mise à jour : 10 mars 2025</p>
  </${Fragment}>
`;

export { CgvVentePage };
