import {
  Fragment,
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  AlertCircle,
  Coffee,
  Coins,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from '../core/deps.js';
import { ShopProductCard } from '../components/index.js';
import { SHOP_CONTENT } from '../../../src/content/shop.ts';

const FEEDBACK_STYLES = {
  success: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
  info: 'border-sky-400/40 bg-sky-500/10 text-sky-100',
  error: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
};

const HERO_HIGHLIGHT_ICONS = [ShoppingBag, Truck, Coffee];

const parseCheckoutFeedback = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const { pathname, search } = window.location;
    const normalizedPath = typeof pathname === 'string' ? pathname.toLowerCase() : '';
    if (!['/boutique', '/shop'].includes(normalizedPath)) {
      return null;
    }

    const params = new URLSearchParams(search || '');
    const status = (params.get('checkout') || '').toLowerCase();
    if (!status) {
      return null;
    }

    let type = 'info';
    let message = '';
    if (status === 'success') {
      type = 'success';
      message = 'Merci pour ton soutien ! La commande est bien prise en compte.';
    } else if (status === 'cancelled') {
      type = 'info';
      message = 'Paiement annulé. Tu peux réessayer quand tu veux.';
    } else {
      type = 'error';
      message = 'Une erreur est survenue lors du paiement. Aucun débit n’a été effectué.';
    }

    if (typeof window.history?.replaceState === 'function') {
      window.history.replaceState({ route: { name: 'shop', params: {} } }, '', '/boutique');
    }

    return { type, message };
  } catch (error) {
    console.warn('Impossible de lire le statut de paiement', error);
    return null;
  }
};

export const ShopPage = ({ bootstrap = null }) => {
  const initialProducts =
    bootstrap && Array.isArray(bootstrap.products) ? bootstrap.products : [];
  const bootstrapRef = useRef(initialProducts.length > 0);
  const [loading, setLoading] = useState(initialProducts.length === 0);
  const [products, setProducts] = useState(initialProducts);
  const [error, setError] = useState('');
  const [checkoutState, setCheckoutState] = useState({
    productId: null,
    provider: null,
    pending: false,
    error: '',
  });
  const [feedback, setFeedback] = useState(parseCheckoutFeedback);

  const fetchProducts = useCallback(async () => {
    if (bootstrapRef.current) {
      bootstrapRef.current = false;
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/shop/products');
      if (!response.ok) {
        throw new Error('Réponse inattendue du serveur.');
      }
      const payload = await response.json();
      const list = Array.isArray(payload?.products) ? payload.products : [];
      setProducts(list);
      setError('');
    } catch (err) {
      console.warn('Impossible de charger la boutique', err);
      setError('Boutique momentanément indisponible. Réessaie dans quelques minutes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    if (!feedback) {
      return undefined;
    }
    const timer = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const getReturnUrls = useCallback(() => {
    if (typeof window === 'undefined') {
      return { success: '', cancel: '' };
    }
    const base = new URL('/boutique', window.location.origin);
    return {
      success: `${base.href}?checkout=success`,
      cancel: `${base.href}?checkout=cancelled`,
    };
  }, []);

  const handleCheckout = useCallback(
    async (productId, provider) => {
      setCheckoutState({ productId, provider, pending: true, error: '' });
      setFeedback(null);

      try {
        const { success, cancel } = getReturnUrls();
        const response = await fetch('/api/shop/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            provider,
            successUrl: success || undefined,
            cancelUrl: cancel || undefined,
          }),
        });

        if (!response.ok) {
          let message = 'Impossible de lancer le paiement.';
          try {
            const data = await response.json();
            if (data?.message) {
              message = data.message;
            }
          } catch (parseError) {
            console.warn('Impossible de lire la réponse de paiement', parseError);
          }
          throw new Error(message);
        }

        const payload = await response.json();
        if (payload?.url) {
          window.location.href = payload.url;
          return;
        }

        throw new Error('Lien de paiement introuvable.');
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Impossible de lancer le paiement.';
        setCheckoutState({ productId, provider, pending: false, error: message });
        setFeedback({ type: 'error', message });
      }
    },
    [getReturnUrls],
  );

  const heroHighlights = useMemo(
    () =>
      SHOP_CONTENT.hero.highlights.map((highlight, index) => ({
        label: highlight.label,
        Icon: HERO_HIGHLIGHT_ICONS[index] ?? ShoppingBag,
      })),
    [],
  );

  const sortedProducts = useMemo(() =>
    products
      .slice()
      .sort((a, b) => Number(Boolean(b.highlight)) - Number(Boolean(a.highlight))),
  [products]);

  return html`
    <${Fragment}>
      <section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
        <p class="text-xs uppercase tracking-[0.35em] text-slate-300">${SHOP_CONTENT.hero.eyebrow}</p>
        <div class="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div class="space-y-4">
            <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              ${SHOP_CONTENT.hero.title}
            </h1>
            <p class="text-base leading-relaxed text-slate-200">
              ${SHOP_CONTENT.hero.description}
            </p>
            <div class="flex flex-wrap gap-3 text-xs text-slate-200">
              ${heroHighlights.map(
                ({ Icon, label }) => html`<span
                  key=${label}
                  class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5"
                >
                  <${Icon} class="h-4 w-4" aria-hidden="true" />
                  ${label}
                </span>`,
              )}
            </div>
          </div>
          <div class="rounded-3xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-6 py-6 text-sm text-fuchsia-100 shadow-lg shadow-fuchsia-900/30">
            <p class="text-xs uppercase tracking-[0.35em] text-fuchsia-200/80">${SHOP_CONTENT.hero.support.eyebrow}</p>
            <p class="mt-3 leading-relaxed">
              ${SHOP_CONTENT.hero.support.body}
            </p>
          </div>
        </div>
      </section>

      ${feedback
        ? (() => {
            const style = FEEDBACK_STYLES[feedback.type] || FEEDBACK_STYLES.info;
            const Icon =
              feedback.type === 'success'
                ? ShieldCheck
                : feedback.type === 'error'
                ? AlertCircle
                : RefreshCcw;
            return html`<div class=${`rounded-2xl border px-5 py-4 text-sm shadow-lg shadow-slate-950/40 backdrop-blur ${style}`}>
              <div class="flex items-center gap-3">
                <${Icon} class="h-4 w-4" aria-hidden="true" />
                <span>${feedback.message}</span>
              </div>
            </div>`;
          })()
        : null}

      <section class="space-y-6">
        ${loading
          ? html`<div class="rounded-3xl border border-white/10 bg-black/30 px-6 py-10 text-center text-sm text-slate-300">
              <span class="mr-3 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent"></span>
              Chargement de la boutique…
            </div>`
          : error
          ? html`<div class="rounded-3xl border border-rose-400/40 bg-rose-500/10 px-6 py-6 text-sm text-rose-100 shadow-lg shadow-rose-900/40">
              <p>${error}</p>
              <button
                type="button"
                class="mt-4 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-white/20"
                onClick=${fetchProducts}
              >
                Réessayer
                <${RefreshCcw} class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>`
          : html`<div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              ${sortedProducts.map((product) =>
                html`<${ShopProductCard}
                  key=${product.id}
                  product=${product}
                  checkoutState=${checkoutState}
                  onCheckout=${handleCheckout}
                />`,
              )}
            </div>`}
      </section>

      <section class="grid gap-6 lg:grid-cols-2">
        <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
          <h3 class="flex items-center gap-2 text-lg font-semibold text-white">
            <${ShieldCheck} class="h-5 w-5 text-emerald-300" aria-hidden="true" />
            ${SHOP_CONTENT.sections.verifiedPayments.title}
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-slate-300">
            ${SHOP_CONTENT.sections.verifiedPayments.description}
          </p>
        </div>
        <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">
          <h3 class="flex items-center gap-2 text-lg font-semibold text-white">
            <${Coins} class="h-5 w-5 text-emerald-300" aria-hidden="true" />
            ${SHOP_CONTENT.sections.cryptoFriendly.title}
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-slate-300">
            ${SHOP_CONTENT.sections.cryptoFriendly.description}
          </p>
        </div>
      </section>
    </${Fragment}>
  `;
};
