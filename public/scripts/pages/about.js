import {
  Fragment,
  html,
  ArrowRight,
} from '../core/deps.js';

const getAboutPageContent = () => {
  const script = document.getElementById('about-page-content');
  if (!script) {
    return null;
  }

  try {
    const raw = script.textContent ?? '';
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error('Impossible de charger le contenu de la page À propos.', error);
    return null;
  }
};

const renderHighlights = (highlights = []) =>
  highlights.map(
    (highlight) => html`
      <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
        <h2 class="text-xl font-semibold text-white">${highlight.title}</h2>
        <p class="mt-3 text-sm text-slate-300">${highlight.body}</p>
      </div>
    `,
  );

const AboutPage = () => {
  const content = getAboutPageContent();

  if (!content) {
    return html`
      <${Fragment}>
        <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
          <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>
          <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">À propos de Libre Antenne</h1>
          <p class="text-base leading-relaxed text-slate-200">
            Le contenu détaillé de cette page n’a pas pu être chargé. Merci de réessayer plus tard.
          </p>
        </section>
      </${Fragment}>
    `;
  }

  const { hero, highlights } = content;

  return html`
    <${Fragment}>
      <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
        <p class="text-xs uppercase tracking-[0.35em] text-slate-300">${hero.eyebrow}</p>
        <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">${hero.title}</h1>
        ${hero.paragraphs.map(
          (paragraph) => html`
            <p class="text-base leading-relaxed text-slate-200">${paragraph}</p>
          `,
        )}
        <a
          class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/20 hover:text-white"
          href=${hero.cta.href}
          target="_blank"
          rel="noreferrer"
        >
          ${hero.cta.label}
          <${ArrowRight} class="h-4 w-4" aria-hidden="true" />
        </a>
      </section>

      <section class="grid gap-6 md:grid-cols-2">
        ${renderHighlights(highlights)}
      </section>
    </${Fragment}>
  `;
};

export { AboutPage };
