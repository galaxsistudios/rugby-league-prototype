import Phaser from "phaser";
import { createGameConfig } from "./config/game-config";

export const startGame = (parent: string | HTMLElement): Phaser.Game => {
  return new Phaser.Game(createGameConfig(parent));
};
