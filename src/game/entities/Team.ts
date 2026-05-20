export class Team {
  constructor(
    public readonly id: "home" | "away",
    public name: string,
    public color: number,
    public score = 0,
  ) {}

  addPoints(points: number): void {
    this.score += points;
  }
}
