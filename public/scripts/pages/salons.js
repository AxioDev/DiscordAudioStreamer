import {
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  RefreshCcw,
  Hash,
} from '../core/deps.js';
import { formatDateTimeLabel } from '../utils/index.js';

const MESSAGE_PAGE_SIZE = 50;
const DEFAULT_CHANNEL_ID = '1000397055442817096';

const normalizeChannel = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const id = typeof entry.id === 'string' ? entry.id : null;
  if (!id) {
    return null;
  }
  const name = typeof entry.name === 'string' ? entry.name : null;
  const topic = typeof entry.topic === 'string' ? entry.topic : null;
  const lastMessageAt = typeof entry.lastMessageAt === 'string' ? entry.lastMessageAt : null;
  const lastMessageId = typeof entry.lastMessageId === 'string' ? entry.lastMessageId : null;
  const position = Number.isFinite(Number(entry.position)) ? Number(entry.position) : null;
  return { id, name, topic, lastMessageAt, lastMessageId, position };
};

const normalizeMessage = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const id = typeof entry.id === 'string' ? entry.id : null;
  if (!id) {
    return null;
  }
  const content = typeof entry.content === 'string' ? entry.content : '';
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : null;
  const authorRaw = entry.author && typeof entry.author === 'object' ? entry.author : {};
  const author = {
    id: typeof authorRaw.id === 'string' ? authorRaw.id : null,
    displayName: typeof authorRaw.displayName === 'string' ? authorRaw.displayName : null,
    username: typeof authorRaw.username === 'string' ? authorRaw.username : null,
    avatarUrl: typeof authorRaw.avatarUrl === 'string' ? authorRaw.avatarUrl : null,
  };
  return { id, content, createdAt, author };
};

const getChannelDisplayName = (channel) => {
  if (!channel) {
    return 'Salon textuel';
  }
  if (channel.name) {
    return `#${channel.name}`;
  }
  return `Salon ${channel.id.slice(0, 6)}`;
};

const formatTimestampLabel = (isoString) => {
  if (!isoString) {
    return null;
  }
  const ms = Date.parse(isoString);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return formatDateTimeLabel(ms, { includeDate: true, includeSeconds: false });
};

const buildInitials = (source) => {
  const text = typeof source === 'string' ? source.trim() : '';
  if (!text) {
    return 'LA';
  }
  const segments = text
    .split(/\s+/)
    .filter((segment) => segment.length > 0)
    .slice(0, 2);
  if (segments.length === 0) {
    return text.slice(0, 2).toUpperCase() || 'LA';
  }
  return segments
    .map((segment) => segment[0]?.toUpperCase?.() ?? '')
    .join('')
    .slice(0, 2);
};

const AuthorAvatar = ({ author }) => {
  const name = author?.displayName || author?.username || 'Membre Libre Antenne';
  if (author?.avatarUrl) {
    return html`<img
      src=${author.avatarUrl}
      alt=${`Avatar de ${name}`}
      class="h-10 w-10 flex-none rounded-2xl border border-white/10 object-cover shadow-inner shadow-black/30"
      loading="lazy"
      decoding="async"
    />`;
  }
  const initials = buildInitials(name);
  return html`<div
    class="flex h-10 w-10 flex-none items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/40 via-purple-500/30 to-fuchsia-500/30 text-sm font-semibold text-white shadow-inner shadow-black/30"
    aria-hidden="true"
  >
    ${initials}
  </div>`;
};

export const SalonsPage = () => {
  const [channels, setChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState('');
  const [channelsRefreshNonce, setChannelsRefreshNonce] = useState(0);
  const [selectedChannelId, setSelectedChannelId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [messagesNonce, setMessagesNonce] = useState(0);
  const [paginationCursor, setPaginationCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialScrollPending, setInitialScrollPending] = useState(false);

  const messageContainerRef = useRef(null);
  const preserveScrollRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const loadChannels = async () => {
      setChannelsLoading(true);
      setChannelsError('');

      try {
        const response = await fetch('/api/text-channels', { signal: controller.signal });
        if (!response.ok) {
          let message = "Impossible de récupérer les salons textuels pour le moment.";
          try {
            const payload = await response.json();
            if (payload?.message) {
              message = String(payload.message);
            }
          } catch (parseError) {
            console.warn('Failed to parse text channel error payload', parseError);
          }
          throw new Error(message);
        }

        const payload = await response.json();
        const normalized = Array.isArray(payload?.channels)
          ? payload.channels
              .map(normalizeChannel)
              .filter((entry) => entry && entry.lastMessageId && entry.lastMessageAt)
              .sort((a, b) => {
                const dateA = Date.parse(a.lastMessageAt ?? '');
                const dateB = Date.parse(b.lastMessageAt ?? '');
                if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) {
                  return dateB - dateA;
                }
                if (Number.isFinite(dateA)) {
                  return -1;
                }
                if (Number.isFinite(dateB)) {
                  return 1;
                }
                const nameA = (a.name ?? '').toLocaleLowerCase('fr-FR');
                const nameB = (b.name ?? '').toLocaleLowerCase('fr-FR');
                if (nameA !== nameB) {
                  return nameA.localeCompare(nameB);
                }
                return a.id.localeCompare(b.id);
              })
          : [];

        if (!isActive) {
          return;
        }

        setChannels(normalized);
        setSelectedChannelId((current) => {
          if (current && normalized.some((channel) => channel.id === current)) {
            return current;
          }
          const preferred = normalized.find((channel) => channel.id === DEFAULT_CHANNEL_ID);
          if (preferred) {
            return preferred.id;
          }
          return normalized.length > 0 ? normalized[0].id : null;
        });
      } catch (error) {
        if (controller.signal.aborted || !isActive) {
          return;
        }
        console.warn('Failed to load text channels', error);
        const message = error instanceof Error ? error.message : "Impossible de récupérer les salons textuels.";
        setChannelsError(message);
        setChannels([]);
        setSelectedChannelId(null);
      } finally {
        if (isActive) {
          setChannelsLoading(false);
        }
      }
    };

    loadChannels();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [channelsRefreshNonce]);

  useEffect(() => {
    if (!selectedChannelId) {
      setMessages([]);
      setMessagesError('');
      setHasMore(false);
      setPaginationCursor(null);
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadMessages = async () => {
      setMessagesLoading(true);
      setMessagesError('');
      setMessages([]);
      setHasMore(false);
      setPaginationCursor(null);
      setInitialScrollPending(true);

      const params = new URLSearchParams();
      params.set('limit', String(MESSAGE_PAGE_SIZE));

      try {
        const response = await fetch(
          `/api/text-channels/${encodeURIComponent(selectedChannelId)}/messages?${params.toString()}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          let message = "Impossible de récupérer les messages pour ce salon.";
          try {
            const payload = await response.json();
            if (payload?.message) {
              message = String(payload.message);
            }
          } catch (parseError) {
            console.warn('Failed to parse channel messages error payload', parseError);
          }
          throw new Error(message);
        }

        const payload = await response.json();
        if (!isActive) {
          return;
        }

        const normalized = Array.isArray(payload?.messages)
          ? payload.messages.map(normalizeMessage).filter((entry) => entry !== null)
          : [];

        setMessages(normalized);
        setHasMore(Boolean(payload?.hasMore) && normalized.length > 0);
        setPaginationCursor(typeof payload?.nextCursor === 'string' ? payload.nextCursor : null);
      } catch (error) {
        if (controller.signal.aborted || !isActive) {
          return;
        }
        console.warn('Failed to load channel messages', error);
        const message = error instanceof Error ? error.message : "Impossible de récupérer les messages pour ce salon.";
        setMessagesError(message);
        setMessages([]);
        setHasMore(false);
        setPaginationCursor(null);
        setInitialScrollPending(false);
      } finally {
        if (isActive) {
          setMessagesLoading(false);
        }
      }
    };

    loadMessages();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [selectedChannelId, messagesNonce]);

  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container) {
      return;
    }

    if (preserveScrollRef.current) {
      const { scrollTop, scrollHeight } = preserveScrollRef.current;
      const delta = container.scrollHeight - scrollHeight;
      container.scrollTop = Math.max(0, scrollTop + delta);
      preserveScrollRef.current = null;
      return;
    }

    if (initialScrollPending) {
      if (messages.length === 0) {
        return;
      }
      container.scrollTop = container.scrollHeight;
      setInitialScrollPending(false);
    }
  }, [messages, initialScrollPending]);

  const handleRefreshChannels = useCallback(() => {
    setChannelsRefreshNonce((value) => value + 1);
  }, []);

  const handleSelectChannel = useCallback(
    (channelId) => {
      if (!channelId || channelId === selectedChannelId) {
        return;
      }
      setSelectedChannelId(channelId);
    },
    [selectedChannelId],
  );

  const handleRefreshMessages = useCallback(() => {
    if (!selectedChannelId) {
      return;
    }
    setMessagesNonce((value) => value + 1);
  }, [selectedChannelId]);

  const handleLoadOlder = useCallback(async () => {
    if (!selectedChannelId || !paginationCursor || isLoadingMore) {
      return;
    }

    const container = messageContainerRef.current;
    if (container) {
      preserveScrollRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }

    setMessagesError('');
    setIsLoadingMore(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(MESSAGE_PAGE_SIZE));
      params.set('before', paginationCursor);

      const response = await fetch(
        `/api/text-channels/${encodeURIComponent(selectedChannelId)}/messages?${params.toString()}`,
      );

      if (!response.ok) {
        let message = "Impossible de charger les messages précédents.";
        try {
          const payload = await response.json();
          if (payload?.message) {
            message = String(payload.message);
          }
        } catch (parseError) {
          console.warn('Failed to parse older messages error payload', parseError);
        }
        throw new Error(message);
      }

      const payload = await response.json();
      const incoming = Array.isArray(payload?.messages)
        ? payload.messages.map(normalizeMessage).filter((entry) => entry !== null)
        : [];

      setMessages((previous) => {
        if (incoming.length === 0) {
          return previous;
        }
        const existingIds = new Set(previous.map((message) => message.id));
        const deduped = incoming.filter((message) => !existingIds.has(message.id));
        if (deduped.length === 0) {
          return previous;
        }
        return [...deduped, ...previous];
      });

      setPaginationCursor(typeof payload?.nextCursor === 'string' ? payload.nextCursor : null);
      if (typeof payload?.hasMore === 'boolean') {
        setHasMore(payload.hasMore);
      } else {
        setHasMore(incoming.length > 0);
      }
    } catch (error) {
      console.warn('Failed to load older channel messages', error);
      const message = error instanceof Error ? error.message : "Impossible de charger les messages précédents.";
      setMessagesError(message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [selectedChannelId, paginationCursor, isLoadingMore]);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  return html`
    <section class="salons-page grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <aside class="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-lg shadow-black/30">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-white">Salons textuels</h2>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            onClick=${handleRefreshChannels}
            disabled=${channelsLoading}
          >
            <${RefreshCcw} class="h-3.5 w-3.5" aria-hidden="true" />
            Actualiser
          </button>
        </div>
        ${channelsError
          ? html`<p class="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 shadow-inner shadow-rose-900/30">${channelsError}</p>`
          : null}
        ${channelsLoading && channels.length === 0
          ? html`<div class="space-y-3">
              ${[0, 1, 2, 3].map(
                (index) => html`<div
                  key=${`skeleton-${index}`}
                  class="h-16 animate-pulse rounded-2xl bg-white/5"
                ></div>`,
              )}
            </div>`
          : null}
        ${!channelsLoading && channels.length === 0 && !channelsError
          ? html`<p class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">Aucun salon textuel n’est disponible pour le moment.</p>`
          : null}
        ${channels.length > 0
          ? html`<ul class="space-y-2">
              ${channels.map((channel) => {
                const isActive = channel.id === selectedChannelId;
                const lastMessageLabel = formatTimestampLabel(channel.lastMessageAt);
                return html`<li key=${channel.id}>
                  <button
                    type="button"
                    class="w-full rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                      isActive
                        ? 'border-amber-400/60 bg-amber-500/10 text-white shadow-lg shadow-amber-900/30'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-amber-300/40 hover:bg-amber-500/10 hover:text-white'
                    }"
                    onClick=${() => handleSelectChannel(channel.id)}
                  >
                    <div class="flex items-start gap-3">
                      <span class="mt-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-xl border border-white/10 bg-white/10 text-slate-200 ${
                        isActive ? 'border-amber-300/60 text-amber-200' : ''
                      }">
                        <${Hash} class="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div class="flex min-w-0 flex-col gap-1">
                        <p class="truncate text-sm font-semibold">${getChannelDisplayName(channel)}</p>
                        ${channel.topic
                          ? html`<p class="line-clamp-2 text-xs text-slate-300/80">${channel.topic}</p>`
                          : null}
                        ${lastMessageLabel
                          ? html`<p class="text-xs text-slate-400">Dernier message · ${lastMessageLabel}</p>`
                          : html`<p class="text-xs text-slate-500">Aucun message récent</p>`}
                      </div>
                    </div>
                  </button>
                </li>`;
              })}
            </ul>`
          : null}
      </aside>
      <div class="flex flex-col gap-4">
        <header class="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/70 px-6 py-5 shadow-lg shadow-black/30 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 class="text-2xl font-semibold text-white">Historique des messages</h1>
            <p class="text-sm text-slate-300">
              ${selectedChannel ? `Salon ${getChannelDisplayName(selectedChannel)}` : 'Sélectionne un salon pour consulter son historique.'}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              onClick=${handleRefreshMessages}
              disabled=${messagesLoading || !selectedChannelId}
            >
              <${RefreshCcw} class="h-3.5 w-3.5" aria-hidden="true" />
              Actualiser
            </button>
          </div>
        </header>
        ${messagesError
          ? html`<div class="rounded-3xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 shadow-inner shadow-rose-900/30">${messagesError}</div>`
          : null}
        <div class="rounded-3xl border border-white/10 bg-slate-900/60 shadow-lg shadow-black/30">
          <div
            ref=${messageContainerRef}
            class="max-h-[70vh] min-h-[24rem] overflow-y-auto px-6 py-6"
          >
            <div class="flex flex-col gap-4">
              ${hasMore
                ? html`<button
                    type="button"
                    class="self-center rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick=${handleLoadOlder}
                    disabled=${isLoadingMore}
                  >
                    ${isLoadingMore ? 'Chargement…' : 'Charger les messages précédents'}
                  </button>`
                : null}
              ${messagesLoading && messages.length === 0
                ? html`<div class="space-y-3">
                    ${[0, 1, 2, 3].map(
                      (index) => html`<div
                        key=${`message-skeleton-${index}`}
                        class="h-20 animate-pulse rounded-2xl bg-white/5"
                      ></div>`,
                    )}
                  </div>`
                : null}
              ${!messagesLoading && messages.length === 0 && !messagesError
                ? html`<p class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">Aucun message n’a encore été publié dans ce salon.</p>`
                : null}
              ${messages.map((message) => {
                const timestampLabel = formatTimestampLabel(message.createdAt);
                const authorName = message.author?.displayName || message.author?.username || 'Membre Libre Antenne';
                return html`<article
                  key=${message.id}
                  class="flex gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-slate-100 shadow-inner shadow-black/20"
                >
                  <${AuthorAvatar} author=${message.author} />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p class="text-sm font-semibold text-white">${authorName}</p>
                      ${message.author?.username && message.author.username !== authorName
                        ? html`<p class="text-xs text-slate-400">@${message.author.username}</p>`
                        : null}
                      ${timestampLabel
                        ? html`<p class="text-xs text-slate-400">${timestampLabel}</p>`
                        : null}
                    </div>
                    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">${message.content || '—'}</p>
                  </div>
                </article>`;
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
};
