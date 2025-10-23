import { Fragment, html } from '../core/deps.js';

const publisherDetails = {
  projectName: 'Libre Antenne',
  publisher: 'Pierrick Goujon – administration du serveur Discord Libre Antenne',
  legalStatus: 'Projet communautaire associatif (déclaration loi 1901 en cours)',
  address: '38 rue des Studios, 75011 Paris, France',
};

const contactDetails = {
  email: 'contact@libre-antenne.fm',
  discord: 'Salon #support sur le serveur Discord Libre Antenne',
  responseTime: 'Réponse sous 72 heures ouvrées pour les demandes légales',
};

const hostingProvider = {
  name: 'Hetzner Online',
  legalName: 'Hetzner Online GmbH',
  address: 'Industriestr. 25, 91710 Gunzenhausen, Allemagne',
  website: 'https://www.hetzner.com/',
  phone: '+49 9831 505-0',
};

const identificationNotes = [
  'Numéro RNA : en cours d’attribution par la préfecture de Paris (dossier déposé).',
  'Responsable de la publication et administrateur du serveur Discord : Pierrick Goujon.',
  'Le bot de diffusion Libre Antenne est ajouté et maintenu sur le serveur par Pierrick Goujon.',
  'Le projet est actuellement opéré par une équipe bénévole sans structure commerciale déclarée.',
];

const MentionsLegalesPage = () => html`
  <${Fragment}>
    <article class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-300">${publisherDetails.projectName}</p>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Mentions légales & informations de contact</h1>
      <p class="text-base leading-relaxed text-slate-200">
        Cette page présente l’éditeur responsable du service Libre Antenne, les moyens de contact officiels ainsi que les informations relatives à l’hébergement et à l’identification administrative du projet.
      </p>
      <dl class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
          <dt class="text-sm uppercase tracking-[0.25em] text-slate-400">Éditeur</dt>
          <dd class="mt-2 text-base font-semibold text-white">${publisherDetails.publisher}</dd>
          <p class="mt-3 text-sm text-slate-300">${publisherDetails.legalStatus}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
          <dt class="text-sm uppercase tracking-[0.25em] text-slate-400">Adresse postale</dt>
          <dd class="mt-2 text-base font-semibold text-white">${publisherDetails.address}</dd>
          <p class="mt-3 text-sm text-slate-300">Accueil sur rendez-vous uniquement.</p>
        </div>
      </dl>
    </article>

    <section class="grid gap-6 lg:grid-cols-2">
      <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Nous contacter</h2>
        <ul class="mt-3 space-y-2 text-sm text-slate-300">
          <li><span class="font-semibold text-slate-200">Courriel :</span> ${contactDetails.email}</li>
          <li><span class="font-semibold text-slate-200">Discord :</span> ${contactDetails.discord}</li>
          <li><span class="font-semibold text-slate-200">Délai de réponse :</span> ${contactDetails.responseTime}</li>
        </ul>
        <p class="mt-4 text-xs text-slate-400">
          Merci de préciser ton identifiant Discord ou toute référence utile pour faciliter le traitement de ta demande.
        </p>
      </article>
      <article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-lg font-semibold text-white">Hébergeur du service</h2>
        <ul class="mt-3 space-y-2 text-sm text-slate-300">
          <li><span class="font-semibold text-slate-200">Nom commercial :</span> ${hostingProvider.name}</li>
          <li><span class="font-semibold text-slate-200">Raison sociale :</span> ${hostingProvider.legalName}</li>
          <li><span class="font-semibold text-slate-200">Adresse :</span> ${hostingProvider.address}</li>
          <li><span class="font-semibold text-slate-200">Site web :</span> <a class="text-indigo-300 underline hover:text-indigo-200" href="${hostingProvider.website}" target="_blank" rel="noreferrer">${hostingProvider.website}</a></li>
          <li><span class="font-semibold text-slate-200">Téléphone :</span> ${hostingProvider.phone}</li>
        </ul>
        <p class="mt-4 text-xs text-slate-400">
          L’infrastructure d’hébergement garantit la conformité aux standards européens (UE) en matière de disponibilité et de sécurité des données.
        </p>
      </article>
    </section>

    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
      <h2 class="text-lg font-semibold text-white">Identification & responsabilités</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
        ${identificationNotes.map((item) => html`<li key=${item}>${item}</li>`) }
      </ul>
      <p class="mt-4 text-xs text-slate-400">
        Pour toute demande officielle (droit de réponse, signalement juridique), merci d’adresser un courriel en précisant l’objet, les URLs concernées et les éléments justificatifs.
      </p>
    </section>

    <p class="text-xs uppercase tracking-[0.25em] text-slate-500">Dernière mise à jour : 17 mars 2025</p>
  </${Fragment}>
`;

export { MentionsLegalesPage };
