const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');

class DiscordAudioBridge {
  constructor({ config, mixer, speakerTracker }) {
    this.config = config;
    this.mixer = mixer;
    this.speakerTracker = speakerTracker;
    this.voiceConnection = null;
    this.activeSubscriptions = new Map();
    this.currentGuildId = null;
    this.currentVoiceChannelId = null;
    this.shouldAutoReconnect = true;
    this.isReconnecting = false;
    this.expectingDisconnect = false;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.speakerTracker.setUserFetcher((userId) => this.client.users.fetch(userId));

    this.registerEventHandlers();
  }

  registerEventHandlers() {
    this.client.once(Events.ClientReady, async () => {
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

    this.client.on('messageCreate', async (message) => this.handleMessage(message));
    this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      try {
        await this.handleVoiceStateUpdate(oldState, newState);
      } catch (error) {
        console.error('Voice state update handling failed', error);
      }
    });
  }

  async handleMessage(message) {
    if (message.author.bot) {
      return;
    }

    const content = (message.content || '').trim();
    if (!content.startsWith('!')) {
      return;
    }

    if (content.startsWith('!joinVoice')) {
      const parts = content.split(/\s+/);
      const guildId = parts[1] || message.guildId;
      const channelId = parts[2];

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
        await message.reply("Je ne suis pas connecté à un salon vocal.");
      }
    }
  }

  async joinVoice(guildId, channelId) {
    this.shouldAutoReconnect = true;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error('Guild not cached. Ensure the bot has access to the guild.');
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      throw new Error('Voice channel not found or inaccessible.');
    }

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
      await this.syncInitialChannelMembers(channel);
    } catch (error) {
      console.warn('Failed to synchronise initial channel members', error);
    }

    this.setupReceiver(connection);
    return connection;
  }

  setupReceiver(connection) {
    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      console.log('start speaking', userId);
      this.mixer.addSource(userId);
      this.speakerTracker.handleSpeakingStart(userId);
      this.subscribeToUserAudio(userId, receiver);
    });

    receiver.speaking.on('end', (userId) => {
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
        if (this.shouldAutoReconnect && !this.expectingDisconnect) {
          this.scheduleReconnect().catch((error) => {
            console.error('Voice reconnection attempt failed', error);
          });
        }
      }
    });
  }

  subscribeToUserAudio(userId, receiver) {
    if (this.activeSubscriptions.has(userId)) {
      return;
    }

    try {
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });
      const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: this.config.audio.channels,
        rate: this.config.audio.sampleRate,
      });

      opusStream.pipe(decoder);
      const onData = (chunk) => this.mixer.pushToSource(userId, chunk);
      decoder.on('data', onData);

      const subscription = { opusStream, decoder, cleanup: null };
      this.activeSubscriptions.set(userId, subscription);

      let cleanedUp = false;
      let onOpusError;
      let onDecoderError;
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

      onOpusError = (error) => {
        console.warn('Opus stream error', error);
        cleanup();
      };
      onDecoderError = (error) => {
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

  leaveVoice() {
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
  }

  cleanupAllSubscriptions() {
    const subscriptions = Array.from(this.activeSubscriptions.values());
    for (const subscription of subscriptions) {
      if (subscription && typeof subscription.cleanup === 'function') {
        subscription.cleanup();
      }
    }
    this.activeSubscriptions.clear();
  }

  async login() {
    await this.client.login(this.config.botToken);
  }

  async destroy() {
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

  async handleConnectionDisconnected(connection) {
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

  async scheduleReconnect() {
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

  async handleVoiceStateUpdate(oldState, newState) {
    const userId = newState?.id || oldState?.id;
    if (!userId) {
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

  async syncInitialChannelMembers(channel) {
    if (!channel || !channel.isVoiceBased()) {
      return;
    }

    const members = channel.members;
    if (!members || members.size === 0) {
      return;
    }

    const promises = [];
    for (const member of members.values()) {
      if (!member || !member.voice) {
        continue;
      }
      const serialized = this.serializeVoiceState(member.voice);
      promises.push(this.speakerTracker.handleVoiceStateUpdate(member.id, serialized));
    }
    await Promise.allSettled(promises);
  }

  serializeVoiceState(voiceState) {
    if (!voiceState) {
      return null;
    }

    const member = voiceState.member;
    return {
      channelId: voiceState.channelId,
      guildId: voiceState.guild?.id || member?.guild?.id || null,
      deaf: voiceState.deaf,
      mute: voiceState.mute,
      selfDeaf: voiceState.selfDeaf,
      selfMute: voiceState.selfMute,
      suppress: voiceState.suppress,
      streaming: voiceState.streaming,
      video: voiceState.selfVideo,
      displayName: member?.displayName || member?.user?.globalName || member?.user?.username,
      username: member?.user?.username,
    };
  }
}

module.exports = DiscordAudioBridge;
