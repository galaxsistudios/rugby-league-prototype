import Phaser from "phaser";
import { ScoringRules } from "../config/rugby-rules";
import { Team } from "../entities/Team";

export class ScoringSystem {
  constructor(private readonly rules: ScoringRules) {}

  awardTry(team: Team): number {
    team.addPoints(this.rules.tryPoints);
    return this.rules.tryPoints;
  }

  attemptConversion(
    team: Team,
    kickX: number,
    postsCenterX: number,
    maxOffset: number,
    placeKickSkill: number,
  ): { points: number; success: boolean; chance: number } {
    const clampedSkill = Math.max(0, Math.min(100, placeKickSkill));
    const skillFactor = clampedSkill / 100;
    const offsetRatio = Math.min(1, Math.abs(kickX - postsCenterX) / Math.max(1, maxOffset));

    const chance = Phaser.Math.Clamp(skillFactor - offsetRatio * 0.45 + 0.35, 0.1, 0.95);
    const success = Math.random() <= chance;

    if (success) {
      team.addPoints(this.rules.conversionPoints);
      return {
        points: this.rules.conversionPoints,
        success,
        chance,
      };
    }

    return {
      points: 0,
      success,
      chance,
    };
  }
}
