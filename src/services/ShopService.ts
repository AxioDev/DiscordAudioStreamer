import Stripe from 'stripe';
import type { Config } from '../config';
import { MUG_LIBRE_ANTENNE_IMAGE, TSHIRT_SIGNAL_BRUT_IMAGE } from './shopImageData';

export type ShopProvider = 'stripe' | 'coingate' | 'paypal';

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
  imageUrl?: string;
  imageAlt?: string;
  updatedAt?: string;
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
  image: { url: string; alt: string } | null;
  updatedAt: string | null;
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

  private readonly paypalApiBase: string | null;

  private paypalAccessToken: { value: string; expiresAt: number } | null = null;

  constructor({ config }: ShopServiceOptions) {
    this.config = config;
    this.products = this.initializeProducts();
    this.stripe = this.initializeStripe();
    this.coingateApiBase = this.initializeCoingateBaseUrl();
    this.paypalApiBase = this.initializePaypalBaseUrl();
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
      image: product.imageUrl
        ? {
            url: product.imageUrl,
            alt: product.imageAlt?.trim() || product.name,
          }
        : null,
      updatedAt: product.updatedAt ?? null,
    }));
  }

  public getCatalogUpdatedAt(): string | null {
    const timestamps = this.products
      .map((product) => product.updatedAt)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      })
      .filter((date): date is Date => Boolean(date));

    if (timestamps.length === 0) {
      return null;
    }

    const latest = timestamps.reduce((acc, current) => {
      if (!acc) {
        return current;
      }
      return current.getTime() > acc.getTime() ? current : acc;
    });

    return latest?.toISOString() ?? null;
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
      case 'paypal':
        return this.createPaypalCheckout(product, options);
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
        imageUrl: MUG_LIBRE_ANTENNE_IMAGE,
        imageAlt: 'Illustration du mug Libre Antenne avec mascotte en noir et blanc',
        updatedAt: '2024-10-02T09:00:00.000Z',
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
        imageUrl: TSHIRT_SIGNAL_BRUT_IMAGE,
        imageAlt: 'Visuel du t-shirt noir Libre Antenne "Libre Antenne"',
        updatedAt: '2024-10-15T09:00:00.000Z',
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
        updatedAt: '2024-11-05T09:00:00.000Z',
      },
      {
        id: 'option-moderation',
        name: 'Option Modération',
        description:
          'Deviens modérateur et participe activement à la protection de la communauté Libre Antenne.',
        priceCents: 2500,
        currency: shop.currency,
        includes: [
          'Attribution du rôle Modérateur sur le serveur Discord',
          'Accès aux salons privés de coordination',
          'Session d’accueil pour découvrir les outils et bonnes pratiques',
        ],
        shippingEstimate: 'Activation sous 24 h (aucune livraison physique)',
        badges: ['Rôle communautaire'],
        accent: 'from-emerald-500/20 via-lime-500/20 to-teal-500/20',
        accentSoft: 'bg-emerald-500/10',
        emoji: '🛡️',
        stripePriceKey: 'moderation',
        updatedAt: '2024-09-20T09:00:00.000Z',
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

  private initializePaypalBaseUrl(): string | null {
    const { clientId, clientSecret, environment } = this.config.shop.paypal;
    if (!clientId || !clientSecret) {
      return null;
    }

    return environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  private computeAvailableProviders(product: InternalProduct): ShopProvider[] {
    const providers: ShopProvider[] = [];
    if (this.stripe && product.stripePriceId) {
      providers.push('stripe');
    }
    if (this.coingateApiBase && this.config.shop.coingate.apiKey) {
      providers.push('coingate');
    }
    if (this.isPaypalEnabled()) {
      providers.push('paypal');
    }
    return providers;
  }

  private isPaypalEnabled(): boolean {
    const { clientId, clientSecret } = this.config.shop.paypal;
    return Boolean(this.paypalApiBase && clientId && clientSecret);
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

  private async createPaypalCheckout(
    product: InternalProduct,
    options: CheckoutRequestOptions,
  ): Promise<CheckoutSession> {
    if (!this.isPaypalEnabled() || !this.paypalApiBase) {
      throw new ShopError('PAYPAL_DISABLED', 'PayPal est indisponible.', 503);
    }

    const successUrl = this.ensureValidReturnUrl(options.successUrl, 'success');
    const cancelUrl = this.ensureValidReturnUrl(options.cancelUrl, 'cancel');

    const accessToken = await this.getPaypalAccessToken();
    const orderPayload: Record<string, unknown> = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: product.id,
          description: this.formatPaypalDescription(product.description),
          amount: {
            currency_code: product.currency.toUpperCase(),
            value: (product.priceCents / 100).toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: this.config.shop.paypal.brandName || 'Libre Antenne',
        user_action: 'PAY_NOW',
        return_url: successUrl,
        cancel_url: cancelUrl,
      },
    };

    if (options.customerEmail) {
      orderPayload.payer = { email_address: options.customerEmail };
    }

    try {
      const response = await fetch(`${this.paypalApiBase}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(orderPayload),
      });

      if (!response.ok) {
        const errorBody = (await this.safeReadJson(response)) as
          | { message?: string; details?: { issue?: string; description?: string }[] }
          | null;
        const detail = errorBody?.details?.[0];
        const message =
          detail?.description ||
          errorBody?.message ||
          `PayPal a répondu avec le statut ${response.status}.`;
        throw new ShopError('PAYPAL_CHECKOUT_FAILED', message, 502);
      }

      const payload = (await response.json()) as {
        links?: { rel?: string; href?: string }[];
      };
      const approvalUrl = payload.links?.find((link) => link.rel === 'approve')?.href;

      if (!approvalUrl) {
        throw new ShopError(
          'PAYPAL_URL_MISSING',
          'Impossible de récupérer le lien de paiement PayPal.',
          503,
        );
      }

      return { provider: 'paypal', url: approvalUrl };
    } catch (error) {
      if (error instanceof ShopError) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Erreur inconnue lors de la création de la commande PayPal.';
      throw new ShopError('PAYPAL_CHECKOUT_FAILED', message, 502);
    }
  }

  private async getPaypalAccessToken(): Promise<string> {
    if (!this.isPaypalEnabled() || !this.paypalApiBase) {
      throw new ShopError('PAYPAL_DISABLED', 'PayPal est indisponible.', 503);
    }

    const now = Date.now();
    if (this.paypalAccessToken && this.paypalAccessToken.expiresAt > now + 5000) {
      return this.paypalAccessToken.value;
    }

    const { clientId, clientSecret } = this.config.shop.paypal;
    if (!clientId || !clientSecret) {
      throw new ShopError('PAYPAL_DISABLED', 'PayPal est indisponible.', 503);
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      const response = await fetch(`${this.paypalApiBase}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        const errorBody = (await this.safeReadJson(response)) as { error_description?: string } | null;
        const message =
          errorBody?.error_description ||
          `PayPal a refusé l'authentification (statut ${response.status}).`;
        throw new ShopError('PAYPAL_AUTH_FAILED', message, 502);
      }

      const payload = (await response.json()) as { access_token?: string; expires_in?: number };
      const token = payload.access_token;
      if (!token) {
        throw new ShopError(
          'PAYPAL_AUTH_FAILED',
          'PayPal a renvoyé une réponse sans jeton.',
          502,
        );
      }

      const expiresInSeconds = Number(payload.expires_in) || 300;
      this.paypalAccessToken = {
        value: token,
        expiresAt: now + expiresInSeconds * 1000,
      };

      return token;
    } catch (error) {
      if (error instanceof ShopError) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Impossible d'obtenir le jeton d'accès PayPal.";
      throw new ShopError('PAYPAL_AUTH_FAILED', message, 502);
    }
  }

  private formatPaypalDescription(description: string): string {
    const trimmed = description?.trim?.() ?? '';
    if (!trimmed) {
      return 'Commande Libre Antenne';
    }

    if (trimmed.length <= 120) {
      return trimmed;
    }

    return `${trimmed.slice(0, 117)}...`;
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
      console.warn('Unable to parse error body', error);
      return null;
    }
  }
}
