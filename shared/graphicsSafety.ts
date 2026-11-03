// Graphics-context recovery bookkeeping. The Pixi event handlers use this;
// keeping the timing rules pure makes them testable without a browser.

import { settings } from "./settings.js";

export const GRAPHICS_RESET_NOTICE = "Graphics reset";
export const GRAPHICS_RELOAD_NOTICE = "Graphics keep failing. Tap to reload.";

export interface GraphicsLossResult {
  message: string;
  reload: boolean;
  losses: number;
  resets: number;
}

export class GraphicsRecovery {
  private losses: number[] = [];
  private resets = 0;
  private needsReload = false;

  lost(at: number): GraphicsLossResult {
    const windowMs = settings.client.graphicsFailureWindowMs;
    this.losses = this.losses.filter((time) => at - time < windowMs);
    this.losses.push(at);
    const reload = this.losses.length >= settings.client.graphicsFailureLimit;
    if (reload) this.needsReload = true;
    return {
      message: reload ? GRAPHICS_RELOAD_NOTICE : GRAPHICS_RESET_NOTICE,
      reload,
      losses: this.losses.length,
      resets: this.resets,
    };
  }

  restored(): void {
    this.resets += 1;
  }

  get resetCount(): number {
    return this.resets;
  }

  get reloadRequired(): boolean {
    return this.needsReload;
  }
}
