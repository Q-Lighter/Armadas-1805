# Fog of war and the chart

Two views share one world. **Ship view** is what your ships can see now.
**Chart** is what you have found so far and remember.

## What a ship sees

- Every ship has a 25 km daylight sight circle, from
  `settings.fog.sightRangeKm`. The player sees the union of all their ships'
  circles. Night, weather and per-ship ranges are later settings.
- Inside a circle: live sea, land and other ships, in full colour, with a soft
  edge about 2 km wide (`settings.fog.sightFeatherKm`).
- Outside every circle: no foreign ship is drawn live. Ground already
  discovered is dimmed. Ground never discovered is blank stained paper, not
  black. Weather is live everywhere.
- A ship's circle marks every 5 km discovery cell it covers. That memory
  belongs to the player and lasts for the rest of the game.
- A foreign ship spotted and then lost becomes a faded last-seen marker with
  its class, navy and age in game time. It never carries the ship's name.

## The server's private chart

`shared/fog.ts` keeps a bit per 5 km cell for each player. The server updates
it each tick from the player's own ships, never from client claims.

Map geometry is split into private **25 km blocks**. The generated blocks live
inside the Worker bundle (`server/src/chartBlocks.ts`), not in the public
`dist/` folder. `visibleStateFor` is the only exit: it sends a block only after
one of that player's discovered cells touches the block, and it sends each
block once. Dev rooms start with every cell discovered and receive all blocks
in batches. Test rooms start a frigate about 30 km off the nearest coast to the
British start so land is found quickly.

Typical state messages carry the own ships, any foreign ships inside the live
circles, last-seen markers, newly discovered cells and at most eight block
geometries. The client caches blocks and paints them into the chart; it cannot
ask for geometry it has not discovered.

## Client views

The ship view zooms from 4 km to 65 km across the shorter screen side. It
draws remembered sea and land dimly, covers never-seen cells in stained paper,
and paints the live 25 km circle brightly above that paper. Wind streaks move
across the whole screen. The chart button opens the whole paper and zooms in
to 25 km; it is painted from the received private blocks and cached as a
texture.

Test and dev rooms show a small **TEMP-DEBUG** line with the room type,
discovered-cell count, received-block count and sight radius. Dev rooms start
fully explored. The old `debug=1` whole-map option, grid and latitude/longitude
panel are gone.

The debug line is temporary and must be removed before release (see
`RULES.md`).
