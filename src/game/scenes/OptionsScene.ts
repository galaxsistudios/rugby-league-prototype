import Phaser from "phaser";
import { GameSettings } from "../config/settings";
import { SettingsService } from "../services/SettingsService";

export class OptionsScene extends Phaser.Scene {
  private settings!: GameSettings;

  constructor() {
    super("OptionsScene");
  }

  create(): void {
    this.settings = this.registry.get("settings") as GameSettings;

    const { width } = this.scale;
    this.cameras.main.setBackgroundColor("#2e2d1b");

    this.add.text(width / 2, 90, "Options", {
      fontFamily: "Verdana",
      fontSize: "56px",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.addMovementToggleRow(160);

    this.addRuleRow("Try", "tryPoints", 225);
    this.addRuleRow("Conversion", "conversionPoints", 285);
    this.addRuleRow("Penalty", "penaltyPoints", 345);
    this.addRuleRow("Drop Goal", "dropGoalPoints", 405);

    this.addPlaceKickSkillRow(485);

    this.addAudioRow("Music", "musicVolume", 555);
    this.addAudioRow("SFX", "sfxVolume", 615);

    const note = this.add.text(width / 2, 665, "Place kick skill is currently a placeholder rating.", {
      fontFamily: "Verdana",
      fontSize: "18px",
      color: "#f6e7a2",
    });
    note.setOrigin(0.5);

    this.addBackButton();
  }

  private addRuleRow(label: string, key: keyof GameSettings["scoring"], y: number): void {
    const { width } = this.scale;
    const valueText = this.add.text(width / 2, y, `${label}: ${this.settings.scoring[key]}`, {
      fontFamily: "Verdana",
      fontSize: "30px",
      color: "#fdfdfd",
    }).setOrigin(0.5);

    this.makeStepper(width / 2 - 180, y, "-", () => {
      this.settings.scoring[key] = Math.max(0, this.settings.scoring[key] - 1);
      valueText.setText(`${label}: ${this.settings.scoring[key]}`);
      this.commitSettings();
    });

    this.makeStepper(width / 2 + 180, y, "+", () => {
      this.settings.scoring[key] += 1;
      valueText.setText(`${label}: ${this.settings.scoring[key]}`);
      this.commitSettings();
    });
  }

  private addAudioRow(label: string, key: keyof GameSettings["audio"], y: number): void {
    const { width } = this.scale;
    const valueText = this.add.text(
      width / 2,
      y,
      `${label}: ${Math.round(this.settings.audio[key] * 100)}%`,
      {
        fontFamily: "Verdana",
        fontSize: "28px",
        color: "#e5f3ff",
      },
    ).setOrigin(0.5);

    this.makeStepper(width / 2 - 180, y, "-", () => {
      this.settings.audio[key] = Phaser.Math.Clamp(this.settings.audio[key] - 0.1, 0, 1);
      valueText.setText(`${label}: ${Math.round(this.settings.audio[key] * 100)}%`);
      this.commitSettings();
    });

    this.makeStepper(width / 2 + 180, y, "+", () => {
      this.settings.audio[key] = Phaser.Math.Clamp(this.settings.audio[key] + 0.1, 0, 1);
      valueText.setText(`${label}: ${Math.round(this.settings.audio[key] * 100)}%`);
      this.commitSettings();
    });
  }

  private addMovementToggleRow(y: number): void {
    const { width } = this.scale;
    const valueText = this.add.text(width / 2, y, "", {
      fontFamily: "Verdana",
      fontSize: "28px",
      color: "#fdfdfd",
    }).setOrigin(0.5);

    const refreshText = (): void => {
      const movementMode = this.settings.verticalOnly ? "Vertical only" : "Full movement";
      valueText.setText(`Movement: ${movementMode}`);
    };

    refreshText();

    this.makeStepper(width / 2 - 180, y, "<", () => {
      this.settings.verticalOnly = !this.settings.verticalOnly;
      refreshText();
      this.commitSettings();
    });

    this.makeStepper(width / 2 + 180, y, ">", () => {
      this.settings.verticalOnly = !this.settings.verticalOnly;
      refreshText();
      this.commitSettings();
    });
  }

  private addPlaceKickSkillRow(y: number): void {
    const { width } = this.scale;
    const valueText = this.add.text(width / 2, y, "", {
      fontFamily: "Verdana",
      fontSize: "28px",
      color: "#fdfdfd",
    }).setOrigin(0.5);

    const refreshText = (): void => {
      valueText.setText(`Place Kick Skill: ${this.settings.placeKickSkill}`);
    };

    refreshText();

    this.makeStepper(width / 2 - 180, y, "-", () => {
      this.settings.placeKickSkill = Phaser.Math.Clamp(this.settings.placeKickSkill - 5, 0, 100);
      refreshText();
      this.commitSettings();
    });

    this.makeStepper(width / 2 + 180, y, "+", () => {
      this.settings.placeKickSkill = Phaser.Math.Clamp(this.settings.placeKickSkill + 5, 0, 100);
      refreshText();
      this.commitSettings();
    });
  }

  private makeStepper(x: number, y: number, text: string, onClick: () => void): void {
    const stepper = this.add
      .text(x, y, text, {
        fontFamily: "Verdana",
        fontSize: "42px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    stepper.on("pointerdown", onClick);
  }

  private addBackButton(): void {
    const { width } = this.scale;

    const back = this.add
      .text(width / 2, 700, "Back", {
        fontFamily: "Verdana",
        fontSize: "30px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    back.on("pointerdown", () => this.scene.start("MenuScene"));
  }

  private commitSettings(): void {
    this.registry.set("settings", this.settings);
    SettingsService.save(this.settings);
  }
}
