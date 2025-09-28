import Stripe from 'stripe';
import type { Config } from '../config';

export type ShopProvider = 'stripe' | 'coingate';

interface ProductDefinition {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  includes: string[];
  shippingEstimate: string;
  badges: string[];
  accent: string;
  accentSoft: string;
  emoji: string;
  highlight?: boolean;
  stripePriceKey?: string;
}

interface InternalProduct extends ProductDefinition {
  stripePriceId?: string;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string;
  price: {
    amount: number;
    currency: string;
    formatted: string;
  };
  includes: string[];
  shippingEstimate: string;
  badges: string[];
  accent: string;
  accentSoft: string;
  emoji: string;
  highlight: boolean;
  providers: ShopProvider[];
}

export interface CheckoutRequestOptions {
  productId: string;
  provider: ShopProvider;
  successUrl?: string;
  cancelUrl?: string;
  customerEmail?: string;
}

export interface CheckoutSession {
  provider: ShopProvider;
  url: string;
}

export class ShopError extends Error {
  public readonly code: string;

  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ShopError';
    this.code = code;
    this.status = status;
  }
}

interface ShopServiceOptions {
  config: Config;
}

export default class ShopService {
  private readonly config: Config;

  private readonly products: InternalProduct[];

  private readonly stripe: Stripe | null;

  private readonly coingateApiBase: string | null;

  constructor({ config }: ShopServiceOptions) {
    this.config = config;
    this.products = this.initializeProducts();
    this.stripe = this.initializeStripe();
    this.coingateApiBase = this.initializeCoingateBaseUrl();
  }

  public getCurrency(): string {
    return this.config.shop.currency;
  }

  public getProducts(): PublicProduct[] {
    return this.products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: {
        amount: product.priceCents / 100,
        currency: product.currency,
        formatted: this.formatPrice(product.priceCents, product.currency),
      },
      includes: product.includes,
      shippingEstimate: product.shippingEstimate,
      badges: product.badges,
      accent: product.accent,
      accentSoft: product.accentSoft,
      emoji: product.emoji,
      highlight: Boolean(product.highlight),
      providers: this.computeAvailableProviders(product),
    }));
  }

  public async createCheckoutSession(options: CheckoutRequestOptions): Promise<CheckoutSession> {
    const product = this.products.find((entry) => entry.id === options.productId);
    if (!product) {
      throw new ShopError('PRODUCT_NOT_FOUND', "Produit introuvable.", 404);
    }

    switch (options.provider) {
      case 'stripe':
        return this.createStripeCheckout(product, options);
      case 'coingate':
        return this.createCoingateCheckout(product, options);
      default:
        throw new ShopError('PROVIDER_UNSUPPORTED', 'Fournisseur de paiement non pris en charge.', 400);
    }
  }

  private initializeProducts(): InternalProduct[] {
    const { shop } = this.config;
    const definitions: ProductDefinition[] = [
      {
        id: 'mug-classique',
        name: 'Mug Libre Antenne',
        description: 'Mug céramique 330 ml pour affronter les libres antennes nocturnes avec style.',
        priceCents: 1800,
        currency: shop.currency,
        includes: [
          'Impression double face résistante au lave-vaisselle',
          'Capacité 330 ml pour les longues nuits en direct',
          'Packaging protecteur anti-chocs',
        ],
        shippingEstimate: 'Production & expédition sous 5 à 7 jours ouvrés',
        badges: ['Edition nocturne'],
        accent: 'from-indigo-500/20 via-fuchsia-500/20 to-purple-500/20',
        accentSoft: 'bg-indigo-500/10',
        emoji: '☕️',
        stripePriceKey: 'mug',
      },
      {
        id: 'tshirt-logo',
        name: 'T-shirt Signal Brut',
        description: 'T-shirt coupe unisexe 100 % coton bio avec logo Libre Antenne sérigraphié.',
        priceCents: 3200,
        currency: shop.currency,
        includes: [
          'Coton peigné 180 g/m² certifié OEKO-TEX®',
          'Impression douce durable haute densité',
          'Tailles du XS au XXL (guide fourni après commande)',
        ],
        shippingEstimate: 'Impression à la demande · 7 à 10 jours ouvrés',
        badges: ['Best-seller'],
        accent: 'from-sky-500/20 via-indigo-500/20 to-blue-500/20',
        accentSoft: 'bg-sky-500/10',
        emoji: '👕',
        highlight: true,
        stripePriceKey: 'tshirt',
      },
      {
        id: 'pack-essentiel',
        name: 'Pack Essentiel',
        description: 'Le duo mug + t-shirt pour afficher ta vibe Libre Antenne partout.',
        priceCents: 4500,
        currency: shop.currency,
        includes: [
          'Mug Libre Antenne',
          'T-shirt Signal Brut',
          'Autocollants holographiques exclusifs',
        ],
        shippingEstimate: 'Expédition groupée sous 7 à 12 jours ouvrés',
        badges: ['Économie combinée'],
        accent: 'from-fuchsia-500/20 via-rose-500/20 to-amber-500/20',
        accentSoft: 'bg-fuchsia-500/10',
        emoji: '🎁',
        stripePriceKey: 'pack',
      },
    ];

    return definitions.map<InternalProduct>((definition) => ({
      ...definition,
      stripePriceId: definition.stripePriceKey
        ? shop.stripe.priceIds[definition.stripePriceKey] || undefined
        : undefined,
    }));
  }

  private initializeStripe(): Stripe | null {
    const secretKey = this.config.shop.stripe.secretKey;
    if (!secretKey) {
      return null;
    }

    try {
      return new Stripe(secretKey, {
        telemetry: false,
        appInfo: {
          name: 'Libre Antenne Shop',
        },
      });
    } catch (error) {
      console.warn('Stripe initialisation failed', error);
      return null;
    }
  }

  private initializeCoingateBaseUrl(): string | null {
    if (!this.config.shop.coingate.apiKey) {
      return null;
    }

    return this.config.shop.coingate.environment === 'live'
      ? 'https://api.coingate.com/v2'
      : 'https://api-sandbox.coingate.com/v2';
  }

  private computeAvailableProviders(product: InternalProduct): ShopProvider[] {
    const providers: ShopProvider[] = [];
    if (this.stripe && product.stripePriceId) {
      providers.push('stripe');
    }
    if (this.coingateApiBase && this.config.shop.coingate.apiKey) {
      providers.push('coingate');
    }
    return providers;
  }

  private formatPrice(priceCents: number, currency: string): string {
    try {
      return new Intl.NumberFormat(this.config.shop.locale, {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: 2,
      }).format(priceCents / 100);
    } catch (error) {
      console.warn('Price formatting failed', error);
      return `${(priceCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
    }
  }

  private async createStripeCheckout(
    product: InternalProduct,
    options: CheckoutRequestOptions,
  ): Promise<CheckoutSession> {
    if (!this.stripe) {
      throw new ShopError('STRIPE_DISABLED', 'Stripe est indisponible.', 503);
    }

    if (!product.stripePriceId) {
      throw new ShopError(
        'STRIPE_PRICE_MISSING',
        'Aucun prix Stripe configuré pour ce produit.',
        503,
      );
    }

    const successUrl = this.ensureValidReturnUrl(options.successUrl, 'success');
    const cancelUrl = this.ensureValidReturnUrl(options.cancelUrl, 'cancel');

    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price: product.stripePriceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: options.customerEmail,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        metadata: {
          productId: product.id,
        },
      });

      if (!session.url) {
        throw new ShopError(
          'STRIPE_URL_MISSING',
          'Impossible de récupérer le lien de paiement Stripe.',
          503,
        );
      }

      return { provider: 'stripe', url: session.url };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur inconnue lors de la création de la session Stripe.';
      throw new ShopError('STRIPE_CHECKOUT_FAILED', message, 502);
    }
  }

  private async createCoingateCheckout(
    product: InternalProduct,
    options: CheckoutRequestOptions,
  ): Promise<CheckoutSession> {
    const apiKey = this.config.shop.coingate.apiKey;
    if (!apiKey || !this.coingateApiBase) {
      throw new ShopError('COINGATE_DISABLED', 'CoinGate est indisponible.', 503);
    }

    const successUrl = this.ensureValidReturnUrl(options.successUrl, 'success');
    const cancelUrl = this.ensureValidReturnUrl(options.cancelUrl, 'cancel');

    const orderPayload = {
      order_id: `${product.id}-${Date.now()}`,
      price_amount: (product.priceCents / 100).toFixed(2),
      price_currency: product.currency.toUpperCase(),
      receive_currency: 'keep',
      title: product.name,
      description: product.description,
      success_url: successUrl,
      cancel_url: cancelUrl,
      callback_url: this.config.shop.coingate.callbackUrl ?? successUrl,
    };

    try {
      const response = await fetch(`${this.coingateApiBase}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${apiKey}`,
        },
        body: JSON.stringify(orderPayload),
      });

      if (!response.ok) {
        const errorBody = (await this.safeReadJson(response)) as { message?: string } | null;
        const message =
          typeof errorBody?.message === 'string'
            ? errorBody.message
            : `CoinGate a répondu avec le statut ${response.status}.`;
        throw new ShopError('COINGATE_CHECKOUT_FAILED', message, 502);
      }

      const payload = (await response.json()) as { payment_url?: string };
      if (!payload?.payment_url) {
        throw new ShopError(
          'COINGATE_URL_MISSING',
          'Impossible de récupérer le lien de paiement CoinGate.',
          503,
        );
      }

      return { provider: 'coingate', url: payload.payment_url };
    } catch (error) {
      if (error instanceof ShopError) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Erreur inconnue lors de la création de la commande CoinGate.';
      throw new ShopError('COINGATE_CHECKOUT_FAILED', message, 502);
    }
  }

  private ensureValidReturnUrl(value: string | undefined, type: 'success' | 'cancel'): string {
    if (!value) {
      throw new ShopError('RETURN_URL_REQUIRED', `L'URL de redirection (${type}) est obligatoire.`, 400);
    }

    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
      return parsed.toString();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "L'URL de redirection fournie est invalide.";
      throw new ShopError('RETURN_URL_INVALID', message, 400);
    }
  }

  private async safeReadJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      console.warn('Unable to parse CoinGate error body', error);
      return null;
    }
  }
}
