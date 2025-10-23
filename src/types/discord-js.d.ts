import 'discord.js';

declare module 'discord.js' {
  export const GatewayIntentBits: {
    Guilds: number;
    GuildMembers: number;
    GuildVoiceStates: number;
    GuildMessages: number;
    MessageContent: number;
  };

  export const ChannelType: {
    GuildText: number;
    GuildAnnouncement: number;
  };
}
