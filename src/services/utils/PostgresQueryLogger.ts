import type { Pool } from 'pg';

interface QueryLoggerOptions {
  context: string;
  debug: boolean;
  connectionString?: string;
  ssl: boolean;
}

const QUERY_LOGGER_MARK = Symbol('postgresQueryLoggerAttached');

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

function logConnectionDetails(context: string, connectionString: string | undefined, ssl: boolean): void {
  if (!connectionString) {
    console.log(`[SupabaseDebug] ${context}: aucune URL de connexion fournie.`);
    return;
  }

  try {
    const parsed = new URL(connectionString);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    console.log(`[SupabaseDebug] ${context}: connexion Supabase`, {
      host: parsed.hostname,
      port: parsed.port || '(default)',
      database,
      user: parsed.username || '(anonymous)',
      ssl,
      protocol: parsed.protocol.replace(/:$/, ''),
    });
  } catch (error) {
    console.log(`[SupabaseDebug] ${context}: connexion Supabase (URL non analysable)`, {
      hasConnectionString: true,
      ssl,
      error: (error as Error)?.message || error,
    });
  }
}

export function attachPostgresQueryLogger(pool: Pool, options: QueryLoggerOptions): void {
  const { context, debug, connectionString, ssl } = options;

  if (!debug) {
    return;
  }

  const typedPool = pool as Pool & { [QUERY_LOGGER_MARK]?: boolean };
  if (typedPool[QUERY_LOGGER_MARK]) {
    return;
  }
  typedPool[QUERY_LOGGER_MARK] = true;

  console.log(`[SupabaseDebug] ${context}: journalisation des requêtes activée.`);
  logConnectionDetails(context, connectionString, ssl);

  const originalQuery = pool.query.bind(pool);

  pool.query = ((...args: unknown[]) => {
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

    console.log(`[SupabaseDebug] ${context}: requête`, {
      query: normalizedText ?? queryText ?? '<inconnue>',
      values: sanitizedValues ?? values,
    });

    try {
      const result = originalQuery(...(args as Parameters<Pool['query']>)) as unknown;
      if (result instanceof Promise) {
        return result.catch((error) => {
          console.error(`[SupabaseDebug] ${context}: échec de la requête`, {
            query: normalizedText ?? queryText ?? '<inconnue>',
            values: sanitizedValues ?? values,
            error: (error as Error)?.message || error,
          });
          throw error;
        });
      }
      return result as ReturnType<Pool['query']>;
    } catch (error) {
      console.error(`[SupabaseDebug] ${context}: erreur synchrone`, {
        query: normalizedText ?? queryText ?? '<inconnue>',
        values: sanitizedValues ?? values,
        error: (error as Error)?.message || error,
      });
      throw error;
    }
  }) as typeof pool.query;
}
