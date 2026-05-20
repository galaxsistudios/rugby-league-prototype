import { DEFAULT_SCORING_RULES, ScoringRules } from "./rugby-rules";

export interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
}

export interface TeamCustomization {
  homeName: string;
  awayName: string;
  homeColor: number;
  awayColor: number;
}

export interface PlayTheBallSettings {
  dummyHalfDelayMinSeconds: number;
  dummyHalfDelayMaxSeconds: number;
}

export interface GameSettings {
  verticalOnly: boolean;
  placeKickSkill: number;
  scoring: ScoringRules;
  audio: AudioSettings;
  teams: TeamCustomization;
  playTheBall: PlayTheBallSettings;
}

export const DEFAULT_SETTINGS: GameSettings = {
  verticalOnly: false,
  placeKickSkill: 65,
  scoring: DEFAULT_SCORING_RULES,
  audio: {
    musicVolume: 0.5,
    sfxVolume: 0.7,
  },
  teams: {
    homeName: "Harbor Hawks",
    awayName: "Valley Bulls",
    homeColor: 0x3f8aee,
    awayColor: 0xee5f5f,
  },
  playTheBall: {
    dummyHalfDelayMinSeconds: 2,
    dummyHalfDelayMaxSeconds: 3,
  },
};
