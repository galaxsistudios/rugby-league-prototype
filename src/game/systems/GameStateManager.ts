import { Team } from "../entities/Team";

export type MatchState = "kickoff" | "live" | "scored";

export class GameStateManager {
  private state: MatchState = "kickoff";

  get currentState(): MatchState {
    return this.state;
  }

  kickoff(): void {
    this.state = "live";
  }

  score(team: Team, points: number): string {
    this.state = "scored";
    return `${team.name} scored ${points} points`;
  }

  resetToKickoff(): void {
    this.state = "kickoff";
  }
}
