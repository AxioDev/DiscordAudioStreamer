# DiscordAudioStreamer

## Configuration

The application uses environment variables (loaded via [dotenv](https://github.com/motdotla/dotenv)) to control its behaviour.

### Excluding users from the audio mix

Use the `EXCLUDED_USER_IDS` environment variable to provide a comma-separated list of Discord user IDs that should be ignored by the audio bridge and speaker tracking logic. If the variable is not provided, the application excludes the user `1419381362116268112` by default.

```env
# Example: ignore multiple users
EXCLUDED_USER_IDS=1419381362116268112,123456789012345678
```

You can clear the default exclusion by explicitly setting the variable to an empty value in your environment (e.g. `EXCLUDED_USER_IDS=` in your `.env` file).

### Boutique en ligne

Les endpoints de la boutique peuvent activer plusieurs prestataires de paiement. Chaque intégration est contrôlée par des variables d’environnement :

#### Stripe Checkout

```env
# Clé API secrète Stripe (obligatoire pour activer Stripe)
SHOP_STRIPE_SECRET_KEY=sk_live_xxx

# Identifiants de prix pour les produits (configurer uniquement ceux que vous souhaitez vendre via Stripe)
SHOP_STRIPE_PRICE_MUG=price_123
SHOP_STRIPE_PRICE_TSHIRT=price_456
SHOP_STRIPE_PRICE_PACK=price_789
SHOP_STRIPE_PRICE_MODERATION=price_abc
```

Fournissez la clé secrète Stripe et au moins un identifiant de prix pour qu’un produit puisse être proposé via Stripe. Tout produit sans identifiant correspondant sera masqué du prestataire Stripe.

#### PayPal Checkout

```env
# Identifiants API PayPal (utilise le sandbox par défaut si l’environnement n’est pas "live")
SHOP_PAYPAL_CLIENT_ID=your-paypal-client-id
SHOP_PAYPAL_CLIENT_SECRET=your-paypal-client-secret
SHOP_PAYPAL_ENVIRONMENT=live

# Optionnel : nom de marque affiché sur l’interface PayPal
SHOP_PAYPAL_BRAND_NAME=Libre Antenne
```

Laissez ces variables vides pour désactiver PayPal.

#### Virements SEPA via CoinGate

CoinGate peut proposer des virements SEPA en plus des paiements crypto. Configurez-le avec les variables suivantes :

```env
# Obligatoire : active CoinGate et les virements SEPA
SHOP_COINGATE_API_KEY=your-coingate-api-key

# Optionnel : environnement (sandbox par défaut si omis ou différent de "live")
SHOP_COINGATE_ENVIRONMENT=live

# Optionnel : URL de callback utilisée par CoinGate après le paiement
SHOP_COINGATE_CALLBACK_URL=https://example.com/shop/callback
```

Si aucune de ces variables n’est définie, CoinGate (et donc l’option virement SEPA) est désactivé.
