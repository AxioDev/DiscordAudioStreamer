import type SpeakerTracker from '../../services/SpeakerTracker';
import type SseService from '../../services/SseService';
import type ListenerStatsService from '../../services/ListenerStatsService';
import type AnonymousSpeechManager from '../../services/AnonymousSpeechManager';

export interface StreamSseDependencies {
  speakerTracker: SpeakerTracker;
  anonymousSpeechManager: AnonymousSpeechManager;
  listenerStatsService: ListenerStatsService;
  sseService: SseService;
}

export function buildStreamInitialState({
  speakerTracker,
  anonymousSpeechManager,
  listenerStatsService,
}: Omit<StreamSseDependencies, 'sseService'>): Record<string, unknown> {
  return {
    ...speakerTracker.getInitialState(),
    anonymousSlot: anonymousSpeechManager.getPublicState(),
    listeners: {
      count: listenerStatsService.getCurrentCount(),
      history: listenerStatsService.getHistory(),
    },
  };
}

export function subscribeToListenerUpdates({
  sseService,
  listenerStatsService,
}: StreamSseDependencies): () => void {
  return listenerStatsService.onUpdate((update) => {
    if (!update) {
      return;
    }

    sseService.broadcast('listeners', {
      count: update.count,
      timestamp: update.entry.timestamp,
      reason: update.reason,
      delta: update.delta,
      entry: update.entry,
      inserted: update.inserted,
    });
  });
}
