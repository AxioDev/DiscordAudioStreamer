import {
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Sparkles,
  MessageSquare,
  RefreshCcw,
} from '../core/deps.js';

const createMessageId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildWelcomeMessage = () => ({
  id: createMessageId('assistant'),
  role: 'assistant',
  content:
    "Salut ! Je suis l’assistant IA de Libre Antenne. Pose une question sur l’activité Discord, les moments marquants ou le contexte d’un membre : je fouille la base de données communautaire pour te répondre.",
  timestamp: Date.now(),
  tone: 'intro',
});

export const ChatPage = () => {
  const [messages, setMessages] = useState(() => [buildWelcomeMessage()]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const scrollContainerRef = useRef(null);
  const pendingRequestRef = useRef(null);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );

  useEffect(() => {
    return () => {
      if (pendingRequestRef.current) {
        pendingRequestRef.current.abort();
        pendingRequestRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (maxScrollTop <= 0) {
      return;
    }
    try {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } catch (error) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isLoading]);

  const sendMessage = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const timestamp = Date.now();
    const userMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: trimmed,
      timestamp,
    };

    setMessages((previous) => [...previous, userMessage]);
    setDraft('');
    setError(null);
    setIsLoading(true);

    if (pendingRequestRef.current) {
      pendingRequestRef.current.abort();
      pendingRequestRef.current = null;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) {
      pendingRequestRef.current = controller;
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
        signal: controller?.signal,
      });

      const contentType = response.headers?.get('Content-Type') ?? '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json() : null;

      if (!response.ok) {
        const message =
          (payload && typeof payload.message === 'string' && payload.message.trim().length > 0
            ? payload.message.trim()
            : "Impossible d’obtenir une réponse pour le moment.");
        throw new Error(message);
      }

      const rawAnswer = payload && typeof payload.answer === 'string' ? payload.answer.trim() : '';
      if (!rawAnswer) {
        throw new Error("La réponse de l’assistant est vide.");
      }

      const assistantMessage = {
        id: createMessageId('assistant'),
        role: 'assistant',
        content: rawAnswer,
        timestamp: Date.now(),
      };

      setMessages((previous) => [...previous, assistantMessage]);
    } catch (requestError) {
      if (requestError?.name === 'AbortError') {
        return;
      }

      console.error('Failed to retrieve assistant answer', requestError);
      const friendlyMessage =
        requestError instanceof Error && requestError.message
          ? requestError.message
          : "Une erreur inattendue est survenue.";
      setError(friendlyMessage);
      setMessages((previous) => [
        ...previous,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          content: "Je n’ai pas pu récupérer d’information pour cette question. Réessaie dans un instant !",
          timestamp: Date.now(),
          tone: 'error',
        },
      ]);
    } finally {
      if (pendingRequestRef.current === controller) {
        pendingRequestRef.current = null;
      }
      setIsLoading(false);
    }
  }, [draft, isLoading]);

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      void sendMessage();
    },
    [sendMessage],
  );

  const handleDraftChange = useCallback((event) => {
    setDraft(event.target?.value ?? '');
  }, []);

  const handleDraftKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      void sendMessage();
    },
    [sendMessage],
  );

  return html`
    <section class="chat-page flex flex-col gap-8">
      <header class="rounded-3xl border border-white/10 bg-slate-900/70 px-6 py-6 shadow-lg shadow-black/30 backdrop-blur">
        <div class="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start gap-4">
            <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40">
              <${Sparkles} class="h-6 w-6" aria-hidden="true" />
            </span>
            <div class="flex flex-col gap-2">
              <h1 class="text-2xl font-semibold text-white">Assistant IA Libre Antenne</h1>
              <p class="text-sm text-slate-300">
                Pose une question sur la communauté Discord : l’assistant retrouve les passages pertinents dans les transcriptions,
                messages et résumés pour te répondre avec précision.
              </p>
            </div>
          </div>
          <div class="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 shadow-inner shadow-emerald-500/20">
            <p class="font-medium">Sources vérifiées</p>
            <p class="text-emerald-50/80">Chaque réponse s’appuie sur les informations vérifiées de la communauté.</p>
          </div>
        </div>
      </header>

      <div class="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <section class="flex h-[560px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-2xl shadow-black/30 backdrop-blur">
          <div
            ref=${scrollContainerRef}
            class="flex-1 space-y-5 overflow-y-auto px-6 py-6"
            aria-live="polite"
            aria-label="Historique de la conversation"
          >
            ${messages.map((message) => {
              const isUser = message.role === 'user';
              const isErrorTone = message.tone === 'error';
              const isIntro = message.tone === 'intro';
              const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
              const formattedTime = timeFormatter.format(new Date(timestamp));
              const Icon = isUser ? MessageSquare : Sparkles;

              const bubbleClasses = [
                'flex gap-3 rounded-2xl border px-4 py-3 shadow-lg',
                'backdrop-blur-sm transition',
                isUser
                  ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100 shadow-indigo-500/10'
                  : isErrorTone
                    ? 'border-rose-400/40 bg-rose-500/15 text-rose-100 shadow-rose-500/10'
                    : isIntro
                      ? 'border-amber-300/40 bg-amber-400/10 text-amber-100 shadow-amber-500/10'
                      : 'border-slate-700/60 bg-slate-800/60 text-slate-100 shadow-black/20',
              ].join(' ');

              const iconWrapperClass = [
                'mt-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl',
                isUser
                  ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-300/50'
                  : isErrorTone
                    ? 'bg-rose-500/20 text-rose-100 ring-1 ring-rose-300/50'
                    : isIntro
                      ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-300/50'
                      : 'bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-300/50',
              ].join(' ');

              const containerClass = `flex ${isUser ? 'justify-end' : 'justify-start'}`;
              const metadataClass = `flex items-center gap-2 text-[0.7rem] uppercase tracking-wider ${
                isUser
                  ? 'justify-end text-indigo-200/80'
                  : isErrorTone
                    ? 'text-rose-200/80'
                    : 'text-slate-400'
              }`;

              return html`
                <article key=${message.id} class=${containerClass}>
                  <div class=${`flex max-w-[90%] flex-col gap-2 ${isUser ? 'items-end text-right' : 'items-start text-left'}`}>
                    <div class=${metadataClass}>
                      <span>${isUser ? 'Toi' : 'Assistant IA'}</span>
                      <span aria-hidden="true">•</span>
                      <time dateTime=${new Date(timestamp).toISOString()} class="text-[0.65rem] font-semibold">
                        ${formattedTime}
                      </time>
                    </div>
                    <div class=${bubbleClasses}>
                      <span class=${iconWrapperClass}>
                        <${Icon} class="h-4 w-4" aria-hidden="true" />
                      </span>
                      <p class="whitespace-pre-wrap text-sm leading-relaxed text-left">${message.content}</p>
                    </div>
                  </div>
                </article>
              `;
            })}

            ${isLoading
              ? html`
                  <div class="flex justify-start">
                    <div class="flex items-center gap-3 rounded-2xl border border-indigo-400/40 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100 shadow-inner shadow-indigo-500/20">
                      <${RefreshCcw} class="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>L’assistant prépare une réponse…</span>
                    </div>
                  </div>
                `
              : null}
          </div>

          <div class="border-t border-white/5 bg-slate-950/60 px-5 py-4">
            <form class="flex flex-col gap-3" onSubmit=${handleSubmit}>
              ${error
                ? html`
                    <div
                      class="flex items-start gap-2 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 shadow-inner shadow-rose-500/20"
                      role="alert"
                    >
                      <strong class="font-semibold">Oups :</strong>
                      <span>${error}</span>
                    </div>
                  `
                : null}
              <label class="flex flex-col gap-2 text-sm text-slate-200">
                <span class="font-medium">Ton message</span>
                <textarea
                  class="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white shadow-inner shadow-black/40 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/60"
                  placeholder="Ex. : Résume ce qui s’est dit hier soir ou raconte la dernière intervention de Vega."
                  value=${draft}
                  onInput=${handleDraftChange}
                  onKeyDown=${handleDraftKeyDown}
                  disabled=${isLoading}
                  aria-label="Saisir un message pour l’assistant IA"
                ></textarea>
              </label>
              <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <p>Appuie sur Entrée pour envoyer · Maj + Entrée pour revenir à la ligne</p>
                <button
                  type="submit"
                  class="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/50 bg-indigo-500/10 px-4 py-2 text-sm font-semibold text-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled=${isLoading || !draft.trim()}
                >
                  <${Sparkles} class="h-4 w-4" aria-hidden="true" />
                  Envoyer à l’assistant
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside class="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-sm leading-relaxed text-slate-300 shadow-lg shadow-black/30 backdrop-blur">
          <h2 class="text-base font-semibold text-white">Conseils pour de meilleures réponses</h2>
          <ul class="space-y-4">
            <li>
              <strong class="text-slate-100">Précise la période</strong>
              <p>Indique un créneau ou une émission pour cibler les transcriptions correspondantes.</p>
            </li>
            <li>
              <strong class="text-slate-100">Cite les participants</strong>
              <p>Ajoute un pseudonyme Discord pour que l’assistant retrouve ses interventions.</p>
            </li>
            <li>
              <strong class="text-slate-100">Reste factuel</strong>
              <p>L’IA se base uniquement sur les données enregistrées : si l’information manque, elle te le dira.</p>
            </li>
          </ul>
          <div class="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-xs text-slate-400">
            <p class="font-semibold text-slate-200">Protection des données</p>
            <p>Les réponses proviennent des logs Discord stockés côté serveur. Rien n’est partagé avec des services externes en dehors de la génération IA.</p>
          </div>
        </aside>
      </div>
    </section>
  `;
};

export default ChatPage;
