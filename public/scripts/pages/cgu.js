import { Fragment, html } from '../core/deps.js';

const DATA_CATEGORIES = [
  {
    title: 'Flux audio en direct',
    description:
      'Les voix captées sur Discord sont transmises en continu pour la diffusion publique du direct Libre Antenne.',
    usage:
      'Diffusion du direct, supervision technique en temps réel et détection d’abus pour protéger les membres.',
    retention:
      'Aucun enregistrement permanent. Tampon de diffusion inférieur à deux minutes et journaux techniques conservés 24 heures maximum.',
  },
  {
    title: 'Métadonnées Discord & activité communautaire',
    description:
      'Identifiants Discord, pseudonymes, états vocaux, temps de présence et statistiques de participation générés pendant les sessions.',
    usage:
      'Affichage des participants, génération des classements, lutte contre le spam et modération communautaire.',
    retention:
      'Historique agrégé conservé douze mois pour les classements ; anonymisation ou suppression des identifiants 30 jours après départ du serveur.',
  },
  {
    title: 'Statistiques d’écoute et journaux techniques',
    description:
      'Adresse IP tronquée, agent utilisateur, date de connexion et compteurs d’audience collectés par nos serveurs.',
    usage:
      'Mesure d’audience, équilibrage de charge, sécurité réseau et détection d’utilisation frauduleuse.',
    retention:
      'Journaux bruts stockés 30 jours maximum ; agrégats statistiques anonymisés conservés jusqu’à 24 mois.',
  },
  {
    title: 'Formulaires, boutique & support',
    description:
      'Nom, alias, coordonnées, commandes et contenus soumis via la boutique, le blog ou les canaux de contact.',
    usage:
      'Traitement des demandes, suivi de commande, assistance et obligations comptables ou légales.',
    retention:
      'Données contractuelles conservées jusqu’à cinq ans ; brouillons rejetés supprimés sous six mois ; suppression accélérée sur demande légitime.',
  },
  {
    title: 'Préférences locales & cookies fonctionnels',
    description:
      'Réglages de volume, choix du thème et état de connexion administrateur stockés sur ton appareil.',
    usage:
      'Assurer le confort d’écoute, maintenir la session sécurisée et mémoriser les préférences de navigation.',
    retention:
      'Stockage local conservé sur ton appareil ; cookies fonctionnels expirent au plus tard après douze mois.',
  },
];

const FINALITIES = [
  'Diffuser un flux audio communautaire conforme aux règles Discord et au droit français.',
  'Fournir des outils de modération, de statistiques et de découverte de talents à la communauté.',
  'Garantir la sécurité des infrastructures et prévenir les abus ou tentatives de fraude.',
  'Respecter les obligations légales en matière de facturation, de conservation comptable et de réponse aux autorités compétentes.',
];

const CONSERVATION_RULES = [
  'Données audio et préférences locales : uniquement le temps nécessaire à la diffusion en direct ou à l’usage de ton navigateur.',
  'Historique de participation et classements : conservation maximale de douze mois, avec anonymisation progressive au-delà.',
  'Profils et données personnelles des membres partis : suppression automatique 28 jours et 23 heures après leur départ du serveur Discord.',
  'Logs techniques et métriques d’audience : conservation inférieure ou égale à trente jours, agrégats anonymisés jusqu’à vingt-quatre mois.',
  'Documents contractuels et commandes : conservation légale de cinq ans, puis archivage sécurisé ou suppression.',
];

const RIGHTS = [
  'Accès, rectification, effacement : écris-nous pour consulter ou corriger les informations liées à ton compte Discord ou à une commande.',
  'Limitation et opposition : tu peux demander la suspension des statistiques te concernant ou t’opposer au traitement marketing.',
  'Portabilité : sur demande, nous exportons les données structurées liées à tes interactions lorsqu’elles sont techniquement disponibles.',
  'Retrait du consentement : les préférences facultatives (cookies analytiques, newsletter) peuvent être retirées à tout moment.',
  'Réclamation : tu peux contacter l’autorité de contrôle compétente (CNIL) si tu estimes que tes droits ne sont pas respectés.',
];

const CONTACT_CHANNELS = [
  'Salon #support sur Discord pour les demandes rapides liées au direct.',
  'Adresse dédiée : axiocontactezmoi@protonmail.com pour toute question relative aux données ou à la modération.',
  'Courrier postal sur demande pour les requêtes nécessitant une identification renforcée.',
];

const OPENAI_DETAILS = {
  name: 'OpenAI, LLC (États-Unis)',
  role:
    'Sous-traitant IA pour la génération quotidienne d’articles, l’assistant conversationnel et les fiches membres.',
  data: [
    'Extraits de transcriptions vocales pseudonymisées (identifiants Discord hachés, horodatages, salons).',
    'Résumés de messages publics et indicateurs d’activité nécessaires au cadrage de la requête.',
  ],
  legalBasis:
    "Intérêt légitime de proposer des outils éditoriaux et communautaires, complété par l'exécution du contrat pour les contenus publiés.",
  processingCountry: 'Traitement réalisé sur des infrastructures OpenAI situées aux États-Unis.',
  retention:
    'OpenAI conserve prompts et réponses jusqu’à 30 jours pour supervision des abus, puis les supprime définitivement.',
  safeguards: [
    'Clauses contractuelles types (UE) et addendum de traitement des données OpenAI API.',
    'Flux sortants chiffrés (TLS 1.2+) et absence de réutilisation pour l’entraînement des modèles.',
  ],
};

const INTERNATIONAL_TRANSFERS = [
  'Les requêtes IA transitent via TLS 1.2+ vers les centres de données OpenAI localisés aux États-Unis.',
  'Les clauses contractuelles types de la Commission européenne et l’addendum OpenAI encadrent ces transferts.',
  'OpenAI purge prompts et sorties après un maximum de 30 jours, sans réentraînement des modèles sur nos données.',
  'Tu peux désactiver DailyArticleService ou UserPersonaService dans l’administration (« Services IA ») ou en configurant OPENAI_DAILY_ARTICLE_DISABLED / OPENAI_PERSONA_DISABLED avant redémarrage. Une opposition peut aussi être formulée via axiocontactezmoi@protonmail.com ou le salon #support.',
];

const CguPage = () => html`
  <${Fragment}>
    <article class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Conditions générales d’utilisation & gestion des données</h1>
      <p class="text-base leading-relaxed text-slate-200">
        Libre Antenne est un service communautaire de diffusion audio en direct. L’accès au flux, aux salons Discord associés et
        aux outils proposés implique l’acceptation pleine et entière des présentes conditions générales d’utilisation (CGU).
      </p>
      <p class="text-base leading-relaxed text-slate-200">
        En rejoignant la communauté, tu reconnais que chaque intervenant reste responsable de ses propos, que l’équipe de
        modération peut intervenir pour préserver un espace sûr, et que des traitements techniques sont nécessaires pour
        assurer la diffusion et la sécurité du service.
      </p>
      <ul class="list-disc space-y-2 pl-6 text-sm text-slate-200">
        <li>Respecte les règles Discord, la loi française et les sensibilités des autres participants.</li>
        <li>Ne partage pas de contenus illicites, discriminatoires ou contraires aux valeurs d’inclusion du projet.</li>
        <li>Accepte que les modérateurs puissent couper un micro, exclure un membre ou signaler une situation à Discord.</li>
        <li>Préserve la confidentialité des informations personnelles échangées hors antenne.</li>
      </ul>
    </article>

    <section class="grid gap-6 md:grid-cols-2">
      ${DATA_CATEGORIES.map(
        (item) => html`
          <article
            key=${item.title}
            class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur"
          >
            <h2 class="text-xl font-semibold text-white">${item.title}</h2>
            <p class="mt-3 text-sm leading-relaxed text-slate-300">${item.description}</p>
            <dl class="mt-4 space-y-2 text-sm text-slate-300">
              <div>
                <dt class="font-semibold text-slate-200">Finalité principale</dt>
                <dd>${item.usage}</dd>
              </div>
              <div>
                <dt class="font-semibold text-slate-200">Durée de conservation</dt>
                <dd>${item.retention}</dd>
              </div>
            </dl>
          </article>
        `,
      )}
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Finalités & bases légales</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${FINALITIES.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </div>
      <div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Durées de conservation</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${CONSERVATION_RULES.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </div>
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Tes droits</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${RIGHTS.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </div>
      <div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Nous contacter</h2>
        <p class="text-sm leading-relaxed text-slate-300">
          Notre équipe traite chaque requête dans un délai raisonnable (moins de 30 jours pour les demandes liées aux données
          personnelles). Identifie-toi clairement afin que nous puissions t’accompagner en toute sécurité.
        </p>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${CONTACT_CHANNELS.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </div>
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Sous-traitant IA : OpenAI</h2>
        <p class="mt-3 text-sm leading-relaxed text-slate-300">${OPENAI_DETAILS.role}</p>
        <dl class="mt-4 space-y-3 text-sm text-slate-300">
          <div>
            <dt class="font-semibold text-slate-200">Organisation</dt>
            <dd>${OPENAI_DETAILS.name}</dd>
          </div>
          <div>
            <dt class="font-semibold text-slate-200">Données transférées</dt>
            <dd>
              <ul class="mt-2 list-disc space-y-1 pl-5">
                ${OPENAI_DETAILS.data.map((item) => html`<li key=${item}>${item}</li>`)}
              </ul>
            </dd>
          </div>
          <div>
            <dt class="font-semibold text-slate-200">Base juridique</dt>
            <dd>${OPENAI_DETAILS.legalBasis}</dd>
          </div>
          <div>
            <dt class="font-semibold text-slate-200">Pays de traitement</dt>
            <dd>${OPENAI_DETAILS.processingCountry}</dd>
          </div>
          <div>
            <dt class="font-semibold text-slate-200">Durée & garanties</dt>
            <dd>
              <p>${OPENAI_DETAILS.retention}</p>
              <ul class="mt-2 list-disc space-y-1 pl-5">
                ${OPENAI_DETAILS.safeguards.map((item) => html`<li key=${item}>${item}</li>`)}
              </ul>
            </dd>
          </div>
        </dl>
      </article>

      <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Transferts internationaux & opposition</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          ${INTERNATIONAL_TRANSFERS.map((item) => html`<li key=${item}>${item}</li>`)}
        </ul>
      </article>
    </section>

    <p class="text-xs uppercase tracking-[0.25em] text-slate-500">Dernière mise à jour : 10 mars 2025</p>
  </${Fragment}>
`;

export { CguPage };
