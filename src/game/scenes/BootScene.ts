import Phaser from "phaser";
import { SettingsService } from "../services/SettingsService";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });

    graphics.fillStyle(0x2f7cff, 1);
    graphics.fillCircle(20, 20, 20);
    graphics.generateTexture("player", 40, 40);

    graphics.clear();
    graphics.fillStyle(0xf7d96f, 1);
    graphics.fillEllipse(24, 16, 36, 24);
    graphics.generateTexture("ball", 48, 32);

    graphics.destroy();
  }

  create(): void {
    const settings = SettingsService.load();
    this.registry.set("settings", settings);
    this.scene.start("MenuScene");
  }
}
