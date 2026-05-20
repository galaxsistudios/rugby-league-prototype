import Phaser from "phaser";
import { Pitch } from "../../entities/Pitch";
import { AttackDirection, getLaneX } from "./field-positioning";

export interface SlotTarget {
  slot: number;
  x: number;
  y: number;
}

export interface ScrumLayout {
  attackerTargets: SlotTarget[];
  defenderTargets: SlotTarget[];
}

export const getScrumLayout = (
  pitch: Pitch,
  scrumX: number,
  scrumY: number,
  attackDirection: AttackDirection,
): ScrumLayout => {
  const attBackDir = attackDirection === "north" ? 1 : -1;
  const defBackDir = -attBackDir;

  const rowDepth = pitch.metersToPixels(1.3);
  const propSpacing = pitch.metersToPixels(1.8);
  const srSpacing = pitch.metersToPixels(1.6);
  const halfSpacing = pitch.metersToPixels(3.5);

  const attFrontY = scrumY;
  const attSRY = scrumY + rowDepth * attBackDir;
  const attLockY = scrumY + rowDepth * 2 * attBackDir;
  const attHalfY = scrumY + rowDepth * 3.5 * attBackDir;

  const defFrontY = scrumY;
  const defSRY = scrumY + rowDepth * defBackDir;
  const defLockY = scrumY + rowDepth * 2 * defBackDir;

  const attackerTargets: SlotTarget[] = [
    { slot: 4, x: scrumX - propSpacing, y: attFrontY },
    { slot: 6, x: scrumX, y: attFrontY },
    { slot: 8, x: scrumX + propSpacing, y: attFrontY },
    { slot: 3, x: scrumX - srSpacing, y: attSRY },
    { slot: 9, x: scrumX + srSpacing, y: attSRY },
    { slot: 7, x: scrumX, y: attLockY },
    { slot: 2, x: scrumX - halfSpacing, y: attHalfY },
    { slot: 10, x: scrumX + halfSpacing, y: attHalfY },
  ];

  const defenderTargets: SlotTarget[] = [
    { slot: 4, x: scrumX - propSpacing, y: defFrontY },
    { slot: 6, x: scrumX, y: defFrontY },
    { slot: 8, x: scrumX + propSpacing, y: defFrontY },
    { slot: 3, x: scrumX - srSpacing, y: defSRY },
    { slot: 9, x: scrumX + srSpacing, y: defSRY },
    { slot: 7, x: scrumX, y: defLockY },
  ];

  const backLineSlots = [0, 1, 5, 11, 12];
  const attackerBackLineY = Phaser.Math.Clamp(
    scrumY + pitch.metersToPixels(9) * attBackDir,
    pitch.topTryLineY + 20,
    pitch.bottomTryLineY - 20,
  );
  const defenderBackLineY = Phaser.Math.Clamp(
    scrumY + pitch.metersToPixels(9) * defBackDir,
    pitch.topTryLineY + 20,
    pitch.bottomTryLineY - 20,
  );

  backLineSlots.forEach((slot) => {
    const laneX = getLaneX(pitch, slot);
    attackerTargets.push({ slot, x: laneX, y: attackerBackLineY });
    defenderTargets.push({ slot, x: laneX, y: defenderBackLineY });
  });

  return {
    attackerTargets,
    defenderTargets,
  };
};
