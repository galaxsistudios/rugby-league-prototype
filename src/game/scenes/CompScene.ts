import Phaser from "phaser";

export class CompScene extends Phaser.Scene {
  constructor() {
    super("CompScene");
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor("#1f313d");

    this.add.text(width / 2, 120, "Comp Mode", {
      fontFamily: "Verdana",
      fontSize: "52px",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 - 40, "Competition system is in progress.", {
      fontFamily: "Verdana",
      fontSize: "28px",
      color: "#d6e5f5",
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 + 20, "This shell is wired and ready for bracket logic.", {
      fontFamily: "Verdana",
      fontSize: "22px",
      color: "#b3d2f3",
    }).setOrigin(0.5);

    const back = this.add
      .text(width / 2, height - 90, "Back", {
        fontFamily: "Verdana",
        fontSize: "36px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    back.on("pointerdown", () => this.scene.start("MenuScene"));
  }
}
