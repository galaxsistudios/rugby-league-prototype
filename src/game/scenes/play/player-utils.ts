import Phaser from "phaser";
import { Ball } from "../../entities/Ball";
import { Player } from "../../entities/Player";

export const getClosestPlayerByDistance = (
  players: Player[],
  targetX: number,
  targetY: number,
): Player => {
  return players.reduce((best, current) => {
    const bestDistance = Phaser.Math.Distance.Between(best.x, best.y, targetX, targetY);
    const currentDistance = Phaser.Math.Distance.Between(current.x, current.y, targetX, targetY);
    return currentDistance < bestDistance ? current : best;
  });
};

export const getClosestPlayerByHorizontalDistance = (
  players: Player[],
  targetX: number,
): Player => {
  return players.reduce((best, current) => {
    const bestDistance = Math.abs(best.x - targetX);
    const currentDistance = Math.abs(current.x - targetX);
    return currentDistance < bestDistance ? current : best;
  });
};

export const isPlayerTouchingBall = (player: Player, ball: Ball): boolean => {
  const playerBody = player.body as Phaser.Physics.Arcade.Body | null;
  const ballBody = ball.body as Phaser.Physics.Arcade.Body | null;

  if (!playerBody || !ballBody) {
    return false;
  }

  const playerCenterX = playerBody.center.x;
  const playerCenterY = playerBody.center.y;
  const ballCenterX = ballBody.center.x;
  const ballCenterY = ballBody.center.y;
  const combinedHalfWidth = (playerBody.width + ballBody.width) * 0.5;
  const combinedHalfHeight = (playerBody.height + ballBody.height) * 0.5;

  return (
    Math.abs(playerCenterX - ballCenterX) <= combinedHalfWidth &&
    Math.abs(playerCenterY - ballCenterY) <= combinedHalfHeight
  );
};

export const movePlayerToward = (
  player: Player,
  targetX: number,
  targetY: number,
  speedScale: number,
): void => {
  const deltaX = targetX - player.x;
  const deltaY = targetY - player.y;
  const length = Math.hypot(deltaX, deltaY);

  if (length < 0.1) {
    player.haltHorizontal();
    player.haltVertical();
    return;
  }

  const velocityScale = (player.speed * player.getSpeedMultiplier() * speedScale) / length;
  player.setVelocity(deltaX * velocityScale, deltaY * velocityScale);
};
