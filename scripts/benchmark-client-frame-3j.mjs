// Local Node proxy for the 3J-fix-b client frame budget. Uses the real render
// plan, fire plan and state-delta update; only the Pixi drawing calls are
// replaced by a counter because Node has no canvas. Not browser GPU time.

import { buildShipRenderPlan } from "@naval/shared/render-plan";
import { selectVisibleEffects } from "@naval/shared/effect-budget";
import { settings } from "@naval/shared/settings";
import { buildStateDelta, encodeStateDelta, applyStateDelta } from "@naval/shared/state-delta";
import { addPlayer, createWorld, stepWorld, visibleStateFor } from "@naval/shared/world";

const world = createWorld("dev-client-frame");
const player = addPlayer(world, "frame", "frigate", 50_000, "British");
const ships = [];
for (let index = 0; index < 20; index += 1) {
  const ship = {
    id: `fx-${index}`,
    classId: "frigate",
    x: player.x + (index - 10) * 0.08,
    y: player.y + 0.2,
    headingRad: Math.PI / 2,
    speedKnots: 6,
    navy: "French",
  };
  ships.push(ship);
}
const effects = Array.from({ length: settings.client.maxLiveEffects }, (_, index) => ({
  id: index,
  x: player.x + (index % 20) * 0.08,
  y: player.y + 0.2,
  at: 0,
  kind: index % 3 === 0 ? "fire" : index % 3 === 1 ? "splash" : "smoke",
}));
let base = visibleStateFor(world, "frame");
base.seq = 1;
let bytes = 0;
let frames = 0;
let drawn = 0;
const started = process.hrtime.bigint();
for (let frame = 0; frame < 600; frame += 1) {
  if (frame % 2 === 0) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
    const current = visibleStateFor(world, "frame");
    current.seq = base.seq + 1;
    const delta = buildStateDelta(base, current, current.seq, frame % 4 === 0);
    bytes += encodeStateDelta(delta).byteLength;
    base = applyStateDelta(base, delta);
    base.full = false;
  }
  const visible = selectVisibleEffects(
    effects,
    (effect) => effect.x > player.x - 2 && effect.x < player.x + 2,
    settings.client.maxLiveEffects,
  );
  const plan = buildShipRenderPlan({
    width: 1280,
    height: 800,
    view: { x: player.x, y: player.y, kmAcross: 5 },
    blocks: [],
    all: true,
    discovered: new Set(),
    sight: [{ x: player.x, y: player.y, radiusKm: 25 }],
    ships,
    fires: visible.slice(0, 20).map((effect) => ({
      id: String(effect.id),
      x: effect.x,
      y: effect.y,
      headingRad: 0,
      strength: 20,
    })),
    timeMs: frame * 16.67,
  });
  // Stub the drawing layer: count the commands Pixi would receive.
  for (const layer of plan.layers) drawn += layer.visible ? layer.items : 0;
  drawn += plan.fires.length + visible.length;
  frames += 1;
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
console.log("SYNTHETIC CLIENT FRAME (render plan + state update, draw stubbed)");
console.log({
  frames,
  ships: ships.length,
  firingShips: 20,
  msPerFrame: Number((elapsedMs / frames).toFixed(3)),
  targetMsPerFrame: 4,
  deltaBytesPerFrame: Math.round(bytes / frames),
  drawnCommands: drawn,
});
