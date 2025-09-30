import type { ImageURLOptions } from 'discord.js';
import SseService from './SseService';
import VoiceActivityRepository from './VoiceActivityRepository';

export interface VoiceStateSnapshot {
  channelId: string | null;
  guildId: string | null;
  deaf: boolean;
  mute: boolean;
  selfDeaf: boolean;
  selfMute: boolean;
  suppress: boolean;
  streaming: boolean;
  video: boolean;
  displayName?: string | null;
  username?: string | null;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface Participant extends UserProfile {
  isSpeaking: boolean;
  startedAt: number | null;
  lastSpokeAt: number | null;
  joinedAt: number | null;
  voiceState: VoiceStateSnapshot;
}

export type UserFetcher = (userId: string) => Promise<{
  username?: string;
  globalName?: string | null;
  displayAvatarURL?: (options?: ImageURLOptions) => string;
}>;

export interface SpeakerTrackerOptions {
  sseService: SseService;
  voiceActivityRepository?: VoiceActivityRepository | null;
}

export default class SpeakerTracker {
  private readonly sseService: SseService;

  private readonly participants: Map<string, Participant>;

  private readonly userProfiles: Map<string, UserProfile>;

  private readonly pendingProfileFetches: Set<string>;

  private userFetcher: UserFetcher | null;

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  constructor({ sseService, voiceActivityRepository = null }: SpeakerTrackerOptions) {
    this.sseService = sseService;
    this.participants = new Map();
    this.userProfiles = new Map();
    this.pendingProfileFetches = new Set();
    this.userFetcher = null;
    this.voiceActivityRepository = voiceActivityRepository;
  }

  public setUserFetcher(fetcher: UserFetcher): void {
    this.userFetcher = fetcher;
  }

  public getSpeakers(): Participant[] {
    return Array.from(this.participants.values()).map((participant) => this.cloneParticipant(participant));
  }

  public getSpeakerCount(): number {
    return this.participants.size;
  }

  public getInitialState(): { speakers: Participant[] } {
    return { speakers: this.getSpeakers() };
  }

  private async ensureParticipant(userId: string): Promise<Participant> {
    if (this.participants.has(userId)) {
      return this.participants.get(userId)!;
    }

    if (this.pendingProfileFetches.has(userId)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return this.ensureParticipant(userId);
    }

    this.pendingProfileFetches.add(userId);

    try {
      const profile = await this.fetchUserProfile(userId);
      const participant: Participant = {
        ...profile,
        isSpeaking: false,
        startedAt: null,
        lastSpokeAt: null,
        joinedAt: null,
        voiceState: {
          channelId: null,
          guildId: null,
          deaf: false,
          mute: false,
          selfDeaf: false,
          selfMute: false,
          suppress: false,
          streaming: false,
          video: false,
        },
      };
      this.participants.set(userId, participant);
      return participant;
    } catch (error) {
      console.error('Failed to ensure participant profile', error);
      throw error;
    } finally {
      this.pendingProfileFetches.delete(userId);
    }
  }

  public async handleSpeakingStart(userId: string): Promise<void> {
    try {
      const participant = await this.ensureParticipant(userId);
      const now = Date.now();
      const updated: Participant = {
        ...participant,
        isSpeaking: true,
        startedAt: now,
        lastSpokeAt: now,
      };
      this.participants.set(userId, updated);
      this.sseService.broadcast('speaking', { type: 'start', user: this.cloneParticipant(updated) });
      this.broadcastState();
    } catch (error) {
      console.error('Failed to handle speaking start', error);
    }
  }

  public handleSpeakingEnd(userId: string): void {
    const participant = this.participants.get(userId);
    if (!participant) {
      return;
    }

    const endedAt = Date.now();
    this.persistVoiceActivity(participant, endedAt);

    const updated: Participant = {
      ...participant,
      isSpeaking: false,
      startedAt: null,
      lastSpokeAt: endedAt,
    };
    this.participants.set(userId, updated);
    this.sseService.broadcast('speaking', { type: 'end', user: this.cloneParticipant(updated) });
    this.broadcastState();
  }

  public async handleVoiceStateUpdate(userId: string, voiceState: VoiceStateSnapshot | null): Promise<void> {
    if (!voiceState || !voiceState.channelId) {
      const participant = this.participants.get(userId);
      if (participant) {
        this.persistVoiceActivity(participant, Date.now());
      }

      if (this.participants.delete(userId)) {
        this.sseService.broadcast('speaking', { type: 'end', userId });
        this.broadcastState();
      }
      return;
    }

    try {
      const participant = await this.ensureParticipant(userId);
      const sameChannel = participant.voiceState?.channelId === voiceState.channelId;
      const joinedAt = sameChannel && participant.joinedAt ? participant.joinedAt : Date.now();

      const updated: Participant = {
        ...participant,
        displayName: voiceState.displayName || participant.displayName,
        username: voiceState.username || participant.username,
        joinedAt,
        voiceState: {
          channelId: voiceState.channelId,
          guildId: voiceState.guildId || participant.voiceState?.guildId || null,
          deaf: Boolean(voiceState.deaf),
          mute: Boolean(voiceState.mute),
          selfDeaf: Boolean(voiceState.selfDeaf),
          selfMute: Boolean(voiceState.selfMute),
          suppress: Boolean(voiceState.suppress),
          streaming: Boolean(voiceState.streaming),
          video: Boolean(voiceState.video),
          displayName: voiceState.displayName,
          username: voiceState.username,
        },
      };

      this.participants.set(userId, updated);
      this.broadcastState();
    } catch (error) {
      console.error('Failed to handle voice state update', error);
    }
  }

  private broadcastState(): void {
    this.sseService.broadcast('state', { speakers: this.getSpeakers() });
  }

  private async fetchUserProfile(userId: string): Promise<UserProfile> {
    if (this.userProfiles.has(userId)) {
      return this.userProfiles.get(userId)!;
    }

    const fallbackIndexRaw = Number(String(userId).slice(-1));
    const fallbackIndex = Number.isFinite(fallbackIndexRaw) ? fallbackIndexRaw % 5 : 0;
    let username = `Utilisateur ${userId}`;
    let displayName = username;
    let avatar = `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;

    if (this.userFetcher) {
      try {
        const user = await this.userFetcher(userId);
        if (user) {
          username = user.username ?? username;
          displayName = user.globalName || user.username || displayName;
          if (typeof user.displayAvatarURL === 'function') {
            avatar = user.displayAvatarURL({ extension: 'png', size: 128 });
          }
        }
      } catch (error) {
        console.warn('Unable to fetch user profile', userId, (error as Error)?.message || error);
      }
    }

    const profile: UserProfile = { id: userId, username, displayName, avatar };
    this.userProfiles.set(userId, profile);
    return profile;
  }

  private cloneParticipant(participant: Participant): Participant {
    return {
      ...participant,
      voiceState: {
        channelId: participant.voiceState?.channelId ?? null,
        guildId: participant.voiceState?.guildId ?? null,
        deaf: Boolean(participant.voiceState?.deaf),
        mute: Boolean(participant.voiceState?.mute),
        selfDeaf: Boolean(participant.voiceState?.selfDeaf),
        selfMute: Boolean(participant.voiceState?.selfMute),
        suppress: Boolean(participant.voiceState?.suppress),
        streaming: Boolean(participant.voiceState?.streaming),
        video: Boolean(participant.voiceState?.video),
      },
    };
  }

  public clear(): void {
    this.participants.clear();
    this.pendingProfileFetches.clear();
    this.userProfiles.clear();
    this.sseService.broadcast('state', { speakers: [] });
  }

  private persistVoiceActivity(participant: Participant, endedAt: number): void {
    if (!this.voiceActivityRepository) {
      return;
    }

    const startedAt = participant.startedAt;
    const channelId = participant.voiceState?.channelId ?? null;
    if (!startedAt || !channelId) {
      return;
    }

    const durationMs = Math.max(endedAt - startedAt, 0);

    void this.voiceActivityRepository.recordVoiceActivity({
      userId: participant.id,
      channelId,
      guildId: participant.voiceState?.guildId ?? null,
      durationMs,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
    });
  }
}
