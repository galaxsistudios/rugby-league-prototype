export type PlayerRole =
  | "fullback"
  | "winger"
  | "center"
  | "half"
  | "prop"
  | "second-row"
  | "hooker"
  | "lock";

export interface PlayerStats {
  strength: number;
  speed: number;
  passing: number;
  kicking: number;
  support: number;
}

const ROLE_BY_JERSEY: Record<number, PlayerRole> = {
  1: "fullback",
  2: "winger",
  3: "center",
  4: "center",
  5: "winger",
  6: "half",
  7: "half",
  8: "prop",
  9: "hooker",
  10: "prop",
  11: "second-row",
  12: "second-row",
  13: "lock",
};

const STATS_BY_ROLE: Record<PlayerRole, PlayerStats> = {
  fullback: { strength: 58, speed: 85, passing: 72, kicking: 62, support: 82 },
  winger: { strength: 62, speed: 90, passing: 56, kicking: 48, support: 88 },
  center: { strength: 74, speed: 78, passing: 62, kicking: 50, support: 72 },
  half: { strength: 54, speed: 80, passing: 86, kicking: 88, support: 76 },
  prop: { strength: 90, speed: 58, passing: 52, kicking: 40, support: 60 },
  "second-row": { strength: 82, speed: 66, passing: 58, kicking: 42, support: 66 },
  hooker: { strength: 70, speed: 72, passing: 90, kicking: 54, support: 92 },
  lock: { strength: 84, speed: 68, passing: 70, kicking: 46, support: 74 },
};

export const getRoleForJerseyNumber = (jerseyNumber: number): PlayerRole => {
  return ROLE_BY_JERSEY[jerseyNumber] ?? "lock";
};

export const getDefaultStatsForRole = (role: PlayerRole): PlayerStats => {
  return { ...STATS_BY_ROLE[role] };
};
