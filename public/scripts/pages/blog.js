import { html, useCallback, useEffect, useMemo, useState } from '../core/deps.js';

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

const BlogListSkeleton = () =>
  html`
    <div class="space-y-3">
      ${Array.from({ length: 3 }).map(
        (_value, index) => html`
          <div
            key=${`skeleton-${index}`}
            class="h-20 w-full animate-pulse rounded-xl border border-slate-800/80 bg-slate-900/80"
          ></div>
        `,
      )}
    </div>
  `;

const EmptyState = ({ title, description }) =>
  html`
    <div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800/60 bg-slate-900/70 px-6 py-10 text-center">
      <div class="text-base font-medium text-white">${title}</div>
      <p class="max-w-sm text-sm text-slate-300">${description}</p>
    </div>
  `;

export const BlogPage = ({ params = {} }) => {
  const slug = typeof params?.slug === 'string' && params.slug.trim().length > 0 ? params.slug.trim() : null;
  const [posts, setPosts] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState(null);
  const [activePost, setActivePost] = useState(null);
  const [isLoadingPost, setIsLoadingPost] = useState(false);
  const [postError, setPostError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const fetchPosts = async () => {
      setIsLoadingList(true);
      setListError(null);
      try {
        const response = await fetch('/api/blog/posts', controller ? { signal: controller.signal } : undefined);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) {
          return;
        }
        setPosts(Array.isArray(payload?.posts) ? payload.posts : []);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Failed to load blog posts', error);
        setListError("Impossible de charger les articles pour le moment.");
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
  }, []);

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

  const latestPost = useMemo(() => (posts.length > 0 ? posts[0] : null), [posts]);

  const handleOpenPost = useCallback((event, nextSlug) => {
    event.preventDefault();
    if (!nextSlug) {
      return;
    }
    const encoded = encodeURIComponent(nextSlug);
    const targetHash = `#/blog/${encoded}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }, []);

  return html`
    <section class="space-y-8 px-4">
      <header class="space-y-2">
        <span class="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-amber-200">Carnet de bord</span>
        <h1 class="text-3xl font-semibold text-white sm:text-4xl">Le blog de la Libre Antenne</h1>
        <p class="max-w-2xl text-base text-slate-300">
          Retrouvez les dernières nouvelles, anecdotes techniques et moments forts de la station. Les articles sont rédigés en Markdown et mis à jour dès que l'équipe a quelque chose à partager.
        </p>
      </header>

      <div class="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside class="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-5 shadow-lg">
          <h2 class="text-lg font-semibold text-white">Articles récents</h2>
          ${isLoadingList
            ? html`<${BlogListSkeleton} />`
            : listError
            ? html`<${EmptyState}
                title="Impossible de récupérer les articles"
                description=${listError}
              />`
            : posts.length === 0
            ? html`<${EmptyState}
                title="Aucun article pour le moment"
                description="Nous publierons bientôt les premières nouvelles de la Libre Antenne."
              />`
            : html`
                <ul class="space-y-3">
                  ${posts.map((post) => {
                    const isActive = slug ? slug === post.slug : activePost ? activePost.slug === post.slug : false;
                    const formattedDate = formatDate(post.date ?? post.updatedAt);
                    return html`
                      <li key=${post.slug}>
                        <a
                          href=${`#/blog/${encodeURIComponent(post.slug)}`}
                          onClick=${(event) => handleOpenPost(event, post.slug)}
                          class=${[
                            'block rounded-xl border px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
                            isActive
                              ? 'border-amber-400/80 bg-amber-500/10 text-white shadow-lg'
                              : 'border-slate-800/70 bg-slate-900/70 text-slate-200 hover:border-amber-400/60 hover:bg-slate-900',
                          ].join(' ')}
                        >
                          <div class="text-sm font-semibold">${post.title}</div>
                          ${formattedDate
                            ? html`<div class="text-xs text-slate-400">${formattedDate}</div>`
                            : null}
                          ${post.excerpt
                            ? html`<p class="mt-2 line-clamp-2 text-sm text-slate-300">${post.excerpt}</p>`
                            : null}
                        </a>
                      </li>
                    `;
                  })}
                </ul>
              `}
        </aside>

        <article class="min-h-[360px] rounded-2xl border border-slate-800/80 bg-slate-950/70 p-6 shadow-lg">
          ${slug
            ? isLoadingPost
              ? html`
                  <div class="space-y-4">
                    <div class="h-8 w-2/3 animate-pulse rounded bg-slate-800/60"></div>
                    <div class="h-4 w-1/4 animate-pulse rounded bg-slate-800/60"></div>
                    <div class="h-64 w-full animate-pulse rounded bg-slate-800/50"></div>
                  </div>
                `
              : postError
              ? html`<${EmptyState} title="Oups" description=${postError} />`
              : activePost
              ? html`
                  <div class="space-y-6">
                    <div class="space-y-2">
                      <h2 class="text-2xl font-semibold text-white sm:text-3xl">${activePost.title}</h2>
                      ${formatDate(activePost.date ?? activePost.updatedAt)
                        ? html`<div class="text-sm text-slate-400">${formatDate(activePost.date ?? activePost.updatedAt)}</div>`
                        : null}
                    </div>
                    <div class="blog-content prose prose-invert max-w-none">
                      <div dangerouslySetInnerHTML=${{ __html: activePost.contentHtml }}></div>
                    </div>
                  </div>
                `
              : html`<${EmptyState}
                  title="Article introuvable"
                  description="Le contenu que vous cherchez n'existe plus."
                />`
            : latestPost
            ? html`
                <div class="space-y-6">
                  <div class="space-y-2">
                    <span class="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">À la une</span>
                    <h2 class="text-2xl font-semibold text-white sm:text-3xl">${latestPost.title}</h2>
                    ${formatDate(latestPost.date ?? latestPost.updatedAt)
                      ? html`<div class="text-sm text-slate-400">${formatDate(latestPost.date ?? latestPost.updatedAt)}</div>`
                      : null}
                    ${latestPost.excerpt
                      ? html`<p class="max-w-2xl text-base text-slate-300">${latestPost.excerpt}</p>`
                      : null}
                  </div>
                  <button
                    class="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    onClick=${(event) => handleOpenPost(event, latestPost.slug)}
                  >
                    Lire l'article
                  </button>
                </div>
              `
            : isLoadingList
            ? html`
                <div class="space-y-4">
                  <div class="h-8 w-1/2 animate-pulse rounded bg-slate-800/60"></div>
                  <div class="h-4 w-1/3 animate-pulse rounded bg-slate-800/60"></div>
                  <div class="h-56 w-full animate-pulse rounded bg-slate-800/50"></div>
                </div>
              `
            : html`<${EmptyState}
                title="Choisissez un article"
                description="Sélectionnez une publication dans la liste de gauche pour commencer la lecture."
              />`}
        </article>
      </div>
    </section>
  `;
};
