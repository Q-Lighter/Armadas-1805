// Recording stand-in for PixiJS in the real-client jsdom harness.
// It keeps the display tree, positions and drawing commands so the test can
// read exactly what the client would have drawn without a WebGL context.

class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x = 0, y = 0) { this.x = x; this.y = y; return this; }
  copyFrom(p) { this.x = p.x; this.y = p.y; return this; }
  clone() { return new Point(this.x, this.y); }
}

class DisplayObject {
  constructor() {
    this.children = [];
    this.parent = null;
    this.position = new Point();
    this.scale = new Point(1, 1);
    this.anchor = new Point();
    this.pivot = new Point();
    this.rotation = 0;
    this.alpha = 1;
    this.visible = true;
    this.renderable = true;
    this.zIndex = 0;
    this.name = "";
    this.filters = null;
    this.mask = null;
    this.eventMode = "auto";
    this.cursor = "auto";
    this.hitArea = null;
    this.texture = Texture.WHITE;
    this.width = 0;
    this.height = 0;
    this.tint = 0xffffff;
    this.blendMode = "normal";
  }
  addChild(...children) {
    for (const child of children) {
      if (!child) continue;
      if (child.parent && child.parent !== this) child.removeFromParent();
      child.parent = this;
      this.children.push(child);
    }
    return children[0] ?? this;
  }
  addChildAt(child, index) {
    child.parent = this;
    this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    return child;
  }
  removeChildren() {
    const old = this.children;
    this.children = [];
    for (const child of old) child.parent = null;
    return old;
  }
  removeFromParent() {
    if (this.parent) this.parent.removeChild(this);
    return this;
  }
  destroy(options) {
    this.removeFromParent();
    if (options?.children) for (const child of this.children) child.destroy(options);
    this.destroyed = true;
  }
  on() { return this; }
  off() { return this; }
  once() { return this; }
  emit() { return false; }
  setParent(parent) { this.parent = parent; return this; }
  getGlobalPosition() { return this.position; }
  getBounds() { return { x: this.position.x, y: this.position.y, width: this.width, height: this.height }; }
}

class Container extends DisplayObject {
  constructor() { super(); this.sortableChildren = false; }
  updateTransform() {}
}

class Graphics extends Container {
  constructor() {
    super();
    this.commands = [];
    this.geometry = { graphicsData: [] };
    this.bounds = null;
  }
  _record(kind, args) { this.commands.push({ kind, args, at: Date.now() }); return this; }
  clear() { this.commands = []; return this; }
  moveTo(...a) { return this._record("moveTo", a); }
  lineTo(...a) { return this._record("lineTo", a); }
  closePath() { return this._record("closePath", []); }
  rect(...a) { return this._record("rect", a); }
  roundRect(...a) { return this._record("roundRect", a); }
  circle(...a) { return this._record("circle", a); }
  ellipse(...a) { return this._record("ellipse", a); }
  poly(...a) { return this._record("poly", a); }
  arc(...a) { return this._record("arc", a); }
  fill(...a) { return this._record("fill", a); }
  stroke(...a) { return this._record("stroke", a); }
  beginFill(...a) { return this._record("beginFill", a); }
  endFill(...a) { return this._record("endFill", a); }
  lineStyle(...a) { return this._record("lineStyle", a); }
  drawCircle(...a) { return this._record("drawCircle", a); }
  drawRect(...a) { return this._record("drawRect", a); }
}

class Sprite extends DisplayObject {
  constructor(texture = Texture.WHITE) {
    super();
    this.texture = texture;
    this.anchor = new Point(0.5, 0.5);
    this.width = 1;
    this.height = 1;
  }
  setTexture(texture) { this.texture = texture; return this; }
}

class Text extends DisplayObject {
  constructor(options = {}) {
    super();
    this.text = typeof options === "string" ? options : options.text ?? "";
    this.style = options.style ?? {};
    this.anchor = new Point(0, 0);
    this.resolution = 1;
  }
}

const Texture = {
  WHITE: { width: 1, height: 1, source: { scaleMode: "nearest" } },
  EMPTY: { width: 0, height: 0 },
  from() { return this.WHITE; },
};
class RenderTexture {
  static create() { return { width: 1, height: 1, source: { scaleMode: "nearest" }, destroy() {} }; }
  static from() { return RenderTexture.create(); }
}

export const tickerCallbacks = [];
class Ticker {
  constructor() { this.deltaMS = 1000 / 60; this.deltaTime = this.deltaMS; }
  add(callback) { tickerCallbacks.push(callback); return callback; }
  remove(callback) { const i = tickerCallbacks.indexOf(callback); if (i >= 0) tickerCallbacks.splice(i, 1); }
  start() {}
  stop() {}
}

class Application {
  constructor() {
    this.stage = new Container();
    this.screen = { width: 1280, height: 800 };
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1280;
    this.canvas.height = 800;
    this.canvas.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800,
    });
    this.renderer = {
      resolution: 1,
      width: 1280,
      height: 800,
      resize: (width, height, resolution) => {
        this.screen.width = width;
        this.screen.height = height;
        if (typeof resolution === "number") this.renderer.resolution = resolution;
      },
      generateTexture: () => RenderTexture.create(),
      render: () => {},
    };
    this.ticker = new Ticker();
    this.renderer.plugins = {};
    globalThis.__pixiApp = this;
    globalThis.__pixiTickerCallbacks = tickerCallbacks;
  }
  async init() { return this; }
  destroy() {}
}

export { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture, Point };
export default { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture, Point };
