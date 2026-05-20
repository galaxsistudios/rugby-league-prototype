export interface ScoringRules {
  tryPoints: number;
  conversionPoints: number;
  penaltyPoints: number;
  dropGoalPoints: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  tryPoints: 4,
  conversionPoints: 2,
  penaltyPoints: 2,
  dropGoalPoints: 1,
};
