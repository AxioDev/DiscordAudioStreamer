import type { HypeLeaderboardSortBy, HypeLeaderboardSortOrder } from '../src/services/VoiceActivityRepository';
import HypeLeaderboardService from '../src/services/HypeLeaderboardService';
import VoiceActivityRepository from '../src/services/VoiceActivityRepository';
import config from '../src/config';

const SCRIPT_NAME = 'precompute:hype-leaderboard';

const DEFAULT_PERIODS: ReadonlyArray<number | null> = [null, 7, 30, 90, 365];
const DEFAULT_SORTS: ReadonlyArray<HypeLeaderboardSortBy> = [
  'schScoreNorm',
  'arrivalEffect',
  'departureEffect',
  'activityScore',
  'displayName',
];
const DEFAULT_ORDERS: ReadonlyArray<HypeLeaderboardSortOrder> = ['desc', 'asc'];
const DEFAULT_LIMIT = 100;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

type CliOptions = {
  schedule: boolean;
  intervalMs: number;
};

function logInfo(message: string, context?: Record<string, unknown>): void {
  if (context && Object.keys(context).length > 0) {
    console.log(`[${SCRIPT_NAME}] ${message}`, context);
    return;
  }
  console.log(`[${SCRIPT_NAME}] ${message}`);
}

function logError(message: string, error: unknown, context?: Record<string, unknown>): void {
  console.error(`[${SCRIPT_NAME}] ${message}`, { ...(context ?? {}), error });
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    schedule: false,
    intervalMs: DAILY_INTERVAL_MS,
  };

  for (const raw of argv) {
    if (raw === '--schedule' || raw === '--watch') {
      options.schedule = true;
      continue;
    }

    if (raw.startsWith('--interval=')) {
      const value = Number.parseInt(raw.split('=')[1] ?? '', 10);
      if (Number.isFinite(value) && value > 0) {
        options.intervalMs = value * 60 * 1000;
      }
      continue;
    }

    if (raw.startsWith('--interval-ms=')) {
      const value = Number.parseInt(raw.split('=')[1] ?? '', 10);
      if (Number.isFinite(value) && value > 0) {
        options.intervalMs = value;
      }
      continue;
    }
  }

  return options;
}

async function precomputeAll(service: HypeLeaderboardService): Promise<void> {
  const combinations: Array<{ period: number | null; sortBy: HypeLeaderboardSortBy; sortOrder: HypeLeaderboardSortOrder }> = [];

  for (const period of DEFAULT_PERIODS) {
    for (const sortBy of DEFAULT_SORTS) {
      for (const sortOrder of DEFAULT_ORDERS) {
        combinations.push({ period, sortBy, sortOrder });
      }
    }
  }

  logInfo('Pré-calcul du classement Hype pour toutes les combinaisons de filtres.', {
    totalRuns: combinations.length,
  });

  let successCount = 0;
  const failures: Array<{ period: number | null; sortBy: HypeLeaderboardSortBy; sortOrder: HypeLeaderboardSortOrder; error: unknown }> = [];

  for (const combination of combinations) {
    const { period, sortBy, sortOrder } = combination;
    const label = `period=${period ?? 'all'}, sortBy=${sortBy}, sortOrder=${sortOrder}`;
    logInfo(`Pré-calcul en cours (${label}).`);

    try {
      const options = service.normalizeOptions({
        limit: DEFAULT_LIMIT,
        search: null,
        sortBy,
        sortOrder,
        periodDays: period,
      });
      await service.getLeaderboardWithTrends(options);
      successCount += 1;
      logInfo(`Pré-calcul terminé (${label}).`);
    } catch (error) {
      logError(`Échec du pré-calcul (${label}).`, error);
      failures.push({ ...combination, error });
    }
  }

  logInfo('Pré-calcul terminé.', {
    successfulRuns: successCount,
    failedRuns: failures.length,
  });

  if (failures.length > 0) {
    const formatted = failures.map(({ period, sortBy, sortOrder }) => ({
      period: period ?? 'all',
      sortBy,
      sortOrder,
    }));
    throw new Error(
      `Certaines combinaisons ont échoué : ${JSON.stringify(formatted)}`,
    );
  }
}

async function main(): Promise<void> {
  if (!config.database?.url) {
    throw new Error('DATABASE_URL doit être configuré pour pré-calculer le HypeLeaderboard.');
  }

  const cliOptions = parseCliOptions(process.argv.slice(2));
  const repository = new VoiceActivityRepository({
    url: config.database.url,
    ssl: config.database.ssl,
    debug: config.database.logQueries,
  });

  const service = new HypeLeaderboardService({
    repository,
    precomputePeriods: DEFAULT_PERIODS,
    precomputeSorts: DEFAULT_SORTS,
  });

  let currentRun: Promise<void> | null = null;

  const runPrecomputation = (): Promise<void> => {
    if (currentRun) {
      logInfo('Une exécution est déjà en cours, nouvelle demande ignorée.');
      return currentRun;
    }

    currentRun = precomputeAll(service)
      .catch((error) => {
        logError('Le pré-calcul quotidien a échoué.', error);
        throw error;
      })
      .finally(() => {
        currentRun = null;
      });

    return currentRun;
  };

  await runPrecomputation();

  if (!cliOptions.schedule) {
    await repository.close();
    return;
  }

  logInfo('Planification quotidienne activée.', {
    intervalMs: cliOptions.intervalMs,
  });

  const timer = setInterval(() => {
    void runPrecomputation().catch((error) => {
      logError('Erreur lors du pré-calcul planifié.', error);
    });
  }, cliOptions.intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  const shutdown = async (): Promise<void> => {
    logInfo('Arrêt du script demandé, nettoyage en cours…');
    clearInterval(timer);
    try {
      if (currentRun) {
        await currentRun.catch(() => undefined);
      }
    } finally {
      await repository.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void main()
  .then(() => {
    logInfo('Exécution terminée.');
  })
  .catch((error: unknown) => {
    logError('Le script a échoué.', error);
    process.exit(1);
  });
