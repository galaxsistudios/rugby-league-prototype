import Phaser from "phaser";
import { GameSettings } from "../config/settings";
import { SettingsService } from "../services/SettingsService";

const COLOR_SWATCHES = [0x3f8aee, 0xee5f5f, 0x7fc96b, 0xf2ab4e, 0xbf6ce2, 0xdddddd];

export class CustomizationScene extends Phaser.Scene {
  private settings!: GameSettings;

  constructor() {
    super("CustomizationScene");
  }

  create(): void {
    this.settings = this.registry.get("settings") as GameSettings;
    const { width } = this.scale;

    this.cameras.main.setBackgroundColor("#36233d");

    this.add.text(width / 2, 80, "Customization", {
      fontFamily: "Verdana",
      fontSize: "52px",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.addNameRow("Home Team", "homeName", 190);
    this.addNameRow("Away Team", "awayName", 300);

    this.addColorRow("Home Color", "homeColor", 440);
    this.addColorRow("Away Color", "awayColor", 560);

    const back = this.add
      .text(width / 2, 675, "Back", {
        fontFamily: "Verdana",
        fontSize: "30px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    back.on("pointerdown", () => this.scene.start("MenuScene"));
  }

  private addNameRow(label: string, key: "homeName" | "awayName", y: number): void {
    const presets = key === "homeName"
      ? ["Harbor Hawks", "Iron Sharks", "Metro Kings"]
      : ["Valley Bulls", "Coastal Foxes", "River Riders"];

    const { width } = this.scale;
    const valueText = this.add.text(width / 2, y, `${label}: ${this.settings.teams[key]}`, {
      fontFamily: "Verdana",
      fontSize: "28px",
      color: "#f7f0ff",
    }).setOrigin(0.5);

    this.makeStepper(width / 2 - 230, y, "<", () => {
      this.cycleName(key, presets, -1);
      valueText.setText(`${label}: ${this.settings.teams[key]}`);
    });

    this.makeStepper(width / 2 + 230, y, ">", () => {
      this.cycleName(key, presets, 1);
      valueText.setText(`${label}: ${this.settings.teams[key]}`);
    });
  }

  private addColorRow(label: string, key: "homeColor" | "awayColor", y: number): void {
    const { width } = this.scale;

    const valueText = this.add.text(width / 2, y - 20, `${label}`, {
      fontFamily: "Verdana",
      fontSize: "28px",
      color: "#f7f0ff",
    }).setOrigin(0.5);

    const colorBox = this.add.rectangle(width / 2, y + 30, 140, 36, this.settings.teams[key]);

    this.makeStepper(width / 2 - 230, y + 30, "<", () => {
      this.cycleColor(key, -1);
      colorBox.fillColor = this.settings.teams[key];
      this.commit();
    });

    this.makeStepper(width / 2 + 230, y + 30, ">", () => {
      this.cycleColor(key, 1);
      colorBox.fillColor = this.settings.teams[key];
      this.commit();
    });

    valueText.setTint(this.settings.teams[key]);
  }

  private makeStepper(x: number, y: number, label: string, onClick: () => void): void {
    const button = this.add
      .text(x, y, label, {
        fontFamily: "Verdana",
        fontSize: "42px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on("pointerdown", onClick);
  }

  private cycleName(
    key: "homeName" | "awayName",
    values: string[],
    direction: 1 | -1,
  ): void {
    const currentIndex = values.indexOf(this.settings.teams[key]);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const next = Phaser.Math.Wrap(safeIndex + direction, 0, values.length);
    this.settings.teams[key] = values[next];
    this.commit();
  }

  private cycleColor(key: "homeColor" | "awayColor", direction: 1 | -1): void {
    const currentIndex = COLOR_SWATCHES.indexOf(this.settings.teams[key]);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const next = Phaser.Math.Wrap(safeIndex + direction, 0, COLOR_SWATCHES.length);
    this.settings.teams[key] = COLOR_SWATCHES[next];
  }

  private commit(): void {
    this.registry.set("settings", this.settings);
    SettingsService.save(this.settings);
  }
}
