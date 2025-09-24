class SpeakerTracker {
  constructor({ sseService }) {
    this.sseService = sseService;
    this.participants = new Map();
    this.userProfiles = new Map();
    this.pendingProfileFetches = new Set();
    this.userFetcher = null;
  }

  setUserFetcher(fetcher) {
    this.userFetcher = fetcher;
  }

  getSpeakers() {
    return Array.from(this.participants.values()).map((participant) => this.cloneParticipant(participant));
  }

  getSpeakerCount() {
    return this.participants.size;
  }

  getInitialState() {
    return { speakers: this.getSpeakers() };
  }

  async ensureParticipant(userId) {
    if (this.participants.has(userId)) {
      return this.participants.get(userId);
    }

    if (this.pendingProfileFetches.has(userId)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return this.ensureParticipant(userId);
    }

    this.pendingProfileFetches.add(userId);

    try {
      const profile = await this.fetchUserProfile(userId);
      const participant = {
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

  async handleSpeakingStart(userId) {
    try {
      const participant = await this.ensureParticipant(userId);
      const now = Date.now();
      const updated = {
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

  handleSpeakingEnd(userId) {
    const participant = this.participants.get(userId);
    if (!participant) {
      return;
    }

    const updated = {
      ...participant,
      isSpeaking: false,
      startedAt: null,
      lastSpokeAt: Date.now(),
    };
    this.participants.set(userId, updated);
    this.sseService.broadcast('speaking', { type: 'end', user: this.cloneParticipant(updated) });
    this.broadcastState();
  }

  async handleVoiceStateUpdate(userId, voiceState) {
    if (!voiceState || !voiceState.channelId) {
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

      const updated = {
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
        },
      };

      this.participants.set(userId, updated);
      this.broadcastState();
    } catch (error) {
      console.error('Failed to handle voice state update', error);
    }
  }

  broadcastState() {
    this.sseService.broadcast('state', { speakers: this.getSpeakers() });
  }

  async fetchUserProfile(userId) {
    if (this.userProfiles.has(userId)) {
      return this.userProfiles.get(userId);
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
        console.warn('Unable to fetch user profile', userId, error?.message || error);
      }
    }

    const profile = { id: userId, username, displayName, avatar };
    this.userProfiles.set(userId, profile);
    return profile;
  }

  cloneParticipant(participant) {
    if (!participant) {
      return participant;
    }

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

  clear() {
    this.participants.clear();
    this.pendingProfileFetches.clear();
    this.userProfiles.clear();
    this.sseService.broadcast('state', { speakers: [] });
  }
}

module.exports = SpeakerTracker;
