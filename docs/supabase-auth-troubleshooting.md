# Supabase "Invalid authentication credentials" Troubleshooting

When the Supabase REST API responds with `{ "error": "Invalid authentication credentials" }`, the problem is almost
always with how the request is authenticated, not the values stored in `.env`. Check the following points:

1. **Make sure both auth headers are sent.** Supabase expects an `apikey` header that contains your anon (or service)
   key *and* an `Authorization: Bearer <key>` header on every REST request. Libraries such as `@supabase/supabase-js`
   add both headers automatically. If you are using `fetch` or another HTTP client directly, add the `Authorization`
   header yourself, otherwise the request is treated as anonymous and rejected.
2. **Confirm you are using the anon key in the browser.** Only server-side code should use the service-role key. Using
   the service key from the client will still fail unless the `Authorization` header is sent, and it exposes a highly
   privileged key in the browser.
3. **Verify the URL and protocol.** The Supabase client must point to the exact project URL, including the `https://`
   scheme. Requests to the Kong gateway or other reverse proxies must forward headers unchanged. If the request is sent
   to the wrong host (for example `http://` instead of `https://`), the JWT signatures will not match and Supabase will
   reject the credentials.
4. **Regenerate keys if they look truncated.** Real Supabase anon and service-role keys are long JWT strings (hundreds of
   characters). If the key you copied is short, it is likely incomplete, and Supabase will report it as invalid.

Walking through these checks usually resolves the `Invalid authentication credentials` error even when `.env` contains
keys that look correct at first glance.
