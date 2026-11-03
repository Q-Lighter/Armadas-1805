# Stress and server cost notes

## Idle rooms

A room starts its 10 Hz world update when the first player connects. The timer
stops as soon as the last socket closes, so a Durable Object with nobody in it
has no timer, makes no world updates and can sleep. Game time advances only
inside those updates. An empty room therefore stays frozen and resumes from the
same time when a player returns; it does not catch up with real time.

Incoming messages do not start the timer. Only a new connection can start it.

## Free-plan estimate

Cloudflare's free Durable Objects allowance is about **100,000 requests a day**
and **13,000 GB-seconds a day**. A room is allocated **128 MB** (0.128 GB), so
one hour of active play costs roughly:

`0.128 GB × 3,600 seconds = 460.8 GB-seconds`

That is about 28 active room-hours within the free daily GB-seconds allowance.
The 10 Hz timer is a `setInterval` inside a live room, not an alarm, because
alarms count as requests on the free plan. A room with no players uses neither
requests nor GB-seconds.

## Built-in load test (TEMP-DEBUG)

Open the game with a dev room and a bot count, for example:

`/?room=dev-load&bots=100`

The server accepts **0 to 300** bots and only when the room code starts `dev-`.
Values above 300 are clamped to 300. Every join that includes `bots=N` sets the
room's target count, adding or removing ships; a later tab can change 25 to 50,
or 100 down to 10. An absent `bots` value leaves the current count alone. Bots
are split across eight fake owners holding roughly equal frigate fleets (100
bots is 12–13 ships per fake owner). About 10% of newly added bots start within
40 km of the first human; the rest are placed in the Caribbean and the northern
part of South America. Every ship starts on sea and receives a sea destination.
Bots use the normal shared sailing, coast and discovery rules and choose a new
sea destination on arrival or after a coast stop.

Every fake owner has a real chart and discovers cells from all of its ships'
sight circles. Five times a second the server calls `visibleStateFor` for each
of the eight fake owners, measures the resulting JSON and throws it away. It is
never sent to a socket.

The dev-room TEMP-DEBUG line shows the bot count and the total ship count
separately, real world updates per second, average and worst gap between timer
callbacks over the last 10 seconds,
average and worst bytes per second per fake player, and the browser's received
updates per second and worst receive gap. CPU time is deliberately not measured
inside the code because Workers coarsens its clocks.

All bot code is marked TEMP-DEBUG and must be removed; `RULES.md` forbids it
outside dev rooms.

## Local Node proxy benchmark

The following rough numbers came from `npm run benchmark:world` on Node 26.13:
each count ran 100 shared world steps (10 real seconds) and eight fake-player
updates at 5 Hz, including JSON encoding. This is a local CPU proxy only: it
does not include Cloudflare CPU accounting, the real chart-block lookup, the
network or browser rendering.

| Ships | Total ms / 10 s | ms per simulated second | ms per world step | ms per fake update | Average update bytes |
| ----: | --------------: | ----------------------: | ----------------: | -----------------: | -------------------: |
|    25 |            31.0 |                     3.1 |              0.31 |               0.08 |                  345 |
|    50 |            39.0 |                     3.9 |              0.39 |               0.10 |                  611 |
|   100 |            88.7 |                     8.9 |              0.89 |               0.22 |                1,304 |
|   200 |           158.6 |                    15.9 |              1.59 |               0.40 |                2,740 |

The benchmark excludes map-block geometry, so the live byte counters can be
higher. It does not predict Cloudflare wall-clock performance.
