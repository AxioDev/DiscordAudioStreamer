import { Router, type Request, type Response } from 'express';
import type VoiceActivityRepository from '../../services/VoiceActivityRepository';
import type StatisticsService from '../../services/StatisticsService';
import type { CommunityPulseSnapshot } from '../../services/VoiceActivityRepository';
import type { CommunityStatisticsSnapshot } from '../../services/StatisticsService';
import { parseStatisticsQuery } from '../utils/statistics';

interface StatsRouterDeps {
  voiceActivityRepository: VoiceActivityRepository | null;
  statisticsService: StatisticsService;
  buildHomePulsePresentation: (snapshot: CommunityPulseSnapshot | null) => unknown;
}

export function createStatsRouter({
  voiceActivityRepository,
  statisticsService,
  buildHomePulsePresentation,
}: StatsRouterDeps): Router {
  const router = Router();

  router.get('/community/pulse', async (_req: Request, res: Response) => {
    if (!voiceActivityRepository) {
      res.status(503).json({
        error: 'PULSE_UNAVAILABLE',
        message: 'Le suivi de l’activité communautaire est désactivé sur ce serveur.',
      });
      return;
    }

    try {
      const snapshot = await voiceActivityRepository.getCommunityPulse({ windowMinutes: 15 });
      const pulse = buildHomePulsePresentation(snapshot);
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
      res.json({ pulse: pulse ?? null });
    } catch (error) {
      console.error('Failed to compute community pulse', error);
      res.status(500).json({
        error: 'COMMUNITY_PULSE_FAILED',
        message: 'Impossible de calculer le pouls communautaire.',
      });
    }
  });

  router.get('/statistiques', async (req: Request, res: Response) => {
    try {
      const options = parseStatisticsQuery(req.query);
      const snapshot: CommunityStatisticsSnapshot = await statisticsService.getStatistics(options);
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=90');
      res.json({ statistics: snapshot });
    } catch (error) {
      console.error('Failed to build statistics snapshot', error);
      res.status(500).json({
        error: 'STATISTICS_FAILED',
        message: 'Impossible de charger les statistiques communautaires.',
      });
    }
  });

  return router;
}
