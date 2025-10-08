declare module 'marked' {
  export const marked: {
    parse: (markdown: string, options?: unknown) => string;
  };
}

declare module 'openai' {
  export default class OpenAI {
    constructor(config?: unknown);
    responses: {
      create: (...args: unknown[]) => Promise<any>;
    };
    images: {
      generate: (...args: unknown[]) => Promise<any>;
    };
  }
}

declare module 'helmet' {
  import type { RequestHandler } from 'express';

  interface HelmetOptions {
    contentSecurityPolicy?: false | Record<string, unknown>;
    crossOriginEmbedderPolicy?: boolean;
    referrerPolicy?: { policy?: string | string[] };
    xContentTypeOptions?: boolean;
    [key: string]: unknown;
  }

  function helmet(options?: HelmetOptions): RequestHandler;
  export default helmet;
}

declare module 'express-minify-html-terser' {
  import type { RequestHandler } from 'express';

  interface MinifyHTMLOptions {
    override?: boolean;
    exception_url?: string[] | string | RegExp;
    htmlMinifier?: Record<string, unknown>;
    [key: string]: unknown;
  }

  function minifyHTML(options?: MinifyHTMLOptions): RequestHandler;
  export default minifyHTML;
}
