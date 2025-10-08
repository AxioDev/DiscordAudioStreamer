import {
  html,
  useCallback,
  useEffect,
  useMemo,
  useState,
  ArrowLeft,
  AlertCircle,
  Sparkles,
} from '../core/deps.js';
import { loadMarkdownRenderer } from '../core/markdown-loader.js';

const initialFormState = {
  title: '',
  slug: '',
  excerpt: '',
  coverImageUrl: '',
  tags: '',
  seoDescription: '',
  contentMarkdown: '',
  authorName: '',
  authorContact: '',
};

const slugify = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized;
};

const parseTags = (value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
    .slice(0, 10);

const validateForm = (form) => {
  const errors = {};
  const title = form.title.trim();
  if (!title) {
    errors.title = 'Le titre est requis.';
  } else if (title.length > 160) {
    errors.title = 'Le titre est trop long (160 caractères max).';
  }

  const slug = form.slug.trim();
  if (slug && !/^[-a-zA-Z0-9_]+$/.test(slug)) {
    errors.slug = 'Seuls les lettres, chiffres, tirets et underscores sont autorisés.';
  } else if (slug.length > 120) {
    errors.slug = 'Le lien personnalisé est trop long (120 caractères max).';
  }

  const excerpt = form.excerpt.trim();
  if (excerpt.length > 320) {
    errors.excerpt = 'L’accroche doit contenir 320 caractères maximum.';
  }

  const seoDescription = form.seoDescription.trim();
  if (seoDescription.length > 320) {
    errors.seoDescription = 'La description SEO doit contenir 320 caractères maximum.';
  }

  const content = form.contentMarkdown.trim();
  if (!content) {
    errors.contentMarkdown = 'Le contenu en Markdown est requis.';
  } else if (content.length > 50_000) {
    errors.contentMarkdown = 'Le contenu est trop long (limite 50 000 caractères).';
  }

  const coverUrl = form.coverImageUrl.trim();
  if (coverUrl) {
    try {
      const url = new URL(coverUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('invalid protocol');
      }
    } catch (_error) {
      errors.coverImageUrl = 'Le lien de l’illustration doit être une URL valide.';
    }
  }

  if (form.authorName.trim().length > 160) {
    errors.authorName = 'Ce champ est trop long (160 caractères max).';
  }

  if (form.authorContact.trim().length > 160) {
    errors.authorContact = 'Ce champ est trop long (160 caractères max).';
  }

  return errors;
};

const inputClasses = (hasError) =>
  [
    'w-full rounded-xl border bg-slate-900/80 py-2 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2',
    hasError
      ? 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-300'
      : 'border-slate-700 focus:border-amber-400 focus:ring-amber-300',
  ].join(' ');

export const BlogProposalPage = ({ onNavigateToBlog }) => {
  const [form, setForm] = useState(initialFormState);
  const [formErrors, setFormErrors] = useState({});
  const [status, setStatus] = useState({ submitting: false, success: false, message: '', reference: null });
  const [markdownRenderer, setMarkdownRenderer] = useState(null);

  useEffect(() => {
    let isMounted = true;
    loadMarkdownRenderer()
      .then((renderer) => {
        if (isMounted) {
          setMarkdownRenderer(() => renderer);
        }
      })
      .catch((error) => {
        console.error('Markdown renderer failed to load', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    document.title = 'Proposer un article · Libre Antenne';
    return () => {
      document.title = 'Libre Antenne · Radio libre et streaming communautaire';
    };
  }, []);

  const derivedSlug = useMemo(() => {
    const source = form.slug.trim() || form.title.trim();
    const normalized = slugify(source);
    return normalized || 'titre-de-ton-article';
  }, [form.slug, form.title]);

  const tagList = useMemo(() => parseTags(form.tags), [form.tags]);

  const coverPreview = useMemo(() => {
    const url = form.coverImageUrl.trim();
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return null;
      }
      return url;
    } catch (_error) {
      return null;
    }
  }, [form.coverImageUrl]);

  const previewHtml = useMemo(() => {
    const content = form.contentMarkdown.trim();
    if (!content) {
      return '<p class="text-sm text-slate-400">Commence à écrire ton article en Markdown pour voir l’aperçu.</p>';
    }
    if (!markdownRenderer) {
      return '<p class="text-sm text-slate-400">Chargement du rendu Markdown…</p>';
    }
    try {
      if (typeof markdownRenderer.parse === 'function') {
        return markdownRenderer.parse(content);
      }
      if (typeof markdownRenderer === 'function') {
        return markdownRenderer(content);
      }
      return String(content);
    } catch (error) {
      console.warn('Impossible de générer la prévisualisation Markdown', error);
      return '<p class="text-sm text-rose-200">Impossible de générer un aperçu pour le moment.</p>';
    }
  }, [form.contentMarkdown, markdownRenderer]);

  const handleInputChange = useCallback((field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const errors = validateForm(form);
      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        setStatus({ submitting: false, success: false, message: 'Corrige les informations indiquées en rouge.', reference: null });
        return;
      }

      setStatus({ submitting: true, success: false, message: '', reference: null });

      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || null,
        excerpt: form.excerpt.trim() || null,
        coverImageUrl: form.coverImageUrl.trim() || null,
        tags: tagList,
        seoDescription: form.seoDescription.trim() || null,
        contentMarkdown: form.contentMarkdown,
        authorName: form.authorName.trim() || null,
        authorContact: form.authorContact.trim() || null,
      };

      try {
        const response = await fetch('/api/blog/proposals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = data?.message || 'Impossible d’envoyer ta proposition pour le moment.';
          setStatus({ submitting: false, success: false, message, reference: null });
          if (data?.details && typeof data.details === 'object') {
            setFormErrors((prev) => ({ ...prev, ...data.details }));
          }
          return;
        }

        setForm(initialFormState);
        setFormErrors({});
        setStatus({
          submitting: false,
          success: true,
          message:
            data?.message ||
            'Merci ! Ton article a bien été transmis à la rédaction. Nous reviendrons vers toi rapidement.',
          reference: data?.proposal?.reference || null,
        });
      } catch (error) {
        console.error('Blog proposal submission failed', error);
        setStatus({
          submitting: false,
          success: false,
          message: 'Une erreur inattendue est survenue. Merci de réessayer dans quelques minutes.',
          reference: null,
        });
      }
    },
    [form, tagList],
  );

  const handleBackToBlog = useCallback(
    (event) => {
      event.preventDefault();
      if (typeof onNavigateToBlog === 'function') {
        onNavigateToBlog();
        return;
      }
      if (typeof window !== 'undefined' && typeof window.history?.pushState === 'function') {
        window.history.pushState({ route: { name: 'blog', params: {} } }, '', '/blog');
        const popEvent =
          typeof window.PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
        window.dispatchEvent(popEvent);
      }
    },
    [onNavigateToBlog],
  );

  const submitButtonLabel = status.submitting ? 'Envoi en cours…' : 'Envoyer ma proposition';

  return html`
    <section class="blog-proposal-page space-y-10 px-4 pb-16">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div class="flex items-center gap-3 text-sm">
          <a
            href="/blog"
            onClick=${handleBackToBlog}
            class="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-4 py-2 text-slate-200 transition hover:border-amber-400/60 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <${ArrowLeft} class="h-4 w-4" aria-hidden="true" />
            Retour au blog
          </a>
          <span class="text-slate-500">/</span>
          <span class="text-slate-300">Nouvelle contribution</span>
        </div>
        <header class="space-y-4 rounded-3xl border border-slate-800/70 bg-slate-950/70 p-8 shadow-xl">
          <span class="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-100">
            <${Sparkles} class="h-3.5 w-3.5" aria-hidden="true" />
            Contribution communauté
          </span>
          <h1 class="text-3xl font-semibold text-white sm:text-4xl">Proposer un article au blog</h1>
          <p class="max-w-3xl text-base text-slate-300">
            Raconte les coulisses d’un projet, partage ton expérience sur la station ou mets en lumière un moment marquant.
            Tu peux écrire en <strong>Markdown</strong>, ajouter une image d’illustration, des tags et une description SEO. Notre équipe relira ta proposition avant publication.
          </p>
        </header>
        ${status.message
          ? html`
              <div
                class=${[
                  'rounded-2xl border px-4 py-3 text-sm shadow-lg sm:px-6 sm:py-4',
                  status.success
                    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                    : 'border-rose-400/50 bg-rose-500/10 text-rose-100',
                ].join(' ')}
              >
                ${status.success
                  ? html`<p class="font-semibold">${status.message}</p>`
                  : html`<p class="font-medium">${status.message}</p>`}
                ${status.reference
                  ? html`<p class="mt-1 text-xs uppercase tracking-wide text-emerald-200/90">Référence : ${status.reference}</p>`
                  : null}
              </div>
            `
          : null}
        <form
          class="space-y-10 rounded-3xl border border-slate-800/70 bg-slate-950/70 p-8 shadow-xl"
          onSubmit=${handleSubmit}
        >
          <div class="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div class="space-y-6">
              <div class="space-y-2">
                <label class="text-sm font-medium text-slate-200" for="proposal-title">Titre</label>
                <input
                  id="proposal-title"
                  type="text"
                  value=${form.title}
                  onInput=${handleInputChange('title')}
                  placeholder="Un titre accrocheur pour ton article"
                  class=${inputClasses(Boolean(formErrors.title))}
                  required
                />
                ${formErrors.title
                  ? html`<p class="text-xs text-rose-300">${formErrors.title}</p>`
                  : html`<p class="text-xs text-slate-400">Astuce : pense à intégrer le sujet principal du billet.</p>`}
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-slate-200" for="proposal-slug">Lien personnalisé (optionnel)</label>
                  <input
                    id="proposal-slug"
                    type="text"
                    value=${form.slug}
                    onInput=${handleInputChange('slug')}
                    placeholder="ex: interventions-marquantes"
                    class=${inputClasses(Boolean(formErrors.slug))}
                  />
                  <p class=${`text-xs ${formErrors.slug ? 'text-rose-300' : 'text-slate-400'}`}>
                    ${formErrors.slug ?? `Le lien apparaîtra sous la forme /blog/${derivedSlug}`}
                  </p>
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-slate-200" for="proposal-tags">Tags</label>
                  <input
                    id="proposal-tags"
                    type="text"
                    value=${form.tags}
                    onInput=${handleInputChange('tags')}
                    placeholder="technique, coulisses, communauté"
                    class=${inputClasses(false)}
                  />
                  <p class="text-xs text-slate-400">Sépare les tags par une virgule (10 maximum).</p>
                </div>
              </div>
              ${tagList.length > 0
                ? html`
                    <div class="flex flex-wrap gap-2 text-xs text-slate-200">
                      ${tagList.map(
                        (tag) => html`<span key=${`tag-${tag}`} class="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1">${tag}</span>`,
                      )}
                    </div>
                  `
                : null}
              <div class="space-y-2">
                <label class="text-sm font-medium text-slate-200" for="proposal-excerpt">Accroche (optionnel)</label>
                <textarea
                  id="proposal-excerpt"
                  rows="3"
                  value=${form.excerpt}
                  onInput=${handleInputChange('excerpt')}
                  placeholder="Une courte introduction qui donne envie de lire l’article."
                  class=${inputClasses(Boolean(formErrors.excerpt))}
                ></textarea>
                ${formErrors.excerpt
                  ? html`<p class="text-xs text-rose-300">${formErrors.excerpt}</p>`
                  : html`<p class="text-xs text-slate-400">Utilisée comme prévisualisation sur le blog et les réseaux sociaux.</p>`}
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium text-slate-200" for="proposal-cover">Image d’illustration (URL)</label>
                <input
                  id="proposal-cover"
                  type="url"
                  value=${form.coverImageUrl}
                  onInput=${handleInputChange('coverImageUrl')}
                  placeholder="https://..."
                  class=${inputClasses(Boolean(formErrors.coverImageUrl))}
                />
                ${formErrors.coverImageUrl
                  ? html`<p class="text-xs text-rose-300">${formErrors.coverImageUrl}</p>`
                  : html`<p class="text-xs text-slate-400">Utilise un lien direct vers une image en haute qualité.</p>`}
                ${coverPreview
                  ? html`<img
                      src=${coverPreview}
                      alt="Aperçu de l’illustration"
                      loading="lazy"
                      decoding="async"
                      class="mt-3 w-full rounded-2xl border border-slate-800/70 object-cover shadow-inner"
                    />`
                  : null}
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium text-slate-200" for="proposal-seo">Description SEO (optionnel)</label>
                <textarea
                  id="proposal-seo"
                  rows="2"
                  value=${form.seoDescription}
                  onInput=${handleInputChange('seoDescription')}
                  placeholder="Ce texte apparaîtra sur Google et les réseaux sociaux."
                  class=${inputClasses(Boolean(formErrors.seoDescription))}
                ></textarea>
                ${formErrors.seoDescription
                  ? html`<p class="text-xs text-rose-300">${formErrors.seoDescription}</p>`
                  : html`<p class="text-xs text-slate-400">Entre 150 et 320 caractères pour un affichage optimal.</p>`}
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-slate-200" for="proposal-author">Ton nom ou pseudo (optionnel)</label>
                  <input
                    id="proposal-author"
                    type="text"
                    value=${form.authorName}
                    onInput=${handleInputChange('authorName')}
                    placeholder="ex : Romain, Luna, @pseudo"
                    class=${inputClasses(Boolean(formErrors.authorName))}
                  />
                  ${formErrors.authorName ? html`<p class="text-xs text-rose-300">${formErrors.authorName}</p>` : null}
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-slate-200" for="proposal-contact">Contact (optionnel)</label>
                  <input
                    id="proposal-contact"
                    type="text"
                    value=${form.authorContact}
                    onInput=${handleInputChange('authorContact')}
                    placeholder="Adresse e-mail ou pseudo Discord"
                    class=${inputClasses(Boolean(formErrors.authorContact))}
                  />
                  ${formErrors.authorContact ? html`<p class="text-xs text-rose-300">${formErrors.authorContact}</p>` : null}
                </div>
              </div>
            </div>
            <aside class="space-y-4 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-6 shadow-inner">
              <h2 class="text-base font-semibold text-white">Conseils rapides</h2>
              <ul class="space-y-3 text-sm text-slate-300">
                <li><strong>#</strong> Titre de niveau 1, <strong>##</strong> sous-titre.</li>
                <li>Utilise <code>**texte**</code> pour le gras et <code>*texte*</code> pour l’italique.</li>
                <li>Insère une image avec <code>!&#91;légende](https://...)</code>.</li>
                <li>Tu peux créer des listes : <code>- élément</code> ou <code>1. élément</code>.</li>
                <li>N’oublie pas d’ajouter des liens : <code>[libre-antenne](https://libre-antenne.xyz)</code>.</li>
              </ul>
              <div class="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                Une fois validé, l’article peut être retravaillé par l’équipe éditoriale (titre, image, mise en forme…).
              </div>
            </aside>
          </div>
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="space-y-2">
              <label class="text-sm font-medium text-slate-200" for="proposal-content">Contenu Markdown</label>
              <textarea
                id="proposal-content"
                rows="18"
                value=${form.contentMarkdown}
                onInput=${handleInputChange('contentMarkdown')}
                placeholder="# Mon article\n\nCommence ton histoire ici..."
                class=${[
                  'min-h-[340px] w-full rounded-2xl border bg-slate-900/80 p-4 font-mono text-sm leading-relaxed text-slate-100 focus:outline-none focus:ring-2',
                  formErrors.contentMarkdown
                    ? 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-300'
                    : 'border-slate-700 focus:border-amber-400 focus:ring-amber-300',
                ].join(' ')}
              ></textarea>
              ${formErrors.contentMarkdown
                ? html`<p class="text-xs text-rose-300">${formErrors.contentMarkdown}</p>`
                : html`<p class="text-xs text-slate-400">Ton texte peut inclure des titres, listes, blocs de code et citations.</p>`}
            </div>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h2 class="text-base font-semibold text-white">Aperçu</h2>
                <span class="text-xs uppercase tracking-widest text-slate-500">Markdown → HTML</span>
              </div>
              <div
                class="prose prose-invert max-w-none rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 text-sm leading-relaxed shadow-inner"
              >
                <div dangerouslySetInnerHTML=${{ __html: previewHtml }}></div>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="inline-flex items-center gap-2 text-xs text-slate-400">
              <${AlertCircle} class="h-4 w-4 text-amber-300" aria-hidden="true" />
              En envoyant ta proposition, tu confirmes être l’auteur·ice du contenu partagé.
            </div>
            <button
              type="submit"
              class="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-400/60 bg-amber-500/10 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-amber-100 transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled=${status.submitting}
            >
              ${submitButtonLabel}
            </button>
          </div>
        </form>
      </div>
    </section>
  `;
};
