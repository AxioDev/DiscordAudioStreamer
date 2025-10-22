import type { Pool } from 'pg';

interface QueryLoggerOptions {
  context: string;
  debug: boolean;
  connectionString?: string;
  ssl: boolean;
}

const QUERY_LOGGER_MARK = Symbol('postgresQueryLoggerAttached');

interface PostgresErrorLike {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
}

function extractPostgresError(error: unknown): PostgresErrorLike | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as PostgresErrorLike;
  if (
    (candidate.code && typeof candidate.code !== 'string') ||
    (candidate.message && typeof candidate.message !== 'string') ||
    (candidate.detail && typeof candidate.detail !== 'string')
  ) {
    return {
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
      detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
    };
  }

  return candidate;
}

function getAdditionalErrorContext(error: unknown): string | null {
  const details = extractPostgresError(error);
  if (!details) {
    return null;
  }

  const { code, message, detail } = details;
  const combinedMessage = `${message ?? ''} ${detail ?? ''}`.trim().toLowerCase();

  if (code === '42501' && combinedMessage.includes('room_members')) {
    return (
      'The realtime.room_members table still enforces row level security. ' +
      'Grant the authenticated and service_role roles explicit access, for example by running the policies documented in ' +
      'docs/supabase-auth-troubleshooting.md.'
    );
  }

  return null;
}

function normalizeQueryText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const condensed = text.replace(/\s+/g, ' ').trim();
  return condensed.length > 0 ? condensed : undefined;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    return trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer length=${value.length}>`;
  }

  if (Array.isArray(value)) {
    if (depth > 3) {
      return '[…]';
    }
    const limit = Math.min(value.length, 20);
    const items = value.slice(0, limit).map((entry) => sanitizeValue(entry, depth + 1));
    if (value.length > limit) {
      items.push(`… (+${value.length - limit} items)`);
    }
    return items;
  }

  if (typeof value === 'object') {
    if (depth > 3) {
      return '{…}';
    }
    try {
      const json = JSON.stringify(value);
      if (!json) {
        return value;
      }
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    } catch (error) {
      return `<Unserializable ${Object.prototype.toString.call(value)}>`;
    }
  }

  return value;
}

export function attachPostgresQueryLogger(pool: Pool, options: QueryLoggerOptions): void {
  const { context, debug } = options;

  if (!debug) {
    return;
  }

  const typedPool = pool as Pool & { [QUERY_LOGGER_MARK]?: Set<string> };
  let contexts = typedPool[QUERY_LOGGER_MARK];
  if (!contexts) {
    contexts = new Set<string>();
    typedPool[QUERY_LOGGER_MARK] = contexts;

    const originalQuery = pool.query.bind(pool);

    pool.query = ((...args: unknown[]) => {
      const contextLabel = Array.from(contexts!).sort().join(', ') || context;
      const [textOrConfig, valuesOrCallback, maybeCallback] = args;

      let queryText: string | undefined;
      let values: unknown[] | undefined;

      if (typeof textOrConfig === 'string') {
        queryText = textOrConfig;
        if (Array.isArray(valuesOrCallback)) {
          values = valuesOrCallback;
        } else if (Array.isArray(maybeCallback)) {
          values = maybeCallback;
        }
      } else if (textOrConfig && typeof textOrConfig === 'object') {
        const config = textOrConfig as { text?: unknown; values?: unknown };
        if (typeof config.text === 'string') {
          queryText = config.text;
        }
        if (Array.isArray(config.values)) {
          values = config.values;
        }
      }

      const normalizedText = normalizeQueryText(queryText);
      const sanitizedValues = values?.map((value) => sanitizeValue(value));

      const logError = (error: unknown, phase: 'async' | 'sync'): void => {
        const basePayload = {
          query: normalizedText ?? queryText ?? '<inconnue>',
          values: sanitizedValues ?? values,
          error: (error as Error)?.message || error,
        } as Record<string, unknown>;
        const hint = getAdditionalErrorContext(error);
        if (hint) {
          basePayload.hint = hint;
        }

        const prefix = phase === 'async' ? 'échec de la requête' : 'erreur synchrone';
        console.error(`[SupabaseDebug] ${contextLabel}: ${prefix}`, basePayload);
      };

      try {
        const result = originalQuery(...(args as Parameters<Pool['query']>)) as unknown;
        if (result instanceof Promise) {
          return result.catch((error) => {
            logError(error, 'async');
            throw error;
          });
        }
        return result as ReturnType<Pool['query']>;
      } catch (error) {
        logError(error, 'sync');
        throw error;
      }
    }) as typeof pool.query;
  }

  contexts.add(context);
}
