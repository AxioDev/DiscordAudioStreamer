import { EventEmitter } from 'node:events';
import type { VoiceConnection } from '@discordjs/voice';
import type {
  DiscordAudioBridgeOptions,
  DiscordUserIdentity,
  GuildMembersListOptions,
  GuildMembersListResult,
} from './DiscordAudioBridge';

const DISCORD_DISABLED_ERROR = 'DISCORD_DISABLED';

export default class NullDiscordAudioBridge {
  private readonly events = new EventEmitter();

  constructor(_options: DiscordAudioBridgeOptions) {}

  public async login(): Promise<void> {
    console.warn('Discord bridge disabled: skipping login.');
  }

  public async destroy(): Promise<void> {
    // Nothing to clean up in offline mode.
  }

  public async fetchUserIdentity(_userId: string): Promise<DiscordUserIdentity | null> {
    return null;
  }

  public async listGuildMembers({
    limit = 0,
    after = null,
    search = null,
  }: GuildMembersListOptions = {}): Promise<GuildMembersListResult> {
    const sanitizedLimit = Number.isFinite(limit) && limit ? Math.max(0, Math.floor(limit)) : 0;
    if (sanitizedLimit > 0 && (after || search)) {
      console.debug('Guild member listing requested while Discord bridge is disabled.', {
        limit: sanitizedLimit,
        after,
        search,
      });
    }

    return {
      members: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  public async joinVoice(): Promise<VoiceConnection> {
    const error = new Error('Voice connection unavailable while Discord bridge is disabled.');
    error.name = DISCORD_DISABLED_ERROR;
    throw error;
  }

  public leaveVoice(): void {
    // Nothing to do.
  }

  public hasActiveVoiceConnection(): boolean {
    return false;
  }

  public pushAnonymousAudio(_chunk: Buffer): boolean {
    return false;
  }

  public onVoiceConnectionReady(listener: (connection: VoiceConnection) => void): void {
    this.events.on('voiceConnectionReady', listener);
  }

  public offVoiceConnectionReady(listener: (connection: VoiceConnection) => void): void {
    this.events.off('voiceConnectionReady', listener);
  }

  public onVoiceConnectionDestroyed(listener: () => void): void {
    this.events.on('voiceConnectionDestroyed', listener);
  }

  public offVoiceConnectionDestroyed(listener: () => void): void {
    this.events.off('voiceConnectionDestroyed', listener);
  }
}
