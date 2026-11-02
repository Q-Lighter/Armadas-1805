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

## Load test

The built-in dev-room load test and local benchmark are added in Part 1D-c.
