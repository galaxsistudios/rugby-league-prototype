import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
import { MenuScene } from "../scenes/MenuScene";
import { PlayScene } from "../scenes/PlayScene";
import { CompScene } from "../scenes/CompScene";
import { OptionsScene } from "../scenes/OptionsScene";
import { CustomizationScene } from "../scenes/CustomizationScene";

export const createGameConfig = (
  parent: string | HTMLElement,
): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0e5328",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    MenuScene,
    PlayScene,
    CompScene,
    OptionsScene,
    CustomizationScene,
  ],
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },
});
