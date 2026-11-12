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
- Repairs work on the most damaged area first, at the table rates per game
  hour multiplied by crew%. A full 0-100 repair of all five non-crew areas
  uses half the repair-material capacity, shared by damage points. Crew
  cannot be repaired. No repairs until 30 real seconds after the last shot.
  A drifting ship with no repair materials loses 0.2% hull per game hour.

## Ways of working

- Each prompt is one job and must finish inside one session. At the end of every prompt: test what you built, commit, push to `main`, and report back.
- Write short, clear code with comments in plain English.
- The debug view (TEMP-DEBUG) is temporary and must be removed before release.
