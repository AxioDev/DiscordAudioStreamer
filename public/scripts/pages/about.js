import { Fragment, html, ArrowRight, useEffect, useState } from '../core/deps.js';

const ABOUT_PAGE_CACHE_KEY = '__APP_ABOUT_PAGE_CONTENT__';

const cloneAboutPageContent = (value) => {
  if (!value) {
    return null;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (error) {
      console.warn('Impossible de cloner le contenu À propos via structuredClone.', error);
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.warn('Impossible de cloner le contenu À propos via JSON.', error);
    return value;
  }
};

const cacheAboutPageContent = (value) => {
  if (typeof window === 'undefined' || !value) {
    return;
  }
  try {
    window[ABOUT_PAGE_CACHE_KEY] = cloneAboutPageContent(value);
  } catch (error) {
    console.warn("Impossible de mettre en cache le contenu de la page À propos dans 'window'.", error);
  }
};

const normalizeAboutPageContent = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const heroSource = value.hero && typeof value.hero === 'object' ? value.hero : null;
  const highlightSource = Array.isArray(value.highlights) ? value.highlights : [];

  if (!heroSource) {
    return null;
  }

  const eyebrow = typeof heroSource.eyebrow === 'string' ? heroSource.eyebrow : null;
  const title = typeof heroSource.title === 'string' ? heroSource.title : null;
  const paragraphs = Array.isArray(heroSource.paragraphs)
    ? heroSource.paragraphs.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const ctaSource = heroSource.cta && typeof heroSource.cta === 'object' ? heroSource.cta : null;
  const ctaLabel = typeof ctaSource?.label === 'string' ? ctaSource.label : null;
  const ctaHref = typeof ctaSource?.href === 'string' ? ctaSource.href : null;

  const highlights = highlightSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const highlightTitle = typeof entry.title === 'string' ? entry.title : null;
      const highlightBody = typeof entry.body === 'string' ? entry.body : null;
      if (!highlightTitle || !highlightBody) {
        return null;
      }
      return {
        title: highlightTitle,
        body: highlightBody,
      };
    })
    .filter(Boolean);

  if (!eyebrow || !title || paragraphs.length === 0 || !ctaLabel || !ctaHref) {
    return null;
  }

  return {
    hero: {
      eyebrow,
      title,
      paragraphs,
      cta: {
        label: ctaLabel,
        href: ctaHref,
      },
    },
    highlights,
  };
};

const getCachedAboutPageContent = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  const cached = window[ABOUT_PAGE_CACHE_KEY];
  const normalized = normalizeAboutPageContent(cached);
  return normalized ?? null;
};

const getAboutPageContentFromScript = () => {
  if (typeof document === 'undefined') {
    return null;
  }

  const script = document.getElementById('about-page-content');
  if (!script) {
    return null;
  }

  try {
    const raw = script.textContent ?? '';
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeAboutPageContent(parsed);
    if (normalized) {
      cacheAboutPageContent(normalized);
      script.remove();
    }
    return normalized;
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
  const [content, setContent] = useState(() => {
    const cached = getCachedAboutPageContent();
    if (cached) {
      return cached;
    }
    return getAboutPageContentFromScript();
  });
  const [loading, setLoading] = useState(() => !content);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (content) {
      return undefined;
    }

    if (typeof fetch !== 'function') {
      setLoading(false);
      setError(new Error('Fetch API non disponible.'));
      return undefined;
    }

    let cancelled = false;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;

    setLoading(true);

    const fetchOptions = controller ? { signal: controller.signal } : undefined;

    fetch('/api/pages/about', fetchOptions)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Échec du chargement (HTTP ${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeAboutPageContent(data);
        if (!normalized) {
          throw new Error("Le contenu reçu pour la page À propos est invalide.");
        }
        cacheAboutPageContent(normalized);
        setContent(normalized);
        setError(null);
      })
      .catch((fetchError) => {
        if (cancelled || (controller && controller.signal.aborted)) {
          return;
        }
        console.error('Impossible de récupérer le contenu de la page À propos.', fetchError);
        setError(fetchError);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (controller) {
        controller.abort();
      }
    };
  }, [content, retryCount]);

  const handleRetry = () => {
    setError(null);
    setRetryCount((value) => value + 1);
  };

  if (!content) {
    const message = loading
      ? 'Chargement du manifeste de Libre Antenne…'
      : 'Le contenu détaillé de cette page n’a pas pu être chargé. Merci de réessayer plus tard.';

    return html`
      <${Fragment}>
        <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
          <p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>
          <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">À propos de Libre Antenne</h1>
          <p class="text-base leading-relaxed text-slate-200">${message}</p>
          ${
            !loading
              ? html`<button
                  type="button"
                  class="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  onClick=${handleRetry}
                >
                  Réessayer le chargement
                </button>`
              : null
          }
          ${
            error
              ? html`<p class="text-xs text-slate-400" role="status">
                  ${error.message ?? 'Une erreur inattendue est survenue.'}
                </p>`
              : null
          }
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
