import {
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  RefreshCcw,
  Hash,
  Search,
  Send,
  X,
  Clock3,
} from '../core/deps.js';
import { buildRoutePath, formatDateTimeLabel } from '../utils/index.js';

const MESSAGE_PAGE_SIZE = 50;
const DEFAULT_CHANNEL_ID = '1000397055442817096';
const MESSAGE_COOLDOWN_MS = 60 * 60 * 1000;
const MESSAGE_COOLDOWN_STORAGE_KEY = 'libre-antenne:salons:last-message-at';
const MAX_MESSAGE_LENGTH = 500;

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

const buildNormalizedChannels = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
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
    });
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

const URL_PATTERN = /https?:\/\/[^\s<>'"`]+/gi;
const IMAGE_EXTENSION_PATTERN = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
const VIDEO_EXTENSION_PATTERN = /\.(?:mp4|m4v|mov|webm|ogv|ogg|mkv)$/i;
const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{6,}$/;

const linkifyContent = (content) => {
  const text = typeof content === 'string' ? content : '';
  const nodes = [];
  const urls = [];
  let lastIndex = 0;
  let linkIndex = 0;

  text.replace(URL_PATTERN, (match, offset) => {
    if (offset > lastIndex) {
      nodes.push(text.slice(lastIndex, offset));
    }

    urls.push(match);
    nodes.push(
      html`<a
        key=${`message-link-${linkIndex++}`}
        href=${match}
        target="_blank"
        rel="noreferrer noopener"
        class="break-words text-amber-200 underline decoration-amber-200/60 decoration-2 underline-offset-2 transition hover:text-amber-100"
      >
        ${match}
      </a>`,
    );

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  if (nodes.length === 0) {
    nodes.push(text);
  }

  return { nodes, urls };
};

const isImageUrl = (url) => {
  if (typeof url !== 'string') {
    return false;
  }
  const normalized = url.split('?')[0]?.split('#')[0] ?? '';
  return IMAGE_EXTENSION_PATTERN.test(normalized);
};

const isVideoUrl = (url) => {
  if (typeof url !== 'string') {
    return false;
  }
  const normalized = url.split('?')[0]?.split('#')[0] ?? '';
  return VIDEO_EXTENSION_PATTERN.test(normalized);
};

const getYouTubeVideoId = (urlString) => {
  if (typeof urlString !== 'string' || urlString.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    const ensureValid = (candidate) => {
      if (candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate)) {
        return candidate;
      }
      return null;
    };

    if (host === 'youtu.be') {
      const candidate = parsed.pathname.split('/').filter((segment) => segment.length > 0)[0] ?? '';
      return ensureValid(candidate);
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
      const direct = parsed.searchParams.get('v');
      if (direct) {
        return ensureValid(direct);
      }

      const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
      if (segments.length > 1) {
        if (segments[0] === 'embed') {
          return ensureValid(segments[1]);
        }
        if (segments[0] === 'shorts') {
          return ensureValid(segments[1]);
        }
        if (segments[0] === 'live') {
          return ensureValid(segments[1]);
        }
      }
    }
  } catch (error) {
    return null;
  }

  return null;
};

const buildMediaPreviews = (urls) => {
  if (!Array.isArray(urls) || urls.length === 0) {
    return [];
  }

  const previews = [];
  const seen = new Set();
  let mediaIndex = 0;

  urls.forEach((rawUrl) => {
    if (typeof rawUrl !== 'string') {
      return;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);

    const youtubeId = getYouTubeVideoId(trimmed);
    if (youtubeId) {
      previews.push(
        html`<div
          key=${`media-youtube-${mediaIndex++}`}
          class="overflow-hidden rounded-2xl border border-white/10 bg-black/80"
        >
          <iframe
            class="aspect-video h-full w-full"
            src=${`https://www.youtube-nocookie.com/embed/${youtubeId}`}
            title="Lecteur vidéo YouTube"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>`,
      );
      return;
    }

    if (isImageUrl(trimmed)) {
      previews.push(
        html`<a
          key=${`media-image-${mediaIndex++}`}
          href=${trimmed}
          target="_blank"
          rel="noreferrer noopener"
          class="group block"
        >
          <figure class="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
            <img
              src=${trimmed}
              alt="Image partagée dans le message"
              loading="lazy"
              decoding="async"
              class="max-h-80 w-full object-contain transition duration-200 ease-out group-hover:opacity-90"
            />
          </figure>
        </a>`,
      );
      return;
    }

    if (isVideoUrl(trimmed)) {
      previews.push(
        html`<div
          key=${`media-video-${mediaIndex++}`}
          class="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80"
        >
          <video
            controls
            preload="metadata"
            class="max-h-96 w-full bg-black"
          >
            <source src=${trimmed} />
            Votre navigateur ne prend pas en charge la lecture de cette vidéo.
          </video>
        </div>`,
      );
    }
  });

  return previews;
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

export const SalonsPage = ({ bootstrap = null } = {}) => {
  const bootstrapData = useMemo(() => {
    if (!bootstrap || typeof bootstrap !== 'object') {
      return { channels: [], refreshedAt: null };
    }

    const channels = buildNormalizedChannels(bootstrap.channels);
    const refreshedAt = typeof bootstrap.refreshedAt === 'string' ? bootstrap.refreshedAt : null;
    return { channels, refreshedAt };
  }, [bootstrap]);

  const [channels, setChannels] = useState(() => bootstrapData.channels);
  const [channelsLoading, setChannelsLoading] = useState(() => bootstrapData.channels.length === 0);
  const [channelsError, setChannelsError] = useState('');
  const [channelsRefreshNonce, setChannelsRefreshNonce] = useState(0);
  const [selectedChannelId, setSelectedChannelId] = useState(() => {
    if (bootstrapData.channels.length === 0) {
      return null;
    }
    const preferred = bootstrapData.channels.find((channel) => channel.id === DEFAULT_CHANNEL_ID);
    if (preferred) {
      return preferred.id;
    }
    return bootstrapData.channels[0]?.id ?? null;
  });

  const skipInitialFetchRef = useRef(bootstrapData.channels.length > 0);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [messagesNonce, setMessagesNonce] = useState(0);
  const [paginationCursor, setPaginationCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialScrollPending, setInitialScrollPending] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');

  const messageContainerRef = useRef(null);
  const preserveScrollRef = useRef(null);
  const messageSearchInputRef = useRef(null);

  const [composerMessage, setComposerMessage] = useState('');
  const [composerError, setComposerError] = useState('');
  const [composerSuccess, setComposerSuccess] = useState('');
  const [isSubmittingMessage, setIsSubmittingMessage] = useState(false);
  const [captchaChallenge, setCaptchaChallenge] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaError, setCaptchaError] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.localStorage.getItem(MESSAGE_COOLDOWN_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const stored = Number(raw);
      if (Number.isFinite(stored)) {
        if (stored > Date.now()) {
          setCooldownUntil(stored);
        } else {
          window.localStorage.removeItem(MESSAGE_COOLDOWN_STORAGE_KEY);
        }
      }
    } catch (error) {
      console.warn('Failed to read stored message cooldown', error);
    }
  }, []);

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownRemainingMs(0);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, cooldownUntil - Date.now());
      setCooldownRemainingMs(remaining);
      if (remaining <= 0) {
        setCooldownUntil(null);
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(MESSAGE_COOLDOWN_STORAGE_KEY);
          } catch (error) {
            console.warn('Failed to clear message cooldown', error);
          }
        }
      }
    };

    updateRemaining();

    if (typeof window === 'undefined') {
      return;
    }

    const intervalId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [cooldownUntil]);

  useEffect(() => {
    setMessageSearchQuery('');
  }, [selectedChannelId]);

  useEffect(() => {
    setComposerMessage('');
    setComposerError('');
    setComposerSuccess('');
    setCaptchaAnswer('');
    if (!selectedChannelId) {
      setCaptchaChallenge(null);
      setCaptchaError('');
    }
  }, [selectedChannelId]);

  const handleMessageSearchChange = useCallback((event) => {
    const value = event?.currentTarget?.value ?? '';
    setMessageSearchQuery(value);
  }, []);

  const handleClearMessageSearch = useCallback(() => {
    setMessageSearchQuery('');
    const input = messageSearchInputRef.current;
    if (input) {
      input.focus();
    }
  }, []);

  const normalizedSearchQuery = useMemo(() => messageSearchQuery.trim().toLocaleLowerCase('fr-FR'), [messageSearchQuery]);

  const filteredMessages = useMemo(() => {
    if (!normalizedSearchQuery) {
      return messages;
    }

    return messages.filter((message) => {
      const includesQuery = (value) =>
        typeof value === 'string' && value.toLocaleLowerCase('fr-FR').includes(normalizedSearchQuery);

      if (includesQuery(message.content)) {
        return true;
      }

      if (includesQuery(message.author?.displayName) || includesQuery(message.author?.username)) {
        return true;
      }

      return false;
    });
  }, [messages, normalizedSearchQuery]);

  const hasSearchQuery = normalizedSearchQuery.length > 0;

  const isOnCooldown = cooldownRemainingMs > 0;

  const cooldownLabel = useMemo(() => {
    if (!isOnCooldown) {
      return null;
    }
    const remainingSeconds = Math.max(0, Math.ceil(cooldownRemainingMs / 1000));
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    if (hours > 0) {
      return `${hours} h ${minutes.toString().padStart(2, '0')} min`;
    }
    if (minutes > 0) {
      return `${minutes} min ${seconds.toString().padStart(2, '0')} s`;
    }
    return `${seconds} s`;
  }, [cooldownRemainingMs, isOnCooldown]);

  const composerCharacterCount = composerMessage.length;

  const fetchCaptchaChallenge = useCallback(async () => {
    if (!selectedChannelId) {
      setCaptchaChallenge(null);
      setCaptchaAnswer('');
      return;
    }

    setCaptchaLoading(true);
    setCaptchaError('');

    try {
      const response = await fetch(
        `/api/text-channels/${encodeURIComponent(selectedChannelId)}/captcha`,
        { method: 'POST' },
      );
      const contentType = response.headers?.get('Content-Type') ?? '';
      const payload = contentType.includes('application/json') ? await response.json() : null;

      if (!response.ok) {
        const message =
          payload && typeof payload.message === 'string'
            ? payload.message
            : 'Impossible de charger le captcha.';
        throw new Error(message);
      }

      const challenge = payload?.challenge;
      const challengeId = typeof challenge?.id === 'string' ? challenge.id : null;
      const question = typeof challenge?.question === 'string' ? challenge.question : null;
      const expiresAt = typeof challenge?.expiresAt === 'string' ? challenge.expiresAt : null;

      if (!challengeId || !question) {
        throw new Error('Captcha invalide reçu.');
      }

      setCaptchaChallenge({ id: challengeId, question, expiresAt });
      setCaptchaAnswer('');
      setCaptchaError('');
    } catch (error) {
      console.warn('Failed to load message captcha', error);
      const friendlyMessage =
        error instanceof Error ? error.message : "Impossible de charger le captcha.";
      setCaptchaError(friendlyMessage);
      setCaptchaChallenge(null);
      setCaptchaAnswer('');
    } finally {
      setCaptchaLoading(false);
    }
  }, [selectedChannelId]);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    if (skipInitialFetchRef.current && channelsRefreshNonce === 0) {
      skipInitialFetchRef.current = false;
      setChannelsLoading(false);
      return () => {
        isActive = false;
        controller.abort();
      };
    }

    skipInitialFetchRef.current = false;

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
        const normalized = buildNormalizedChannels(payload?.channels);

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

  useEffect(() => {
    if (!selectedChannelId || isOnCooldown) {
      return;
    }
    if (captchaLoading) {
      return;
    }
    if (captchaChallenge) {
      return;
    }
    void fetchCaptchaChallenge();
  }, [selectedChannelId, isOnCooldown, captchaChallenge, captchaLoading, fetchCaptchaChallenge]);

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

  const handleComposerMessageChange = useCallback((event) => {
    const value = event?.currentTarget?.value ?? '';
    const limited = value.length > MAX_MESSAGE_LENGTH ? value.slice(0, MAX_MESSAGE_LENGTH) : value;
    setComposerMessage(limited);
    setComposerError('');
    setComposerSuccess('');
  }, []);

  const handleCaptchaAnswerChange = useCallback((event) => {
    const value = event?.currentTarget?.value ?? '';
    setCaptchaAnswer(value);
    setComposerError('');
  }, []);

  const handleRequestNewCaptcha = useCallback(() => {
    setComposerError('');
    setComposerSuccess('');
    setCaptchaError('');
    setCaptchaAnswer('');
    void fetchCaptchaChallenge();
  }, [fetchCaptchaChallenge]);

  const handleComposerSubmit = useCallback(
    async (event) => {
      event.preventDefault();

      if (isSubmittingMessage) {
        return;
      }

      if (!selectedChannelId) {
        setComposerError('Sélectionne un salon avant d’envoyer un message.');
        return;
      }

      if (isOnCooldown) {
        setComposerError('Tu dois patienter avant d’envoyer un nouveau message.');
        return;
      }

      const trimmed = composerMessage.trim();
      if (!trimmed) {
        setComposerError('Ton message est vide.');
        return;
      }

      if (!captchaChallenge?.id) {
        setComposerError('Récupère un captcha valide avant d’envoyer ton message.');
        return;
      }

      const answer = captchaAnswer.trim();
      if (!answer) {
        setComposerError('Entre la réponse au captcha.');
        return;
      }

      setIsSubmittingMessage(true);
      setComposerError('');
      setComposerSuccess('');

      try {
        const response = await fetch(
          `/api/text-channels/${encodeURIComponent(selectedChannelId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: trimmed,
              captchaId: captchaChallenge.id,
              captchaAnswer: answer,
            }),
          },
        );

        const contentType = response.headers?.get('Content-Type') ?? '';
        const payload = contentType.includes('application/json') ? await response.json() : null;

        if (!response.ok) {
          const message =
            payload && typeof payload.message === 'string'
              ? payload.message
              : "Impossible d’envoyer le message.";
          const error = new Error(message);
          if (payload && typeof payload.error === 'string') {
            error.code = payload.error;
          }
          if (payload && typeof payload.retryAt === 'string') {
            error.retryAt = payload.retryAt;
          }
          throw error;
        }

        const nextAllowedAtIso = typeof payload?.nextAllowedAt === 'string' ? payload.nextAllowedAt : null;
        const parsedNextAllowed = nextAllowedAtIso ? Date.parse(nextAllowedAtIso) : NaN;
        const resolvedNextAllowed = Number.isFinite(parsedNextAllowed)
          ? parsedNextAllowed
          : Date.now() + MESSAGE_COOLDOWN_MS;

        setCooldownUntil(resolvedNextAllowed);
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              MESSAGE_COOLDOWN_STORAGE_KEY,
              String(resolvedNextAllowed),
            );
          } catch (storageError) {
            console.warn('Failed to persist message cooldown', storageError);
          }
        }

        setComposerMessage('');
        setCaptchaAnswer('');
        setComposerSuccess('Message envoyé ! Il apparaîtra bientôt dans le salon sélectionné.');
        setCaptchaChallenge(null);
        setCaptchaError('');
        setMessagesNonce((value) => value + 1);
      } catch (error) {
        console.warn('Failed to send channel message', error);
        if (error && typeof error === 'object' && typeof error.retryAt === 'string') {
          const retryAtMs = Date.parse(error.retryAt);
          if (Number.isFinite(retryAtMs) && retryAtMs > Date.now()) {
            setCooldownUntil(retryAtMs);
            if (typeof window !== 'undefined') {
              try {
                window.localStorage.setItem(
                  MESSAGE_COOLDOWN_STORAGE_KEY,
                  String(retryAtMs),
                );
              } catch (storageError) {
                console.warn('Failed to persist message cooldown', storageError);
              }
            }
          }
        }

        if (error && typeof error === 'object' && error.code === 'CAPTCHA_INVALID') {
          setCaptchaChallenge(null);
          setCaptchaAnswer('');
          void fetchCaptchaChallenge();
        }

        const friendlyMessage =
          error instanceof Error ? error.message : "Impossible d’envoyer le message.";
        setComposerError(friendlyMessage);
      } finally {
        setIsSubmittingMessage(false);
      }
    },
    [
      captchaAnswer,
      captchaChallenge,
      composerMessage,
      fetchCaptchaChallenge,
      isOnCooldown,
      isSubmittingMessage,
      selectedChannelId,
    ],
  );

  const canSubmitMessage = useMemo(() => {
    if (!selectedChannelId || !captchaChallenge) {
      return false;
    }
    if (isSubmittingMessage || isOnCooldown) {
      return false;
    }
    if (composerMessage.trim().length === 0) {
      return false;
    }
    if (captchaAnswer.trim().length === 0) {
      return false;
    }
    return true;
  }, [
    captchaAnswer,
    captchaChallenge,
    composerMessage,
    isOnCooldown,
    isSubmittingMessage,
    selectedChannelId,
  ]);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  return html`
    <section class="salons-page grid gap-6 lg:grid-cols-[minmax(0,176px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,192px)_minmax(0,1fr)]">
      <aside class="flex flex-col gap-1 rounded-3xl border border-white/10 bg-slate-900/60 p-1 shadow-lg shadow-black/30">
        <div class="flex items-center justify-between gap-1">
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
          ? html`<div class="space-y-2">
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
          ? html`<ul class="flex flex-col gap-1">
              ${channels.map((channel) => {
                const isActive = channel.id === selectedChannelId;
                const lastMessageLabel = formatTimestampLabel(channel.lastMessageAt);
                return html`<li key=${channel.id}>
                  <button
                    type="button"
                    class="group relative w-full overflow-hidden rounded-2xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
                      isActive
                        ? 'border-amber-400/70 bg-amber-500/10 text-white shadow-lg shadow-amber-900/30'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-amber-300/50 hover:bg-white/10 hover:text-white'
                    }"
                    onClick=${() => handleSelectChannel(channel.id)}
                    aria-pressed=${isActive ? 'true' : 'false'}
                    aria-current=${isActive ? 'page' : undefined}
                  >
                    <span
                      class="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-400/0 via-amber-400/0 to-amber-500/0 transition duration-300 ease-out ${
                        isActive ? 'via-amber-400/15 to-amber-500/20' : 'group-hover:via-amber-400/10 group-hover:to-amber-500/10'
                      }"
                      aria-hidden="true"
                    ></span>
                    <div class="relative flex items-center gap-3 px-1 py-1">
                      <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                          <p class="truncate text-[13px] font-semibold leading-5 text-white">
                            ${getChannelDisplayName(channel)}
                          </p>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4">
                          <span
                            class="min-w-0 flex-1 truncate text-left ${
                              channel.topic
                                ? 'text-slate-300/90 group-hover:text-slate-200/90'
                                : 'text-slate-500'
                            }"
                          >
                            ${channel.topic ? channel.topic : 'Aucun sujet défini'}
                          </span>
                          <span
                            class="inline-flex items-center gap-1 rounded-full bg-slate-950/60 px-1 py-0.5 text-[8px] font-medium text-slate-200 ring-1 ring-white/10"
                          >
                            <${Clock3} class="h-3 w-3" aria-hidden="true" />
                            ${lastMessageLabel ?? 'Aucun historique'}
                          </span>
                        </div>
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
          <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end md:w-auto">
            <div class="relative flex-1 sm:w-64 md:w-72">
              <label class="sr-only" for="salons-message-search">Rechercher dans l’historique</label>
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <${Search} class="h-4 w-4" aria-hidden="true" />
              </span>
              <input
                id="salons-message-search"
                ref=${messageSearchInputRef}
                type="search"
                class="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-10 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950"
                placeholder="Rechercher dans l’historique…"
                value=${messageSearchQuery}
                onInput=${handleMessageSearchChange}
                autoComplete="off"
                spellCheck=${false}
              />
              ${hasSearchQuery
                ? html`<button
                    type="button"
                    class="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white/5 bg-white/10 text-slate-200 transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950"
                    onClick=${handleClearMessageSearch}
                  >
                    <span class="sr-only">Effacer la recherche</span>
                    <${X} class="h-3.5 w-3.5" aria-hidden="true" />
                  </button>`
                : null}
            </div>
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
              ${hasSearchQuery && !messagesLoading && messages.length > 0 && filteredMessages.length === 0
                ? html`<p class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">Aucun message ne correspond à ta recherche.</p>`
                : null}
              ${filteredMessages.map((message) => {
                const timestampLabel = formatTimestampLabel(message.createdAt);
                const authorName = message.author?.displayName || message.author?.username || 'Membre Libre Antenne';
                const profileHref = message.author?.id ? buildRoutePath('profile', { userId: message.author.id }) : null;
                const { nodes: contentNodes, urls: contentUrls } = linkifyContent(message.content);
                const mediaPreviews = buildMediaPreviews(contentUrls);
                const hasRenderableText = contentNodes.some((node) => {
                  if (typeof node === 'string') {
                    return node.trim().length > 0;
                  }
                  return true;
                });
                return html`<article
                  key=${message.id}
                  class="flex gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-slate-100 shadow-inner shadow-black/20"
                >
                  <${AuthorAvatar} author=${message.author} />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                      ${profileHref
                        ? html`<a
                            class="inline-flex items-center text-sm font-semibold text-white transition hover:text-amber-200 focus-visible:outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                            href=${profileHref}
                            aria-label=${`Voir le profil de ${authorName}`}
                          >
                            ${authorName}
                          </a>`
                        : html`<p class="text-sm font-semibold text-white">${authorName}</p>`}
                      ${message.author?.username && message.author.username !== authorName
                        ? profileHref
                          ? html`<a
                              class="inline-flex items-center text-xs text-slate-400 transition hover:text-amber-200 focus-visible:outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                              href=${profileHref}
                            >
                              @${message.author.username}
                            </a>`
                          : html`<p class="text-xs text-slate-400">@${message.author.username}</p>`
                        : null}
                      ${timestampLabel
                        ? html`<p class="text-xs text-slate-400">${timestampLabel}</p>`
                        : null}
                    </div>
                    <div class="flex flex-col gap-3 text-sm leading-relaxed text-slate-200">
                      ${hasRenderableText
                        ? html`<p class="whitespace-pre-wrap break-words">${contentNodes}</p>`
                        : mediaPreviews.length === 0
                          ? html`<p class="text-slate-400">—</p>`
                          : null}
                      ${mediaPreviews.length > 0
                        ? html`<div class="flex flex-col gap-3">${mediaPreviews}</div>`
                        : null}
                    </div>
                  </div>
                </article>`;
              })}
            </div>
          </div>
        </div>
        <div class="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-lg shadow-black/30">
          <div class="flex flex-col gap-5">
            <div class="flex flex-col gap-1">
              <h2 class="text-lg font-semibold text-white">Envoyer un message public</h2>
              <p class="text-sm text-slate-300">
                Rédige un message court pour le salon sélectionné. Pour éviter les abus, un captcha est requis et l’envoi est
                limité à un message par heure.
              </p>
            </div>
            ${composerSuccess
              ? html`<div class="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 shadow-inner shadow-emerald-900/20">${composerSuccess}</div>`
              : null}
            ${composerError
              ? html`<div class="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 shadow-inner shadow-rose-900/20">${composerError}</div>`
              : null}
            ${isOnCooldown
              ? html`<div class="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-inner shadow-amber-900/20">
                  ${cooldownLabel
                    ? `Tu pourras envoyer un nouveau message dans ${cooldownLabel}.`
                    : 'Tu pourras envoyer un nouveau message dans moins d’une minute.'}
                </div>`
              : null}
            <form class="space-y-5" onSubmit=${handleComposerSubmit}>
              <div class="space-y-2">
                <label class="text-sm font-semibold text-white" for="salons-composer-message">Message</label>
                <textarea
                  id="salons-composer-message"
                  class="min-h-[6.5rem] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  value=${composerMessage}
                  onInput=${handleComposerMessageChange}
                  maxLength=${MAX_MESSAGE_LENGTH}
                  placeholder="Ton message pour la communauté…"
                  disabled=${isSubmittingMessage || isOnCooldown || !selectedChannelId}
                  autoComplete="off"
                  spellCheck=${false}
                ></textarea>
                <div class="flex items-center justify-between text-xs text-slate-400">
                  <span>Le message sera publié via le compte Libre Antenne.</span>
                  <span>${composerCharacterCount}/${MAX_MESSAGE_LENGTH}</span>
                </div>
              </div>
              <div class="space-y-2">
                <label class="text-sm font-semibold text-white" for="salons-composer-captcha">Captcha</label>
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div class="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                    ${captchaLoading
                      ? 'Chargement du captcha…'
                      : captchaChallenge?.question ?? 'Clique sur « Nouveau captcha » pour continuer.'}
                  </div>
                  <div class="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <input
                      id="salons-composer-captcha"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      class="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60 sm:w-40"
                      value=${captchaAnswer}
                      onInput=${handleCaptchaAnswerChange}
                      placeholder="Réponse"
                      autoComplete="off"
                      disabled=${
                        isSubmittingMessage
                        || isOnCooldown
                        || !selectedChannelId
                        || captchaLoading
                        || !captchaChallenge
                      }
                    />
                    <button
                      type="button"
                      class="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick=${handleRequestNewCaptcha}
                      disabled=${isSubmittingMessage || isOnCooldown || !selectedChannelId || captchaLoading}
                    >
                      Nouveau captcha
                    </button>
                  </div>
                </div>
                ${captchaError ? html`<p class="text-xs text-rose-200">${captchaError}</p>` : null}
              </div>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs text-slate-400">Limite : un message toutes les 60 minutes.</p>
                <button
                  type="submit"
                  class="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled=${!canSubmitMessage}
                >
                  ${isSubmittingMessage
                    ? 'Envoi…'
                    : html`<span class="inline-flex items-center gap-2"><${Send} class="h-4 w-4" aria-hidden="true" />Envoyer</span>`}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  `;
};
