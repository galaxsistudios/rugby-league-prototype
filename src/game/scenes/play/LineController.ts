import Phaser from "phaser";
import { Player } from "../../entities/Player";
import { PlayContext } from "./PlayContext";

/**
 * Handles all per-frame line/formation updates:
 *  - attacking line advancement and support-player positioning
 *  - defender retreat / marker / rush logic
 *  - defensive offside visualisation
 *  - officials (referee + touch judges) dot rendering
 *  - controlled-player selection ring
 */
export class LineController {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: PlayContext,
  ) {}

  // ─── Attack line ─────────────────────────────────────────────────────────────

  updateAttackLineAndSupportPlayers(): void {
    const { ctx } = this;
    const { pitch } = ctx;
    this.refreshPersistentOffsideState();
    this.syncPossessionRolesFromCarrier();
    const isReforming = this.scene.time.now < ctx.lineReformUntil;
    const supportDirection = ctx.attackDirection === "north" ? 1 : -1;
    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    const isSetOpeningRun = ctx.currentTackleCount === 0 && !ctx.isInPlayTheBall;

    if (ctx.currentTackleCount !== ctx.maxTackles - 1) {
      ctx.firstReceiverPlayer = null;
      ctx.firstReceiverTargetX = null;
      ctx.firstReceiverTargetY = null;
    }

    const supportDepthPixels = pitch.metersToPixels(isSetOpeningRun ? 0 : ctx.supportDepthMeters);
    const podDepthPixels = pitch.metersToPixels(isSetOpeningRun ? 0 : ctx.supportPodDepthMeters);

    const lineAtCurrentDepth = ctx.attackingLineY + supportDepthPixels * supportDirection;
    const lineContactTolerance = pitch.metersToPixels(0.5);
    const toSupportLine = (ballCarrier.y - lineAtCurrentDepth) * supportDirection;
    const carrierTouchesLine = toSupportLine >= -lineContactTolerance;

    const forwardProgress = ctx.getForwardProgress(ctx.previousCarrierY, ballCarrier.y);
    const carrierMovingForward = forwardProgress > 0.2;
    const carrierMovingBackward = forwardProgress < -0.2;

    if (ctx.isLineHeldAfterPass) {
      ctx.attackingLineY = ctx.heldLineY;
      if (carrierMovingForward || carrierMovingBackward) {
        ctx.isLineHeldAfterPass = false;
      }
    } else {
      if (ctx.dragLineWithCarrier) {
        if (carrierMovingForward) {
          ctx.dragLineWithCarrier = false;
        } else {
          ctx.attackingLineY = ballCarrier.y - supportDepthPixels * supportDirection;
        }
      }

      if (!ctx.dragLineWithCarrier) {
        const desiredLineY = ctx.isBallInFlight ? ballCarrier.y - 28 : ctx.ball.y;
        const allowBackward = carrierMovingBackward;

        if (isReforming && !ctx.isInPlayTheBall) {
          ctx.attackingLineY = Phaser.Math.Linear(ctx.attackingLineY, desiredLineY, 0.025);
        } else {
          ctx.attackingLineY = allowBackward
            ? desiredLineY
            : ctx.attackDirection === "north"
              ? Math.min(ctx.attackingLineY, desiredLineY)
              : Math.max(ctx.attackingLineY, desiredLineY);
        }

        if (carrierMovingBackward && carrierTouchesLine) {
          ctx.dragLineWithCarrier = true;
          ctx.attackingLineY = ballCarrier.y - supportDepthPixels * supportDirection;
        }
      }
    }

    let targetSupportY = Phaser.Math.Clamp(
      ctx.attackingLineY + supportDepthPixels * supportDirection,
      pitch.topTryLineY + 20,
      pitch.bottomTryLineY - 20,
    );

    // Force line behind the play-the-ball mark after a tackle to reduce
    // accidental forward-pass positioning.
    if (ctx.currentTackleCount > 0) {
      const behindBuffer = pitch.metersToPixels(0.45);
      const maxNorth = ctx.playTheBallMarkY + supportDirection * behindBuffer;
      targetSupportY =
        ctx.attackDirection === "north"
          ? Math.max(targetSupportY, maxNorth)
          : Math.min(targetSupportY, maxNorth);
    }

    const startX = pitch.fieldRect.x + 70;
    const endX = pitch.fieldRect.right - 70;

    ctx.attackers.forEach((attacker, index) => {
      if (attacker === ctx.controlledPlayer) return;

      if (ctx.detachedFromLine.has(attacker)) {
        const rejoinThreshold = pitch.metersToPixels(0.75);
        if (Math.abs(attacker.y - targetSupportY) > rejoinThreshold) {
          attacker.haltHorizontal();
          attacker.haltVertical();
          return;
        }
        ctx.detachedFromLine.delete(attacker);
      }

      if (this.scene.tweens.isTweening(attacker)) return;

      const laneX = Phaser.Math.Linear(startX, endX, index / 12);
      const isLinePlayer = ctx.attackingLineIndices.includes(index);
      const isPodPlayer = ctx.supportPodIndices.includes(index);
      const podOffset = index <= 1 ? 0 : pitch.metersToPixels(2);
      const role = attacker.getRole();

      let targetY = isLinePlayer
        ? targetSupportY
        : isPodPlayer
          ? Phaser.Math.Clamp(
              ctx.attackingLineY + (podDepthPixels + podOffset) * supportDirection,
              pitch.topTryLineY + 20,
              pitch.bottomTryLineY - 20,
            )
          : targetSupportY;

      if (role === "winger") targetY = targetSupportY;

      if (role === "half" && ctx.currentTackleCount >= 4) {
        targetY = Phaser.Math.Clamp(
          targetY + pitch.metersToPixels(3.5) * supportDirection,
          pitch.topTryLineY + 20,
          pitch.bottomTryLineY - 20,
        );
      }

      if (role === "hooker" && ctx.currentTackleCount > 0) {
        const hookerTrackY = Phaser.Math.Clamp(
          ctx.playTheBallMarkY + pitch.metersToPixels(1.6) * supportDirection,
          pitch.topTryLineY + 20,
          pitch.bottomTryLineY - 20,
        );
        targetY = Phaser.Math.Linear(targetY, hookerTrackY, 0.55);
      }

      if (ctx.currentTackleCount > 0 && role !== "hooker") {
        const behindBuffer = pitch.metersToPixels(0.35);
        const maxBehindY = ctx.playTheBallMarkY + supportDirection * behindBuffer;
        targetY =
          ctx.attackDirection === "north"
            ? Math.max(targetY, maxBehindY)
            : Math.min(targetY, maxBehindY);
      }

      // Keep support runners behind the attacking line.
      const attackingBehindBuffer = pitch.metersToPixels(0.25);
      const attackingBehindY = ctx.attackingLineY + supportDirection * attackingBehindBuffer;
      targetY =
        ctx.attackDirection === "north"
          ? Math.max(targetY, attackingBehindY)
          : Math.min(targetY, attackingBehindY);

      const reformLerpScale = isReforming ? 0.4 : 1;
      const lateralLerp =
        (role === "winger" || role === "center" ? 0.03 : 0.06) * reformLerpScale;
      let hookerXTarget =
        role === "hooker" && ctx.currentTackleCount > 0
          ? Phaser.Math.Linear(laneX, ballCarrier.x, 0.4)
          : laneX;

      if (
        ctx.currentTackleCount === ctx.maxTackles - 1 &&
        ctx.firstReceiverPlayer === attacker &&
        ctx.firstReceiverTargetX !== null &&
        ctx.firstReceiverTargetY !== null
      ) {
        hookerXTarget = Phaser.Math.Linear(hookerXTarget, ctx.firstReceiverTargetX, 0.92);
        targetY = Phaser.Math.Linear(targetY, ctx.firstReceiverTargetY, 0.95);
      }

      const depthLerp =
        (role === "winger" || role === "center" ? 0.03 : 0.05) * reformLerpScale;
      const desiredY = Phaser.Math.Linear(attacker.y, targetY, depthLerp);
      const forwardOnlyY =
        ctx.attackDirection === "north"
          ? Math.min(attacker.y, desiredY)
          : Math.max(attacker.y, desiredY);

      attacker.setPosition(
        Phaser.Math.Linear(attacker.x, hookerXTarget, lateralLerp),
        carrierMovingBackward ? desiredY : forwardOnlyY,
      );
    });

    this.positionDefenders();
    this.applyTeamFacing();
    this.drawDebugFieldLines();
    ctx.previousCarrierY = ballCarrier.y;
  }

  // ─── Defence positioning ─────────────────────────────────────────────────────

  captureRuckState(): void {
    const { ctx } = this;
    if (!ctx.isInPlayTheBall) {
      ctx.markerDefenders = [];
      ctx.offsideDefendersAtRuck.clear();
      return;
    }

    ctx.offsideLineY = this.getDefensiveLineSnapshotY();
    ctx.markerDefenders = this.selectMarkerDefenders();
    const offsideDefenders = this.getOffsideDefenders();
    ctx.offsideDefendersAtRuck = new Set(offsideDefenders);
    offsideDefenders.forEach((defender) => ctx.offsideDefenders.add(defender));
  }

  clearRuckState(): void {
    this.ctx.markerDefenders = [];
    this.ctx.offsideDefendersAtRuck.clear();
  }

  positionDefenders(): void {
    const { ctx } = this;
    const { pitch } = ctx;
    if (ctx.defenders.length === 0) return;

    const forwardDir = ctx.attackDirection === "north" ? -1 : 1;
    const retreatPixels = pitch.metersToPixels(ctx.defensiveRetreatMeters);
    const markerAdvancePx = pitch.metersToPixels(1.3);

    const baseLineY = ctx.isInPlayTheBall
      ? Phaser.Math.Clamp(
          ctx.playTheBallMarkY + retreatPixels * forwardDir,
          pitch.topTryLineY + 20,
          pitch.bottomTryLineY - 20,
        )
      : Phaser.Math.Clamp(
          ctx.attackingLineY + pitch.metersToPixels(ctx.defensiveLineGapMeters) * forwardDir,
          pitch.topTryLineY + 20,
          pitch.bottomTryLineY - 20,
        );

    const canRush = !ctx.isInPlayTheBall && ctx.defendersCanAdvance;
    if (ctx.isInPlayTheBall && ctx.markerDefenders.length === 0) {
      this.captureRuckState();
    }
    const markerSet = new Set(ctx.markerDefenders);
    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    
    // Identify fullback and wingers for backline positioning
    const fullback = ctx.defenders.find(d => d.getRole() === "fullback");
    const wingers = ctx.defenders.filter(d => d.getRole() === "winger");
    const isFifthTackle = ctx.currentTackleCount === 5;
    
    // Check for line break: ball carrier is past the defensive line
    const avgDefensiveLineY = ctx.defenders.length > 0
      ? ctx.defenders.reduce((s, d) => s + d.y, 0) / ctx.defenders.length
      : baseLineY;
    const carrierPastLine = forwardDir === -1 
      ? ballCarrier.y < avgDefensiveLineY 
      : ballCarrier.y > avgDefensiveLineY;
    const isLineBreak = carrierPastLine && !ctx.isInPlayTheBall;

    if (canRush) {
      this.drawOfficialsOnDefensiveLine(avgDefensiveLineY);

      ctx.defenders.forEach((defender) => {
        if (this.scene.tweens.isTweening(defender)) return;
        const toCarrier = new Phaser.Math.Vector2(
          ballCarrier.x - defender.x,
          ballCarrier.y - defender.y,
        );
        if (toCarrier.lengthSq() < 1) {
          defender.haltHorizontal();
          defender.haltVertical();
          defender.setSprinting(false);
          return;
        }
        toCarrier.normalize();
        
        // AI stamina management: use stamina to sprint if available
        if (defender.hasStamina(1)) {
          defender.setSprinting(true);
          defender.drainStamina(defender.staminaDrainRate * 0.5); // AI drains slower
        } else {
          defender.setSprinting(false);
          defender.recoverStamina(defender.staminaRecoveryRate);
        }
        
        const speed = defender.speed * defender.getSpeedMultiplier() * ctx.defensiveChaseSpeedScale;
        defender.setVelocity(toCarrier.x * speed, toCarrier.y * speed);
      });
      return;
    }
    
    // Line break handling: only players closer than line chase
    if (isLineBreak) {
      this.drawOfficialsOnDefensiveLine(avgDefensiveLineY);
      
      ctx.defenders.forEach((defender) => {
        if (this.scene.tweens.isTweening(defender)) return;
        
        // Check if defender is behind the line (should not chase unless close)
        const defenderBehindLine = forwardDir === -1 
          ? defender.y > avgDefensiveLineY 
          : defender.y < avgDefensiveLineY;
        
        // Only chase if defender is ahead of or close to the line
        if (!defenderBehindLine) {
          const toCarrier = new Phaser.Math.Vector2(
            ballCarrier.x - defender.x,
            ballCarrier.y - defender.y,
          );
          if (toCarrier.lengthSq() < 1) {
            defender.haltHorizontal();
            defender.haltVertical();
            defender.setSprinting(false);
            return;
          }
          toCarrier.normalize();
          
          // AI stamina management for chase
          if (defender.hasStamina(1)) {
            defender.setSprinting(true);
            defender.drainStamina(defender.staminaDrainRate * 0.5);
          } else {
            defender.setSprinting(false);
            defender.recoverStamina(defender.staminaRecoveryRate);
          }
          
          const speed = defender.speed * defender.getSpeedMultiplier() * ctx.defensiveChaseSpeedScale;
          defender.setVelocity(toCarrier.x * speed, toCarrier.y * speed);
        } else {
          // Defender behind line - don't chase, just hold position or move slowly to backline
          defender.haltHorizontal();
          defender.haltVertical();
        }
      });
      return;
    }

    const targetLineY =
      ctx.isInPlayTheBall && !ctx.defendersCanAdvance
        ? baseLineY
        : Phaser.Math.Clamp(
            ctx.attackingLineY + pitch.metersToPixels(ctx.defensiveLineGapMeters) * forwardDir,
            pitch.topTryLineY + 20,
            pitch.bottomTryLineY - 20,
          );

    this.drawOfficialsOnDefensiveLine(targetLineY);

    const startX = pitch.fieldRect.x + 70;
    const endX = pitch.fieldRect.right - 70;
    const fieldWidth = pitch.fieldRect.width;
    
    // Determine which wingers should drop back on 5th tackle
    const wingersInBackline: Player[] = [];
    if (isFifthTackle) {
      wingers.forEach((winger) => {
        const wingerIndex = ctx.defenders.indexOf(winger);
        const isInTackle = ctx.markerDefenderIndices.includes(wingerIndex);
        if (!isInTackle) {
          wingersInBackline.push(winger);
        }
      });
    }
    
    // Build backline array (fullback + eligible wingers)
    const backlinePlayers: Player[] = [];
    if (fullback) backlinePlayers.push(fullback);
    backlinePlayers.push(...wingersInBackline);

    ctx.defenders.forEach((defender, index) => {
      if (this.scene.tweens.isTweening(defender)) return;
      
      const role = defender.getRole();
      const isFullback = role === "fullback";
      const isInBackline = backlinePlayers.includes(defender);

      // Fullback or backline positioning
      const reformLerpScale = this.scene.time.now < ctx.lineReformUntil ? 0.4 : 1;

      if (isFullback || isInBackline) {
        // Position 30m behind the line, but don't go over goal line
        const fullbackDepth = pitch.metersToPixels(30);
        let fullbackY = targetLineY + fullbackDepth * forwardDir;
        
        // Clamp to goal lines
        const goalLineBuffer = pitch.metersToPixels(2);
        if (forwardDir === -1) {
          // Attacking north (defending south goal)
          fullbackY = Math.max(fullbackY, pitch.topTryLineY + goalLineBuffer);
        } else {
          // Attacking south (defending north goal)
          fullbackY = Math.min(fullbackY, pitch.bottomTryLineY - goalLineBuffer);
        }
        
        // Position backline players (left, middle, right)
        let targetX = ctx.ball.x; // Default: inline with ball
        
        if (backlinePlayers.length === 2) {
          // 2 in backline: one left, one right
          const backlineIndex = backlinePlayers.indexOf(defender);
          if (backlineIndex === 0) {
            targetX = pitch.fieldRect.x + fieldWidth * 0.25; // Left
          } else {
            targetX = pitch.fieldRect.x + fieldWidth * 0.75; // Right
          }
        } else if (backlinePlayers.length === 3) {
          // 3 in backline: left, middle, right
          const backlineIndex = backlinePlayers.indexOf(defender);
          if (backlineIndex === 0) {
            targetX = pitch.fieldRect.x + fieldWidth * 0.2; // Left
          } else if (backlineIndex === 1) {
            targetX = pitch.fieldRect.centerX; // Middle
          } else {
            targetX = pitch.fieldRect.x + fieldWidth * 0.8; // Right
          }
        } else if (isFullback) {
          // Only fullback: stay inline with ball
          targetX = ctx.ball.x;
        }
        
        // Clamp X to field boundaries
        targetX = Phaser.Math.Clamp(targetX, startX, endX);
        
        defender.haltHorizontal();
        defender.haltVertical();
        defender.setPosition(
          Phaser.Math.Linear(defender.x, targetX, 0.04 * reformLerpScale),
          Phaser.Math.Linear(defender.y, fullbackY, 0.06 * reformLerpScale),
        );
      } else {
        // Standard defensive line positioning
        const laneX = Phaser.Math.Linear(startX, endX, index / 12);
        const shiftPx = ctx.isInPlayTheBall
          ? 0
          : pitch.metersToPixels(ctx.defensiveShiftMeters[index] ?? 0) * forwardDir;
        let targetY =
          ctx.isInPlayTheBall && markerSet.has(defender)
            ? targetLineY + markerAdvancePx * forwardDir
            : targetLineY + shiftPx;

        // Keep defenders behind their defensive line.
        targetY =
          ctx.attackDirection === "north"
            ? Math.min(targetY, targetLineY)
            : Math.max(targetY, targetLineY);

        defender.haltHorizontal();
        defender.haltVertical();
        defender.setPosition(
          Phaser.Math.Linear(defender.x, laneX, 0.04 * reformLerpScale),
          Phaser.Math.Linear(defender.y, targetY, 0.06 * reformLerpScale),
        );
      }
    });
  }

  reseedDefensiveShift(): void {
    const offsideChance = 0.14;
    this.ctx.defensiveShiftMeters = this.ctx.defenders.map((_, index) => {
      if (this.ctx.markerDefenderIndices.includes(index)) return 0;
      const base = Phaser.Math.FloatBetween(-1.2, 1.2);
      const forward =
        Math.random() < offsideChance ? Phaser.Math.FloatBetween(0.8, 2.2) : 0;
      return base + forward;
    });
  }

  // ─── Offside detection ───────────────────────────────────────────────────────

  checkDefensiveOffside(): void {
    this.refreshPersistentOffsideState();
    if (this.ctx.offsideDefenders.size === 0 && this.ctx.offsideDefendersAtRuck.size === 0) {
      this.clearOffsideRings();
      return;
    }
    this.drawOffsideRings(Array.from(this.ctx.offsideDefenders));
  }

  getOffsideDefenders(): Player[] {
    const { ctx } = this;
    const { pitch } = ctx;
    const retreatLineY = ctx.offsideLineY ?? this.getDefensiveLineSnapshotY();
    const markerSet = new Set(ctx.markerDefenders);
    return ctx.defenders.filter((defender) => {
      if (markerSet.has(defender)) return false;
      return this.isDefenderAheadOfDefensiveLine(defender, retreatLineY);
    });
  }

  isDefenderOffside(defender: Player): boolean {
    this.refreshPersistentOffsideState();
    return this.ctx.offsideDefenders.has(defender) || this.ctx.offsideDefendersAtRuck.has(defender);
  }

  private selectMarkerDefenders(): Player[] {
    const { ctx } = this;
    const targetX = ctx.ball.x;
    const targetY = ctx.playTheBallMarkY;

    return [...ctx.defenders]
      .sort((a, b) => {
        const da = Phaser.Math.Distance.Between(a.x, a.y, targetX, targetY);
        const db = Phaser.Math.Distance.Between(b.x, b.y, targetX, targetY);
        return da - db;
      })
      .slice(0, 2);
  }

  // ─── Graphics helpers ────────────────────────────────────────────────────────

  drawOffsideRings(players: Player[]): void {
    this.ctx.offsideGraphics.clear();
    if (players.length === 0) return;
    this.ctx.offsideGraphics.lineStyle(3, 0xffe56b, 1);
    players.forEach((p) => {
      this.ctx.offsideGraphics.strokeCircle(p.x, p.y, this.ctx.pitch.metersToPixels(0.8));
    });
  }

  clearOffsideRings(): void {
    this.ctx.offsideGraphics.clear();
  }

  private getDefensiveLineSnapshotY(): number {
    const { ctx } = this;
    const forwardDir = ctx.attackDirection === "north" ? -1 : 1;
    return Phaser.Math.Clamp(
      ctx.playTheBallMarkY + ctx.pitch.metersToPixels(ctx.defensiveRetreatMeters) * forwardDir,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );
  }

  private isDefenderAheadOfDefensiveLine(defender: Player, lineY: number): boolean {
    return this.ctx.attackDirection === "north"
      ? defender.y < lineY
      : defender.y > lineY;
  }

  private refreshPersistentOffsideState(): void {
    const { ctx } = this;
    const lineY = ctx.offsideLineY;
    if (lineY === null) return;

    for (const defender of Array.from(ctx.offsideDefenders)) {
      if (!this.isDefenderAheadOfDefensiveLine(defender, lineY)) {
        ctx.offsideDefenders.delete(defender);
      }
    }

    for (const defender of Array.from(ctx.offsideDefendersAtRuck)) {
      if (!this.isDefenderAheadOfDefensiveLine(defender, lineY)) {
        ctx.offsideDefendersAtRuck.delete(defender);
      }
    }
  }

  drawOfficialsOnDefensiveLine(lineY: number): void {
    if (!this.ctx.officialsGraphics) return;
    const { ctx } = this;
    const { pitch } = ctx;

    ctx.officialsGraphics.clear();

    const targetLineY = ctx.officialsLineOverrideY ?? lineY;
    const clampedY = Phaser.Math.Clamp(targetLineY, pitch.topTryLineY + 20, pitch.bottomTryLineY - 20);

    const startX = pitch.fieldRect.x + 70;
    const endX = pitch.fieldRect.right - 70;
    const laneGap = (endX - startX) / 12;
    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    const carrierLane = Phaser.Math.Clamp(
      Math.round((ballCarrier.x - startX) / laneGap),
      0,
      12,
    );
    const refLane =
      carrierLane <= 6
        ? Math.min(12, carrierLane + 2)
        : Math.max(0, carrierLane - 2);
    const refTargetX = Phaser.Math.Linear(startX, endX, refLane / 12);

    if (ctx.refereeDotX === null || ctx.refereeDotY === null) {
      ctx.refereeDotX = refTargetX;
      ctx.refereeDotY = clampedY;
    } else {
      ctx.refereeDotX = Phaser.Math.Linear(ctx.refereeDotX, refTargetX, ctx.officialsRunLerp);
      ctx.refereeDotY = Phaser.Math.Linear(ctx.refereeDotY, clampedY, ctx.officialsRunLerp);
    }

    const touchJudgeInset = 12;
    ctx.officialsGraphics.fillStyle(0xff8a2a, 1);
    ctx.officialsGraphics.fillCircle(ctx.refereeDotX, ctx.refereeDotY, 6);
    ctx.officialsGraphics.fillStyle(0xffe16a, 1);
    ctx.officialsGraphics.fillCircle(pitch.fieldRect.x + touchJudgeInset, clampedY, 5);
    ctx.officialsGraphics.fillCircle(pitch.fieldRect.right - touchJudgeInset, clampedY, 5);
  }

  drawControlledPlayerRing(): void {
    this.ctx.controlledPlayerRingGraphics.clear();
    if (!this.ctx.controlledPlayer) return;
    this.ctx.controlledPlayerRingGraphics.lineStyle(4, 0xff2d2d, 1);
    this.ctx.controlledPlayerRingGraphics.strokeCircle(
      this.ctx.controlledPlayer.x,
      this.ctx.controlledPlayer.y,
      24,
    );
  }

  clearTransientFieldIndicators(): void {
    this.clearOffsideRings();
    this.ctx.controlledPlayerRingGraphics.clear();
    this.ctx.kickAimGraphics.clear();
  }

  private drawDebugFieldLines(): void {
    const { ctx } = this;
    if (!ctx.debugEnabled || !ctx.debugLinesGraphics) return;

    const g = ctx.debugLinesGraphics;
    const left = ctx.pitch.fieldRect.x;
    const right = ctx.pitch.fieldRect.right;

    const attackLineY = Phaser.Math.Clamp(
      ctx.attackingLineY,
      ctx.pitch.topTryLineY + 12,
      ctx.pitch.bottomTryLineY - 12,
    );

    const forwardDir = ctx.attackDirection === "north" ? -1 : 1;
    const defensiveLineY = Phaser.Math.Clamp(
      ctx.attackingLineY + ctx.pitch.metersToPixels(ctx.defensiveLineGapMeters) * forwardDir,
      ctx.pitch.topTryLineY + 12,
      ctx.pitch.bottomTryLineY - 12,
    );

    g.clear();

    // Offensive line (cyan)
    g.lineStyle(2, 0x40d7ff, 0.85);
    g.lineBetween(left, attackLineY, right, attackLineY);

    // Defensive line (red)
    g.lineStyle(2, 0xff6b57, 0.85);
    g.lineBetween(left, defensiveLineY, right, defensiveLineY);
  }

  private syncPossessionRolesFromCarrier(): void {
    const carrier = this.ctx.getBallCarrier();
    if (!carrier) return;
    const hasHomeCarrier = this.ctx.homePlayers.includes(carrier);
    const expectedAttackingTeam: "home" | "away" = hasHomeCarrier ? "home" : "away";
    if (this.ctx.attackingTeamId !== expectedAttackingTeam) {
      this.ctx.setAttackingTeam(expectedAttackingTeam);
    }
  }

  private applyTeamFacing(): void {
    const attackFacesSouth = this.ctx.attackDirection === "south";
    const defenseFacesSouth = !attackFacesSouth;

    this.ctx.attackers.forEach((player) => {
      player.setFlipY(attackFacesSouth);
    });

    this.ctx.defenders.forEach((player) => {
      player.setFlipY(defenseFacesSouth);
    });
  }
}
