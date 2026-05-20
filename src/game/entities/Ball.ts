import Phaser from "phaser";

export class Ball extends Phaser.Physics.Arcade.Sprite {
  private carrier: Phaser.GameObjects.Sprite | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
    this.setImmovable(true);
  }

  setCarrier(carrier: Phaser.GameObjects.Sprite | null): void {
    this.carrier = carrier;
  }

  getCarrier(): Phaser.GameObjects.Sprite | null {
    return this.carrier;
  }

  updateFollow(): void {
    if (!this.carrier) {
      return;
    }

    this.x = this.carrier.x;
    this.y = this.carrier.y - 28;
  }
}
