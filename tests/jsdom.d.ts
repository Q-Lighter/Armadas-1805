declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    window: any;
  }
  export class VirtualConsole {
    sendTo(console: Console): void;
  }
}
