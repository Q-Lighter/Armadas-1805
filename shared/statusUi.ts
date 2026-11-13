// 3E fit rules for the resign, eliminated and victory screens.
// Plain data: the browser draws it and the layout tests can check it.

export interface EndScreenLayout {
  margin: number;
  contentWidth: number;
  maxHeight: number;
  minTargetPx: number;
  columns: 1 | 2;
  scrolls: true;
  compact: boolean;
}

/** Fit a full-height status sheet inside the five review viewports. */
export function endScreenLayout(width: number, height: number): EndScreenLayout {
  const margin = width <= 640 ? 8 : 16;
  return {
    margin,
    contentWidth: Math.max(0, width - margin * 2),
    maxHeight: Math.max(0, height - margin * 2),
    minTargetPx: 44,
    columns: width >= 900 ? 2 : 1,
    scrolls: true,
    compact: width <= 640 || height <= 440,
  };
}

export interface ResignPlayerOption {
  id: string;
  name: string;
  navy: string;
  isTeammate: boolean;
}

/** Teammate first, then every other active player, then the Nobody choice. */
export function resignRecipients(
  players: readonly { id: string; name: string; navy: string }[],
  youId: string,
  teammateId: string | null,
): { choices: ResignPlayerOption[]; nobodyLabel: string } {
  const choices = players
    .filter((player) => player.id !== youId)
    .map((player) => ({
      id: player.id,
      name: player.name,
      navy: player.navy,
      isTeammate: player.id === teammateId,
    }))
    .sort((left, right) =>
      Number(right.isTeammate) - Number(left.isTeammate) ||
      left.name.localeCompare(right.name)
    );
  return { choices, nobodyLabel: "Nobody" };
}

export function eliminatedTitle(flagshipName: string | null, reason: string): string {
  return `Your flagship${flagshipName ? ` ${flagshipName}` : ""} was ${reason}. You are out of the game.`;
}

export function eliminatedByText(names: readonly string[]): string {
  return names.length > 0 ? `Defeated by ${names.join(", ")}.` : "No one defeated you.";
}

export function eliminatedAssetsText(
  heirNames: readonly string[],
  shipsGiven: number,
  moneyGiven: number,
): string {
  if (heirNames.length === 0) {
    return shipsGiven > 0
      ? "Your remaining ships were abandoned and your money was lost."
      : "Your remaining property was lost.";
  }
  return `Your ${shipsGiven} remaining ships and ${moneyGiven} pieces went to ${heirNames.join(", ")}.`;
}

export interface StatsRow {
  label: string;
  value: string;
}

/** The simple 3E stats table, shared by the eliminated and victory screens. */
export function statsRows(stats: {
  shipsSunk: number; shipsCaptured: number; shipsLost: number;
  flagshipsDestroyed: number; shotsFired: number; shotsHit: number;
  damageDealtPounds: number; crewKilled: number; prisonersTaken: number;
  shipsBought: number; moneyEarned: number; moneySpent: number;
  distanceSailedKm: number; gameDaysPlayed: number;
  flagshipSurvivedRealSeconds: number;
}): StatsRow[] {
  const whole = (value: number): string =>
    String(Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minutes = Math.max(0, stats.flagshipSurvivedRealSeconds) / 60;
  return [
    { label: "Ships sunk", value: whole(stats.shipsSunk) },
    { label: "Ships captured", value: whole(stats.shipsCaptured) },
    { label: "Ships lost", value: whole(stats.shipsLost) },
    { label: "Flagships destroyed", value: whole(stats.flagshipsDestroyed) },
    { label: "Shots fired", value: whole(stats.shotsFired) },
    { label: "Shots hit", value: whole(stats.shotsHit) },
    { label: "Damage dealt", value: `${whole(stats.damageDealtPounds)} lb` },
    { label: "Crew killed", value: whole(stats.crewKilled) },
    { label: "Prisoners taken", value: whole(stats.prisonersTaken) },
    { label: "Ships bought", value: whole(stats.shipsBought) },
    { label: "Money earned", value: whole(stats.moneyEarned) },
    { label: "Money spent", value: whole(stats.moneySpent) },
    { label: "Distance sailed", value: `${whole(stats.distanceSailedKm)} km` },
    { label: "Game days", value: (Math.max(0, stats.gameDaysPlayed)).toFixed(1) },
    { label: "Flagship survived", value: `${minutes.toFixed(1)} min` },
  ];
}

export interface VictoryRow {
  id: string;
  name: string;
  navy: string;
  flagshipName: string;
  left: string;
  winner: boolean;
  stats: StatsRow[];
}

export function victoryRows(players: readonly {
  id: string; name: string; navy: string; flagshipName: string | null;
  left: string; winner: boolean;
  stats: Parameters<typeof statsRows>[0];
}[]): VictoryRow[] {
  return players.map((player) => ({
    id: player.id,
    name: player.name,
    navy: player.navy,
    flagshipName: player.flagshipName ?? "—",
    left: player.left,
    winner: player.winner,
    stats: statsRows(player.stats),
  }));
}
