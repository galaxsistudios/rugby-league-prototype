import Phaser from "phaser";
import { Player } from "../entities/Player";

export class MovementController {
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private controlledPlayer: Player;
  private keys: {
    W: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  constructor(
    private readonly scene: Phaser.Scene,
    player: Player,
    private readonly allowLateral: boolean,
  ) {
    this.controlledPlayer = player;
    this.cursors = this.scene.input.keyboard!.createCursorKeys();
    this.keys = this.scene.input.keyboard!.addKeys("W,S,A,D") as {
      W: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    };
  }

  setControlledPlayer(player: Player): void {
    this.controlledPlayer = player;
  }

  update(): void {
    const moveUp = this.cursors.up.isDown || this.keys.W.isDown;
    const moveDown = this.cursors.down.isDown || this.keys.S.isDown;
    const moveLeft = this.allowLateral && (this.cursors.left.isDown || this.keys.A.isDown);
    const moveRight = this.allowLateral && (this.cursors.right.isDown || this.keys.D.isDown);

    if (moveUp && !moveDown) {
      this.controlledPlayer.moveVertical(-1);
    } else if (moveDown && !moveUp) {
      this.controlledPlayer.moveVertical(1);
    } else {
      this.controlledPlayer.haltVertical();
    }

    if (moveLeft && !moveRight) {
      this.controlledPlayer.moveHorizontal(-1);
    } else if (moveRight && !moveLeft) {
      this.controlledPlayer.moveHorizontal(1);
    } else {
      this.controlledPlayer.haltHorizontal();
    }
  }
}
