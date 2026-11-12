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
- Crew may move between two of the same player's ships within 300 m. The
  donor keeps at least 10% and the receiver never exceeds full crew. Transfer
  is instant until the design says otherwise.
- A ship that has had at least 10% crew and then falls below it is ABANDONED.
  It has no owner, leaves its fleet, control group and 30-ship count, cannot
  sail or fire, drifts at the sailless rate, and keeps its damage, cargo,
  ammunition and upgrades. It loses 1.5% of hull per game hour until claimed
  or sunk. A ship that never had the minimum (a new purchase, or a prize with
  no crew) is NOT abandoned; it stays owned and shows "needs crew".
- Any player, including the former owner, may claim an abandoned ship by
  moving crew from a ship within 300 m to bring it back to at least 10%. The
  first success wins: ownership and navy colours change, the name and all
  damage stay, and decay stops. A claim is refused at 30 ships. Enemy ships
  may still fire on an abandoned ship.
- Boarding strength is crew x quality (1.0) x morale (1.0) x crew health
  (1.0). Attacker odds are A^2 / (A^2 + D^2), rounded to 5% for the player.
  Very rough seas make boarding impossible through a weather hook.
- The Board order sails alongside within 60 m and matches speed within 3
  knots, then grapples for 60-120 real seconds (90 default). The two ships
  drift together, cannot sail away and do not fire at each other; other ships
  may still fire on them. A side three times stronger wins at once. Surrendered
  ships use Accept and abandoned ships use Claim, never Board.
- The winner is decided from the odds and seed at the start. The loser loses
  80% of its surviving crew. The winner loses 40% times closeness, where
  closeness is the loser's strength divided by the winner's, capped at 1.
  If the attacker wins, the ship is captured like an accepted surrender and
  its survivors become captured crew. If the defender wins, the attacker
  keeps its ship and its losses.
- Auto-board is on by default per ship and fleet. It starts a Board order
  only with a Capture objective, odds of at least 50%, and a target whose
  crew is below 50% or whose sails and masts are both below 20%. Below 50%
  odds the player must order boarding. A ship cannot refuse being boarded.
- On a boarding win or accepted surrender the captured crew are chosen once:
  Join (stay as the prize's crew), Kill (the prize then needs crew), or Take
  prisoners (at most 20% of the prize's full crew; overflow must join or be
  killed). If nobody chooses within 120 real seconds they Join. Prisoners stay
  aboard, eat half a crewman's provisions, cannot rebel, and are lost if the
  ship sinks. A usable port pays 20 pieces for each prisoner handed over.
- Each landed hit has a 1 in 40 chance to start a fire, or adds 10 to an
  existing fire. Fire strength runs 0-100, starts at 20 and grows 0.5 a second.
  It removes strength x 0.005% of hull and strength x 0.003% of full crew each
  second. Fighting it removes 1.5 x crew% / 100 a second, uses 0.01 t of repair
  materials a second, and pauses normal repairs; with no materials it works at
  30%. At zero the fire is out. A burning ship may ignite any ship within
  100 m, including friends: chance a second is 0.01 x strength / 100, x2.5
  downwind within 45 degrees and x0.3 upwind. Burning ships do not re-ignite.
- A ship under 15% hull may explode, 4% per real minute checked each second.
  It is destroyed with all hands. Ships within 100 m lose 5% hull and 5% crew.
- A missed shot has a 5% chance to hit the nearest friendly ship within 100 m
  behind the target and inside a 12 degree cone. Friendly means the same
  player or navy; the Phase 4 allies list is empty for now. Surrendered and
  abandoned ships are not friendly. It is an ordinary hit with normal
  ammunition, fire and sinking. Attacks on friends cannot be ordered. A
  flagship sunk this way only records the "flagship lost" event for 3E.
- At 0% hull a ship sinks for 20 real seconds. It cannot act, be boarded or
  claimed, and its cargo, ammunition, crew and prisoners are lost. The "ship
  sunk" event is sent when sinking starts, then the ship is removed.

## Ways of working

- Each prompt is one job and must finish inside one session. At the end of every prompt: test what you built, commit, push to `main`, and report back.
- Write short, clear code with comments in plain English.
- The debug view (TEMP-DEBUG) is temporary and must be removed before release.
