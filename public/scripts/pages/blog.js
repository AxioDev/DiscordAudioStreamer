import { html, useCallback, useEffect, useMemo, useRef, useState, Sparkles } from '../core/deps.js';

const formatDate = (isoString) => {
  if (!isoString) {
    return null;
  }
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch (error) {
    console.warn('Impossible de formater la date du blog', error);
    return null;
  }
};

const useDebouncedValue = (value, delay = 350) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const BlogGridSkeleton = () =>
  html`
    <div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      ${Array.from({ length: 6 }).map(
        (_value, index) => html`
          <div
            key=${`blog-skeleton-${index}`}
            class="flex h-full flex-col gap-4 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-5 shadow-inner"
          >
            <div class="aspect-[16/9] w-full rounded-xl bg-slate-800/60"></div>
            <div class="h-4 w-3/4 rounded bg-slate-800/60"></div>
            <div class="h-3 w-1/2 rounded bg-slate-800/40"></div>
            <div class="h-3 w-full rounded bg-slate-800/40"></div>
          </div>
        `,
      )}
    </div>
  `;

const EmptyState = ({ title, description }) =>
  html`
    <div class="flex flex-col items-center justify-center gap-3 rounded-3xl border border-slate-800/70 bg-slate-950/60 px-8 py-12 text-center shadow-lg">
      <div class="text-base font-semibold text-white">${title}</div>
      <p class="max-w-md text-sm text-slate-300">${description}</p>
    </div>
  `;

const BlogCard = ({ post, onOpen, isActive }) => {
  const formattedDate = formatDate(post.date ?? post.updatedAt);
  return html`
    <article
      key=${post.slug}
      class=${[
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border transition duration-200',
        isActive
          ? 'border-amber-400/70 bg-amber-500/10 shadow-lg'
          : 'border-slate-800/70 bg-slate-900/70 hover:border-amber-400/60 hover:bg-slate-900/80',
      ].join(' ')}
    >
      <a
        href=${`/blog/${encodeURIComponent(post.slug)}`}
        onClick=${(event) => onOpen(event, post.slug)}
        class="flex h-full flex-col"
      >
        ${post.coverImageUrl
          ? html`
              <div class="relative aspect-[16/9] w-full overflow-hidden">
                <img
                  src=${post.coverImageUrl}
                  alt=${`Illustration de l'article ${post.title}`}
                  loading="lazy"
                  class="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950/90 to-transparent"></div>
              </div>
            `
          : html`<div class="aspect-[16/9] w-full bg-slate-800/60"></div>`}
        <div class="flex flex-1 flex-col gap-4 p-5">
          ${post.tags.length > 0
            ? html`
                <div class="flex flex-wrap gap-2">
                  ${post.tags.map(
                    (tag) => html`
                      <span
                        key=${`${post.slug}-tag-${tag}`}
                        class="rounded-full bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-200"
                      >
                        ${tag}
                      </span>
                    `,
                  )}
                </div>
              `
            : null}
          <div class="space-y-2">
            <h3 class="text-lg font-semibold text-white transition duration-150 group-hover:text-amber-200">
              ${post.title}
            </h3>
            ${post.excerpt ? html`<p class="line-clamp-3 text-sm text-slate-300">${post.excerpt}</p>` : null}
          </div>
          <div class="mt-auto flex items-center justify-between text-xs font-medium text-slate-400">
            ${formattedDate ? html`<span>${formattedDate}</span>` : html`<span>Article</span>`}
            <span class="inline-flex items-center gap-1 text-amber-300">
              Lire
              <span aria-hidden="true">→</span>
            </span>
          </div>
        </div>
      </a>
    </article>
  `;
};

export const BlogPage = ({ params = {}, onNavigateToPost, onNavigateToProposal }) => {
  const slug = typeof params?.slug === 'string' && params.slug.trim().length > 0 ? params.slug.trim() : null;
  const [posts, setPosts] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState(null);
  const [activePost, setActivePost] = useState(null);
  const [isLoadingPost, setIsLoadingPost] = useState(false);
  const [postError, setPostError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [manualPassword, setManualPassword] = useState('');
  const [isTriggeringManualArticle, setIsTriggeringManualArticle] = useState(false);
  const [manualTriggerError, setManualTriggerError] = useState(null);
  const [manualTriggerSuccess, setManualTriggerSuccess] = useState(null);
  const debouncedSearch = useDebouncedValue(searchTerm, 350);
  const defaultMetaDescription = useRef(null);

  useEffect(() => {
    const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="description"]') : null;
    if (meta && defaultMetaDescription.current === null) {
      defaultMetaDescription.current = meta.getAttribute('content') || '';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const fetchPosts = async () => {
      setIsLoadingList(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch && debouncedSearch.trim().length > 0) {
          params.set('search', debouncedSearch.trim());
        }
        selectedTags.forEach((tag) => params.append('tag', tag));
        const query = params.toString();
        const response = await fetch(`/api/blog/posts${query ? `?${query}` : ''}`, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) {
          return;
        }
        setPosts(Array.isArray(payload?.posts) ? payload.posts : []);
        setAvailableTags(Array.isArray(payload?.tags) ? payload.tags : []);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Failed to load blog posts', error);
        setListError("Impossible de charger les articles pour le moment.");
        setPosts([]);
      } finally {
        if (!cancelled) {
          setIsLoadingList(false);
        }
      }
    };

    fetchPosts();

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [debouncedSearch, selectedTags]);

  useEffect(() => {
    if (!slug) {
      setActivePost(null);
      setPostError(null);
      setIsLoadingPost(false);
      return;
    }

    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const fetchPost = async () => {
      setIsLoadingPost(true);
      setPostError(null);
      try {
        const response = await fetch(`/api/blog/posts/${encodeURIComponent(slug)}`, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('NOT_FOUND');
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) {
          return;
        }
        setActivePost(payload?.post ?? null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if ((error?.message ?? '') === 'NOT_FOUND') {
          setPostError("Cet article est introuvable ou a été archivé.");
        } else {
          console.error('Failed to load blog post', error);
          setPostError("Impossible de charger cet article pour le moment.");
        }
        setActivePost(null);
      } finally {
        if (!cancelled) {
          setIsLoadingPost(false);
        }
      }
    };

    fetchPost();

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [slug]);

  useEffect(() => {
    const baseTitle = 'Blog · Libre Antenne';
    if (slug && activePost) {
      document.title = `${activePost.title} · ${baseTitle}`;
      const meta = document.querySelector('meta[name="description"]');
      const description = activePost.seoDescription || activePost.excerpt || defaultMetaDescription.current || '';
      if (meta) {
        meta.setAttribute('content', description);
      }
    } else {
      document.title = baseTitle;
      if (defaultMetaDescription.current !== null) {
        const meta = document.querySelector('meta[name="description"]');
        meta?.setAttribute('content', defaultMetaDescription.current);
      }
    }
  }, [slug, activePost]);

  const tagOptions = useMemo(() => {
    const combined = new Set([...(Array.isArray(availableTags) ? availableTags : [])]);
    selectedTags.forEach((tag) => combined.add(tag));
    return Array.from(combined).sort((a, b) => a.localeCompare(b));
  }, [availableTags, selectedTags]);

  const hasActiveFilters = selectedTags.length > 0 || (debouncedSearch && debouncedSearch.trim().length > 0);

  const handleOpenPost = useCallback(
    (event, nextSlug) => {
      event.preventDefault();
      if (!nextSlug) {
        return;
      }
      if (typeof onNavigateToPost === 'function') {
        onNavigateToPost(nextSlug);
        return;
      }
      if (typeof window !== 'undefined' && typeof window.history?.pushState === 'function') {
        const encoded = encodeURIComponent(nextSlug);
        window.history.pushState({ route: { name: 'blog', params: { slug: nextSlug } } }, '', `/blog/${encoded}`);
        const popEvent =
          typeof window.PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
        window.dispatchEvent(popEvent);
      }
    },
    [onNavigateToPost],
  );

  const handleSearchChange = useCallback((event) => {
    setSearchTerm(event.target.value);
  }, []);

  const handleTagToggle = useCallback((tag) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((entry) => entry !== tag);
      }
      return [...prev, tag];
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedTags([]);
  }, []);

  const handleOpenProposal = useCallback(() => {
    if (typeof onNavigateToProposal === 'function') {
      onNavigateToProposal();
      return;
    }
    if (typeof window !== 'undefined' && typeof window.history?.pushState === 'function') {
      window.history.pushState({ route: { name: 'blog-proposal', params: {} } }, '', '/blog/proposer');
      const popEvent =
        typeof window.PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
      window.dispatchEvent(popEvent);
    }
  }, [onNavigateToProposal]);

  const handleManualPasswordChange = useCallback((event) => {
    setManualPassword(event.target.value);
  }, []);

  const handleManualGeneration = useCallback(
    async (event) => {
      event.preventDefault();
      const normalizedPassword = manualPassword.trim();
      if (!normalizedPassword) {
        setManualTriggerError('Mot de passe requis.');
        setManualTriggerSuccess(null);
        return;
      }

      setIsTriggeringManualArticle(true);
      setManualTriggerError(null);
      setManualTriggerSuccess(null);

      try {
        const response = await fetch('/api/blog/manual-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: normalizedPassword }),
        });

        let payload = null;
        try {
          payload = await response.json();
        } catch (parseError) {
          payload = null;
        }

        if (!response.ok) {
          const message =
            payload && typeof payload.message === 'string' && payload.message.trim().length > 0
              ? payload.message
              : "Impossible de lancer la génération de l'article.";
          throw new Error(message);
        }

        const successMessage =
          payload && typeof payload.message === 'string' && payload.message.trim().length > 0
            ? payload.message
            : "La génération de l'article a été déclenchée.";
        setManualTriggerSuccess(successMessage);
        setManualPassword('');
      } catch (error) {
        console.error('Failed to trigger manual blog article', error);
        setManualTriggerError(error?.message ?? "Impossible de lancer la génération de l'article.");
      } finally {
        setIsTriggeringManualArticle(false);
      }
    },
    [manualPassword],
  );

  return html`
    <section class="blog-page space-y-10 px-4 pb-16">
      <header class="mx-auto flex max-w-6xl flex-col gap-6 rounded-3xl border border-slate-800/80 bg-slate-950/70 p-8 shadow-xl">
        <div class="space-y-3">
          <span class="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-amber-200">
            Carnet de bord
          </span>
          <h1 class="text-3xl font-semibold text-white sm:text-4xl">Le blog de la Libre Antenne</h1>
          <p class="max-w-3xl text-base text-slate-300">
            Suivez l'actualité de la station : coulisses techniques, grands moments à l'antenne et projets en cours. Utilisez la
            recherche et les filtres pour retrouver facilement les sujets qui vous intéressent.
          </p>
        </div>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
            <div class="relative w-full sm:max-w-sm">
              <svg
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="7"></circle>
                <line x1="20" y1="20" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="search"
                value=${searchTerm}
                onInput=${handleSearchChange}
                placeholder="Rechercher un article..."
                class="w-full rounded-xl border border-slate-700 bg-slate-900/80 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
            ${hasActiveFilters
              ? html`
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-xl border border-amber-400/60 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    onClick=${handleResetFilters}
                  >
                    Réinitialiser les filtres
                  </button>
                `
              : null}
          </div>
          <button
            type="button"
            onClick=${() => handleOpenProposal()}
            class="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-amber-400/60 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 shadow-sm transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <${Sparkles} class="h-4 w-4" aria-hidden="true" />
            Proposer un article
          </button>
        </div>
        ${tagOptions.length > 0
          ? html`
              <div class="flex flex-wrap gap-2">
                ${tagOptions.map((tag) => {
                  const isActive = selectedTags.includes(tag);
                  return html`
                    <button
                      key=${`tag-${tag}`}
                      type="button"
                      class=${[
                        'rounded-full border px-3 py-1 text-xs font-medium transition',
                        isActive
                          ? 'border-amber-400/70 bg-amber-500/20 text-amber-100'
                          : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-amber-400/40 hover:text-amber-100',
                      ].join(' ')}
                      aria-pressed=${isActive}
                      onClick=${() => handleTagToggle(tag)}
                    >
                      ${tag}
                    </button>
                  `;
                })}
              </div>
            `
          : null}
        <div class="text-sm text-slate-400">
          ${isLoadingList
            ? 'Chargement des articles...'
            : `${posts.length} article${posts.length > 1 ? 's' : ''} visibles`}
        </div>
        <form
          class="ml-auto flex items-center gap-2 text-[11px] text-slate-500"
          onSubmit=${handleManualGeneration}
          autocomplete="off"
        >
          <label class="sr-only" for="blog-manual-password">Mot de passe</label>
          <input
            id="blog-manual-password"
            type="password"
            value=${manualPassword}
            onInput=${handleManualPasswordChange}
            placeholder="••••"
            class="w-20 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[11px] text-slate-400 focus:border-slate-600 focus:outline-none focus:ring-0"
          />
          <button
            type="submit"
            class="rounded-md border border-transparent px-2 py-1 text-[10px] font-medium text-slate-500 transition hover:text-amber-200 focus:border-slate-600 focus:outline-none"
            disabled=${isTriggeringManualArticle}
            title="Déclencher un nouvel article"
          >
            …
          </button>
        </form>
        ${(manualTriggerError || manualTriggerSuccess)
          ? html`
              <div class="ml-auto max-w-xs text-right text-[11px]">
                ${manualTriggerSuccess
                  ? html`<p class="text-emerald-300">${manualTriggerSuccess}</p>`
                  : null}
                ${manualTriggerError
                  ? html`<p class="text-rose-300">${manualTriggerError}</p>`
                  : null}
              </div>`
          : null}
      </header>

      ${slug
        ? html`
            <section class="mx-auto w-full max-w-5xl">
              ${isLoadingPost
                ? html`
                    <div class="space-y-4 rounded-3xl border border-slate-800/70 bg-slate-950/70 p-8 shadow-xl">
                      <div class="aspect-[16/9] w-full animate-pulse rounded-2xl bg-slate-800/60"></div>
                      <div class="h-8 w-2/3 animate-pulse rounded bg-slate-800/60"></div>
                      <div class="h-4 w-1/3 animate-pulse rounded bg-slate-800/50"></div>
                      <div class="h-4 w-full animate-pulse rounded bg-slate-800/40"></div>
                      <div class="h-4 w-5/6 animate-pulse rounded bg-slate-800/40"></div>
                    </div>`
                : postError
                ? html`<${EmptyState} title="Oups" description=${postError} />`
                : activePost
                ? html`
                    <article class="overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-950/70 shadow-xl">
                      ${activePost.coverImageUrl
                        ? html`
                            <div class="relative aspect-[16/9] w-full max-h-[420px] overflow-hidden">
                              <img
                                src=${activePost.coverImageUrl}
                                alt=${`Illustration de l'article ${activePost.title}`}
                                class="absolute inset-0 h-full w-full object-cover"
                              />
                              <div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950/90 to-transparent"></div>
                            </div>
                          `
                        : null}
                      <div class="space-y-6 p-8">
                        <div class="space-y-4">
                          ${activePost.tags.length > 0
                            ? html`
                                <div class="flex flex-wrap gap-2">
                                  ${activePost.tags.map(
                                    (tag) => html`
                                      <span
                                        key=${`active-tag-${tag}`}
                                        class="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-100"
                                      >
                                        ${tag}
                                      </span>
                                    `,
                                  )}
                                </div>
                              `
                            : null}
                          <h2 class="text-3xl font-semibold text-white sm:text-4xl">${activePost.title}</h2>
                          ${formatDate(activePost.date ?? activePost.updatedAt)
                            ? html`<div class="text-sm text-slate-400">
                                Publié le ${formatDate(activePost.date ?? activePost.updatedAt)}
                              </div>`
                            : null}
                          ${activePost.excerpt
                            ? html`<p class="text-base text-slate-300">${activePost.excerpt}</p>`
                            : null}
                        </div>
                        <div class="blog-content prose prose-invert max-w-none">
                          <div dangerouslySetInnerHTML=${{ __html: activePost.contentHtml }}></div>
                        </div>
                      </div>
                    </article>
                  `
                : html`<${EmptyState}
                    title="Article introuvable"
                    description="Le contenu que vous cherchez n'existe plus."
                  />`}
            </section>
          `
        : null}

      <section class="mx-auto w-full max-w-6xl">
        ${isLoadingList
          ? html`<${BlogGridSkeleton} />`
          : listError
          ? html`<${EmptyState} title="Impossible de récupérer les articles" description=${listError} />`
          : posts.length === 0
          ? html`<${EmptyState}
              title=${hasActiveFilters ? 'Aucun article ne correspond à votre recherche' : 'Aucun article publié pour le moment'}
              description=${hasActiveFilters
                ? 'Ajustez votre recherche ou choisissez d’autres filtres pour explorer le blog.'
                : 'Revenez bientôt pour découvrir les premières publications de la Libre Antenne.'}
            />`
          : html`
              <div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                ${posts.map((post) =>
                  html`<${BlogCard}
                    key=${post.slug}
                    post=${post}
                    onOpen=${handleOpenPost}
                    isActive=${slug ? slug === post.slug : false}
                  />`,
                )}
              </div>
            `}
      </section>
    </section>
  `;
};
