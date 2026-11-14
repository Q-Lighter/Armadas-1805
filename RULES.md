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
  by the owner, no cancellation. Research is a hook; only test and dev rooms
  unlock it in 3F, so normal rooms show "Needs research".
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
  unlock for the captor and income starts from the next cycle hook. There is no
  unfriendly period; health becomes 25% of maximum. A flagship may take a
  small weak port.
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
- Research hook: `fireShipsUnlocked()` is true only in test and dev rooms for
  now. Normal rooms show "Needs research" in the buy list. It is sold at ports
  that sell small ships, never at NPC ports, and sails in a fleet; in Convoy it
  sits in the protected middle with the trade ships.
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

- The helm needs way on. A hull below 2 knots (Draft) loses turn rate in
  proportion to speed; at rest only backing the sails can pivot it, at 15% of the
  normal rate. Every class turns about three times faster than the old 90-degree
  time, so a frigate at cruise circles in about 5.2 ship lengths rather than
  15.7. The measured table is in the 3H-b1 build log. No AGREED turning number
  changed.
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

## Ways of working

- Each prompt is one job and must finish inside one session. At the end of every prompt: test what you built, commit, push to `main`, and report back.
- Write short, clear code with comments in plain English.
- The debug view (TEMP-DEBUG) is temporary and must be removed before release.
