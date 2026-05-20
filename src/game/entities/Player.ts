import Phaser from "phaser";
import {
  getDefaultStatsForRole,
  getRoleForJerseyNumber,
  PlayerRole,
  PlayerStats,
} from "../config/player-profiles";

export class Player extends Phaser.Physics.Arcade.Sprite {
  readonly speed = 260;
  private jerseyNumberText: Phaser.GameObjects.Text | null = null;
  private role: PlayerRole = "lock";
  private stats: PlayerStats = getDefaultStatsForRole("lock");
  private jerseyNumber = 13;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.setDragX(800);
    this.setDragY(800);
    this.setMaxVelocity(this.speed, this.speed);
  }

  moveVertical(direction: number): void {
    this.setVelocityY(direction * this.speed);
  }

  setJerseyNumber(number: number): void {
    this.jerseyNumber = number;
    this.role = getRoleForJerseyNumber(number);
    this.stats = getDefaultStatsForRole(this.role);

    if (!this.jerseyNumberText) {
      this.jerseyNumberText = this.scene.add.text(this.x, this.y, "", {
        fontFamily: "Verdana",
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
      });
      this.jerseyNumberText.setOrigin(0.5);
      this.jerseyNumberText.setDepth(this.depth + 2);
    }

    this.jerseyNumberText.setText(String(number));
  }

  getRole(): PlayerRole {
    return this.role;
  }

  getStats(): PlayerStats {
    return this.stats;
  }

  getJerseyNumber(): number {
    return this.jerseyNumber;
  }

  getSpeedMultiplier(): number {
    return Phaser.Math.Clamp(this.stats.speed / 75, 0.65, 1.35);
  }

  moveHorizontal(direction: number): void {
    this.setVelocityX(direction * this.speed);
  }

  haltVertical(): void {
    this.setVelocityY(0);
  }

  haltHorizontal(): void {
    this.setVelocityX(0);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);

    if (this.jerseyNumberText) {
      this.jerseyNumberText.setPosition(this.x, this.y);
    }
  }

  destroy(fromScene?: boolean): void {
    if (this.jerseyNumberText) {
      this.jerseyNumberText.destroy();
      this.jerseyNumberText = null;
    }

    super.destroy(fromScene);
  }
}
