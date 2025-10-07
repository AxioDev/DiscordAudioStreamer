import fs from 'fs';

export interface SeoImageDescriptor {
  url: string;
  alt?: string;
  type?: string;
  width?: number;
  height?: number;
}

export interface SeoAlternateLanguage {
  locale: string;
  url?: string;
}

export interface SeoBreadcrumbItem {
  name: string;
  path: string;
}

export interface SeoArticleMetadata {
  publishedTime?: string | null;
  modifiedTime?: string | null;
  section?: string | null;
  tags?: string[];
}

export interface SeoProfileMetadata {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface SeoPageMetadata {
  title: string;
  description: string;
  path: string;
  canonicalUrl?: string;
  robots?: string;
  keywords?: string[];
  openGraphType?: string;
  locale?: string;
  language?: string;
  alternateLocales?: string[];
  alternateLanguages?: SeoAlternateLanguage[];
  images?: SeoImageDescriptor[];
  twitterCard?: string;
  twitterSite?: string;
  twitterCreator?: string;
  authorName?: string;
  publisherName?: string;
  structuredData?: unknown[];
  breadcrumbs?: SeoBreadcrumbItem[];
  additionalMeta?: Array<{ name?: string; property?: string; content: string }>;
  article?: SeoArticleMetadata;
  profile?: SeoProfileMetadata;
}

export interface AssetScriptDescriptor {
  src: string;
  type?: string;
  integrity?: string;
  crossorigin?: string;
  defer?: boolean;
  async?: boolean;
}

export interface AssetStyleDescriptor {
  href: string;
  rel?: string;
  media?: string;
  integrity?: string;
  crossorigin?: string;
}

export interface AssetPreloadDescriptor {
  href: string;
  rel?: string;
  as: string;
  type?: string;
  crossorigin?: string;
  media?: string;
}

export interface AssetManifest {
  scripts?: AssetScriptDescriptor[] | null;
  styles?: AssetStyleDescriptor[] | null;
  preloads?: AssetPreloadDescriptor[] | null;
}

export interface SeoRendererOptions {
  templatePath: string;
  baseUrl: string;
  siteName: string;
  defaultLocale: string;
  defaultLanguage: string;
  defaultRobots?: string;
  defaultTwitterSite?: string | null;
  defaultTwitterCreator?: string | null;
  defaultImages: SeoImageDescriptor[];
  defaultStructuredData?: unknown[];
}

export interface RenderOptions {
  appHtml?: string | null;
  preloadState?: unknown;
}

export default class SeoRenderer {
  private readonly templatePrefix: string;

  private readonly templateSuffix: string;

  private readonly baseUrl: string;

  private readonly siteName: string;

  private readonly defaultLocale: string;

  private readonly defaultLanguage: string;

  private readonly defaultRobots: string;

  private readonly defaultTwitterSite: string | null;

  private readonly defaultTwitterCreator: string | null;

  private readonly defaultImages: SeoImageDescriptor[];

  private readonly defaultStructuredData: unknown[];

  private assetManifest: AssetManifest | null = null;

  constructor({
    templatePath,
    baseUrl,
    siteName,
    defaultLocale,
    defaultLanguage,
    defaultRobots = 'index,follow',
    defaultTwitterSite = null,
    defaultTwitterCreator = null,
    defaultImages,
    defaultStructuredData = [],
  }: SeoRendererOptions) {
    const template = fs.readFileSync(templatePath, 'utf8');
    const startMarker = '<!--SEO_HEAD_START-->';
    const endMarker = '<!--SEO_HEAD_END-->';

    const startIndex = template.indexOf(startMarker);
    const endIndex = template.indexOf(endMarker);
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      throw new Error('SEO head markers are missing from the HTML template.');
    }

    this.templatePrefix = template.slice(0, startIndex + startMarker.length);
    this.templateSuffix = template.slice(endIndex);
    this.baseUrl = this.normalizeBaseUrl(baseUrl);
    this.siteName = siteName;
    this.defaultLocale = defaultLocale;
    this.defaultLanguage = defaultLanguage;
    this.defaultRobots = defaultRobots;
    this.defaultTwitterSite = defaultTwitterSite;
    this.defaultTwitterCreator = defaultTwitterCreator;
    this.defaultImages = defaultImages;
    this.defaultStructuredData = Array.isArray(defaultStructuredData)
      ? defaultStructuredData
      : [];
  }

  public updateAssetManifest(manifest: AssetManifest | null): void {
    const normalized = this.normalizeAssetManifest(manifest);
    if (normalized && this.hasUsableAssets(normalized)) {
      this.assetManifest = normalized;
      return;
    }

    this.assetManifest = this.normalizeAssetManifest(this.buildFallbackAssetManifest());
  }

  public render(metadata: SeoPageMetadata, options: RenderOptions = {}): string {
    const title = metadata.title.trim();
    const description = metadata.description.trim();
    const canonicalUrl = this.normalizeUrl(metadata.canonicalUrl ?? metadata.path);
    const robots = (metadata.robots ?? this.defaultRobots).trim();
    const keywords = Array.from(
      new Set(
        (metadata.keywords ?? [])
          .map((keyword) => (typeof keyword === 'string' ? keyword.trim() : ''))
          .filter((keyword) => keyword.length > 0),
      ),
    );

    const ogLocale = metadata.locale ?? this.defaultLocale;
    const language = metadata.language ?? this.defaultLanguage;
    const alternateLocales = Array.from(
      new Set((metadata.alternateLocales ?? []).filter((locale) => typeof locale === 'string' && locale.trim())),
    );
    const alternateLanguages = this.buildAlternateLanguages(
      language,
      canonicalUrl,
      metadata.alternateLanguages ?? [],
    );

    const images = this.resolveImages(metadata.images);
    const twitterCard = metadata.twitterCard ?? (images.length > 0 ? 'summary_large_image' : 'summary');
    const twitterSite = metadata.twitterSite ?? this.defaultTwitterSite;
    const twitterCreator = metadata.twitterCreator ?? this.defaultTwitterCreator ?? twitterSite;
    const authorName = metadata.authorName ?? this.siteName;
    const publisherName = metadata.publisherName ?? this.siteName;

    const baseStructuredData = this.buildBaseStructuredData({
      title,
      description,
      canonicalUrl,
      language,
      keywords,
    });

    const structuredData = [
      ...this.defaultStructuredData,
      ...baseStructuredData,
      ...(metadata.structuredData ?? []),
    ];

    if (metadata.breadcrumbs && metadata.breadcrumbs.length > 0) {
      structuredData.push(this.buildBreadcrumbStructuredData(metadata.breadcrumbs));
    }

    const lines: string[] = [];
    lines.push('    <title>' + this.escapeHtml(title) + '</title>');
    lines.push('    <meta name="description" content="' + this.escapeHtml(description) + '" />');
    lines.push('    <meta name="robots" content="' + this.escapeHtml(robots) + '" />');
    lines.push('    <meta name="googlebot" content="' + this.escapeHtml(robots) + '" />');
    lines.push('    <meta name="bingbot" content="' + this.escapeHtml(robots) + '" />');
    lines.push('    <meta name="author" content="' + this.escapeHtml(authorName) + '" />');
    lines.push('    <meta name="publisher" content="' + this.escapeHtml(publisherName) + '" />');
    lines.push('    <link rel="canonical" href="' + this.escapeHtml(canonicalUrl) + '" />');
    for (const alternate of alternateLanguages) {
      lines.push(
        '    <link rel="alternate" href="' +
          this.escapeHtml(alternate.url) +
          '" hreflang="' +
          this.escapeHtml(alternate.locale) +
          '" />',
      );
    }

    lines.push('    <meta property="og:type" content="' + this.escapeHtml(metadata.openGraphType ?? 'website') + '" />');
    lines.push('    <meta property="og:site_name" content="' + this.escapeHtml(this.siteName) + '" />');
    lines.push('    <meta property="og:locale" content="' + this.escapeHtml(ogLocale) + '" />');
    for (const altLocale of alternateLocales) {
      lines.push('    <meta property="og:locale:alternate" content="' + this.escapeHtml(altLocale) + '" />');
    }
    lines.push('    <meta property="og:url" content="' + this.escapeHtml(canonicalUrl) + '" />');
    lines.push('    <meta property="og:title" content="' + this.escapeHtml(title) + '" />');
    lines.push('    <meta property="og:description" content="' + this.escapeHtml(description) + '" />');
    for (const image of images) {
      lines.push('    <meta property="og:image" content="' + this.escapeHtml(image.url) + '" />');
      lines.push('    <meta property="og:image:secure_url" content="' + this.escapeHtml(image.url) + '" />');
      if (image.alt) {
        lines.push('    <meta property="og:image:alt" content="' + this.escapeHtml(image.alt) + '" />');
      }
      if (typeof image.type === 'string' && image.type.trim().length > 0) {
        lines.push('    <meta property="og:image:type" content="' + this.escapeHtml(image.type) + '" />');
      }
      if (typeof image.width === 'number' && Number.isFinite(image.width)) {
        lines.push('    <meta property="og:image:width" content="' + String(Math.floor(image.width)) + '" />');
      }
      if (typeof image.height === 'number' && Number.isFinite(image.height)) {
        lines.push('    <meta property="og:image:height" content="' + String(Math.floor(image.height)) + '" />');
      }
    }

    lines.push('    <meta name="twitter:card" content="' + this.escapeHtml(twitterCard) + '" />');
    if (twitterSite) {
      lines.push('    <meta name="twitter:site" content="' + this.escapeHtml(twitterSite) + '" />');
    }
    if (twitterCreator) {
      lines.push('    <meta name="twitter:creator" content="' + this.escapeHtml(twitterCreator) + '" />');
    }
    lines.push('    <meta name="twitter:title" content="' + this.escapeHtml(title) + '" />');
    lines.push('    <meta name="twitter:description" content="' + this.escapeHtml(description) + '" />');
    if (images.length > 0) {
      const [firstImage] = images;
      lines.push('    <meta name="twitter:image" content="' + this.escapeHtml(firstImage.url) + '" />');
      if (firstImage.alt) {
        lines.push('    <meta name="twitter:image:alt" content="' + this.escapeHtml(firstImage.alt) + '" />');
      }
    }

    if (metadata.article) {
      const { publishedTime, modifiedTime, section, tags } = metadata.article;
      if (publishedTime) {
        lines.push('    <meta property="article:published_time" content="' + this.escapeHtml(publishedTime) + '" />');
      }
      if (modifiedTime) {
        lines.push('    <meta property="article:modified_time" content="' + this.escapeHtml(modifiedTime) + '" />');
      }
      if (section) {
        lines.push('    <meta property="article:section" content="' + this.escapeHtml(section) + '" />');
      }
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (typeof tag === 'string' && tag.trim().length > 0) {
            lines.push('    <meta property="article:tag" content="' + this.escapeHtml(tag.trim()) + '" />');
          }
        }
      }
    }

    if (metadata.profile) {
      const { username, firstName, lastName } = metadata.profile;
      if (username) {
        lines.push('    <meta property="profile:username" content="' + this.escapeHtml(username) + '" />');
      }
      if (firstName) {
        lines.push('    <meta property="profile:first_name" content="' + this.escapeHtml(firstName) + '" />');
      }
      if (lastName) {
        lines.push('    <meta property="profile:last_name" content="' + this.escapeHtml(lastName) + '" />');
      }
    }

    if (Array.isArray(metadata.additionalMeta)) {
      for (const entry of metadata.additionalMeta) {
        if (!entry || typeof entry.content !== 'string') {
          continue;
        }
        if (typeof entry.name === 'string' && entry.name.trim().length > 0) {
          lines.push(
            '    <meta name="' +
              this.escapeHtml(entry.name.trim()) +
              '" content="' +
              this.escapeHtml(entry.content) +
              '" />',
          );
          continue;
        }
        if (typeof entry.property === 'string' && entry.property.trim().length > 0) {
          lines.push(
            '    <meta property="' +
              this.escapeHtml(entry.property.trim()) +
              '" content="' +
              this.escapeHtml(entry.content) +
              '" />',
          );
        }
      }
    }

    for (const item of structuredData) {
      if (!item) {
        continue;
      }
      const json = JSON.stringify(item, null, 2)?.replace(/</g, '\\u003C');
      if (!json) {
        continue;
      }
      lines.push('    <script type="application/ld+json">');
      lines.push(json);
      lines.push('    </script>');
    }

    const headContent = lines.join('\n');
    const suffix = this.injectAppShell(this.templateSuffix, options);
    return `${this.templatePrefix}\n${headContent}\n${suffix}`;
  }

  private injectAppShell(template: string, options: RenderOptions): string {
    const appPlaceholder = '<!--APP_HTML-->';
    const statePlaceholder = '<!--APP_STATE-->';
    const stylesPlaceholder = '<!--ASSET_STYLES-->';
    const scriptsPlaceholder = '<!--ASSET_SCRIPTS-->';
    const preloadPlaceholder = '<!--ASSET_PRELOADS-->';

    let result = template;

    if (result.includes(appPlaceholder)) {
      const appHtml = typeof options.appHtml === 'string' ? options.appHtml : '';
      result = result.replace(appPlaceholder, appHtml);
    }

    if (result.includes(statePlaceholder)) {
      const stateScript = this.buildStateBootstrap(options.preloadState);
      result = result.replace(statePlaceholder, stateScript);
    }

    if (result.includes(preloadPlaceholder)) {
      const preloadTags = this.buildPreloadTags();
      result = result.replace(preloadPlaceholder, preloadTags);
    }

    if (result.includes(stylesPlaceholder)) {
      const styleTags = this.buildStyleTags();
      result = result.replace(stylesPlaceholder, styleTags);
    }

    if (result.includes(scriptsPlaceholder)) {
      const scriptTags = this.buildScriptTags();
      result = result.replace(scriptsPlaceholder, scriptTags);
    }

    return result;
  }

  private buildStateBootstrap(state: unknown): string {
    if (state === undefined) {
      return '';
    }

    try {
      const json = JSON.stringify(state ?? null)?.replace(/</g, '\\u003C');
      if (!json) {
        return '';
      }
      return `    <script>window.__PRERENDER_STATE__ = ${json};</script>`;
    } catch (error) {
      console.warn('Failed to serialize pre-render state', error);
      return '';
    }
  }

  private buildPreloadTags(): string {
    const manifest = this.assetManifest;
    if (!manifest || !Array.isArray(manifest.preloads) || manifest.preloads.length === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const entry of manifest.preloads) {
      if (!entry || typeof entry.href !== 'string' || typeof entry.as !== 'string') {
        continue;
      }
      const rel = (entry.rel ?? 'preload').trim() || 'preload';
      const attrs: Array<[string, string | true]> = [
        ['rel', rel],
        ['href', entry.href],
        ['as', entry.as],
      ];
      if (entry.type) {
        attrs.push(['type', entry.type]);
      }
      if (entry.crossorigin) {
        attrs.push(['crossorigin', entry.crossorigin]);
      }
      if (entry.media) {
        attrs.push(['media', entry.media]);
      }

      lines.push('    <link ' + this.formatHtmlAttributes(attrs) + ' />');
    }

    return lines.join('\n');
  }

  private buildStyleTags(): string {
    const manifest = this.assetManifest;
    if (!manifest || !Array.isArray(manifest.styles) || manifest.styles.length === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const entry of manifest.styles) {
      if (!entry || typeof entry.href !== 'string') {
        continue;
      }
      const rel = (entry.rel ?? 'stylesheet').trim() || 'stylesheet';
      const attrs: Array<[string, string | true]> = [
        ['rel', rel],
        ['href', entry.href],
      ];
      if (entry.media) {
        attrs.push(['media', entry.media]);
      }
      if (entry.crossorigin) {
        attrs.push(['crossorigin', entry.crossorigin]);
      }
      if (entry.integrity) {
        attrs.push(['integrity', entry.integrity]);
      }
      lines.push('    <link ' + this.formatHtmlAttributes(attrs) + ' />');
    }

    return lines.join('\n');
  }

  private buildScriptTags(): string {
    const manifest = this.assetManifest;
    if (!manifest || !Array.isArray(manifest.scripts) || manifest.scripts.length === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const entry of manifest.scripts) {
      if (!entry || typeof entry.src !== 'string') {
        continue;
      }
      const attrs: Array<[string, string | true]> = [
        ['type', (entry.type ?? 'module').trim() || 'module'],
        ['src', entry.src],
      ];
      if (entry.defer) {
        attrs.push(['defer', true]);
      }
      if (entry.async) {
        attrs.push(['async', true]);
      }
      if (entry.crossorigin) {
        attrs.push(['crossorigin', entry.crossorigin]);
      }
      if (entry.integrity) {
        attrs.push(['integrity', entry.integrity]);
      }
      lines.push('    <script ' + this.formatHtmlAttributes(attrs) + '></script>');
    }

    return lines.join('\n');
  }

  private formatHtmlAttributes(attributes: Array<[string, string | true]>): string {
    return attributes
      .map(([key, value]) => {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          return null;
        }
        if (value === true) {
          return trimmedKey;
        }
        const trimmedValue = typeof value === 'string' ? value.trim() : '';
        if (!trimmedValue) {
          return trimmedKey;
        }
        return `${trimmedKey}="${this.escapeHtml(trimmedValue)}"`;
      })
      .filter((entry): entry is string => Boolean(entry))
      .join(' ');
  }

  private normalizeAssetManifest(manifest: AssetManifest | null): AssetManifest | null {
    if (!manifest || typeof manifest !== 'object') {
      return null;
    }

    const normalizeScripts = (scripts: AssetScriptDescriptor[] | null | undefined): AssetScriptDescriptor[] => {
      if (!Array.isArray(scripts)) {
        return [];
      }
      return scripts
        .filter((entry): entry is AssetScriptDescriptor => Boolean(entry && typeof entry.src === 'string'))
        .map((entry) => ({
          src: entry.src,
          type: entry.type,
          integrity: entry.integrity,
          crossorigin: entry.crossorigin,
          defer: Boolean(entry.defer),
          async: Boolean(entry.async),
        }));
    };

    const normalizeStyles = (styles: AssetStyleDescriptor[] | null | undefined): AssetStyleDescriptor[] => {
      if (!Array.isArray(styles)) {
        return [];
      }
      return styles
        .filter((entry): entry is AssetStyleDescriptor => Boolean(entry && typeof entry.href === 'string'))
        .map((entry) => ({
          href: entry.href,
          rel: entry.rel,
          media: entry.media,
          integrity: entry.integrity,
          crossorigin: entry.crossorigin,
        }));
    };

    const normalizePreloads = (preloads: AssetPreloadDescriptor[] | null | undefined): AssetPreloadDescriptor[] => {
      if (!Array.isArray(preloads)) {
        return [];
      }
      return preloads
        .filter(
          (entry): entry is AssetPreloadDescriptor =>
            Boolean(entry && typeof entry.href === 'string' && typeof entry.as === 'string'),
        )
        .map((entry) => ({
          href: entry.href,
          rel: entry.rel,
          as: entry.as,
          type: entry.type,
          crossorigin: entry.crossorigin,
          media: entry.media,
        }));
    };

    return {
      scripts: normalizeScripts(manifest.scripts),
      styles: normalizeStyles(manifest.styles),
      preloads: normalizePreloads(manifest.preloads),
    };
  }

  private hasUsableAssets(manifest: AssetManifest): boolean {
    const hasScripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0;
    const hasStyles = Array.isArray(manifest.styles) && manifest.styles.length > 0;
    const hasPreloads = Array.isArray(manifest.preloads) && manifest.preloads.length > 0;
    return hasScripts || hasStyles || hasPreloads;
  }

  private buildFallbackAssetManifest(): AssetManifest {
    return {
      scripts: [
        {
          src: '/scripts/main.js',
          type: 'module',
        },
      ],
      styles: [
        {
          href: '/styles/app.css',
          rel: 'stylesheet',
        },
      ],
      preloads: [],
    };
  }

  private buildAlternateLanguages(
    language: string,
    canonicalUrl: string,
    alternates: SeoAlternateLanguage[],
  ): Array<{ locale: string; url: string }> {
    const map = new Map<string, string>();
    const normalizedLanguage = language.trim();
    if (normalizedLanguage.length > 0) {
      map.set(normalizedLanguage, canonicalUrl);
    }
    for (const entry of alternates) {
      if (!entry || typeof entry.locale !== 'string') {
        continue;
      }
      const locale = entry.locale.trim();
      if (!locale) {
        continue;
      }
      const target = this.normalizeUrl(entry.url ?? canonicalUrl);
      map.set(locale, target);
    }
    if (!map.has('x-default')) {
      map.set('x-default', canonicalUrl);
    }
    return Array.from(map.entries()).map(([locale, url]) => ({ locale, url }));
  }

  private buildBaseStructuredData(options: {
    title: string;
    description: string;
    canonicalUrl: string;
    language: string;
    keywords?: string[];
  }): unknown[] {
    const webPage: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: options.title,
      description: options.description,
      url: options.canonicalUrl,
      inLanguage: options.language,
      isPartOf: {
        '@type': 'WebSite',
        name: this.siteName,
        url: this.baseUrl,
      },
    };

    if (Array.isArray(options.keywords) && options.keywords.length > 0) {
      webPage.keywords = options.keywords;
    }

    return [webPage];
  }

  private buildBreadcrumbStructuredData(items: SeoBreadcrumbItem[]): unknown {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items
        .filter((item) => item && typeof item.name === 'string' && typeof item.path === 'string')
        .map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: this.normalizeUrl(item.path),
        })),
    };
  }

  private resolveImages(candidateImages?: SeoImageDescriptor[]): SeoImageDescriptor[] {
    const source = Array.isArray(candidateImages) && candidateImages.length > 0
      ? candidateImages
      : this.defaultImages;
    return source
      .map((image) => ({
        ...image,
        url: this.normalizeUrl(image.url),
      }))
      .filter((image) => typeof image.url === 'string' && image.url.length > 0);
  }

  private normalizeUrl(pathOrUrl: string): string {
    if (typeof pathOrUrl !== 'string' || pathOrUrl.trim().length === 0) {
      return this.baseUrl;
    }
    const trimmed = pathOrUrl.trim();
    try {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
        return new URL(trimmed).toString();
      }
    } catch (error) {
      // Ignore and fall back to relative resolution.
    }
    try {
      return new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, this.baseUrl).toString();
    } catch (error) {
      return this.baseUrl;
    }
  }

  private normalizeBaseUrl(baseUrl: string): string {
    try {
      const normalized = new URL(baseUrl);
      return normalized.toString();
    } catch (error) {
      return 'https://libre-antenne.xyz/';
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
