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

The shop endpoints support multiple payment providers. To enable PayPal Checkout you need to provide API credentials via environment variables:

```env
# PayPal Checkout (defaults to the sandbox environment if not provided)
SHOP_PAYPAL_CLIENT_ID=your-paypal-client-id
SHOP_PAYPAL_CLIENT_SECRET=your-paypal-client-secret
SHOP_PAYPAL_ENVIRONMENT=live
# Optional: overrides the brand name displayed on the PayPal approval screen
SHOP_PAYPAL_BRAND_NAME=Libre Antenne
```

Omit the variables (or leave them empty) to disable PayPal. Stripe and CoinGate keep their existing configuration options.

#### Virements SEPA via CoinGate

CoinGate can expose SEPA bank transfers in addition to crypto payments. Provide the following environment variables to configure it:

```env
# Required: activates CoinGate and enables SEPA payouts
SHOP_COINGATE_API_KEY=your-coingate-api-key

# Optional: switch the environment (defaults to sandbox when omitted or different from "live")
SHOP_COINGATE_ENVIRONMENT=live

# Optional: override the callback URL used by CoinGate after payment completion
SHOP_COINGATE_CALLBACK_URL=https://example.com/shop/callback
```

Leaving these variables undefined disables the CoinGate (and thus SEPA transfer) option entirely.
