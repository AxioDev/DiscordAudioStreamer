import fs from 'fs';
import path from 'path';

export default class SitemapLastModStore {
  private readonly filePath: string;

  private readonly entries = new Map<string, string>();

  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.loadFromDisk();
  }

  public get(pathKey: string): string | null {
    return this.entries.get(pathKey) ?? null;
  }

  public update(pathKey: string, isoTimestamp: string): void {
    if (!isoTimestamp) {
      return;
    }

    const normalized = new Date(isoTimestamp);
    if (Number.isNaN(normalized.getTime())) {
      return;
    }

    const value = normalized.toISOString();
    const current = this.entries.get(pathKey);
    if (current === value) {
      return;
    }

    this.entries.set(pathKey, value);
    this.dirty = true;
  }

  public async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    const directory = path.dirname(this.filePath);
    try {
      await fs.promises.mkdir(directory, { recursive: true });
      const snapshot = Object.fromEntries(this.entries);
      await fs.promises.writeFile(this.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      this.dirty = false;
    } catch (error) {
      console.warn('Failed to persist sitemap lastmod snapshot', error);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw) {
        return;
      }
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [pathKey, iso] of Object.entries(data)) {
        if (typeof iso !== 'string') {
          continue;
        }
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime())) {
          continue;
        }
        this.entries.set(pathKey, parsed.toISOString());
      }
    } catch (error) {
      console.warn('Failed to load sitemap lastmod snapshot', error);
    }
  }
}
