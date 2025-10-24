import { Router, type Request, type Response } from 'express';
import type ShopService from '../../services/ShopService';
import { ShopError, type ShopProvider } from '../../services/ShopService';

interface ShopRouterDeps {
  shopService: ShopService;
  toAbsoluteUrl: (path: string) => string;
}

function normalizeShopProvider(raw: unknown): ShopProvider | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'stripe' || normalized === 'coingate' || normalized === 'paypal') {
    return normalized;
  }

  return null;
}

function handleShopError(res: Response, error: unknown): void {
  if (error instanceof ShopError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }

  console.error('Unhandled shop error', error);
  res.status(500).json({ error: 'SHOP_UNKNOWN', message: 'Impossible de finaliser la commande.' });
}

export function createShopRouter({ shopService, toAbsoluteUrl }: ShopRouterDeps): Router {
  const router = Router();

  router.get('/products', (_req: Request, res: Response) => {
    res.json({
      currency: shopService.getCurrency(),
      products: shopService.getProducts(),
    });
  });

  router.post('/checkout', async (req: Request, res: Response) => {
    const { productId, provider, successUrl, cancelUrl, customerEmail } = req.body ?? {};

    if (typeof productId !== 'string' || productId.trim().length === 0) {
      res.status(400).json({ error: 'PRODUCT_REQUIRED', message: 'Le produit est obligatoire.' });
      return;
    }

    const normalizedProvider = normalizeShopProvider(provider);
    if (!normalizedProvider) {
      res.status(400).json({ error: 'PROVIDER_REQUIRED', message: 'Le fournisseur de paiement est obligatoire.' });
      return;
    }

    try {
      const session = await shopService.createCheckoutSession({
        productId: productId.trim(),
        provider: normalizedProvider,
        successUrl: typeof successUrl === 'string' ? successUrl : undefined,
        cancelUrl: typeof cancelUrl === 'string' ? cancelUrl : undefined,
        customerEmail: typeof customerEmail === 'string' ? customerEmail : undefined,
      });
      const termsUrl = toAbsoluteUrl('/cgv-vente');
      res.status(201).json({ ...session, termsUrl });
    } catch (error) {
      handleShopError(res, error);
    }
  });

  return router;
}
