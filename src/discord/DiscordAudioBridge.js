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
    console.log('Voice connection ready');

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
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.voiceConnection = null;
      }
    });
  }

  subscribeToUserAudio(userId, receiver) {
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
      decoder.on('data', (chunk) => this.mixer.pushToSource(userId, chunk));

      const cleanup = () => {
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

      opusStream.on('end', cleanup);
      opusStream.on('error', (error) => {
        console.warn('Opus stream error', error);
        cleanup();
      });
      decoder.on('error', (error) => {
        console.warn('Decoder error', error);
        cleanup();
      });
    } catch (error) {
      console.error('Failed to subscribe to user audio', error);
    }
  }

  leaveVoice() {
    if (this.voiceConnection) {
      this.voiceConnection.destroy();
      this.voiceConnection = null;
    }
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
}

module.exports = DiscordAudioBridge;
