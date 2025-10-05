import fs from 'fs/promises';
import path from 'path';

export interface HiddenMemberRecord {
  userId: string;
  idea: string | null;
  hiddenAt: string;
}

interface AdminServiceOptions {
  storageDirectory: string;
  hiddenMembersFileName?: string;
}

export default class AdminService {
  private readonly storageDirectory: string;

  private readonly hiddenMembersFilePath: string;

  private hiddenMembers: Map<string, HiddenMemberRecord> = new Map();

  private initialized = false;

  private initializing: Promise<void> | null = null;

  constructor({ storageDirectory, hiddenMembersFileName = 'hidden-members.json' }: AdminServiceOptions) {
    this.storageDirectory = storageDirectory;
    this.hiddenMembersFilePath = path.join(this.storageDirectory, hiddenMembersFileName);
  }

  public async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  public async listHiddenMembers(): Promise<HiddenMemberRecord[]> {
    await this.ensureInitialized();
    return Array.from(this.hiddenMembers.values()).sort((a, b) => a.hiddenAt.localeCompare(b.hiddenAt));
  }

  public async getHiddenMemberIds(): Promise<Set<string>> {
    const members = await this.listHiddenMembers();
    return new Set(members.map((entry) => entry.userId));
  }

  public async isMemberHidden(userId: string): Promise<boolean> {
    if (!userId) {
      return false;
    }
    await this.ensureInitialized();
    return this.hiddenMembers.has(userId);
  }

  public async hideMember(userId: string, idea?: string | null): Promise<HiddenMemberRecord> {
    const normalizedId = this.normalizeUserId(userId);
    if (!normalizedId) {
      throw new Error('USER_ID_REQUIRED');
    }

    await this.ensureInitialized();

    const sanitizedIdea = this.normalizeIdea(idea);
    const record: HiddenMemberRecord = {
      userId: normalizedId,
      idea: sanitizedIdea,
      hiddenAt: new Date().toISOString(),
    };

    this.hiddenMembers.set(normalizedId, record);
    await this.persist();
    return record;
  }

  public async unhideMember(userId: string): Promise<boolean> {
    const normalizedId = this.normalizeUserId(userId);
    if (!normalizedId) {
      throw new Error('USER_ID_REQUIRED');
    }

    await this.ensureInitialized();

    const existed = this.hiddenMembers.delete(normalizedId);
    if (existed) {
      await this.persist();
    }

    return existed;
  }

  private normalizeIdea(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeUserId(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.initializing) {
      this.initializing = this.loadFromDisk();
    }
    await this.initializing;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      await fs.mkdir(this.storageDirectory, { recursive: true });
    } catch (error) {
      console.warn('AdminService: unable to ensure storage directory', error);
    }

    try {
      const raw = await fs.readFile(this.hiddenMembersFilePath, 'utf8');
      const parsed = JSON.parse(raw) as HiddenMemberRecord[];
      if (Array.isArray(parsed)) {
        this.hiddenMembers = new Map(
          parsed
            .map((entry) => ({
              ...entry,
              userId: this.normalizeUserId(entry?.userId) ?? '',
              idea: this.normalizeIdea(entry?.idea ?? null),
              hiddenAt: typeof entry?.hiddenAt === 'string' ? entry.hiddenAt : new Date().toISOString(),
            }))
            .filter((entry) => entry.userId.length > 0)
            .map((entry) => [entry.userId, entry]),
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn('AdminService: failed to read hidden member registry', error);
      }
      this.hiddenMembers = new Map();
    } finally {
      this.initialized = true;
      this.initializing = null;
    }
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(await this.listHiddenMembers(), null, 2);
    await fs.writeFile(this.hiddenMembersFilePath, `${payload}\n`, 'utf8');
  }
}
