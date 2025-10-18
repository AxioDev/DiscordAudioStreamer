import { html, useCallback, useEffect, useRef, useState, Sparkles } from '../core/deps.js';

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
                  decoding="async"
                  class="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950/90 to-transparent"></div>
              </div>
            `
          : html`<div class="aspect-[16/9] w-full bg-slate-800/60"></div>`}
        <div class="flex flex-1 flex-col gap-4 p-5">
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

const normalizeTags = (input) => {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter((tag) => tag.length > 0);
};

const sanitizePostSummary = (post) => {
  if (!post || typeof post !== 'object' || typeof post.slug !== 'string') {
    return null;
  }
  const tags = normalizeTags(post.tags);
  return {
    ...post,
    slug: post.slug,
    title: typeof post.title === 'string' ? post.title : '',
    excerpt: typeof post.excerpt === 'string' ? post.excerpt : post.seoDescription ?? null,
    seoDescription: typeof post.seoDescription === 'string' ? post.seoDescription : null,
    date: typeof post.date === 'string' ? post.date : null,
    updatedAt: typeof post.updatedAt === 'string' ? post.updatedAt : null,
    coverImageUrl: typeof post.coverImageUrl === 'string' ? post.coverImageUrl : null,
    tags,
  };
};

const sanitizePostDetail = (post) => {
  const summary = sanitizePostSummary(post);
  if (!summary) {
    return null;
  }
  return {
    ...summary,
    contentHtml: typeof post.contentHtml === 'string' ? post.contentHtml : '',
    contentMarkdown: typeof post.contentMarkdown === 'string' ? post.contentMarkdown : '',
  };
};

export const BlogPage = ({ params = {}, bootstrap = null, onNavigateToPost, onNavigateToSubmission }) => {
  const slug = typeof params?.slug === 'string' && params.slug.trim().length > 0 ? params.slug.trim() : null;
  const bootstrapData = bootstrap && typeof bootstrap === 'object' ? bootstrap : {};
  const bootstrapSelectedTags = normalizeTags(bootstrapData.selectedTags);
  const bootstrapSearch = typeof bootstrapData.search === 'string' ? bootstrapData.search : '';
  const bootstrapPosts = Array.isArray(bootstrapData.posts)
    ? bootstrapData.posts
        .map((post) => sanitizePostSummary(post))
        .filter((post) => post !== null)
    : null;
  const bootstrapActivePostDetail = sanitizePostDetail(bootstrapData.activePost);
  const bootstrapActiveSlug = bootstrapActivePostDetail?.slug ?? null;
  const hasBootstrapActivePost = Boolean(slug && bootstrapActiveSlug && bootstrapActiveSlug === slug);
  const hasBootstrapPosts = Array.isArray(bootstrapPosts);

  const [posts, setPosts] = useState(() => (bootstrapPosts ? bootstrapPosts.map((post) => ({ ...post })) : []));
  const [isLoadingList, setIsLoadingList] = useState(() => !hasBootstrapPosts);
  const [listError, setListError] = useState(null);
  const [activePost, setActivePost] = useState(() => (
    hasBootstrapActivePost && bootstrapActivePostDetail ? { ...bootstrapActivePostDetail } : null
  ));
  const [isLoadingPost, setIsLoadingPost] = useState(() => (slug ? !hasBootstrapActivePost : false));
  const [postError, setPostError] = useState(null);
  const [searchTerm, setSearchTerm] = useState(() => bootstrapSearch);
  const [selectedTags, setSelectedTags] = useState(() => bootstrapSelectedTags.slice());
  const skipListFetchRef = useRef(hasBootstrapPosts);
  const skipPostFetchRef = useRef(hasBootstrapActivePost);
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
    let controller = null;

    if (skipListFetchRef.current) {
      skipListFetchRef.current = false;
      setIsLoadingList(false);
      return () => {};
    }

    controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

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
        const fetchedPosts = Array.isArray(payload?.posts)
          ? payload.posts.map((post) => sanitizePostSummary(post)).filter((post) => post !== null)
          : [];
        setPosts(fetchedPosts);
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
      if (controller) {
        controller.abort();
      }
    };
  }, [debouncedSearch, selectedTags]);

  useEffect(() => {
    if (!slug) {
      setActivePost(null);
      setPostError(null);
      setIsLoadingPost(false);
      return;
    }

    if (skipPostFetchRef.current && bootstrapActiveSlug && bootstrapActiveSlug === slug) {
      skipPostFetchRef.current = false;
      setIsLoadingPost(false);
      setPostError(null);
      return () => {};
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
        const normalized = sanitizePostDetail(payload?.post);
        setActivePost(normalized);
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

  const handleResetFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedTags([]);
  }, []);

  const handleOpenSubmission = useCallback(() => {
    if (typeof onNavigateToSubmission === 'function') {
      onNavigateToSubmission();
      return;
    }
    if (typeof window !== 'undefined' && typeof window.history?.pushState === 'function') {
      window.history.pushState({ route: { name: 'blog-submit', params: {} } }, '', '/blog/publier');
      const popEvent =
        typeof window.PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
      window.dispatchEvent(popEvent);
    }
  }, [onNavigateToSubmission]);

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
            onClick=${() => handleOpenSubmission()}
            class="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-amber-400/60 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 shadow-sm transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <${Sparkles} class="h-4 w-4" aria-hidden="true" />
            Publier un article
          </button>
        </div>
        <div class="text-sm text-slate-400">
          ${isLoadingList
            ? 'Chargement des articles...'
            : `${posts.length} article${posts.length > 1 ? 's' : ''} visibles`}
        </div>
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
                                loading="lazy"
                                decoding="async"
                                class="absolute inset-0 h-full w-full object-cover"
                              />
                              <div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950/90 to-transparent"></div>
                            </div>
                          `
                        : null}
                      <div class="space-y-6 p-8">
                        <div class="space-y-4">
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
