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
    /** Largest device pixel ratio the canvas may use. */
    maxDevicePixelRatio: 2,
    /** Context losses inside this window count toward the reload notice. */
    graphicsFailureWindowMs: 60_000,
    /** This many losses shows the tap-to-reload notice. */
    graphicsFailureLimit: 3,
    /** Press-and-hold time that sends one move order when tap-to-sail is off. */
    tapHoldMs: 500,
    /** Screen radius of the hold-to-sail progress ring. */
    tapHoldRingPx: 24,
    /** Stroke width of the hold-to-sail progress ring. */
    tapHoldRingWidthPx: 3,
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

  /** Ship buying, delivery and crew numbers. Draft values. */
  ships: {
    /** Pieces of eight for each buyable role, the same for every navy. */
    prices: {
      raider: 1_000,
      escort: 2_500,
      trade: 3_000,
      frigate: 6_000,
      line: 14_000,
    },
    /** Game days from purchase to delivery, by ship size. */
    deliveryGameDays: {
      small: 1,
      mid: 2,
      large: 3,
    },
    /** Test and dev rooms speed delivery up by this factor. */
    testDeliveryMultiplier: 0.1,
    /** A player may own no more than this, counting ships in delivery. */
    maxShipsPerPlayer: 30,
    /** Crew needed to sail, as a share of the full complement. */
    minimumCrewShare: 0.1,
    /** Pieces of eight paid to the port for each sailor hired. */
    crewHireFee: 5,
    /** A port crew pool refills from empty to full in this many real minutes. */
    crewRefillRealMinutes: 25,
    /** Starting money by room kind. */
    startMoney: {
      normal: 0,
      test: 50_000,
      dev: 50_000,
    },
    /** The longest permanent ship name the server accepts. */
    maxNameLength: 40,

    /** Ship stores and the cost of sailing them. Draft values. */
    stores: {
      /** Tonnes of provisions one sailor eats in one game day. Draft: 0.0065. */
      provisionsTonnesPerCrewPerGameDay: 0.0065,
      /** A full cargo hold removes this share of a ship's speed. Draft: 10%. */
      fullCargoSpeedLoss: 0.1,
      /** Sailors lost each game day without provisions. Draft: 8%. */
      starvationCrewSharePerGameDay: 0.08,
      /** Rounds carried for each of the ship's broadsides. Draft: 60. */
      ammunitionBroadsides: 60,
      /** Pounds in a tonne. A definition, kept here for the ammunition formula. */
      poundsPerTonne: 2_000,
      /** Hull points per tonne of repair materials. Draft: 200. */
      repairHullPointsPerTonne: 200,
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

    /** Longest order the server will accept. Draft: 800 km. */
    maxOrderDistanceKm: 800,

    /** Small offset between ships ordered to the same sea point. Draft: 1.2 km. */
    groupSpreadKm: 1.2,
  },

  /** Fleets, formations and the first order rules. Draft values. */
  fleets: {
    /** A fleet never contains more than this many ships. */
    maxShipsPerFleet: 12,
    /** Traditional line-of-battle gap between neighbouring ships. Draft: 185 m. */
    defaultGapM: 185,
    /** Never close up below this gap. Draft: 60 m. */
    minimumGapM: 60,
    /** A follower may change speed by this share of the fleet speed to close up. */
    stationSpeedShare: 0.15,
    /** How far ahead of its slot a follower steers, in metres. Draft: 120 m. */
    stationLookAheadM: 120,
    /** A follower farther than this from its slot is out of station. Draft: 300 m. */
    outOfStationM: 300,
    /** A formation turns into line ahead this near the no-sail angle. Draft: 10 deg. */
    upwindFormationMarginDeg: 10,
    /** Follow keeps this distance behind its target. Draft: 1 km. */
    followDistanceKm: 1,
    /** Escort keeps this distance out alongside its target. Draft: 2 km. */
    escortDistanceKm: 2,
    /** A target unseen for this many game minutes ends a follow or escort. */
    targetLostGameMinutes: 10,
    /** A player may save this many numbered control groups. */
    maxControlGroups: 9,
    /** Breadcrumb spacing and history used by line ahead. */
    breadcrumbSpacingM: 25,
    maxBreadcrumbs: 160,
  },

  /** Guns, damage, repairs and battle timing. Draft unless marked AGREED. */
  combat: {
    /** AGREED: one game minute of battle lasts one real second. */
    battleSecondsPerGameMinute: 1,
    /** AGREED: a broadside bears within this angle of side-on. */
    broadsideArcDeg: 30,
    /** AGREED: bow and stern guns bear within this angle of the centreline. */
    bowSternArcDeg: 30,
    /** AGREED hit chances by range, checked in order. Nothing beyond 1 km. */
    hitChanceBands: [
      { maxKm: 0.3, chance: 0.5 },
      { maxKm: 0.6, chance: 0.3 },
      { maxKm: 1, chance: 0.12 },
    ],
    /** AGREED: the upwind ship multiplies its hit chance by this. */
    upwindHitMultiplier: 1.1,
    /** Draft damage split of one broadside across gun classes. */
    gunWeightLb: { heavy: 14, medium: 7, light: 3 },
    /** Draft light bow and stern guns. They are not part of the broadside. */
    bowSternGunsByClass: {
      flagship: { bow: 0, stern: 2 },
      line: { bow: 0, stern: 2 },
      frigate: { bow: 2, stern: 2 },
      escort: { bow: 2, stern: 2 },
      raider: { bow: 2, stern: 2 },
      trade: { bow: 0, stern: 0 },
    },
    /** Draft size groups for the light- and heavy-gun damage rules. */
    smallClasses: ["raider", "escort", "fireShip"],
    bigClasses: ["flagship", "line"],
    /** Draft: light guns do this share of damage against BIG ships. */
    lightGunVsBigMultiplier: 0.5,
    /** Draft: heavy guns do this multiple against SMALL ships. */
    heavyGunVsSmallMultiplier: 1.5,
    /** Draft damage capacity shares of the hull points, by area. */
    damageAreaShareOfHull: { sails: 0.3, masts: 0.4, rudder: 0.2, guns: 0.3 },
    /** Draft share of a broadside's pounds that hits the hull. Area weights:
     *  hull, sails, masts, rudder, guns, crew. They must total 100. */
    objectiveAreaWeights: {
      sink: { hull: 70, sails: 5, masts: 5, rudder: 5, guns: 10, crew: 5 },
      capture: { hull: 10, sails: 3, masts: 5, rudder: 7, guns: 30, crew: 45 },
    },
    /** Draft: one crewman is lost for this many pounds of damage. */
    crewKillPounds: 10,
    /** AGREED: grape at x2 only within this range; otherwise round at x1. */
    grapeRangeKm: 0.3,
    /** AGREED: chain does this multiple against sails and masts. */
    chainDamageMultiplier: 2,
    /** AGREED: grape does this multiple against crew. */
    grapeDamageMultiplier: 2,
    /** Draft reload time multiplier at full and minimum useful crew. The
     *  value moves in a straight line between them. */
    reloadMultiplierAtFullCrew: 1,
    reloadMultiplierAtMinimumCrew: 3,
    /** Draft: sailing with no effective sail drifts at this share of wind speed. */
    driftWindSpeedShare: 0.1,
    /** Draft: a ship with no rudder still turns at this share of normal rate. */
    zeroRudderTurnShare: 0.1,
    /** Draft: a repairing ship must be out of combat this many real seconds. */
    combatSeconds: 30,
    /** Draft: a full 0-to-100 repair of the five areas uses this share of the
     *  ship's repair-material capacity. */
    repairMaterialShareForFullRestore: 0.5,
    /** Draft repair rates at full crew, in percentage points per game hour. */
    repairRatePctPerGameHour: { hull: 1.5, sails: 4, masts: 2, rudder: 3, guns: 2.5 },
    /** Draft: a drifting ship with no repair materials loses this share of
     *  maximum hull per game hour. */
    driftHullDamageSharePerGameHour: 0.002,
    /** Neutral values for systems that arrive later. Keep at 1.0 for now. */
    seaStateHitMultiplier: 1,
    crewAccuracyMultiplier: 1,
    moraleHitMultiplier: 1,
    seaStateSpeedMultiplier: 1,
    crewSkillSpeedMultiplier: 1,
    moraleSpeedMultiplier: 1,
    crewSkillReloadMultiplier: 1,
  },

  /** Automatic route planning around discovered land. Draft values. */
  route: {
    /** Search grid around the ship and destination. */
    gridKm: 2,
    /** Fallback grid if the first search hits its node limit. */
    coarseGridKm: 4,
    /** Preferred clearance from known land. */
    clearanceKm: 8,
    /** Hard fallback where the eight-kilometre channel is too narrow. */
    minimumClearanceKm: 4,
    /** Routes pay a soft cost in this band, preferring open water. */
    softClearanceKm: 20,
    /** Weight of the soft clearance cost relative to distance. */
    softClearanceWeight: 0.8,
    /** Start and destination may be this close to land. */
    terminalClearanceKm: 5,
    /** How far ahead to look for newly discovered land across the route. */
    lookAheadKm: 40,
    /** Minimum curve radius as a multiple of the ship's turning radius. */
    curveRadiusFactor: 1.5,
    /** Look-ahead distance when steering along a smooth route curve. */
    steerLookAheadKm: 6,
    /** Server route curve spacing sent to the client. */
    curveSampleKm: 1.5,
    /** Hard ceiling on points in one route curve. */
    maxCurvePoints: 200,
    /** Search boxes grow by this much when no route is found. */
    searchMarginKm: 80,
    /** Never grow a single search beyond this margin. */
    maxSearchMarginKm: 480,
    /** Hard limit on expanded grid nodes per search. */
    maxNodes: 20_000,
    /** Shortest representation the planner may produce. */
    maxWaypoints: 50,
    /** Plans allowed per player per real second. */
    maxPlansPerSecond: 4,
    /** Do not re-plan the same ship more often than this many server ticks. */
    minReplanTicks: 5,
  },

  /** Player identity and rooms. */
  players: {
    /** In test and dev rooms only, remove a disconnected player after this
     *  many seconds. Normal rooms never remove one. Draft: 1,800 seconds. */
    ghostRemoveAfterSeconds: 1_800,
  },

  /** Port sizes and the port rules shared by the server and the chart. */
  ports: {
    /** Open-water distance from the real coast for a port's anchorage. */
    anchorageOffshoreKm: 3,
    /** A test or dev room starts this far from its chosen port. */
    startDistanceKm: 40,
    /** Real seconds between a waiting ship's attempts for a free place. */
    dockingRetrySeconds: 5,
    /** Draft port values, by size. Only docking capacity is used yet. */
    sizes: {
      S: {
        dockingCapacity: 4,
        incomePer30Minutes: 400,
        storageTonnes: 1_000,
        crewPool: 200,
        lookoutRangeKm: 15,
      },
      M: {
        dockingCapacity: 8,
        incomePer30Minutes: 800,
        storageTonnes: 2_000,
        crewPool: 400,
        lookoutRangeKm: 20,
      },
      L: {
        dockingCapacity: 16,
        incomePer30Minutes: 1_200,
        storageTonnes: 3_000,
        crewPool: 900,
        lookoutRangeKm: 30,
      },
    },
  },

  /** Goods, port production, prices and trading. Draft values. */
  trade: {
    /** Posted base prices in pieces of eight per tonne. */
    prices: {
      hides: 10,
      sugar: 15,
      tobacco: 20,
      coffee: 25,
      rum: 30,
      silver: 100,
      whaleOil: 20,
      provisions: 5,
      timber: 8,
      cloth: 10,
      repairMaterials: 12,
      ammunition: 15,
    },

    /** Port production and NPC stock, all on game time. Draft values. */
    production: {
      /** One production cycle lasts this many game days. Draft: 3. */
      cycleGameDays: 3,
      /** The port's regional good produced each cycle. Draft: 20 t. */
      regionalGoodTonnes: 20,
      /** Each of the two basic resources produced each cycle. Draft: 30 t. */
      basicResourceTonnes: 30,
      /** Repair materials a usable port produces each cycle. Draft: 10 t. */
      repairMaterialsTonnes: 10,
      /** Ammunition a usable port produces each cycle. Draft: 10 t. */
      ammunitionTonnes: 10,
      /** NPC stock cap per resource, by port size. Draft values. */
      npcStockCapTonnes: { S: 150, M: 300, L: 450 },
      /** NPC stock starts at this share of each resource cap. Draft: full. */
      npcStartStockShare: 1,
      /** NPC repair materials added each cycle. Draft: 30 t. */
      npcRefillRepairMaterialsTonnes: 30,
      /** NPC ammunition added each cycle. Draft: 30 t. */
      npcRefillAmmunitionTonnes: 30,
      /** Port storage starts at this share of its limit. Draft: half. */
      storageStartShare: 0.5,
    },

    /** Price movement. Draft values. */
    pricesCycle: {
      /** Prices change this often in game days. Draft: 60. */
      shiftGameDays: 60,
      /** Each region's new trend is within this share, up or down. Draft: 30%. */
      regionalTrendMax: 0.3,
      /** Each port's new random factor is within this share. Draft: 10%. */
      portRandomMax: 0.1,
      /** A port sells its own regional good for this share of its price. Draft: 75%. */
      producerFactor: 0.75,
      /** Posted prices never fall below this many pieces. */
      minimumPrice: 1,
    },

    /** Test and dev rooms consume provisions faster. Draft: ten times. */
    testHungerMultiplier: 10,
    /** Normal rooms consume provisions at the ordinary rate. */
    normalHungerMultiplier: 1,
    /** The largest &hunger= multiplier a test/dev room accepts. */
    maxTestHungerMultiplier: 1_000,
  },

  /** The four navies, their real starts and their draft hull colours. */
  navies: {
    British: {
      start: { lonDeg: -79.5, latDeg: 13 },
      flagshipCruiseKnots: 6,
      hullColor: "#9b2d2d",
      firstNpcPort: "Montego Bay",
    },
    Dutch: {
      start: { lonDeg: -45, latDeg: 3 },
      flagshipCruiseKnots: 5.5,
      hullColor: "#d9822b",
      firstNpcPort: "Belem",
    },
    Spanish: {
      start: { lonDeg: -50, latDeg: -37.5 },
      flagshipCruiseKnots: 5.5,
      hullColor: "#c9a227",
      firstNpcPort: "Maldonado",
    },
    French: {
      start: { lonDeg: -84, latDeg: -10 },
      flagshipCruiseKnots: 6.5,
      hullColor: "#2f4f8f",
      firstNpcPort: "Paita",
    },
  },

  /** The placeholder starting area for new players. */
  world: {
    /** New ships spawn this far from the start centre. */
    startRadiusKm: 6,
    /** New ships are never placed closer than this to each other. */
    minimumSeparationKm: 1.5,
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
    minBots: 0,
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
    /** Dev rooms send no more than this many blocks in any one second. */
    blockBatchPerSecond: 40,
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
    /** Below this view width the chart draws vector blocks, not its texture. */
    chartDetailThresholdKm: 300,
    /** Distance over which the texture and vector layers cross-fade. */
    chartDetailFadeKm: 40,
    /** How dark remembered land and sea are outside a live sight circle. */
    fogDimAlpha: 0.52,
    /** Mix of the remembered sea colour into paper. */
    dimSeaBlend: 0.74,
    /** Mix of the lighter water line into remembered land. */
    dimWaterBlend: 0.55,
    /** Mix of the ink coast into remembered land. */
    dimInkBlend: 0.62,
    /** Extra screen widths of nearby chart blocks kept ready while panning. */
    blockMarginScreens: 0.5,
    /** Hard ceiling on live block graphics; nearest blocks win. */
    maxLiveBlockGraphics: 300,
    /** Maximum side of the cached chart texture, in pixels. */
    chartCacheMaxPx: 2_048,
    /** The chart cache redraws no more often than this. */
    chartCacheRebuildMs: 1_000,
    /** Concentric soft rings outside each live sight circle. */
    sightFeatherRings: 3,
    /** Opacity of the innermost soft sight ring. */
    sightFeatherAlpha: 0.38,
    /** How quickly each outward sight ring fades. */
    sightFeatherFade: 0.7,
    /** Night wash over the ship view; the paper HUD and chart stay clear. */
    nightTintStrength: 0.32,
    /** Live wind streaks in the ship and chart views. */
    windStreakCount: 24,
    windStreakMinPx: 22,
    windStreakMaxPx: 88,
    windStreakAlpha: 0.22,
    windStreakWidthPx: 1.2,
    windStreakSpeedPxPerSec: 18,
    /** Port markers, label zoom rules and hit padding. */
    portMarkerRadiusPx: { S: 5, M: 6.5, L: 8 },
    portMarkerHitPadPx: 10,
    portLabelFontPx: 12,
    /** Route dots stay ten screen pixels apart at every zoom. */
    routeDotSpacingPx: 10,
    routeDotRadiusPx: 1.5,
    /** Remembered ports outside a sight circle are faded to this opacity. */
    portDimAlpha: 0.45,
    /** Medium labels appear at this zoom or closer, small only much closer. */
    mediumPortLabelMaxKm: 150,
    smallPortLabelMaxKm: 40,
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
    /** TEMP-DEBUG: 5 km grid is hidden when a cell is smaller than this. */
    borderGridMinPx: 12,
    borderLineAlpha: 0.5,
  },
} as const;

/** The shape of the whole settings file, for code that wants to pass it around. */
export type Settings = typeof settings;
