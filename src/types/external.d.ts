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
