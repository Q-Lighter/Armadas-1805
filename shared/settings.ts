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
    /** The clock starts at Day 1, this hour. Draft: 08:00. */
    startHour: 8,
    /** One game day. Twenty-four is the design, not a calendar. */
    hoursPerDay: 24,
    /** Nominal daylight: 06:00 to 18:00. */
    daylightStartHour: 6,
    daylightEndHour: 18,
    /** Dawn and dusk blend over this many game hours. Draft: 1. */
    twilightHours: 1,
    /** The moon repeats every this many game days. Draft: 29.5. */
    moonCycleDays: 29.5,
  },

  /** The browser build and its update check. */
  client: {
    /** How often an open page checks for a newer build. Draft: 60 seconds. */
    versionCheckMs: 60_000,
  },

  /** The chart: the flat map frame and how it is turned into tiles. */
  map: {
    /** The map frame, in degrees. x grows east and y grows south. */
    frame: {
      lonMinDeg: -100,
      lonMaxDeg: -28,
      latMaxDeg: 24,
      latMinDeg: -78,
    },

    /** Half real-life scale. One degree is this many map kilometres. */
    kmPerLonDegree: 52.93,
    kmPerLatDegree: 55.3,

    /** Drawing tiles: how many levels, and the size of a tile at the finest
     *  level. Level 0 is the coarsest; each level halves the tile size. */
    tileLevels: 5,
    finestTileKm: 128,

    /** A tile may not grow past these limits. Denser coast is simplified
     *  further until it fits, so phones never draw a huge tile. */
    tileFileBudgetBytes: 60 * 1024,
    tilePointsBudget: 8_000,

    /** How far neighbouring tiles overlap, in km, so their edges meet cleanly. */
    tileOverlapKm: 0.75,

    /** The largest tile set allowed: Cloudflare static hosting limits. */
    maxTileFiles: 5_000,
    maxTileSetBytes: 20 * 1024 * 1024,

    /** Coast simplification at each level, coarsest first, in map km. The
     *  finest level keeps Natural Earth detail for the 5 km view. */
    levelToleranceKm: [6, 3, 1, 0.25, 0.01],

    /** Grid cell for the server land lookup, in map km. Smaller is more
     *  accurate but larger to send to Cloudflare. */
    landCellKm: 1,

    /** The land lookup must stay under this size once compressed. */
    maxLookupCompressedBytes: 1_000_000,
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

  /** Player identity and rooms. */
  players: {
    /** In test and dev rooms only, remove a disconnected player after this
     *  many seconds. Normal rooms never remove one. Draft: 120 seconds. */
    ghostRemoveAfterSeconds: 120,
  },

  /** The placeholder starting area for new players. */
  world: {
    /** The British start, west of Jamaica. */
    startArea: {
      lonDeg: -79.5,
      latDeg: 13,
      radiusKm: 6,
      /** New ships are never placed closer than this to each other. */
      minimumSeparationKm: 1.5,
    },
  },

  /** What happens when a ship meets land or the chart edge. */
  coast: {
    /** How far apart the path is sampled, in km, so thin land is not skipped. */
    pathSampleKm: 0.25,
    /** How far short of a chart edge a ship stops, in km. */
    stopMarginKm: 0.1,
    /** Open-water clearance a stopped ship keeps from land, in km. */
    offshoreClearanceKm: 1,
    /** How far from land a ship starts looking for a seaward tack, in km. */
    tackAwarenessKm: 5,
    /** How far a seaward probe looks for open water, in km. */
    offshoreProbeKm: 12,
    /** Ray directions used to find the seaward side of a coast. */
    offshoreProbeRays: 16,
  },

  /** TEMP-DEBUG: built-in dev-room load test. Remove with the bot code. */
  loadTest: {
    minBots: 1,
    maxBots: 300,
    fakePlayers: 8,
    /** Share of bots that start near the first human, within these distances. */
    nearHumanShare: 0.1,
    nearHumanMinKm: 3,
    nearHumanMaxKm: 40,
    /** Bots sail to nearby sea points so every order is a normal order. */
    destinationMinKm: 40,
    destinationMaxKm: 250,
    /** Search boxes for the rest of the fleet. */
    caribbean: {
      lonMinDeg: -88,
      lonMaxDeg: -60,
      latMinDeg: 10,
      latMaxDeg: 22,
    },
    northernSouthAmerica: {
      lonMinDeg: -82,
      lonMaxDeg: -50,
      latMinDeg: 0,
      latMaxDeg: 12,
    },
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

  /** Fog of war and the chart's private map blocks. */
  fog: {
    /** How far every ship can see in daylight, in km. */
    sightRangeKm: 25,
    /** Width of the soft edge of the live sight circle, in km. */
    sightFeatherKm: 2,
    /** Discovery grid cell, and the map block sent for chart painting, in km. */
    discoveryCellKm: 5,
    chartBlockKm: 25,
    /** Keep each websocket state message small by batching block geometry. */
    maxBlocksPerMessage: 8,
    /** How far offshore a test room starts from the nearest coast, in km. */
    testStartCoastDistanceKm: 30,
  },

  /** Camera limits and chart drawing for the client. */
  view: {
    minKmAcross: 5,
    maxKmAcross: 300,
    startKmAcross: 60,
    /** Ship-view zoom range, measured across the shorter screen side. */
    shipMinKmAcross: 4,
    shipMaxKmAcross: 65,
    /** Chart-screen zoom range. */
    chartMinKmAcross: 25,
    /** How dark remembered land and sea are outside a live sight circle. */
    fogDimAlpha: 0.52,
    /** Night wash over the ship view; the paper HUD and chart stay clear. */
    nightTintStrength: 0.32,
    /** Live wind streaks in the ship and chart views. */
    windStreakCount: 24,
    windStreakMinPx: 22,
    windStreakMaxPx: 88,
    windStreakAlpha: 0.22,
    windStreakWidthPx: 1.2,
    windStreakSpeedPxPerSec: 18,
    /** Chart scale ruler: a readable bar and the distances it can show. */
    chartRulerMinPx: 64,
    chartRulerMaxPx: 150,
    chartRulerStepsKm: [25, 50, 100, 250, 500, 1_000, 2_000, 4_000],
    /** Pick a tile level whose tiles are no larger than this share of the
     *  view. Two means a view spans at least two tiles. */
    tileLevelPickFactor: 2,
    /** Hard ceiling on chart points drawn in one frame. */
    maxDrawnPoints: 30_000,
    /** Ink coast line and the lighter water line outside it, in screen px. */
    coastLinePx: 1.5,
    waterLinePx: 7,
  },
} as const;

/** The shape of the whole settings file, for code that wants to pass it around. */
export type Settings = typeof settings;
