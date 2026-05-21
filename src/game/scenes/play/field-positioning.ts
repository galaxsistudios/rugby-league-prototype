import Phaser from "phaser";
import { Pitch } from "../../entities/Pitch";

export type AttackDirection = "north" | "south";

export const getLaneX = (pitch: Pitch, slotIndex: number): number => {
  const startX = pitch.fieldRect.x + 70;
  const endX = pitch.fieldRect.right - 70;
  return Phaser.Math.Linear(startX, endX, slotIndex / 12);
};

export const getKickoffCarrierY = (pitch: Pitch, attackDirection: AttackDirection): number => {
  const halfwayMeters = 50;
  const receiveOffsetMeters = 10;
  return attackDirection === "north"
    ? pitch.getLineYFromTopTryLine(halfwayMeters - receiveOffsetMeters)
    : pitch.getLineYFromTopTryLine(halfwayMeters + receiveOffsetMeters);
};

export const getKickingTeamKickoffY = (pitch: Pitch, attackDirection: AttackDirection): number => {
  return pitch.getLineYFromTopTryLine(50);
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
