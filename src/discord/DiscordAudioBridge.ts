import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  PermissionsBitField,
  type Message,
  type GuildBasedChannel,
  type TextChannel,
  type NewsChannel,
  type VoiceState,
  type Snowflake,
  type VoiceBasedChannel,
  type GuildMember,
  type PartialGuildMember,
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
import { type UserSyncRecord } from '../services/VoiceActivityRepository';
import type KaldiTranscriptionService from '../services/KaldiTranscriptionService';
import type UserAudioRecorder from '../services/UserAudioRecorder';
import type { UserAudioRecordingSession } from '../services/UserAudioRecorder';
import type { Config } from '../config';

type DecoderStream = prism.opus.Decoder;

interface Subscription {
  opusStream: AudioReceiveStream;
  decoder: DecoderStream;
  cleanup: (() => void) | null;
  recordingSession: UserAudioRecordingSession | null;
}

export interface DiscordAudioBridgeOptions {
  config: Config;
  mixer: AudioMixer;
  speakerTracker: SpeakerTracker;
  voiceActivityRepository?: VoiceActivityRepository | null;
  transcriptionService?: KaldiTranscriptionService | null;
  audioRecorder?: UserAudioRecorder | null;
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

export interface DiscordTextChannelSummary {
  id: string;
  name: string | null;
  topic: string | null;
  lastMessageId: string | null;
  lastMessageAt: string | null;
  position: number;
  parentId: string | null;
}

export interface DiscordChannelMessageAuthor {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface DiscordChannelMessage {
  id: string;
  content: string;
  createdAt: string;
  author: DiscordChannelMessageAuthor;
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

export interface DiscordGuildSummary {
  id: string;
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number | null;
  approximateMemberCount: number | null;
  approximatePresenceCount: number | null;
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

  private readonly knownBotUserIds = new Set<Snowflake>();

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

  private readonly transcriptionService: KaldiTranscriptionService | null;

  private readonly audioRecorder: UserAudioRecorder | null;

  private anonymousPipelineReady = false;

  private anonymousPipelineSetupInProgress = false;

  constructor({
    config,
    mixer,
    speakerTracker,
    voiceActivityRepository = null,
    transcriptionService = null,
    audioRecorder = null,
  }: DiscordAudioBridgeOptions) {
    this.config = config;
    this.mixer = mixer;
    this.speakerTracker = speakerTracker;
    this.voiceActivityRepository = voiceActivityRepository;
    this.transcriptionService = transcriptionService;
    this.audioRecorder = audioRecorder;

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

  private resolveActiveGuildId(): Snowflake {
    const guildId = this.config.guildId ?? this.currentGuildId;
    if (!guildId) {
      const error = new Error('GUILD_NOT_CONFIGURED');
      error.name = 'GUILD_NOT_CONFIGURED';
      throw error;
    }
    return guildId;
  }

  private isSupportedGuildTextChannel(channel: GuildBasedChannel | null): channel is TextChannel | NewsChannel {
    if (!channel) {
      return false;
    }

    const candidate = channel as GuildBasedChannel & {
      isTextBased?: () => boolean;
      isDMBased?: () => boolean;
    };

    if (typeof candidate.isTextBased !== 'function' || !candidate.isTextBased()) {
      return false;
    }

    if (typeof candidate.isDMBased === 'function' && candidate.isDMBased()) {
      return false;
    }

    switch (channel.type) {
      case ChannelType.GuildText:
      case ChannelType.GuildAnnouncement:
        return true;
      default:
        return false;
    }
  }

  private registerEventHandlers(): void {
    this.client.once(Events.ClientReady, async () => {
      if (!this.client.user) {
        console.error('Discord client ready without user context');
        return;
      }
      if (this.config.guildId && this.config.voiceChannelId) {
        try {
          await this.joinVoice(this.config.guildId, this.config.voiceChannelId);
        } catch (error) {
          console.error('Auto-join voice channel failed', error);
        }
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
    this.client.on(Events.GuildMemberAdd, async (member) => {
      try {
        await this.handleGuildMemberAdd(member);
      } catch (error) {
        console.error('Guild member add handling failed', error);
      }
    });
    this.client.on(Events.GuildMemberRemove, async (member) => {
      try {
        await this.handleGuildMemberRemove(member);
      } catch (error) {
        console.error('Guild member remove handling failed', error);
      }
    });
  }

  private syncUsers(records: UserSyncRecord[]): void {
    if (!this.voiceActivityRepository || !Array.isArray(records) || records.length === 0) {
      return;
    }

    this.voiceActivityRepository
      .syncUsers(records)
      .catch((error) => {
        console.error('Failed to synchronize users metadata', error);
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
          content: message.content ?? null,
          timestamp: createdAt,
        })
        .catch((error) => {
          console.error('Failed to persist message activity event', error);
        });
    }

    if (message.guildId) {
      const joinedAt = message.member?.joinedAt instanceof Date && !Number.isNaN(message.member.joinedAt.getTime())
        ? message.member.joinedAt
        : null;
      const displayName = typeof message.member?.displayName === 'string'
        ? message.member.displayName
        : message.author.globalName ?? message.author.username ?? null;
      const nickname = typeof message.member?.nickname === 'string' ? message.member.nickname : null;
      const avatarUrl = typeof message.author.displayAvatarURL === 'function'
        ? message.author.displayAvatarURL({ extension: 'png', size: 128 })
        : null;

      this.syncUsers([
        {
          userId: message.author.id,
          guildId: message.guildId,
          username: message.author.username ?? null,
          displayName,
          nickname,
          firstSeenAt: joinedAt,
          lastSeenAt: createdAt,
          metadata: {
            globalName: message.author.globalName ?? null,
            avatarUrl,
            isBot: Boolean(message.author.bot),
          },
        },
      ]);
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
          console.error('Unable to fetch guild member details for user', userId, (error as Error)?.message ?? error);
        }
      }

      const computedDisplayName = guildInfo?.displayName || guildInfo?.nickname || globalName || username;

      const identity: DiscordUserIdentity = {
        id: user.id,
        username,
        globalName,
        discriminator,
        displayName: computedDisplayName,
        avatarUrl,
        bannerUrl: bannerUrl ?? null,
        accentColor,
        createdAt,
        guild: guildInfo,
      };

      if (guildInfo?.id) {
        const joinedAtDate = guildInfo.joinedAt ? new Date(guildInfo.joinedAt) : null;
        const normalizedJoinedAt = joinedAtDate && !Number.isNaN(joinedAtDate.getTime()) ? joinedAtDate : null;

        this.syncUsers([
          {
            userId: user.id,
            guildId: guildInfo.id,
            username,
            displayName: computedDisplayName,
            nickname: guildInfo.nickname,
            firstSeenAt: normalizedJoinedAt,
            lastSeenAt: new Date(),
            metadata: {
              globalName,
              displayName: guildInfo.displayName ?? null,
              avatarUrl,
              bannerUrl: bannerUrl ?? null,
              accentColor,
              roles: guildInfo.roles ?? [],
            },
          },
        ]);
      }

      return identity;
    } catch (error) {
      console.error('Failed to fetch Discord user identity', userId, (error as Error)?.message ?? error);
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
        const isBot = Boolean(member.user?.bot);

        if (isBot) {
          this.knownBotUserIds.add(member.id);
        }

        return {
          id: member.id,
          displayName,
          username,
          nickname,
          avatarUrl,
          joinedAt,
          roles,
          isBot,
        };
      });

      const syncTimestamp = new Date();
      this.syncUsers(
        members.map((member) => {
          const joinedAtDate = member.joinedAt ? new Date(member.joinedAt) : null;
          const firstSeenAt = joinedAtDate && !Number.isNaN(joinedAtDate.getTime()) ? joinedAtDate : null;

          return {
            userId: member.id,
            guildId,
            username: member.username,
            displayName: member.displayName ?? member.nickname ?? member.username ?? null,
            nickname: member.nickname,
            firstSeenAt,
            lastSeenAt: syncTimestamp,
            metadata: {
              avatarUrl: member.avatarUrl,
              roles: member.roles,
              isBot: member.isBot,
            },
          } satisfies UserSyncRecord;
        }),
      );

      const nextCursor = !normalizedSearch && members.length === normalizedLimit
        ? members[members.length - 1]?.id ?? null
        : null;

      return {
        members,
        nextCursor,
        hasMore: Boolean(nextCursor),
      };
    } catch (error) {
      console.error('Failed to list guild members', (error as Error)?.message ?? error);
      throw error;
    }
  }

  public async getGuildSummary(): Promise<DiscordGuildSummary> {
    const guildId = this.resolveActiveGuildId();

    try {
      const resolvedGuild = await this.client.guilds.fetch({ guild: guildId, withCounts: true });

      if (!resolvedGuild) {
        const unavailableError = new Error('GUILD_UNAVAILABLE');
        unavailableError.name = 'GUILD_UNAVAILABLE';
        throw unavailableError;
      }

      const iconUrl = typeof resolvedGuild.iconURL === 'function' ? resolvedGuild.iconURL({ size: 128 }) : null;
      const bannerUrl = typeof resolvedGuild.bannerURL === 'function' ? resolvedGuild.bannerURL({ size: 512 }) : null;

      const normalizeCount = (value: unknown): number | null => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return null;
        }
        return Math.max(0, Math.round(numeric));
      };

      return {
        id: resolvedGuild.id,
        name: typeof resolvedGuild.name === 'string' ? resolvedGuild.name : null,
        description: typeof resolvedGuild.description === 'string' ? resolvedGuild.description : null,
        iconUrl,
        bannerUrl,
        memberCount: normalizeCount(resolvedGuild.memberCount),
        approximateMemberCount: normalizeCount(resolvedGuild.approximateMemberCount),
        approximatePresenceCount: normalizeCount(resolvedGuild.approximatePresenceCount),
      };
    } catch (error) {
      const errorName = (error as Error)?.name;
      if (errorName === 'GUILD_NOT_CONFIGURED' || errorName === 'GUILD_UNAVAILABLE') {
        throw error;
      }
      console.error('Failed to fetch guild summary', (error as Error)?.message ?? error);
      throw error;
    }
  }

  public async listTextChannels(): Promise<DiscordTextChannelSummary[]> {
    const guildId = this.resolveActiveGuildId();

    try {
      const guild = await this.client.guilds.fetch({ guild: guildId, force: true });
      const fetched = await guild.channels.fetch();

      const guildMember = guild.members.me;
      if (!guildMember) {
        console.warn('Skipping text channel listing because the bot member is unavailable in the guild context');
        return [];
      }

      const summaries: DiscordTextChannelSummary[] = [];
      for (const channel of fetched.values()) {
        if (!this.isSupportedGuildTextChannel(channel)) {
          continue;
        }

        const permissions = channel.permissionsFor(guildMember);
        if (!permissions) {
          continue;
        }

        if (
          !permissions.has(PermissionsBitField.Flags.ViewChannel) ||
          !permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
        ) {
          continue;
        }

        const topic = typeof channel.topic === 'string' && channel.topic.trim().length > 0 ? channel.topic.trim() : null;
        let lastMessageId = channel.lastMessageId ?? channel.lastMessage?.id ?? null;
        let lastMessage: Message | null = null;

        if (lastMessageId) {
          const cached = channel.messages?.cache?.get(lastMessageId) ?? channel.lastMessage ?? null;
          if (cached) {
            lastMessage = cached;
          } else {
            try {
              lastMessage = await channel.messages.fetch(lastMessageId);
            } catch (error) {
              console.warn('Failed to fetch cached last message for channel', channel.id, error);
            }
          }
        }

        if (!lastMessage) {
          try {
            const latest = await channel.messages.fetch({ limit: 1 });
            const first = latest.first() ?? null;
            if (first) {
              lastMessage = first;
              lastMessageId = first.id;
            }
          } catch (error) {
            console.warn('Failed to fetch latest message for channel', channel.id, error);
          }
        }

        if (!lastMessage) {
          continue;
        }

        const createdAt =
          lastMessage.createdAt instanceof Date && !Number.isNaN(lastMessage.createdAt.getTime())
            ? lastMessage.createdAt
            : new Date(lastMessage.createdTimestamp);
        const lastMessageAt = Number.isNaN(createdAt.getTime()) ? null : createdAt.toISOString();

        if (!lastMessageId || !lastMessageAt) {
          continue;
        }

        summaries.push({
          id: channel.id,
          name: typeof channel.name === 'string' ? channel.name : null,
          topic,
          lastMessageId,
          lastMessageAt,
          position: typeof channel.position === 'number' ? channel.position : 0,
          parentId: channel.parentId ?? null,
        });
      }

      summaries.sort((a, b) => {
        const dateA = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const dateB = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        if (dateA !== dateB) {
          return dateB - dateA;
        }
        const nameA = (a.name ?? '').toLocaleLowerCase('fr-FR');
        const nameB = (b.name ?? '').toLocaleLowerCase('fr-FR');
        if (nameA !== nameB) {
          return nameA.localeCompare(nameB);
        }
        return a.id.localeCompare(b.id);
      });

      return summaries;
    } catch (error) {
      console.error('Failed to list guild text channels', (error as Error)?.message ?? error);
      throw error;
    }
  }

  public async fetchTextChannelMessages(
    channelId: Snowflake,
    options: { limit?: number | null; before?: Snowflake | null } = {},
  ): Promise<{ messages: DiscordChannelMessage[]; hasMore: boolean; nextCursor: string | null }> {
    const guildId = this.resolveActiveGuildId();

    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        const error = new Error('CHANNEL_NOT_FOUND');
        error.name = 'CHANNEL_NOT_FOUND';
        throw error;
      }

      const guildBased = channel as GuildBasedChannel | null;
      if (!guildBased || guildBased.guildId !== guildId || !this.isSupportedGuildTextChannel(guildBased)) {
        const error = new Error('CHANNEL_NOT_ACCESSIBLE');
        error.name = 'CHANNEL_NOT_ACCESSIBLE';
        throw error;
      }

      const numericLimit = Number(options.limit);
      const boundedLimit = Number.isFinite(numericLimit)
        ? Math.min(Math.max(Math.floor(numericLimit), 1), 100)
        : 50;

      const fetchOptions: { limit: number; before?: Snowflake } = { limit: boundedLimit };
      if (options.before) {
        fetchOptions.before = options.before;
      }

      const textChannel: TextChannel | NewsChannel = guildBased;

      const fetchedMessages = await textChannel.messages.fetch(fetchOptions);
      const sorted = Array.from(fetchedMessages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp,
      );

      const messages: DiscordChannelMessage[] = sorted.map((message) => {
        const createdAt = message.createdAt instanceof Date && !Number.isNaN(message.createdAt.getTime())
          ? message.createdAt
          : new Date(message.createdTimestamp);

        let avatarUrl: string | null = null;
        if (typeof message.author?.displayAvatarURL === 'function') {
          try {
            avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 128 });
          } catch (avatarError) {
            console.warn('Failed to resolve avatar URL for message author', avatarError);
          }
        }

        const displayName = message.member?.displayName
          ?? message.author?.globalName
          ?? message.author?.username
          ?? null;

        return {
          id: message.id,
          content: typeof message.content === 'string' ? message.content : '',
          createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
          author: {
            id: message.author?.id ?? 'unknown',
            displayName,
            username: message.author?.username ?? null,
            avatarUrl,
          },
        } satisfies DiscordChannelMessage;
      });

      const hasMore = fetchedMessages.size === boundedLimit;
      const nextCursor = messages.length > 0 ? messages[0]?.id ?? null : null;

      return {
        messages,
        hasMore,
        nextCursor,
      };
    } catch (error) {
      if ((error as Error)?.name === 'CHANNEL_NOT_FOUND' || (error as Error)?.name === 'CHANNEL_NOT_ACCESSIBLE') {
        throw error;
      }

      console.error('Failed to fetch text channel messages', (error as Error)?.message ?? error);
      throw error;
    }
  }

  public async sendTextChannelMessage(channelId: Snowflake, content: string): Promise<DiscordChannelMessage> {
    const guildId = this.resolveActiveGuildId();

    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        const error = new Error('CHANNEL_NOT_FOUND');
        error.name = 'CHANNEL_NOT_FOUND';
        throw error;
      }

      const guildBased = channel as GuildBasedChannel | null;
      if (!guildBased || guildBased.guildId !== guildId || !this.isSupportedGuildTextChannel(guildBased)) {
        const error = new Error('CHANNEL_NOT_ACCESSIBLE');
        error.name = 'CHANNEL_NOT_ACCESSIBLE';
        throw error;
      }

      const textChannel: TextChannel | NewsChannel = guildBased;

      const sentMessage = await textChannel.send({ content });

      const createdAt = sentMessage.createdAt instanceof Date && !Number.isNaN(sentMessage.createdAt.getTime())
        ? sentMessage.createdAt
        : new Date(sentMessage.createdTimestamp);

      let avatarUrl: string | null = null;
      if (typeof sentMessage.author?.displayAvatarURL === 'function') {
        try {
          avatarUrl = sentMessage.author.displayAvatarURL({ extension: 'png', size: 128 });
        } catch (avatarError) {
          console.warn('Failed to resolve avatar URL for sent message author', avatarError);
        }
      }

      const displayName = sentMessage.member?.displayName
        ?? sentMessage.author?.globalName
        ?? sentMessage.author?.username
        ?? null;

      return {
        id: sentMessage.id,
        content: typeof sentMessage.content === 'string' ? sentMessage.content : '',
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
        author: {
          id: sentMessage.author?.id ?? 'unknown',
          displayName,
          username: sentMessage.author?.username ?? null,
          avatarUrl,
        },
      } satisfies DiscordChannelMessage;
    } catch (error) {
      if ((error as Error)?.name === 'CHANNEL_NOT_FOUND' || (error as Error)?.name === 'CHANNEL_NOT_ACCESSIBLE') {
        throw error;
      }

      console.error('Failed to send text channel message', (error as Error)?.message ?? error);
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

    try {
      this.speakerTracker.clear();
      await this.syncInitialChannelMembers(voiceChannel);
    } catch (error) {
      console.error('Failed to synchronise initial channel members', error);
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

      this.mixer.addSource(userId);
      this.speakerTracker.handleSpeakingStart(userId).catch((error) => {
        console.error('Failed to handle speaking start', error);
      });
      this.transcriptionService?.startSession(userId, {
        guildId: this.currentGuildId,
        channelId: this.currentVoiceChannelId,
      });
      this.subscribeToUserAudio(userId, receiver);
    });

    receiver.speaking.on('end', (userId) => {
      if (this.isUserExcluded(userId)) {
        this.cleanupSubscriptionForUser(userId);
        return;
      }

      this.speakerTracker.handleSpeakingEnd(userId);
      this.mixer.removeSource(userId);
      void this.transcriptionService?.finalizeSession(userId).catch((error) => {
        console.error('Failed to finalize transcription session on speaking end', {
          userId,
          error,
        });
      });
    });

    connection.on('stateChange', (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        this.handleConnectionDisconnected(connection).catch((error) => {
          console.error('Failed handling voice disconnect', error);
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

  private getRecordingIdentity(userId: Snowflake): { username: string | null; displayName: string | null } {
    const user = this.client.users.cache.get(userId);
    let username: string | null = user?.username ?? null;
    let displayName: string | null = user?.globalName ?? user?.username ?? null;

    if (this.currentGuildId) {
      const guild = this.client.guilds.cache.get(this.currentGuildId);
      const member = guild?.members.cache.get(userId);
      if (member) {
        const memberDisplayName = member.displayName?.trim() || member.nickname?.trim() || null;
        if (memberDisplayName) {
          displayName = memberDisplayName;
        }
        if (!username) {
          username = member.user?.username ?? null;
        }
      }
    }

    return { username, displayName };
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
      const identity = this.getRecordingIdentity(userId);
      const recordingSession = this.audioRecorder?.openSession({
        id: userId,
        username: identity.username,
        displayName: identity.displayName,
      }) ?? null;
      const onData = (chunk: Buffer) => {
        this.mixer.pushToSource(userId, chunk);
        this.transcriptionService?.pushAudio(userId, chunk);
        recordingSession?.write(chunk);
      };
      decoder.on('data', onData);

      const subscription: Subscription = { opusStream, decoder, cleanup: null, recordingSession };
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
          console.error('Failed to destroy opus stream', error);
        }
        try {
          decoder.destroy();
        } catch (error) {
          console.error('Failed to destroy decoder', error);
        }
        this.mixer.removeSource(userId);
        this.speakerTracker.handleSpeakingEnd(userId);
        void this.transcriptionService?.finalizeSession(userId).catch((error) => {
          console.error('Failed to finalize transcription session during cleanup', {
            userId,
            error,
          });
        });
        if (subscription.recordingSession) {
          const { filePath } = subscription.recordingSession;
          const finalizeRecording = subscription.recordingSession.finalize();
          finalizeRecording.catch((error) => {
            console.error('Failed to finalize audio recording session', {
              userId,
              filePath,
              error,
            });
          });
        }
        subscription.recordingSession = null;
      };

      onOpusError = (error: Error) => {
        console.error('Opus stream error', error);
        cleanup();
      };
      onDecoderError = (error: Error) => {
        console.error('Decoder error', error);
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
      console.error('Error while leaving voice channel during shutdown', error);
    }

    try {
      await this.client.destroy();
    } catch (error) {
      console.error('Error while destroying Discord client', error);
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
    } catch (error) {
      console.error('Voice connection lost, preparing to reconnect', error);
      try {
        connection.destroy();
      } catch (destroyError) {
        console.error('Failed to destroy disconnected voice connection', destroyError);
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
      await this.joinVoice(this.currentGuildId, this.currentVoiceChannelId);
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

    const botUserId = this.client.user?.id;
    const isSelfBot = Boolean(botUserId && userId === botUserId);

    if (isSelfBot) {
      this.speakerTracker.updateBridgeStatus({
        serverDeafened: Boolean(newState?.deaf),
        selfDeafened: Boolean(newState?.selfDeaf),
        updatedAt: Date.now(),
      });
    }

    const isBotUser = Boolean(newState?.member?.user?.bot ?? oldState?.member?.user?.bot);
    if (isBotUser && !isSelfBot) {
      this.knownBotUserIds.add(userId);
      await this.speakerTracker.handleVoiceStateUpdate(userId, null);
      this.cleanupSubscriptionForUser(userId);
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

    this.syncUsers([
      {
        userId,
        guildId: relevantGuildId,
        lastSeenAt: new Date(),
      },
    ]);

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

  private async handleGuildMemberAdd(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!this.voiceActivityRepository) {
      return;
    }

    const guildId = member.guild?.id;
    if (!guildId) {
      return;
    }

    if (this.config.guildId && guildId !== this.config.guildId) {
      return;
    }

    let resolvedMember: GuildMember;
    if ('partial' in member && member.partial) {
      try {
        resolvedMember = await member.fetch();
      } catch (error) {
        console.warn('Failed to resolve partial guild member on join', (error as Error)?.message ?? error);
        return;
      }
    } else {
      resolvedMember = member as GuildMember;
    }

    const user = resolvedMember.user;
    if (!user) {
      return;
    }

    if (user.bot) {
      this.knownBotUserIds.add(resolvedMember.id);
    }

    const username = typeof user.username === 'string' ? user.username : null;
    const globalName = typeof user.globalName === 'string' ? user.globalName : null;
    const nickname = typeof resolvedMember.nickname === 'string' ? resolvedMember.nickname : null;
    const displayName = typeof resolvedMember.displayName === 'string'
      ? resolvedMember.displayName
      : nickname ?? globalName ?? username ?? null;
    const avatarUrl = typeof resolvedMember.displayAvatarURL === 'function'
      ? resolvedMember.displayAvatarURL({ extension: 'png', size: 128 })
      : null;
    const joinedAt = resolvedMember.joinedAt instanceof Date && !Number.isNaN(resolvedMember.joinedAt.getTime())
      ? resolvedMember.joinedAt
      : null;
    const roles = Array.from(resolvedMember.roles.cache.values())
      .filter((role) => role.id !== guildId)
      .map((role) => ({ id: role.id, name: role.name }));
    const now = new Date();

    this.syncUsers([
      {
        userId: resolvedMember.id,
        guildId,
        username,
        displayName,
        nickname,
        firstSeenAt: joinedAt ?? now,
        lastSeenAt: now,
        metadata: {
          globalName,
          avatarUrl,
          roles,
          isBot: Boolean(user.bot),
        },
        departedAt: null,
      },
    ]);
  }

  private async handleGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!this.voiceActivityRepository) {
      return;
    }

    const guildId = member.guild?.id;
    if (!guildId) {
      return;
    }

    if (this.config.guildId && guildId !== this.config.guildId) {
      return;
    }

    const user = member.user;
    const userId = member.id;
    if (!userId) {
      return;
    }

    if (user?.bot) {
      this.knownBotUserIds.add(userId);
      return;
    }

    const username = typeof user?.username === 'string' ? user.username : null;
    const globalName = typeof user?.globalName === 'string' ? user.globalName : null;
    const nickname = typeof member.nickname === 'string' ? member.nickname : null;
    const displayName = typeof member.displayName === 'string'
      ? member.displayName
      : nickname ?? globalName ?? username ?? null;
    const avatarUrl = typeof user?.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ extension: 'png', size: 128 })
      : null;
    const departedAt = new Date();

    this.syncUsers([
      {
        userId,
        guildId,
        username,
        displayName,
        nickname,
        lastSeenAt: departedAt,
        metadata: {
          globalName,
          avatarUrl,
          departedAt: departedAt.toISOString(),
        },
        departedAt,
      },
    ]);
  }

  private setupAnonymousPipeline(connection: VoiceConnection): void {
    if (this.anonymousPipelineSetupInProgress) {
      return;
    }

    if (this.anonymousPipelineReady) {
      return;
    }

    this.anonymousPipelineSetupInProgress = true;

    try {
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
        console.error('Failed to stop previous anonymous player', error);
      }

      this.anonymousPlayer.play(resource);
      let subscribed = false;
      try {
        connection.subscribe(this.anonymousPlayer);
        subscribed = true;
      } catch (error) {
        console.error('Unable to subscribe anonymous player to voice connection', error);
      }

      this.anonymousPlayer.removeAllListeners('error');
      this.anonymousPlayer.on('error', (error) => {
        console.error('Anonymous audio player error', error);
      });

      this.anonymousInput = input;
      this.anonymousEncoder = encoder;

      this.anonymousDrainListener = () => {
        try {
          this.flushAnonymousQueue();
        } catch (error) {
          console.error('Failed to flush anonymous queue on drain event', error);
        }
      };

      input.on('drain', this.anonymousDrainListener);

      this.flushAnonymousQueue();
      this.anonymousPipelineReady = subscribed;
    } finally {
      this.anonymousPipelineSetupInProgress = false;
    }
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
        console.error('Failed to teardown anonymous input stream', error);
      }
    }
    if (this.anonymousEncoder) {
      try {
        this.anonymousEncoder.removeAllListeners();
        this.anonymousEncoder.destroy();
      } catch (error) {
        console.error('Failed to teardown anonymous encoder', error);
      }
    }

    try {
      this.anonymousPlayer.stop(true);
    } catch (error) {
      console.error('Failed to stop anonymous player', error);
    }

    this.anonymousInput = null;
    this.anonymousEncoder = null;
    this.anonymousQueue = [];
    this.anonymousRemainder = Buffer.alloc(0);
    this.anonymousDrainListener = null;
    this.anonymousPipelineReady = false;
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
        console.error('Failed to flush anonymous queue after push', error);
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
      if (member.user?.bot) {
        this.knownBotUserIds.add(member.id);
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
    if (this.config.excludedUserIds.includes(userId)) {
      return true;
    }

    if (this.knownBotUserIds.has(userId)) {
      return true;
    }

    const cachedUser = this.client.users.cache.get(userId);
    if (cachedUser?.bot) {
      this.knownBotUserIds.add(userId);
      return true;
    }

    if (this.currentGuildId) {
      const guild = this.client.guilds.cache.get(this.currentGuildId);
      const member = guild?.members.cache.get(userId);
      if (member?.user?.bot) {
        this.knownBotUserIds.add(userId);
        return true;
      }
    }

    return false;
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
        void this.transcriptionService?.finalizeSession(userId).catch((error) => {
          console.error('Failed to finalize transcription session during manual cleanup', {
            userId,
            error,
          });
        });
      }
      return;
    }

    this.mixer.removeSource(userId);
    this.speakerTracker.handleSpeakingEnd(userId);
    void this.transcriptionService?.finalizeSession(userId).catch((error) => {
      console.error('Failed to finalize transcription session during passive cleanup', {
        userId,
        error,
      });
    });
  }
}
