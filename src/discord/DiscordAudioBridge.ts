import {
  Client,
  GatewayIntentBits,
  Events,
  type Message,
  type VoiceState,
  type Snowflake,
  type VoiceBasedChannel,
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  type VoiceConnection,
  type VoiceReceiver,
  type AudioReceiveStream,
} from '@discordjs/voice';
import * as prism from 'prism-media';
import { PassThrough } from 'stream';
import { EventEmitter } from 'node:events';
import type AudioMixer from '../audio/AudioMixer';
import type SpeakerTracker from '../services/SpeakerTracker';
import type { VoiceStateSnapshot } from '../services/SpeakerTracker';
import type VoiceActivityRepository from '../services/VoiceActivityRepository';
import type { Config } from '../config';

type DecoderStream = prism.opus.Decoder;

interface Subscription {
  opusStream: AudioReceiveStream;
  decoder: DecoderStream;
  cleanup: (() => void) | null;
}

export interface DiscordAudioBridgeOptions {
  config: Config;
  mixer: AudioMixer;
  speakerTracker: SpeakerTracker;
  voiceActivityRepository?: VoiceActivityRepository | null;
}

export interface DiscordUserIdentity {
  id: string;
  username: string | null;
  globalName: string | null;
  discriminator: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accentColor: string | null;
  createdAt: string | null;
  guild: {
    id: string;
    nickname: string | null;
    displayName: string | null;
    joinedAt: string | null;
    roles: Array<{ id: string; name: string }>;
  } | null;
}

export interface DiscordGuildMemberSummary {
  id: string;
  displayName: string | null;
  username: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  joinedAt: string | null;
  roles: Array<{ id: string; name: string }>;
  isBot: boolean;
}

export interface GuildMembersListOptions {
  limit?: number | null;
  after?: string | null;
  search?: string | null;
}

export interface GuildMembersListResult {
  members: DiscordGuildMemberSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export default class DiscordAudioBridge {
  private readonly config: Config;

  private readonly mixer: AudioMixer;

  private readonly speakerTracker: SpeakerTracker;

  private readonly client: Client;

  private voiceConnection: VoiceConnection | null = null;

  private readonly activeSubscriptions = new Map<Snowflake, Subscription>();

  private currentGuildId: Snowflake | null = null;

  private currentVoiceChannelId: Snowflake | null = null;

  private shouldAutoReconnect = true;

  private isReconnecting = false;

  private expectingDisconnect = false;

  private anonymousInput: PassThrough | null = null;

  private anonymousEncoder: prism.opus.Encoder | null = null;

  private anonymousPlayer = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
    },
  });

  private anonymousQueue: Buffer[] = [];

  private anonymousRemainder: Buffer = Buffer.alloc(0);

  private anonymousDrainListener: (() => void) | null = null;

  private readonly events = new EventEmitter();

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  constructor({ config, mixer, speakerTracker, voiceActivityRepository = null }: DiscordAudioBridgeOptions) {
    this.config = config;
    this.mixer = mixer;
    this.speakerTracker = speakerTracker;
    this.voiceActivityRepository = voiceActivityRepository;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.speakerTracker.setUserFetcher((userId) => this.client.users.fetch(userId));

    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.client.once(Events.ClientReady, async () => {
      if (!this.client.user) {
        console.warn('Discord client ready without user context');
        return;
      }
      console.log('Discord bot logged as', this.client.user.tag);
      if (this.config.guildId && this.config.voiceChannelId) {
        try {
          await this.joinVoice(this.config.guildId, this.config.voiceChannelId);
          console.log('Auto-join voice channel successful');
        } catch (error) {
          console.error('Auto-join voice channel failed', error);
        }
      } else {
        console.log('No guild or voice channel configured. Use !joinVoice to connect manually.');
      }
    });

    this.client.on(Events.MessageCreate, async (message) => this.handleMessage(message));
    this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      try {
        await this.handleVoiceStateUpdate(oldState, newState);
      } catch (error) {
        console.error('Voice state update handling failed', error);
      }
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    const createdAt = message.createdAt instanceof Date && !Number.isNaN(message.createdAt.getTime())
      ? message.createdAt
      : new Date();

    if (this.voiceActivityRepository) {
      this.voiceActivityRepository
        .recordMessageActivity({
          messageId: message.id,
          userId: message.author.id,
          guildId: message.guildId ?? null,
          channelId: message.channelId,
          timestamp: createdAt,
        })
        .catch((error) => {
          console.warn('Failed to persist message activity event', error);
        });
    }

    const content = (message.content || '').trim();
    if (!content.startsWith('!')) {
      return;
    }

    if (content.startsWith('!joinVoice')) {
      const parts = content.split(/\s+/);
      const guildId = (parts[1] as Snowflake | undefined) || message.guildId || undefined;
      const channelId = parts[2] as Snowflake | undefined;

      if (!guildId || !channelId) {
        await message.reply('Usage: !joinVoice <guildId> <voiceChannelId>');
        return;
      }

      try {
        await this.joinVoice(guildId, channelId);
        await message.reply('Joined voice channel ✅');
      } catch (error) {
        console.error('Failed to join voice channel', error);
        await message.reply('Unable to join the requested voice channel.');
      }
    }

    if (content === '!leaveVoice') {
      if (this.voiceConnection) {
        await message.reply('Disconnecting from voice channel.');
        this.leaveVoice();
      } else {
        await message.reply('Je ne suis pas connecté à un salon vocal.');
      }
    }
  }

  public async fetchUserIdentity(userId: string): Promise<DiscordUserIdentity | null> {
    try {
      const user = await this.client.users.fetch(userId);
      if (!user) {
        return null;
      }

      const discriminator = typeof user.discriminator === 'string' ? user.discriminator : null;
      const username = typeof user.username === 'string' ? user.username : null;
      const globalName = typeof user.globalName === 'string' ? user.globalName : null;
      const createdAt = user.createdAt instanceof Date && !Number.isNaN(user.createdAt.getTime())
        ? user.createdAt.toISOString()
        : null;

      const avatarUrl = typeof user.displayAvatarURL === 'function'
        ? user.displayAvatarURL({ extension: 'png', size: 256 })
        : null;
      const bannerUrl = typeof user.bannerURL === 'function' ? user.bannerURL({ size: 1024 }) : null;
      const accentColor = typeof user.hexAccentColor === 'string' ? user.hexAccentColor : null;

      const guildId = this.config.guildId ?? this.currentGuildId;
      let guildInfo: DiscordUserIdentity['guild'] = null;

      if (guildId) {
        try {
          const cachedGuild = this.client.guilds.cache.get(guildId);
          const guild = cachedGuild ?? (await this.client.guilds.fetch(guildId));
          if (guild) {
            const member = await guild.members.fetch(userId);
            if (member) {
              const joinedAt = member.joinedAt instanceof Date && !Number.isNaN(member.joinedAt.getTime())
                ? member.joinedAt.toISOString()
                : null;
              const nickname = typeof member.nickname === 'string' ? member.nickname : null;
              const memberDisplayName = typeof member.displayName === 'string' ? member.displayName : nickname;
              const roles = Array.from(member.roles.cache.values())
                .filter((role) => role.id !== guildId)
                .map((role) => ({ id: role.id, name: role.name }));
              guildInfo = {
                id: guildId,
                nickname,
                displayName: memberDisplayName ?? nickname ?? null,
                joinedAt,
                roles,
              };
            }
          }
        } catch (error) {
          console.warn('Unable to fetch guild member details for user', userId, (error as Error)?.message ?? error);
        }
      }

      return {
        id: user.id,
        username,
        globalName,
        discriminator,
        displayName: guildInfo?.displayName || guildInfo?.nickname || globalName || username,
        avatarUrl,
        bannerUrl: bannerUrl ?? null,
        accentColor,
        createdAt,
        guild: guildInfo,
      };
    } catch (error) {
      console.warn('Failed to fetch Discord user identity', userId, (error as Error)?.message ?? error);
      return null;
    }
  }

  public async listGuildMembers({
    limit = 25,
    after = null,
    search = null,
  }: GuildMembersListOptions = {}): Promise<GuildMembersListResult> {
    const guildId = this.config.guildId ?? this.currentGuildId;
    if (!guildId) {
      const error = new Error('GUILD_UNAVAILABLE');
      error.name = 'GUILD_UNAVAILABLE';
      throw error;
    }

    const normalizedLimit = (() => {
      const numeric = Number(limit);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return 25;
      }
      return Math.min(Math.max(Math.floor(numeric), 1), search ? 100 : 1000);
    })();

    const normalizedSearch = typeof search === 'string' ? search.trim() : '';
    const normalizedAfter = typeof after === 'string' && after.trim().length > 0 ? after.trim() : null;

    const cachedGuild = this.client.guilds.cache.get(guildId);
    const guild = cachedGuild ?? (await this.client.guilds.fetch(guildId));
    if (!guild) {
      const error = new Error('GUILD_UNAVAILABLE');
      error.name = 'GUILD_UNAVAILABLE';
      throw error;
    }

    try {
      const collection = normalizedSearch
        ? await guild.members.search({ query: normalizedSearch, limit: normalizedLimit })
        : await guild.members.list({ limit: normalizedLimit, after: normalizedAfter ?? undefined });

      const members = Array.from(collection.values()).map<DiscordGuildMemberSummary>((member) => {
        const username = typeof member.user?.username === 'string' ? member.user.username : null;
        const nickname = typeof member.nickname === 'string' ? member.nickname : null;
        const globalName = typeof member.user?.globalName === 'string' ? member.user.globalName : null;
        const displayName = typeof member.displayName === 'string'
          ? member.displayName
          : nickname ?? globalName ?? username ?? null;
        const avatarUrl = typeof member.displayAvatarURL === 'function'
          ? member.displayAvatarURL({ extension: 'png', size: 128 })
          : null;
        const joinedAt = member.joinedAt instanceof Date && !Number.isNaN(member.joinedAt.getTime())
          ? member.joinedAt.toISOString()
          : null;
        const roles = Array.from(member.roles.cache.values())
          .filter((role) => role.id !== guildId)
          .map((role) => ({ id: role.id, name: role.name }));

        return {
          id: member.id,
          displayName,
          username,
          nickname,
          avatarUrl,
          joinedAt,
          roles,
          isBot: Boolean(member.user?.bot),
        };
      });

      const nextCursor = !normalizedSearch && members.length === normalizedLimit
        ? members[members.length - 1]?.id ?? null
        : null;

      return {
        members,
        nextCursor,
        hasMore: Boolean(nextCursor),
      };
    } catch (error) {
      console.warn('Failed to list guild members', (error as Error)?.message ?? error);
      throw error;
    }
  }

  public async joinVoice(guildId: Snowflake, channelId: Snowflake): Promise<VoiceConnection> {
    this.shouldAutoReconnect = true;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error('Guild not cached. Ensure the bot has access to the guild.');
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      throw new Error('Voice channel not found or inaccessible.');
    }

    const voiceChannel = channel;

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    this.voiceConnection = connection;
    this.currentGuildId = guildId;
    this.currentVoiceChannelId = channelId;
    this.expectingDisconnect = false;
    console.log('Voice connection ready');

    try {
      this.speakerTracker.clear();
      await this.syncInitialChannelMembers(voiceChannel);
    } catch (error) {
      console.warn('Failed to synchronise initial channel members', error);
    }

    this.setupReceiver(connection);
    this.setupAnonymousPipeline(connection);
    this.events.emit('voiceConnectionReady', connection);
    return connection;
  }

  private setupReceiver(connection: VoiceConnection): void {
    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      if (this.isUserExcluded(userId)) {
        this.cleanupSubscriptionForUser(userId);
        return;
      }

      console.log('start speaking', userId);
      this.mixer.addSource(userId);
      this.speakerTracker.handleSpeakingStart(userId).catch((error) => {
        console.error('Failed to handle speaking start', error);
      });
      this.subscribeToUserAudio(userId, receiver);
    });

    receiver.speaking.on('end', (userId) => {
      if (this.isUserExcluded(userId)) {
        this.cleanupSubscriptionForUser(userId);
        return;
      }

      console.log('speaking end', userId);
      this.speakerTracker.handleSpeakingEnd(userId);
      this.mixer.removeSource(userId);
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log('Voice state', oldState.status, '->', newState.status);
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        this.handleConnectionDisconnected(connection).catch((error) => {
          console.warn('Failed handling voice disconnect', error);
        });
      }
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.voiceConnection = null;
        this.cleanupAllSubscriptions();
        this.teardownAnonymousPipeline();
        this.events.emit('voiceConnectionDestroyed');
        if (this.shouldAutoReconnect && !this.expectingDisconnect) {
          this.scheduleReconnect().catch((error) => {
            console.error('Voice reconnection attempt failed', error);
          });
        }
        return;
      }

      if (newState.status === VoiceConnectionStatus.Ready) {
        this.setupAnonymousPipeline(connection);
        this.events.emit('voiceConnectionReady', connection);
      }
    });
  }

  private subscribeToUserAudio(userId: Snowflake, receiver: VoiceReceiver): void {
    if (this.isUserExcluded(userId)) {
      return;
    }

    if (this.activeSubscriptions.has(userId)) {
      return;
    }

    try {
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });
      const decoder: DecoderStream = new prism.opus.Decoder({
        frameSize: 960,
        channels: this.config.audio.channels,
        rate: this.config.audio.sampleRate,
      });

      opusStream.pipe(decoder);
      const onData = (chunk: Buffer) => this.mixer.pushToSource(userId, chunk);
      decoder.on('data', onData);

      const subscription: Subscription = { opusStream, decoder, cleanup: null };
      this.activeSubscriptions.set(userId, subscription);

      let cleanedUp = false;
      let onOpusError: ((error: Error) => void) | null = null;
      let onDecoderError: ((error: Error) => void) | null = null;
      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;

        this.activeSubscriptions.delete(userId);
        decoder.off('data', onData);
        if (onOpusError) {
          opusStream.off('error', onOpusError);
        }
        if (onDecoderError) {
          decoder.off('error', onDecoderError);
        }

        try {
          opusStream.destroy();
        } catch (error) {
          console.warn('Failed to destroy opus stream', error);
        }
        try {
          decoder.destroy();
        } catch (error) {
          console.warn('Failed to destroy decoder', error);
        }
        this.mixer.removeSource(userId);
        this.speakerTracker.handleSpeakingEnd(userId);
        console.log('Cleaned resources for user', userId);
      };

      onOpusError = (error: Error) => {
        console.warn('Opus stream error', error);
        cleanup();
      };
      onDecoderError = (error: Error) => {
        console.warn('Decoder error', error);
        cleanup();
      };

      opusStream.once('end', cleanup);
      opusStream.on('error', onOpusError);
      decoder.on('error', onDecoderError);

      subscription.cleanup = cleanup;
    } catch (error) {
      console.error('Failed to subscribe to user audio', error);
    }
  }

  public leaveVoice(): void {
    if (this.voiceConnection) {
      this.shouldAutoReconnect = false;
      this.expectingDisconnect = true;
      this.voiceConnection.destroy();
      this.voiceConnection = null;
    }
    this.currentGuildId = null;
    this.currentVoiceChannelId = null;
    this.cleanupAllSubscriptions();
    this.speakerTracker.clear();
    this.isReconnecting = false;
    this.teardownAnonymousPipeline();
    this.events.emit('voiceConnectionDestroyed');
  }

  private cleanupAllSubscriptions(): void {
    const subscriptions = Array.from(this.activeSubscriptions.values());
    for (const subscription of subscriptions) {
      if (subscription && typeof subscription.cleanup === 'function') {
        subscription.cleanup();
      }
    }
    this.activeSubscriptions.clear();
  }

  public async login(): Promise<void> {
    await this.client.login(this.config.botToken);
  }

  public async destroy(): Promise<void> {
    try {
      this.leaveVoice();
    } catch (error) {
      console.warn('Error while leaving voice channel during shutdown', error);
    }

    try {
      await this.client.destroy();
    } catch (error) {
      console.warn('Error while destroying Discord client', error);
    }
  }

  private async handleConnectionDisconnected(connection: VoiceConnection): Promise<void> {
    if (!this.shouldAutoReconnect || this.expectingDisconnect) {
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      console.log('Transient voice disconnect recovered automatically');
    } catch (error) {
      console.warn('Voice connection lost, preparing to reconnect', error);
      try {
        connection.destroy();
      } catch (destroyError) {
        console.warn('Failed to destroy disconnected voice connection', destroyError);
      }
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.isReconnecting) {
      return;
    }
    if (!this.currentGuildId || !this.currentVoiceChannelId) {
      return;
    }

    this.isReconnecting = true;
    try {
      console.log('Attempting to reconnect to voice channel...');
      await this.joinVoice(this.currentGuildId, this.currentVoiceChannelId);
      console.log('Voice reconnection successful');
    } catch (error) {
      console.error('Failed to reconnect to voice channel', error);
    } finally {
      this.isReconnecting = false;
    }
  }

  private async handleVoiceStateUpdate(oldState: VoiceState | null, newState: VoiceState | null): Promise<void> {
    const userId = newState?.id || oldState?.id;
    if (!userId) {
      return;
    }

    if (this.isUserExcluded(userId)) {
      await this.speakerTracker.handleVoiceStateUpdate(userId, null);
      this.cleanupSubscriptionForUser(userId);
      return;
    }

    const relevantGuildId = this.currentGuildId;
    if (!relevantGuildId) {
      return;
    }

    const isRelevantOld = oldState?.guild?.id === relevantGuildId;
    const isRelevantNew = newState?.guild?.id === relevantGuildId;
    if (!isRelevantOld && !isRelevantNew) {
      return;
    }

    const channelId = newState?.channelId;
    if (channelId === this.currentVoiceChannelId) {
      const serialized = this.serializeVoiceState(newState);
      await this.speakerTracker.handleVoiceStateUpdate(userId, serialized);
      return;
    }

    if (oldState?.channelId === this.currentVoiceChannelId && channelId !== this.currentVoiceChannelId) {
      await this.speakerTracker.handleVoiceStateUpdate(userId, null);
    }
  }

  private setupAnonymousPipeline(connection: VoiceConnection): void {
    this.teardownAnonymousPipeline();

    const input = new PassThrough({ highWaterMark: this.config.audio.frameBytes * 16 || 4096 });
    const encoder = new prism.opus.Encoder({
      rate: this.config.audio.sampleRate,
      channels: this.config.audio.channels,
      frameSize: this.config.audio.frameSamples || 960,
    });

    input.pipe(encoder);

    const resource = createAudioResource(encoder, { inputType: StreamType.Opus });
    try {
      this.anonymousPlayer.stop(true);
    } catch (error) {
      console.warn('Failed to stop previous anonymous player', error);
    }

    this.anonymousPlayer.play(resource);
    try {
      connection.subscribe(this.anonymousPlayer);
    } catch (error) {
      console.warn('Unable to subscribe anonymous player to voice connection', error);
    }

    this.anonymousPlayer.removeAllListeners('error');
    this.anonymousPlayer.on('error', (error) => {
      console.warn('Anonymous audio player error', error);
    });

    this.anonymousInput = input;
    this.anonymousEncoder = encoder;

    this.anonymousDrainListener = () => {
      try {
        this.flushAnonymousQueue();
      } catch (error) {
        console.warn('Failed to flush anonymous queue on drain event', error);
      }
    };

    input.on('drain', this.anonymousDrainListener);

    this.flushAnonymousQueue();
  }

  private teardownAnonymousPipeline(): void {
    if (this.anonymousInput) {
      try {
        if (this.anonymousDrainListener) {
          this.anonymousInput.off('drain', this.anonymousDrainListener);
        }
        this.anonymousInput.removeAllListeners();
        this.anonymousInput.end();
        this.anonymousInput.destroy();
      } catch (error) {
        console.warn('Failed to teardown anonymous input stream', error);
      }
    }
    if (this.anonymousEncoder) {
      try {
        this.anonymousEncoder.removeAllListeners();
        this.anonymousEncoder.destroy();
      } catch (error) {
        console.warn('Failed to teardown anonymous encoder', error);
      }
    }

    try {
      this.anonymousPlayer.stop(true);
    } catch (error) {
      console.warn('Failed to stop anonymous player', error);
    }

    this.anonymousInput = null;
    this.anonymousEncoder = null;
    this.anonymousQueue = [];
    this.anonymousRemainder = Buffer.alloc(0);
    this.anonymousDrainListener = null;
  }

  public pushAnonymousAudio(chunk: Buffer): boolean {
    if (!chunk || chunk.length === 0) {
      return false;
    }

    const frameBytes = this.config.audio.frameBytes > 0 ? this.config.audio.frameBytes : chunk.length;
    let buffer = Buffer.concat([this.anonymousRemainder, chunk]);
    let wroteAtLeastOneFrame = false;

    while (buffer.length >= frameBytes) {
      const frame = buffer.subarray(0, frameBytes);
      buffer = buffer.subarray(frameBytes);
      const success = this.writeAnonymousFrame(frame);
      if (success) {
        wroteAtLeastOneFrame = true;
        continue;
      }

      this.enqueueAnonymousFrame(frame);
      wroteAtLeastOneFrame = true;

      while (buffer.length >= frameBytes) {
        const pendingFrame = buffer.subarray(0, frameBytes);
        buffer = buffer.subarray(frameBytes);
        this.enqueueAnonymousFrame(pendingFrame);
      }

      break;
    }

    this.anonymousRemainder = buffer;

    if (this.anonymousInput && this.anonymousQueue.length > 0) {
      try {
        this.flushAnonymousQueue();
      } catch (error) {
        console.warn('Failed to flush anonymous queue after push', error);
      }
    }

    return wroteAtLeastOneFrame;
  }

  private writeAnonymousFrame(frame: Buffer): boolean {
    if (!this.anonymousInput) {
      return false;
    }

    return this.anonymousInput.write(frame);
  }

  private enqueueAnonymousFrame(frame: Buffer): void {
    const MAX_QUEUE_SIZE = 96;
    if (this.anonymousQueue.length >= MAX_QUEUE_SIZE) {
      return;
    }
    this.anonymousQueue.push(Buffer.from(frame));
  }

  private flushAnonymousQueue(): void {
    if (!this.anonymousInput || this.anonymousQueue.length === 0) {
      return;
    }

    while (this.anonymousQueue.length > 0) {
      const frame = this.anonymousQueue.shift();
      if (!frame) {
        break;
      }
      const canWrite = this.anonymousInput.write(frame);
      if (!canWrite) {
        this.anonymousQueue.unshift(frame);
        break;
      }
    }
  }

  public hasActiveVoiceConnection(): boolean {
    if (!this.voiceConnection) {
      return false;
    }
    const status = this.voiceConnection.state?.status;
    return status === VoiceConnectionStatus.Ready;
  }

  public onVoiceConnectionReady(listener: (connection: VoiceConnection) => void): void {
    this.events.on('voiceConnectionReady', listener);
  }

  public onVoiceConnectionDestroyed(listener: () => void): void {
    this.events.on('voiceConnectionDestroyed', listener);
  }

  public offVoiceConnectionReady(listener: (connection: VoiceConnection) => void): void {
    this.events.off('voiceConnectionReady', listener);
  }

  public offVoiceConnectionDestroyed(listener: () => void): void {
    this.events.off('voiceConnectionDestroyed', listener);
  }

  private async syncInitialChannelMembers(channel: VoiceBasedChannel): Promise<void> {
    if (!channel || !channel.isVoiceBased()) {
      return;
    }

    const members = channel.members;
    if (!members || members.size === 0) {
      return;
    }

    const promises: Array<Promise<unknown>> = [];
    for (const member of members.values()) {
      if (!member || !member.voice) {
        continue;
      }
      if (this.isUserExcluded(member.id)) {
        continue;
      }
      const serialized = this.serializeVoiceState(member.voice);
      promises.push(this.speakerTracker.handleVoiceStateUpdate(member.id, serialized));
    }
    await Promise.allSettled(promises);
  }

  private serializeVoiceState(voiceState: VoiceState | null): VoiceStateSnapshot | null {
    if (!voiceState) {
      return null;
    }

    const member = voiceState.member;
    return {
      channelId: voiceState.channelId,
      guildId: voiceState.guild?.id || member?.guild?.id || null,
      deaf: Boolean(voiceState.deaf),
      mute: Boolean(voiceState.mute),
      selfDeaf: Boolean(voiceState.selfDeaf),
      selfMute: Boolean(voiceState.selfMute),
      suppress: Boolean(voiceState.suppress),
      streaming: Boolean(voiceState.streaming),
      video: Boolean(voiceState.selfVideo),
      displayName: member?.displayName || member?.user?.globalName || member?.user?.username || null,
      username: member?.user?.username || null,
    };
  }

  private isUserExcluded(userId: Snowflake): boolean {
    return this.config.excludedUserIds.includes(userId);
  }

  private cleanupSubscriptionForUser(userId: Snowflake): void {
    const subscription = this.activeSubscriptions.get(userId);
    if (subscription) {
      if (typeof subscription.cleanup === 'function') {
        subscription.cleanup();
      } else {
        this.activeSubscriptions.delete(userId);
        this.mixer.removeSource(userId);
        this.speakerTracker.handleSpeakingEnd(userId);
      }
      return;
    }

    this.mixer.removeSource(userId);
    this.speakerTracker.handleSpeakingEnd(userId);
  }
}
