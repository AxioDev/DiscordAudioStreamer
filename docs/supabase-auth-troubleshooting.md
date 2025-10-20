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

## `new row violates row-level security policy for table "room_members"`

Realtime connections rely on the `realtime.room_members` table. On fresh Supabase
projects, that table ships with Row Level Security turned on but **no policies**,
which causes the Postgres error `42501` the first time a client tries to join a
room (for example during the "PrivateConversation bootstrap" step).

Fix the issue by creating explicit policies for the roles that need access. You
can run the following SQL from the Supabase SQL editor:

```sql
alter table realtime.room_members enable row level security;

create policy "Allow authenticated realtime access"
  on realtime.room_members for all
  using (auth.role() in ('authenticated', 'service_role'))
  with check (auth.role() in ('authenticated', 'service_role'));
```

If you already created other policies, make sure they include the
`service_role`, otherwise server-side jobs will keep failing while bootstrapping
realtime rooms. After saving the policy, retry the operation—the insert should
now succeed and the error will disappear.
