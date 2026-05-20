import Phaser from "phaser";
import { Team } from "../entities/Team";

export class HUD {
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly scoreLabel: Phaser.GameObjects.Text;
  private readonly statusLabel: Phaser.GameObjects.Text;
  private readonly directionLabel: Phaser.GameObjects.Text;
  private readonly tackleLabel: Phaser.GameObjects.Text;
  private camera: Phaser.Cameras.Scene2D.Camera | null = null;

  constructor(scene: Phaser.Scene) {
    this.panel = scene.add
      .rectangle(12, 10, 520, 96, 0x000000, 0.38)
      .setOrigin(0, 0)
      .setDepth(1999);

    this.scoreLabel = scene.add.text(30, 20, "", {
      fontFamily: "Verdana",
      fontSize: "24px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 5,
    }).setDepth(2000).setOrigin(0, 0);

    this.statusLabel = scene.add.text(30, 58, "", {
      fontFamily: "Verdana",
      fontSize: "20px",
      color: "#f8f6d9",
      stroke: "#000000",
      strokeThickness: 4,
    }).setDepth(2000).setOrigin(0, 0);

    this.directionLabel = scene.add.text(30, 92, "", {
      fontFamily: "Verdana",
      fontSize: "18px",
      color: "#c9ecff",
      stroke: "#000000",
      strokeThickness: 4,
    }).setDepth(2000).setOrigin(0, 0);

    this.tackleLabel = scene.add.text(30, 118, "", {
      fontFamily: "Verdana",
      fontSize: "18px",
      color: "#ffe6a8",
      stroke: "#000000",
      strokeThickness: 4,
    }).setDepth(2000).setOrigin(0, 0);

    this.layout();
  }

  attachToCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.camera = camera;
    this.layout();
  }

  updateScore(home: Team, away: Team): void {
    this.scoreLabel.setText(`${home.name} ${home.score} - ${away.score} ${away.name}`);
    this.layout();
  }

  setStatus(message: string): void {
    this.statusLabel.setText(message);
    this.layout();
  }

  setDirection(teamName: string, direction: "north" | "south"): void {
    const arrow = direction === "north" ? "^" : "v";
    this.directionLabel.setText(`Attack: ${teamName} ${arrow} ${direction}`);
    this.layout();
  }

  setTackleCount(current: number, max: number): void {
    this.tackleLabel.setText(`Tackle: ${current}/${max}`);
    this.layout();
  }

  private layout(): void {
    const marginX = 18;
    const marginY = 14;

    const baseX = this.camera ? this.camera.worldView.x + marginX : marginX;
    const baseY = this.camera ? this.camera.worldView.y + marginY : marginY;

    this.scoreLabel.setPosition(baseX, baseY);
    this.statusLabel.setPosition(baseX, baseY + 34);
    this.directionLabel.setPosition(baseX, baseY + 66);
    this.tackleLabel.setPosition(baseX, baseY + 90);

    const widest = Math.max(
      this.scoreLabel.width,
      this.statusLabel.width,
      this.directionLabel.width,
      this.tackleLabel.width,
      360,
    );

    this.panel.setPosition(baseX - 8, baseY - 6);
    this.panel.setSize(widest + 22, 122);
  }
}
