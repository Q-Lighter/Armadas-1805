// The single settings file. Every tuning number in the game belongs here.
//
// The design notes mark values that still need tuning as "Draft". When a Draft
// number is agreed, it goes into the matching group below, with a short comment
// saying what it does and why it has that value.
//
// Rules for this file:
// - Only numbers that a designer might want to change: times, speeds, costs,
//   ranges, rates, capacities.
// - Plain TypeScript only. No browser code, no server code.

export const settings = {
  /** Game clock and other timing values. */
  time: {
    /** Game seconds that pass for every real second. Draft: 144. */
    sailingTimeScale: 144,
  },

  /** Ship classes and their sailing values. All speeds are in knots. */
  ships: {
    types: {
      flagship: {
        name: "British flagship (first rate 100)",
        cruiseKnots: 6,
        topKnots: 9,
        closestAngleDeg: 70,
        turn90GameMinutes: 8,
      },
      frigate: {
        name: "British frigate (38 gun)",
        cruiseKnots: 9,
        topKnots: 13,
        closestAngleDeg: 62,
        turn90GameMinutes: 4,
      },
      raider: {
        name: "British raider (schooner)",
        cruiseKnots: 8.5,
        topKnots: 12,
        closestAngleDeg: 55,
        turn90GameMinutes: 2,
      },
    },
  },

  /** Placeholder weather: one constant wind until the weather phase. */
  weather: {
    /** Direction the wind blows FROM, in compass degrees. Draft: north-west. */
    windFromDeg: 315,
    /** Constant placeholder strength in knots. Draft: 12. */
    windStrengthKnots: 12,
  },

  /** How a ship moves under sail. */
  sailing: {
    /** Speed as a share of cruise speed, by angle between heading and wind.
     *  Key values are joined with a smooth curve. Draft values. */
    speedCurve: [
      { angleOffWindDeg: 0, speedFactor: 0 },
      { angleOffWindDeg: 60, speedFactor: 0.55 },
      { angleOffWindDeg: 90, speedFactor: 0.9 },
      { angleOffWindDeg: 110, speedFactor: 1 },
      { angleOffWindDeg: 140, speedFactor: 0.93 },
      { angleOffWindDeg: 180, speedFactor: 0.78 },
    ],

    /** Distance in km at which a sail-to order counts as arrived. This is kept
     *  wider than the tacking zigzag so an upwind ship always reaches it.
     *  Draft: 4 km. */
    arrivalRadiusKm: 4,

    /** Half-width in km of the zigzag used when the target is upwind. The
     *  whole zigzag is twice this. Kept below the arrival radius. Draft: 2.5. */
    tackHalfWidthKm: 2.5,

    /** How early a tack is started, as a share of the distance the ship will
     *  drift sideways while turning. Draft: 0.7. */
    tackTurnLeadFactor: 0.7,

    /** Orders closer than this do nothing. Draft: 0.2 km. */
    minOrderDistanceKm: 0.2,

    /** Longest order the server will accept. Draft: 400 km. */
    maxOrderDistanceKm: 400,
  },

  /** The placeholder starting area for new players. */
  world: {
    startArea: { x: 0, y: 0, radiusKm: 10 },
  },

  /** Server loop values. */
  server: {
    /** World updates per real second. Draft: 10. */
    tickHz: 10,
    /** Updates sent to each player per real second. Draft: 5. */
    broadcastHz: 5,
    /** Longest room code accepted from the web address. Draft: 24. */
    maxRoomCodeLength: 24,
  },

  /** Camera limits for the client, in km across the screen. */
  view: {
    minKmAcross: 5,
    maxKmAcross: 300,
    startKmAcross: 60,
  },
} as const;

/** The shape of the whole settings file, for code that wants to pass it around. */
export type Settings = typeof settings;
