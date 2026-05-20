import Phaser from "phaser";

export class MenuButton {
  readonly text: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ) {
    this.text = scene.add
      .text(x, y, label, {
        fontFamily: "Verdana",
        fontSize: "42px",
        color: "#f2f6fb",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.text.setScale(1.08))
      .on("pointerout", () => this.text.setScale(1))
      .on("pointerdown", onClick);
  }
}
