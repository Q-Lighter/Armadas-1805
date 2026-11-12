# Project rules

Read this file at the start of every prompt, then follow it for the whole session.

## Code layout

- The game rules live in `shared/` as plain TypeScript. The client and server are thin layers around them.

## Authority

- The server runs the real game world. The client only displays it and sends orders. The client must never be trusted with hidden information.

## Style

- Every screen uses the single shared style sheet `client/paper.css`, described in `docs/STYLE.md`. Never add a second theme.

## Numbers

- Every tuning number goes in `shared/settings.ts`. Never hard-code a number that a designer might want to change.

## Cost

- Everything must be free to run with no credit card.

## Devices

- The game must run in a browser on a phone, a Chromebook and a PC, and resize without looking broken.

## Temporary load test

- The built-in load-test mode (`bots=` and all `TEMP-DEBUG` bot code) is
  temporary and must never be reachable outside a room whose code starts
  `dev-`. Remove the mode before release.

## Combat and damage

- Every ship has six 0-100% areas: hull, sails, masts, rudder, guns and
  crew. Hull has the ship's hull points; sails, masts, rudder and guns have
  30%, 40%, 20% and 30% of those points; crew is the living count.
- A landed pound removes that many points from the area it hits. Crew lose
  one sailor per 10 lb. Clamp every area at zero. At 0% hull the ship sinks.
- Effective sail is `sails% x masts% / 100`. Speed scales with it. With no
  effective sail a ship drifts downwind at 10% of wind speed. Turn rate
  scales with rudder; with no rudder it turns at 10% of normal towards
  downwind. Below 10% crew a ship stops and cannot fight.
- Reload time is the ship-table reload multiplied by the crew reload factor
  (x1 at 100% crew, x3 at 10%, straight line) and the later crew-skill
  factor. One game minute of battle lasts one real second.
- Broadside guns bear within 30 degrees of side-on; bow and stern guns
  within 30 degrees of the centreline. There is no fire in the gaps.
  Hit chance is 50% under 300 m, 30% from 300-600 m and 12% from 600 m to
  1 km. The upwind ship multiplies its chance by 1.1.
- Light guns do half damage to BIG ships (flagship, line); heavy guns do
  1.5 times to SMALL ships (raider, escort, fire ship). Each landed gun
  chooses an area from the Sink or Capture weights. Round shot hits hull,
  guns and rudder; chain doubles sails and masts; grape doubles crew only
  inside 300 m, otherwise round shot is used.
- One full broadside uses `broadside lb / 2,000` tonnes of ammunition;
  partial fire uses the matching share. No ammunition means no fire.
- The four battle orders are Capture, Sink, Run and Surrender. Capture and
  Sink are the objective of an Engage order; switching them keeps the same
  target, reload state and position and only changes the aimed areas. With
  no target, choosing one engages the ship that most recently fired on it,
  or else the nearest visible enemy within 3 km; otherwise nothing happens
  and the player is told "No enemy in sight". Orders are per ship; a fleet
  order applies Capture, Sink or Run to every member. Surrender is always
  per ship, never a fleet order.
- Run uses the normal sailing rules: it steers away from the weighted
  nearest known enemies, re-steers every 2 real seconds, and follows the
  coast when land blocks the way. A running ship still fires any gun group
  that bears and may repair after the usual 30 seconds out of combat. It
  escapes after 60 real seconds out of every pursuer's sight, then holds
  position (or starts queued orders) and is told "Escaped". A new order
  cancels the run. A ship below 10% crew cannot run.
- Surrender is the player's choice and is confirmed first. The ship stops,
  stops firing, flies a white flag and cannot fire until the flag is
  accepted or taken down. The owner may cancel at any time before an
  enemy accepts. A player who can see the flag and has a ship within 1 km
  may accept; ships already attacking keep attacking until they do. On
  acceptance the ship changes owner and navy, keeps class, name, damage,
  cargo, ammunition and upgrades, leaves its fleet and control group, and
  holds position unfleeted; all attackers' Engage orders against it end.
  Acceptance is refused if it would exceed 30 ships. A surrendered
  flagship only records a "flagship lost" event for a later prompt.
- Stances now act: fight-if-attacked (the default) answers the ship that
  fired on it and stays within 1.5 km; engage-anything seeks any visible
  enemy within 3 km; avoid-combat runs when fired at; stealth never starts
  a fight or answers fire on its own.
- A battle zone is a group of ships within 1.5 km of an enemy that is
  engaging them or being engaged. Players who can see a battle zone get
  its world updates at 10 a second instead of 5; everything elsewhere
  stays at 5. The client smooths between updates.
- Draft class durability multiplies all damage taken: raider x1.75 and
  flagship x0.55, with the other classes at x1. This is a duel-length
  tuning number, not an agreed ship-table value.
- Repairs work on the most damaged area first, at the table rates per game
  hour multiplied by crew%. A full 0-100 repair of all five non-crew areas
  uses half the repair-material capacity, shared by damage points. Crew
  cannot be repaired. No repairs until 30 real seconds after the last shot.
  A drifting ship with no repair materials loses 0.2% hull per game hour.

## Ways of working

- Each prompt is one job and must finish inside one session. At the end of every prompt: test what you built, commit, push to `main`, and report back.
- Write short, clear code with comments in plain English.
- The debug view (TEMP-DEBUG) is temporary and must be removed before release.
