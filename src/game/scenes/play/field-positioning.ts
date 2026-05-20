import Phaser from "phaser";
import { Pitch } from "../../entities/Pitch";

export type AttackDirection = "north" | "south";

export const getLaneX = (pitch: Pitch, slotIndex: number): number => {
  const startX = pitch.fieldRect.x + 70;
  const endX = pitch.fieldRect.right - 70;
  return Phaser.Math.Linear(startX, endX, slotIndex / 12);
};

export const getKickoffCarrierY = (pitch: Pitch, attackDirection: AttackDirection): number => {
  // Flipped kickoff side: spawn on the opposite end from previous behavior.
  return pitch.getReceivingKickoffY(attackDirection === "south");
};

export const getKickingTeamKickoffY = (pitch: Pitch, attackDirection: AttackDirection): number => {
  const halfwayY = pitch.getLineYFromTopTryLine(50);
  const behindHalfwayMeters = 2.5;
  const behindHalfwayPixels = pitch.metersToPixels(behindHalfwayMeters);
  const receivingY = getKickoffCarrierY(pitch, attackDirection);
  const kickersStartBelowHalfway = receivingY < halfwayY;

  return Phaser.Math.Clamp(
    halfwayY + (kickersStartBelowHalfway ? behindHalfwayPixels : -behindHalfwayPixels),
    pitch.topTryLineY + 20,
    pitch.bottomTryLineY - 20,
  );
};

export const getDistanceFromOwnTryLine = (
  pitch: Pitch,
  attackDirection: AttackDirection,
  y: number,
): number => {
  return attackDirection === "north"
    ? pitch.bottomTryLineY - y
    : y - pitch.topTryLineY;
};

export const getDistanceFromOpponentTryLine = (
  pitch: Pitch,
  attackDirection: AttackDirection,
  y: number,
): number => {
  return attackDirection === "north"
    ? y - pitch.topTryLineY
    : pitch.bottomTryLineY - y;
};
