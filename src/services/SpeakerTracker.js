class SpeakerTracker {
  constructor({ sseService }) {
    this.sseService = sseService;
    this.currentSpeakers = new Map();
    this.userProfiles = new Map();
    this.pendingProfileFetches = new Set();
    this.userFetcher = null;
  }

  setUserFetcher(fetcher) {
    this.userFetcher = fetcher;
  }

  getSpeakers() {
    return Array.from(this.currentSpeakers.values());
  }

  getSpeakerCount() {
    return this.currentSpeakers.size;
  }

  getInitialState() {
    return { speakers: this.getSpeakers() };
  }

  async handleSpeakingStart(userId) {
    if (this.currentSpeakers.has(userId) || this.pendingProfileFetches.has(userId)) {
      return;
    }

    this.pendingProfileFetches.add(userId);

    try {
      const profile = await this.fetchUserProfile(userId);
      const payload = { ...profile, startedAt: Date.now() };
      this.currentSpeakers.set(userId, payload);
      this.sseService.broadcast('speaking', { type: 'start', user: payload });
      this.broadcastState();
    } catch (error) {
      console.error('Failed to handle speaking start', error);
    } finally {
      this.pendingProfileFetches.delete(userId);
    }
  }

  handleSpeakingEnd(userId) {
    if (!this.currentSpeakers.has(userId)) {
      return;
    }

    this.currentSpeakers.delete(userId);
    this.sseService.broadcast('speaking', { type: 'end', userId });
    this.broadcastState();
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

  clear() {
    this.currentSpeakers.clear();
    this.pendingProfileFetches.clear();
    this.userProfiles.clear();
    this.sseService.broadcast('state', { speakers: [] });
  }
}

module.exports = SpeakerTracker;
