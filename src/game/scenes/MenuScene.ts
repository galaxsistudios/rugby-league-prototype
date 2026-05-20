import Phaser from "phaser";
import { MenuButton } from "../ui/MenuButton";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super("MenuScene");
  }

  create(): void {
    const { width, height } = this.scale;

    this.cameras.main.setBackgroundColor("#163e25");

    this.add.text(width / 2, 100, "RL27", {
      fontFamily: "Verdana",
      fontSize: "74px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 8,
    }).setOrigin(0.5);

    this.add.text(width / 2, 170, "Rugby League - Vertical MVP", {
      fontFamily: "Verdana",
      fontSize: "24px",
      color: "#d8f1df",
    }).setOrigin(0.5);

    const entries: Array<{ label: string; target: string }> = [
      { label: "Play", target: "PlayScene" },
      { label: "Comp", target: "CompScene" },
      { label: "Options", target: "OptionsScene" },
      { label: "Customization", target: "CustomizationScene" },
    ];

    entries.forEach((entry, index) => {
      new MenuButton(this, width / 2, 280 + index * 84, entry.label, () => {
        this.scene.start(entry.target);
      });
    });
  }
}
