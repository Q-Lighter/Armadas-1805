# Project rules

Read this file at the start of every prompt, then follow it for the whole session.

## Code layout

- The game rules live in `shared/` as plain TypeScript. The client and server are thin layers around them.

## Authority

- The server runs the real game world. The client only displays it and sends orders. The client must never be trusted with hidden information.

## Accounts

- Accounts are username and password only. No email is sent. Usernames are 3–20 letters, digits or underscore, unique without regard to case. Passwords are at least 8 characters. Display names are 2–24 characters and default to the username.
- Supabase Auth receives a made-up address `username@<accountEmailDomain>`; the default domain is `armadas-1805.carltonjamie714.workers.dev`. The mapping lives in `shared/accounts.ts` so real email can be added later.
- Test and dev rooms accept guests and logged-in players; a guest may still use `&as=NAME` there. Normal rooms require a valid Supabase access token in the first WebSocket message. The token is verified against the project JWKS (signature, expiry and issuer). The game id is the Supabase user id and the display name comes from `profiles`, never from the client.
- The Worker environment holds three values in the Cloudflare dashboard only. Never put them in the repository or client:
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY` (served by `/api/config`; safe in the browser)
  - `SUPABASE_SECRET_KEY` (server only)
- Deleting an account deletes the Auth user and profile. If that player is in a running game it is a resign for now.
- A daily Cron Trigger reads one `keepalive` row so the free Supabase project is not paused.

## Style

- Every screen uses the single shared style sheet `client/paper.css`, described in `docs/STYLE.md`. Never add a second theme.

## Numbers

- Every tuning number goes in `shared/settings.ts`. Never hard-code a number that a designer might want to change.

## Cost

- Everything must be free to run with no credit card.

## Devices

- The game must run in a browser on a phone, a Chromebook and a PC, and resize without looking broken.

## Controls

- No action is press-and-hold. A tap selects, a second tap opens the selection's sheet, and a double tap selects its fleet. A long press does nothing anywhere: sea, ship or port.
- The fixed slots are the only chrome: top-right money, date/time and moon with Menu, Sailor's Log and Formations; top-left the ship strip; bottom-left the wind compass with Tools, Multi and Stance; bottom-right the title mark. The armed banner and at most two toasts sit at the top centre.
- Every other order is verb then target. Stance opens the four stances plus Battle orders (Sink, Capture, Loot, Run, Surrender) and Actions (Board, Claim, Ignite, Tow, Cast off, Attack port). One toggle can be armed at a time; the armed banner names its target and Cancel is always present. An order that needs a target rejects a tap outside every friendly sight circle with "Target not in sight".
- A tap on empty sea does nothing: there is no tap-to-sail, no Undo sail and no sea palette. Sailing comes from the Tools heading order, a port, the queue or the chart. Run and Surrender are armed from Stance, then aimed at one of the player's own ships.
- A fleet may contain every ship its player owns, up to the 30-ship player cap. A ship belongs to at most one fleet.
- Bulk selection has Select all, Select nearby, class chips (frigates, line ships), Fleet panel checkboxes and the Multi box drag. Make fleet is one tap. Save group stores the selection in a numbered slot; a numbered button recalls it in one tap.
- The selected ship is always at the exact map centre; a fleet centres on its leader and an empty selection keeps the last ship. The camera cannot be dragged, followed or sent Back to ship. Pinch or wheel zooms from about 4 km to about 30 km. Tab cycles ships. Desktop extras: Esc cancels, +/− zooms and 1–9 recalls groups.
- The Sailor's Log is a full-screen brown-bar folio: Return to game, Chart, Queued orders, Fleets and Trade routes. Chart puts the real chart on the left (about 55 percent) with the Ship list over the Port list on the right. Queued orders reorder and remove points; Patrol and Rendezvous are chosen there and then placed with chart taps, which only pick points and never sail a ship. Fleets holds the existing fleet panel, checkboxes, Select all, class chips, formation, slot position, stance and leader. Trade routes holds the existing cargo, storage and trade screens; Trade links stay disabled with "Arrives with trade links".
- The chart draws latitude and longitude lines with real labels such as 15° N and 70° W, and a fixed compass rose. Spacing follows zoom at 10, 5, 2, 1 and 0.5 degrees using the existing projection (52.93 map-km per degree of longitude, 55.3 per degree of latitude). Lines and labels appear only over discovered ground, so the world edge stays hidden. This replaces the old no-grid, no-coordinates chart rule.
- The Tools sheet lists every planned tool. Heading and distance, Wind (a local arrow and speed around the selected ship), Range check (sight, cannon range and the 300 m / 600 m / 1 km hit-chance bands) and Scale ruler work. Spyglass, Depth, Survey area, Currents and tides and Barometer stay visible as disabled "Not built yet" rows; Poseidon's trident and Compass of Desire stay disabled as "Item only".
- Sight is one rule for the sea circles, chart discovery and visible enemies. Day sight is 25 km (15 km for a fire ship); at night the ship's own sight is 16 percent of it at a quarter moon, scaled by the agreed moon table (new x0.375, crescent x0.675, quarter x1, gibbous x1.2, full x1.375). A lit ship is seen from 10 km at night; a dark ship only inside the observer's own night sight. Day and night blend over one game hour around 06:00 and 18:00, and weather is a stub multiplier of 1. Port capture ranges keep their existing night halving.
- Day draws one soft light disc at the day radius. Night with lights off draws one small dark disc at the own night sight; night with lights on draws that crisp disc plus a larger warm glow to 10 km. Circle radii are in kilometres times the zoom scale; ship icons stay fixed size.
- The Developer sheet can pin the moon phase for testing without moving the clock. `settings.fog.nightSightEnabled` (default true) turns the night rule off.
- Every action gives a readable accepted or rejected notice. Disabled actions stay visible with the reason. Sheets stay open until closed, scroll on short screens and keep 44 px targets with no overlaps.
- Menu, Controls is the same cheat sheet in the game. Five first-use hints explain selection, the heading order, Stance, enemy actions and bulk selection; each is dismissable and never blocks the map.

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
  Accepting is never refused for fleet size; a player may own more than 30
  ships through capture or inheritance. A surrendered flagship is a
  flagship lost (see Elimination and winning).
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
  It has no owner, leaves its fleet and control group, cannot
  sail or fire, drifts at the sailless rate, and keeps its damage, cargo,
  ammunition and upgrades. It loses 1.5% of hull per game hour until claimed
  or sunk. A ship that never had the minimum (a new purchase, or a prize with
  no crew) is NOT abandoned; it stays owned and shows "needs crew".
- Any player, including the former owner, may claim an abandoned ship by
  moving crew from a ship within 300 m to bring it back to at least 10%. The
  first success wins: ownership and navy colours change, the name and all
  damage stay, and decay stops. A claim is never refused for fleet size, so a
  player may own more than 30 ships. Enemy ships may still fire on an
  abandoned ship.
- Boarding strength is crew x quality (1.0) x morale (1.0) x crew health
  (1.0). Attacker odds are A^2 / (A^2 + D^2), rounded to 5% for the player.
  Very rough seas make boarding impossible through a weather hook.
- Buying ships is blocked at 30 or more ships, with "Over the ship limit
  (31 of 30): cannot buy ships". Capture, inheritance and claims are not
  blocked.
- The Board order intercepts on a predicted course, closes to about 45 m
  abeam, then eases alongside. It grapples only at 60 m or less, with at most
  3 knots of relative speed and at most 30 degrees of heading difference. It
  turns back if it overshoots, and cancels with a visible reason if it cannot
  reach. A grapple lasts 60-120 real seconds (90 default). The two ships drift
  together, cannot sail away and do not fire at each other; other ships may
  still fire on them. A side three times stronger wins at once. Surrendered
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
  It removes strength x 0.00035% of hull and strength x 0.00025% of full
  crew each second (tuned so fires do not dominate a duel). Fighting it
  removes 1.5 x crew% / 100 a second, uses 0.01 t of repair
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

## Ports in battle

- NPC ports are neutral ground. They can never be attacked or captured, shots
  at them are refused with "Neutral ground", their docked ships are safe, and
  their defences do nothing.
- A capturable port has an owner (a player or nobody), health, a fortification
  tier from 0 to 3, one build in progress, a silenced flag at zero health, a
  capture hold, and a last-attacked time with its aggressors.
- Base defences (AGREED): small 0 heavy / 10 medium / 10 light guns (100 lb),
  health 2,000; medium 10/12/8 (248 lb with 14, 7 and 3 lb shot), health 5,000;
  large 40/20/10 (730 lb), health 12,000. Battery range 1.2 km. Hit chance is
  50% to 300 m, 30% to 600 m, 12% to 1 km and 6% out to battery range, on the
  battle clock. Firepower falls with health; at zero health the batteries are
  destroyed. A port fires only after being hit, only at aggressors, and never
  at its owner or friends. Aggressors stay marked for 120 real seconds after
  their last shot. Rough seas do not affect batteries.
- Fortification tiers (AGREED) add 20% guns, 30% health (current health rises
  in proportion) and 100 m range. Build times are 1, 2 and 3 game days; the old
  defences work until the tier finishes. Costs come from the port's own stock,
  scaled small x0.5, medium x1, large x2: tier 1 = 60 t timber + 20 t repair
  materials; tier 2 = 150 + 50; tier 3 = 300 + 100. One build at a time, started
  by the owner, no cancellation. The build is allowed only up to the navy's
  researched Fortification tier; without that research the button says
  "Needs research".
- Attack port is a Sink order for a ship or fleet. Ships close to 600 m and
  stand and fire; damage is the pounds of landed shot. Unowned, enemy and other
  navies' ports can be attacked; your own, teammates' and NPC ports cannot.
- Repair is blocked for 120 real seconds after the last attack. Unowned ports
  heal 0.5% of maximum health per game hour; owned ports heal 2%, doubled while
  using 1 t of repair materials per 5% healed. A silenced port heals and its
  batteries return when health is above zero.
- Capture (AGREED): only at zero health. Ranges are 15 km small, 20 km medium
  and 30 km large, halved at night (18:00-06:00) and in mist, quartered in
  thick fog, stacked with a weather hook. Only armed ships with guns,
  ammunition and at least 10% crew count; abandoned, surrendered, drifting and
  grappled ships do not. Lights-off ships do. Exactly one side must be in
  range: a player, their navy teammates or an alliance hook. The owner's armed
  ships count as a side and block capture; two enemy sides block each other.
- The capturing side holds alone for 300 real seconds. Pause freezes the timer,
  another side entering resets it, all capturers leaving resets it, and any
  healing above zero resets it. On capture the owner changes, buildings and
  tier stay, stored resources stay and now belong to the captor, upgrades
  unlock for the captor and income starts from the next payment cycle. There is
  no unfriendly period; health becomes 25% of maximum. A flagship may take a
  small weak port.
- Owned ports pay every 3 game days (30 real minutes). AGREED base income is
  400 small, 800 medium and 1,200 large pieces. Each trade route ending at the
  port adds 15% of that base, counting at most 4 routes. Money is created by
  the game. NPC ports pay nothing. A captured port stops paying its old owner
  and pays the captor from the next cycle. One quiet notice reports each
  payment total, not one per port.
- Port income research: Market adds 10/20/30% to every owned port; Jamaica
  station adds 10/20/30% at Greater and Lesser Antilles ports for Britain;
  Navigation Acts makes Britain's route share 18/21/25% instead of 15%.
- Docked ships when a port falls: ships that do not fight back are captured
  with the port, their crew joining. A ship fights back with Engage anything or
  Fight only if attacked, at least 10% crew and guns; those and any docked
  flagship are pushed about 3 km out to sea, and the owner is told. Flagships
  are never captured. A ship cannot dock at another player's port; teammates
  and an alliance hook allow it. Unowned ports keep today's rules.
- Elimination hook: an eliminated player's ports go to a teammate, otherwise
  to the victor or victors split evenly by value with the ships. Draft values:
  small 3,000, medium 8,000, large 20,000 pieces, plus 25% per tier. With no
  defeater the ports become unowned and keep their tier.

## Fire ships and towing

- The fire ship is one cheap type, the same for every navy, not one of the 24
  catalogue ships. AGREED: 500 pieces of eight, one game day to deliver, named
  once, counted against the 30-ship limit. Cruise 4 knots, top 6, hull 400,
  sight 15 km, draught 2.5 m, no cargo, no guns and no ammunition. Its full
  crew is 10% of that navy's raider crew, rounded up, and at least 3; the 10%
  minimum-crew rule still applies, so it arrives with no crew. Draft: its turn
  rate is 60% of a raider's. It is a SMALL ship for damage, never an armed ship
  for port capture, and can be boarded, captured, claimed and abandoned.
- Research: fire ships need the first Fire ships research level. Until then
  the buy list shows "Needs research: Fire ships". They are sold at ports that
  sell small ships, never at NPC ports, and sail in a fleet; in Convoy they sit
  in the protected middle with the trade ships.
- Ignite now: the crew escape (no loss, no prisoners, crew set to zero). The
  ship keeps its heading, its speed falls to zero over 20 seconds, then it
  drifts with the wind. It burns at strength 100 and nobody fights that fire
  until the hull is gone. Normal fire spread applies: about 100 m, chance per
  second 0.01 x strength / 100, x2.5 downwind and x0.3 upwind, including the
  owner's own ships.
- Ignite on contact: the fire ship steers for a chosen enemy ship and ignites
  within 100 m (Draft). It also ignites at once below 30% hull (Draft). After
  150 seconds (Draft), or if the target is faster, it holds position and says
  "Cannot reach: target is faster". A sunk or lost target ends the order. Ports
  cannot be targets and fire never damages ports or docked ships.
- Ignition is the only order that consumes the ship. Sunk before ignition, it
  just sinks. A towed fire ship refuses ignition with "Cast off first".
- Towing (31 October rules; the first and third were Proposed): a frigate,
  line ship or flagship may tow ONE fire ship within 300 m. The pair travels at
  the tower's achievable speed minus 2 knots, never below zero. The fire ship
  follows 120 m behind on the tower's path, accepts only Cast off, and leaves
  its formation slot (the existing detached state; Rejoin is available).
- Cast off works from either ship. Auto cast off (Proposed) happens when either
  ship fires or is fired at, an armed enemy within 3 km is engaging or being
  engaged, or the tower is boarded, sinks or is abandoned. The notice is
  "Tow cast off: battle nearby".
- Lights (minimal Draft for 3G): every ship has lights on by default and Lights
  on/off orders. Daylight is 06:00-18:00. At night an enemy with lights off is
  seen only within 5 km of one of your ships; lights on uses the normal sight.
  Lights never affect capture ranges. Real night sight and weather are Phase 6.
- Balance simulation (Proposed, not agreed): 100 seeded real-loop runs at night,
  lights off, one fire ship 4 km from five frigates hove to 60-100 m apart.
  Target was about 85% ignition against Fight only if attacked and 15-25%
  against Engage anything. The measured result is in the 3G-b build log; the
  existing hove-to gunnery timing means both stances reached 100%, so the target
  was not met without unrelated combat changes.

## Sailing and manoeuvres

- The helm is defined by feel in real seconds. A 90-degree turn at cruise takes
  raider 2.0 s, escort 2.5, frigate 3.0, trade 4.0, fire ship 4.0, line 5.0 and
  flagship 5.5 (Draft). Heading changes at a maximum turn rate with limited
  angular acceleration: the rate eases in over about 0.8 s and eases off as the
  target bearing approaches, so there are no heading snaps. Speed changes use
  the same limited acceleration instead of jumping, including starting,
  stopping, arrival and slowing for a tack. Rudder damage still reduces the
  maximum rate. The live ship, client sprite, route planner, route dots,
  heading preview and manoeuvres all use these limits, so a plotted path is the
  path sailed. Fleet station-keeping uses the same helm.
- The helm still needs way on. Below steerage the rate falls with speed; at rest
  a hull pivots at 15% of its rate, and a boarding hull alongside may use 35%
  (Draft) so the eased helm can line up. A low-speed hull with a sailable target
  uses the normal helm and builds way again; only a target inside the no-sail
  angle or a dead stop for a large turn enters irons recovery. The measured
  before/after table is in the 3L-a build log. No AGREED turning number changed.
- A course change of 110 degrees or more is a manoeuvre. If the shorter turn
  crosses the wind the ship tacks; otherwise it wears round. A damaged or very
  slow hull wears instead of tacking. A clean tack can miss stays; damaged rig,
  damaged rudder, low crew and strong wind increase the chance. A missed stays
  drops into irons, where the ship backs its sails for one ship length and pays
  off onto a close-hauled course. In a narrow channel with the wind onto a lee
  shore it box-hauls instead, backing and filling without a long downwind loop.
  Warping is port-water only, at 1 knot, and needs no wind.
- A ship shortens sail near a coast (1.5 km Draft) or in a channel under 2 km
  wide, keeping half speed. Ports, their anchorages and their approaches are
  exempt from automatic coast avoidance.
- Anchors: drop below 3 knots. An anchored hull neither drifts nor answers a
  sailing order, and swings slowly head to wind. Weighing anchor takes 20 real
  seconds, during which the helm does not answer. An independent ship left with
  no order for 20 game minutes anchors itself; a new order wakes that automatic
  anchor immediately. Manually dropped anchors still need Weigh anchor.
- Coast safety runs every 2 real seconds. It probes 3 km ahead, or 7.5 km when
  the wind blows onto a lee shore (2.5x Draft), and turns a ship with an order
  away from the closing coast. An idle ship inside the probe anchors instead.
  The tick path check still stops any hull that actually reaches land, and the
  chart edge keeps its 100 m margin.
- The route planner is kinematic: 2 km fine grid for routes up to 30 km, 5 km
  long-route grid with the same 4 km minimum hull clearance, weighted search and
  a five-kilometre corridor around the raw plan when rounding corners. A long
  Jamaica detour plans in about 2 ms on this VM; the 200-case median is in the
  3H-b2 build log. The one planned curve is used by the route dots, the ghost
  prediction and the live helm, so they cannot disagree about a corner.
- A routed ship that makes less than 20 m of progress for 30 game minutes gets
  "no progress; trying a new tack". At 60 game minutes the order is cleared and
  the ship anchors. A hull still making way is never treated as stuck.
- Fleet orders keep line ahead. A follower steers for its slot on the leader's
  recorded track, not a straight-line offset. If the formation would face into
  the wind it falls back to line ahead; this is the only formation that does
  not need the wind on the beam.
- Draft values for all of the above live in `shared/settings.ts` and may change
  after playtesting. Later phases add depth, shallows, grounding, tides,
  currents, real weather and night sight; none of those are built here.

## NPC groups

- Neutral traffic is a separate layer from player fleets. A full room has
  twelve merchant hulls, two whaling groups (two and three hulls) and three
  privateers. They are marked as neutral for colours, sheets and hostile-target
  rules even though a neutral hull uses an ordinary ship class. They are not in
  `botFleets`, which stays the load-test facility.
- The neutral brain runs at 2 Hz while movement runs every tick. Merchants and
  whalers pick another port within 60 km (Draft), meet it at an offshore
  rendezvous rather than the crowded anchorage, and use a bounded coarse local
  route. A lone trader with no second port nearby cruises to an offshore point
  and back. Group followers copy the leader's planned track instead of
  planning their own. A neutral hull pinned on a coast for eight game minutes
  takes one seaward recovery course; the player stuck-recovery rules do not
  apply to it.
- Loot and leave: after a neutral ship is boarded, abandoned or has struck,
  a player alongside can take what fits in their hold. The cargo is never
  shown in the public ship or neutral contact snapshot before that point. The
  emptied hull stays afloat and can still be claimed; claiming removes it from
  the neutral layer.
- Privateer contracts: a player may hire a nearby privateer for six game days.
  The base fee is 1,200 pieces of eight, or 900 for an escort. Modes are patrol,
  escort and raid. Escort follows one of the player's ships at 1.1 km; raid
  shadows the nearest neutral trader; patrol wanders near its home port. A
  privateer is still an ordinary armed hull, so an ordinary attack or board
  order resolves against it normally. The privateer does not run a second
  hidden combat AI, and a real privateer prize economy is a later hook.
- A neutral hull that is sunk or claimed returns after 30 real minutes as a
  fresh hull in the same group and home port. This is a replacement, not a
  respawn of the old hull.
- The map marks neutral hulls with their own ink: merchants are ochre with a
  round marker, whalers teal with a diamond, and privateers rust with a
  triangle. A hired privateer gains a thin gold ring. These are recon markers,
  not navy colours; a last-seen neutral keeps the same marker after it leaves
  sight. Hired privateers are also listed in a compact escort strip even when
  the hull is out of sight, and contract expiry produces a notice.
- Selecting a neutral opens its battle actions. A surrendered or abandoned
  hull gets **Loot & leave** in the battle bar; an abandoned hull can still be
  claimed. An unhired privateer offers **Hire privateer**, and a hired one
  offers **Manage contract**. The loot sheet deliberately shows no cargo until
  the server marks the hull surrendered or abandoned. It lists only goods that
  fit the selected ship's free hold, and the emptied hull stays afloat.
- The privateer sheet shows the 1,200-piece fee, the 900-piece escort fee, the
  three modes and the six-game-day contract. **Escort** opens a target sheet
  for one of the player's ships. The five sheet layouts (360x740, 412x915,
  740x360, 768x1024 and 1280x800) keep 44 px targets and scroll inside the
  viewport. These presentation details are Draft and may change after a real
  phone review.
- Test and dev rooms accept `&npc=0` to remove the whole neutral layer and
  `&npc=1` to put it back. The server enables it by default; direct world tests
  opt in. All counts, ranges, fees, cargo bands and timers are Draft values in
  `shared/settings.ts` and may change after playtesting. Real privateer prize
  courts, alliances and a trade economy are later phases.

## Elimination and winning

- Every player has exactly one flagship. In a normal room it is the navy's
  flagship ship; in a test or dev room the player's starting ship is their
  flagship whatever its class. A ship stores `isFlagship`. Ships spawned by
  test helpers are not players and never count for elimination or victory.
- Losing the flagship, by any cause, puts that player personally out of the
  game. The reasons are sunk, blew up, captured by boarding, surrendered and
  accepted, abandoned (a flagship under 10% crew becomes ownerless) and
  resigned. Weather and starvation use the same hook when they are built.
  There is no early protection: a flagship can always be sunk. A player who
  is merely disconnected, or whose ships are removed by the test-room
  absent-player timer, is not eliminated.
- Sunk, blown-up and damage-abandoned flagships credit the player of another
  navy who dealt the last damage within the last 600 real seconds. Damage
  from a fire the enemy started counts. Friendly fire and teammates are never
  credited. If nobody qualifies, nobody defeated them.
- A boarding capture or an accepted surrender credits the capturing or
  accepting player. A resignation credits the player the resigning captain
  chose. Weather credits nobody. The allies hook is empty for now: when it
  returns allies, every qualifying ally shares the victory.
- Assets follow the agreed table. A surviving teammate of the same navy
  inherits first: all remaining ships, ports (hook, none yet), resources
  aboard them and money. With no teammate, the credited player receives
  everything. With no teammate and an alliance victory (hook), everything is
  divided as evenly as possible by value across the alliance: each ship is
  valued at its price plus the market value of its cargo and ammunition, the
  highest-value unit goes to the recipient with the lowest running total,
  and money is split equally. With no teammate and nobody credited, a
  teammate still inherits if one exists; otherwise ports become unowned
  (hook, none yet), every other ship becomes abandoned with zero crew under
  the 3D decay, and money is lost.
- Inherited ships keep their names, damage, cargo, ammunition and upgrades.
  They leave their old fleets and control groups, hold position and take the
  default stance. Owning more than 30 ships is allowed; only buying is
  blocked at 30. Money inheritance is on. The lost flagship itself already
  belongs to its captor if captured or handed over, and is gone if sunk.
- The eliminated player leaves all alliances at once (hook).
- Resign is final. Any player may surrender their flagship at any time and
  choose any other real player, or Nobody, as recipient. The flagship and all
  remaining property go to that recipient; with Nobody, ships become
  abandoned. The choice cannot be undone.
- A navy is eliminated once none of its players has a flagship. Everyone is
  told "Navy X eliminated". Victory is checked after each elimination, and
  only in rooms where at least two navies had players with flagships. The
  last navy standing wins; teammates win together. An empty or unused navy
  counts as already eliminated. A one-navy room never ends.
- When one navy remains, the world simulation stops: no movement, combat or
  timers, and all orders are blocked. A game-over state names the winning
  navy and its players. Only a test room may reset to a fresh world with the
  same players; a real rematch belongs to Phase 4.
- Simple per-player stats count ships sunk (by last damage), ships captured,
  ships lost, flagships destroyed, shots fired, shots hit, damage dealt,
  crew killed, prisoners taken, ships bought, money earned and spent,
  distance sailed, game days and flagship survival time. They are shown only
  after the player is eliminated or the game is won. During play nobody
  receives another player's stats, flagship status or asset list. Elimination
  events carry names and navies only; the reason and heir go to the player
  concerned, and the receiver is told "You received N ships".
- The port-ownership hook (`portsForPlayer`) and the allies hook
  (`alliedPlayerIds`) exist and return nothing or nobody for now.

## Research and upgrades

- Each navy has one research tree: 5 shared branches of 5 upgrades, plus 6
  unique upgrades for that navy. Every navy has 31 upgrades and the same total
  cost. Levels are L1, L2 and L3, except the three cold-weather items (one level
  each, 2 units) and Fortification (3, 6 and 12 units). Normal levels cost 1, 2
  and 4 units. Unique upgrades cost the same as shared ones.
- One research unit is 100 points (Draft unit size). Research points belong to
  the navy, so teammates share one pool. The first discovery of a port gives 15
  small, 25 medium or 40 large points; capturing a port gives 120, 250 or 500;
  each first 25 km block gives 0.5 points. Reef, depth and weather surveys are
  hooks. Levels are bought in order, at any time, anywhere.
- Ship upgrades are researched for the navy but fitted to each ship at a port.
  Fitting costs 5% of the ship's price per level fitted (Draft), reduced by the
  Shipyard and capped at a 60% total discount, and the ship stays docked for one
  game day. "Upgrade ship" fits every unlocked ship level; the Fleet panel can
  upgrade every docked ship. A newly ordered ship arrives with every unlocked
  ship upgrade fitted for free. A captured ship keeps its fitted levels and they
  keep working.
- Port upgrades apply automatically to every port the navy owns; no per-port
  building except Fortification. A captured port has the port upgrades its
  previous owner's navy had researched and keeps its Fortification tier.
- Capturing a ship or port that has an upgrade unlocks that upgrade's first level
  for the capturing navy if it has none. Each repeat capture gives one capture
  point; every 3 points unlock the next level, up to the highest level seen on
  a captured ship or port. This works for shared and foreign unique upgrades.
- Each effect is ACTIVE or a HOOK. ACTIVE effects are wired into sailing, sight,
  gunnery, boarding, fitting, prices, storage, repairs, supplies and cargo. A
  HOOK stores and reports its level but changes nothing until its system arrives
  (weather, night sight, depth, other nations' regional income, healing, port
  log, alliances, trade routes, silver shares). Market, Jamaica station and
  Navigation Acts are now ACTIVE port-income effects.
- Every ship has its own sight radius: 25 km base, 15 km for a fire ship,
  multiplied by Chronometer and charts. It is used for discovery and spotting.
  The night multiplier is a hook.
- EFFECTS ARE DRAFT unless marked AGREED. All numbers are in
  `shared/settings.ts`; the tree names and ACTIVE/HOOK labels are in
  `shared/data/research.ts`.

## Ways of working

- Each prompt is one job and must finish inside one session. At the end of every prompt: test what you built, commit, push to `main`, and report back.
- Write short, clear code with comments in plain English.
- The debug view (TEMP-DEBUG) is temporary and must be removed before release.
