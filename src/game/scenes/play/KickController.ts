import Phaser from "phaser";
import { GameSettings } from "../../config/settings";
import { Player } from "../../entities/Player";
import { HUD } from "../../ui/HUD";
import {
  getClosestPlayerByHorizontalDistance,
  isPlayerTouchingBall,
  movePlayerToward,
} from "./player-utils";
import {
  getDistanceFromOpponentTryLine,
  getDistanceFromOwnTryLine,
} from "./field-positioning";
import { LineController } from "./LineController";
import { PlayContext } from "./PlayContext";
import { RestartController } from "./RestartController";
import { TackleController } from "./TackleController";

/**
 * Handles all kicking: charge input, aim, flight, kick-chase, ball recovery,
 * out-of-field resolution, offside penalty, and touchline restarts.
 */
export class KickController {
  private puntKey!: Phaser.Input.Keyboard.Key; // CTRL
  private bombKey!: Phaser.Input.Keyboard.Key; // ALT
  private chipKey!: Phaser.Input.Keyboard.Key; // SPACE
  private aimLeftKey!: Phaser.Input.Keyboard.Key; // A
  private aimRightKey!: Phaser.Input.Keyboard.Key; // D

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: PlayContext,
    private readonly hud: HUD,
    private readonly settings: GameSettings,
    private readonly line: LineController,
    private readonly tackle: TackleController,
    private readonly restart: RestartController,
  ) {}

  /** Must be called once after the Phaser keyboard is ready. */
  initKeys(): void {
    this.puntKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    this.bombKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ALT);
    this.chipKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.aimLeftKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.aimRightKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
  }

  // ─── Per-frame input ─────────────────────────────────────────────────────────

  updateInput(): void {
    const { ctx } = this;

    // Can't kick during certain states
    if (
      ctx.isInPlayTheBall ||
      ctx.isTurnoverPause ||
      ctx.isKickInFlight ||
      ctx.isKickLoose ||
      !ctx.isHomeTeamInPossession()
    ) return;

    // Start charging a kick
    if (!ctx.isKickCharging) {
      if (Phaser.Input.Keyboard.JustDown(this.puntKey)) {
        this.beginKickCharge("punt");
        return;
      }
      if (Phaser.Input.Keyboard.JustDown(this.bombKey)) {
        this.beginKickCharge("bomb");
        return;
      }
      if (Phaser.Input.Keyboard.JustDown(this.chipKey)) {
        this.beginKickCharge("chip");
        return;
      }
      return;
    }

    // Update aim while charging
    this.updateKickAim();

    // Release kick
    if (ctx.kickType === "punt" && Phaser.Input.Keyboard.JustUp(this.puntKey)) {
      this.releaseKick();
    } else if (ctx.kickType === "bomb" && Phaser.Input.Keyboard.JustUp(this.bombKey)) {
      this.releaseKick();
    } else if (ctx.kickType === "chip" && Phaser.Input.Keyboard.JustUp(this.chipKey)) {
      this.releaseKick();
    }
  }

  // ─── Per-frame kick flow (chase / ball claim) ─────────────────────────────────

  updateFlow(): void {
    this.updateKickChasePlayers();

    // Keep the ball airborne until landing logic resolves.
    if (this.ctx.isKickInFlight) return;

    const touching = this.getTouchingPlayerWithBall();
    if (!touching) return;

    if (this.ctx.kickOffsideAttackers.has(touching)) {
      this.resolveKickOffsidePenalty(touching);
      return;
    }

    this.attemptCatch(touching, this.ctx.attackers.includes(touching));
  }

  clearAimArrowIfNotCharging(): void {
    if (!this.ctx.isKickCharging) this.ctx.kickAimGraphics.clear();
  }

  armControlledKickoff(): void {
    const { ctx } = this;
    ctx.isKickoffSetPiece = true;
    ctx.isKickCharging = true;
    ctx.kickType = "punt";
    ctx.kickOwnerTeamId = ctx.attackingTeamId;
    ctx.kickAimSideMeters = 0;
    ctx.kickAimForwardMeters = 52;
    ctx.kickStartY = ctx.controlledPlayer.y;
    this.hud.setStatus("Kickoff: A/D to aim, press CTRL to kick.");
    this.drawKickAimArrow();
  }

  // ─── Charge ──────────────────────────────────────────────────────────────────

  private beginKickCharge(kickType: "punt" | "bomb" | "chip"): void {
    const { ctx } = this;

    if (ctx.isKickoffSetPiece) {
      if (!ctx.isKickCharging) return;
      this.updateKickAim();
      if (Phaser.Input.Keyboard.JustDown(this.puntKey)) {
        this.releaseKick();
      }
      return;
    }
    ctx.isKickCharging = true;
    ctx.kickType = kickType;
    ctx.kickOwnerTeamId = ctx.attackingTeamId;
    ctx.kickAimSideMeters = 0; // Start centered
    ctx.kickStartY = ctx.controlledPlayer.y; // Track start position for 40/20
    
    let message = "";
    if (kickType === "punt") {
      message = "PUNT: A/D to aim, release CTRL to kick (kicks in direction you're moving)";
      ctx.kickAimForwardMeters = 60; // Long kick downfield
    } else if (kickType === "bomb") {
      message = "BOMB: A/D to aim, release ALT to kick";
      ctx.kickAimForwardMeters = 30; // Medium distance, high arc
    } else {
      message = "CHIP: A/D to aim, release SPACE to kick";
      ctx.kickAimForwardMeters = 20; // Short kick
    }
    
    this.hud.setStatus(message);
    this.drawKickAimArrow();
  }

  private updateKickAim(): void {
    const { ctx } = this;
    const lateralStep = 1.2;

    // Only lateral aiming with A/D keys
    if (this.aimLeftKey.isDown) ctx.kickAimSideMeters -= lateralStep;
    if (this.aimRightKey.isDown) ctx.kickAimSideMeters += lateralStep;

    // Reduce lateral range so punt goes clearly downfield
    const maxLateral = ctx.kickType === "punt" ? 12 : 16;
    ctx.kickAimSideMeters = Phaser.Math.Clamp(ctx.kickAimSideMeters, -maxLateral, maxLateral);

    const aimDir = ctx.kickAimSideMeters === 0 ? "center" : 
                   ctx.kickAimSideMeters < 0 ? `${Math.round(Math.abs(ctx.kickAimSideMeters))}m left` :
                   `${Math.round(ctx.kickAimSideMeters)}m right`;
    
    let kickName = ctx.kickType === "punt" ? "PUNT" : 
                   ctx.kickType === "bomb" ? "BOMB" : "CHIP";
    this.hud.setStatus(`${kickName}: aiming ${aimDir}`);
    this.drawKickAimArrow();
  }

  // ─── Release ─────────────────────────────────────────────────────────────────

  private releaseKick(): void {
    const { ctx } = this;
    ctx.isKickCharging = false;
    ctx.kickAimGraphics.clear();
    ctx.isKickInFlight = true;
    ctx.kickBouncedOut = false;
    ctx.kickGroundedBeforeClaim = false;
    ctx.kickContestPlayers = [];

    const kicker = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    ctx.kickOffsideAttackers = new Set(
      ctx.getControlledTeamPlayers().filter(
        (p) => p !== kicker && this.isAheadOfKicker(p),
      ),
    );

    const fwdDir = ctx.attackDirection === "north" ? -1 : 1;
    const stats = kicker.getStats();
    
    // Determine kick direction based on player movement
    // If player is moving, kick in that direction
    // Otherwise, kick toward opponent try line
    let kickDirectionY = fwdDir;
    if (!ctx.isKickoffSetPiece) {
      const playerVelocity = kicker.body?.velocity;
      if (playerVelocity) {
        const velocityY = playerVelocity.y as number;
        if (Math.abs(velocityY) > 20) {
          // Player is moving significantly, use their movement direction.
          kickDirectionY = velocityY > 0 ? 1 : -1;
          console.log(`[KICK] Using player movement direction: ${kickDirectionY > 0 ? 'down' : 'up'}`);
        } else {
          console.log(`[KICK] Using attack direction: ${ctx.attackDirection} (${kickDirectionY > 0 ? 'down' : 'up'})`);
        }
      }
    }
    
    // Kick distance based on type and kicking skill
    let baseDistance = ctx.kickAimForwardMeters;
    const distScale = Phaser.Math.Linear(0.8, 1.25, stats.kicking / 100);
    const jitterM = (100 - stats.kicking) / 30;
    const sideJitter = Phaser.Math.FloatBetween(-jitterM, jitterM);
    const fwdJitter = Phaser.Math.FloatBetween(-jitterM * 0.6, jitterM * 0.6);

    console.log(`[KICK] Type: ${ctx.kickType}, BaseDistance: ${baseDistance}m, KickDir: ${kickDirectionY}`);

    const aimX = kicker.x + ctx.pitch.metersToPixels(ctx.kickAimSideMeters + sideJitter);
    const aimY =
      kicker.y +
      ctx.pitch.metersToPixels(baseDistance * distScale + fwdJitter) * kickDirectionY;

    console.log(`[KICK] Kicker Y: ${Math.round(kicker.y)}, Target Y: ${Math.round(aimY)}, Difference: ${Math.round(aimY - kicker.y)}px`);

    ctx.kickTargetX = Phaser.Math.Clamp(
      aimX,
      ctx.pitch.fieldRect.x - 60,
      ctx.pitch.fieldRect.right + 60,
    );
    ctx.kickTargetY = Phaser.Math.Clamp(
      aimY,
      ctx.pitch.topTryZone.y - 20,
      ctx.pitch.bottomTryZone.bottom + 20,
    );

    // Release ball from carrier and set initial kick position
    ctx.ball.setCarrier(null);
    this.scene.cameras.main.startFollow(ctx.ball, true, 0.2, 0.2);
    
    // Kill any existing tweens on the ball
    this.scene.tweens.killTweensOf(ctx.ball);
    
    const kickStartX = kicker.x;
    const kickStartY = kicker.y - 20;
    
    // Force ball position away from player
    ctx.ball.setPosition(kickStartX, kickStartY);
    ctx.ball.setAngle(0);
    ctx.ball.setScale(1);
    
    // Stop any velocity on the ball
    if (ctx.ball.body) {
      const body = ctx.ball.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      body.stop();
    }
    
    console.log(`[KICK] Ball FORCED to (${Math.round(kickStartX)}, ${Math.round(kickStartY)}), carrier=${ctx.ball.getCarrier()}, target (${Math.round(ctx.kickTargetX)}, ${Math.round(ctx.kickTargetY)})`);

    const dist = Phaser.Math.Distance.Between(
      kickStartX, kickStartY,
      ctx.kickTargetX, ctx.kickTargetY,
    );
    
    console.log(`[KICK] Distance to travel: ${Math.round(dist)}px`);
    
    // Duration and arc based on kick type
    let duration: number;
    let arcMultiplier: number;
    
    if (ctx.kickType === "punt") {
      duration = Phaser.Math.Clamp(600 + dist * 6, 800, 1800); // Faster punt
      arcMultiplier = 0.25; // Low arc for punt (flatter trajectory)
      this.hud.setStatus(`Punt downfield ${Math.round(baseDistance)}m...`);
    } else if (ctx.kickType === "bomb") {
      duration = Phaser.Math.Clamp(700 + dist * 12, 800, 1600);
      arcMultiplier = 0.65; // High arc for bomb
      this.hud.setStatus("Bomb up...");
    } else { // chip
      duration = Phaser.Math.Clamp(500 + dist * 10, 600, 1200);
      arcMultiplier = 0.45; // Medium arc for chip
      this.hud.setStatus("Chip kick...");
    }

    const arcHeightPx = Phaser.Math.Clamp(dist * arcMultiplier, 26, 170);

    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: "Sine.Out",
      onStart: () => {
        console.log(`[KICK] Tween started! Ball at (${Math.round(ctx.ball.x)}, ${Math.round(ctx.ball.y)})`);
      },
      onUpdate: (tween) => {
        const progress = Number(tween.getValue());
        const baseX = Phaser.Math.Linear(kickStartX, ctx.kickTargetX, progress);
        const baseY = Phaser.Math.Linear(kickStartY, ctx.kickTargetY, progress);
        const heightProgress = Math.sin(progress * Math.PI);
        const arcOffset = heightProgress * arcHeightPx;

        // Move ball along flight path toward the landing spot.
        ctx.ball.setPosition(baseX, baseY - arcOffset);

        const rotationSpeed = 480;
        ctx.ball.setAngle(progress * rotationSpeed);

        const scaleMultiplier = 1 + (heightProgress * arcMultiplier);
        ctx.ball.setScale(scaleMultiplier);

        // Check for bounce (when ball is at ~70% through flight for punt)
        if (ctx.kickType === "punt" && progress > 0.7 && progress < 0.71 && !ctx.kickBouncedOut) {
          ctx.kickLastBounceY = Phaser.Math.Linear(kickStartY, ctx.kickTargetY, 0.85);
        }
      },
      onComplete: () => {
        ctx.ball.setAngle(0);
        ctx.ball.setScale(1);
        ctx.ball.setPosition(ctx.kickTargetX, ctx.kickTargetY);
        
        console.log(`[KICK] Kick complete at (${Math.round(ctx.kickTargetX)}, ${Math.round(ctx.kickTargetY)})`);
        
        if (this.isKickOutOfField()) {
          ctx.isKickInFlight = false;
          ctx.kickBouncedOut = true;
          this.resolveKickTouchOut();
          return;
        }

        if (this.isOverDeadBallLine()) {
          this.resolveKickDeadBall();
          return;
        }
        
        // Handle landing based on kick type
        if (ctx.kickType === "bomb") {
          ctx.isKickInFlight = false;
          this.resolveBombContest();
        } else {
          this.animateKickGroundBounce(() => {
            ctx.isKickInFlight = false;
            ctx.kickGroundedBeforeClaim = true;
            if (this.isBallBeyondDeadBallLineNow()) {
              ctx.kickTargetX = ctx.ball.x;
              ctx.kickTargetY = ctx.ball.y;
              this.resolveKickDeadBall();
              return;
            }
            ctx.isKickLoose = true;
            this.hud.setStatus("Kick chase.");
          });
        }
      },
    });
  }

  // ─── Chase ───────────────────────────────────────────────────────────────────

  private updateKickChasePlayers(): void {
    const tx = this.ctx.ball.x;
    const ty = this.ctx.ball.y;

    this.ctx.attackers.forEach((a) => {
      if (!this.scene.tweens.isTweening(a)) movePlayerToward(a, tx, ty, 0.9);
    });
    this.ctx.defenders.forEach((d) => {
      if (!this.scene.tweens.isTweening(d)) movePlayerToward(d, tx, ty, 1);
    });
  }

  private getTouchingPlayerWithBall(): Player | null {
    const all = [...this.ctx.attackers, ...this.ctx.defenders];
    return all.find((p) => isPlayerTouchingBall(p, this.ctx.ball)) ?? null;
  }

  // ─── Resolution ──────────────────────────────────────────────────────────────

  private resolveKickOffsidePenalty(_player: Player): void {
    const { ctx } = this;
    ctx.isKickLoose = false;
    ctx.isKickInFlight = false;
    const restartX =
      ctx.ball.x < ctx.pitch.fieldRect.centerX
        ? ctx.pitch.fieldRect.x
        : ctx.pitch.fieldRect.right;
    this.hud.setStatus("Offside touch. Penalty.");
    this.restartAtTouchLine(ctx.ball.y, restartX, false, "Offside touch. Other team restart.");
  }

  private resolveKickTouchOut(): void {
    const { ctx } = this;
    const restartX =
      ctx.ball.x < ctx.pitch.fieldRect.centerX
        ? ctx.pitch.fieldRect.x
        : ctx.pitch.fieldRect.right;
    const restartY = Phaser.Math.Clamp(
      ctx.ball.y,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );

    // Check if out on the full (no bounce)
    if (ctx.kickType === "punt" && !ctx.kickBouncedOut) {
      // Out on full - defending team gets ball where it was kicked
      const kickerY = ctx.kickStartY;
      this.restartAtTouchLine(
        kickerY,
        restartX,
        false,
        "Out on full! Defence gets ball at kick position."
      );
      return;
    }

    // Check for 40/20 rule (only for punts)
    if (ctx.kickType === "punt" && ctx.kickBouncedOut) {
      const kickerDistFromOwnTryLine = getDistanceFromOwnTryLine(
        ctx.pitch,
        ctx.attackDirection,
        ctx.kickStartY
      );
      const landDistFromOppTryLine = getDistanceFromOpponentTryLine(
        ctx.pitch,
        ctx.attackDirection,
        restartY
      );

      // 40/20: Kicked from own 40m area, bounced and landed in opponent's 20m
      if (kickerDistFromOwnTryLine <= 40 && landDistFromOppTryLine <= 20) {
        // Use the last bounce position for restart
        const bounceRestartY = Phaser.Math.Clamp(
          ctx.kickLastBounceY,
          ctx.pitch.topTryLineY + 20,
          ctx.pitch.bottomTryLineY - 20,
        );
        this.restartAtTouchLine(
          bounceRestartY,
          restartX,
          true,
          "40/20! Kicking team retains possession!"
        );
        return;
      }
    }

    // Normal bounce out - play the ball where it bounced last
    if (ctx.kickBouncedOut) {
      const bounceRestartY = Phaser.Math.Clamp(
        ctx.kickLastBounceY,
        ctx.pitch.topTryLineY + 20,
        ctx.pitch.bottomTryLineY - 20,
      );
      this.restartAtTouchLine(
        bounceRestartY,
        restartX,
        false,
        "Bounced out. Other team's ball."
      );
      return;
    }

    // Default: kick went out (not punt or no special rules)
    this.restartAtTouchLine(restartY, restartX, false, "Kick out. Other team restart.");
  }

  private attemptCatch(player: Player, sameTeam: boolean): void {
    const { ctx } = this;
    ctx.isKickoffSetPiece = false;
    ctx.isKickLoose = false;
    ctx.isKickInFlight = false;

    // Calculate catch success based on stamina
    const staminaPercent = player.getStaminaPercent();
    const catchSkill = player.getStats().speed / 100; // Using speed as catch ability
    const baseCatchChance = 0.85; // 85% base catch rate
    const staminaBonus = staminaPercent * 0.15; // Up to 15% bonus from stamina
    const skillBonus = catchSkill * 0.10; // Up to 10% bonus from skill
    const catchChance = baseCatchChance + staminaBonus + skillBonus;

    const catchSuccess = Math.random() < catchChance;

    if (!catchSuccess) {
      // Knock-on! Ball falls to ground
      this.hud.setStatus("KNOCK-ON! Turnover.");
      ctx.ball.setPosition(player.x, player.y + 20);
      
      // Award to other team
      const receivingTeam = sameTeam ? ctx.defenders : ctx.attackers;
      const nearest = getClosestPlayerByHorizontalDistance(receivingTeam, player.x);
      this.tackle.triggerTurnover(nearest);
      this.scene.cameras.main.startFollow(nearest, true, 0.16, 0.16);
      return;
    }

    // Successful catch
    if (!sameTeam) {
      if (this.isCleanCatchInDefendersInGoal(player)) {
        this.handleInGoalCleanCatch20mRestart(player);
        return;
      }

      this.tackle.triggerTurnover(player);
      ctx.ball.setPosition(player.x, player.y - 28);
      this.scene.cameras.main.startFollow(player, true, 0.16, 0.16);
      this.hud.setStatus("Kick caught by defence.");
      return;
    }

    // Same team caught it
    ctx.controlledPlayer = player;
    ctx.controlledPlayer.setScale(1.12);
    ctx.movement.setControlledPlayer(ctx.controlledPlayer);
    ctx.ball.setCarrier(ctx.controlledPlayer);
    ctx.ball.updateFollow();
    this.scene.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
    ctx.lineReformUntil = this.scene.time.now + 2200;
    this.hud.setStatus("Kick caught - tackle count continues.");
  }

  private resolveBombContest(): void {
    const { ctx } = this;
    
    // Find all players near the landing spot (within 40 pixels)
    const contestRadius = 40;
    const allPlayers = [...ctx.attackers, ...ctx.defenders];
    ctx.kickContestPlayers = allPlayers.filter((p) => {
      const dist = Phaser.Math.Distance.Between(p.x, p.y, ctx.ball.x, ctx.ball.y);
      return dist < contestRadius;
    });

    if (ctx.kickContestPlayers.length === 0) {
      // No one there, let it bounce before becoming a loose ball.
      this.animateKickGroundBounce(() => {
        ctx.kickGroundedBeforeClaim = true;
        ctx.isKickLoose = true;
        this.hud.setStatus("Bomb lands - no contest!");
      });
      return;
    }

    // Contest: each player has a chance based on their jumping/speed stats and stamina
    let bestPlayer: Player | null = null;
    let bestScore = -1;

    for (const player of ctx.kickContestPlayers) {
      const jumpSkill = player.getStats().speed / 100; // Using speed as jump ability
      const staminaFactor = player.getStaminaPercent();
      const contestScore = (jumpSkill * 0.6 + staminaFactor * 0.4) * Math.random();
      
      if (contestScore > bestScore) {
        bestScore = contestScore;
        bestPlayer = player;
      }
    }

    if (!bestPlayer) {
      this.animateKickGroundBounce(() => {
        ctx.kickGroundedBeforeClaim = true;
        ctx.isKickLoose = true;
        this.hud.setStatus("Bomb spilled!");
      });
      return;
    }

    // Winner claims the ball
    const wonByAttacker = ctx.attackers.includes(bestPlayer);
    
    // Check for knock-on in contest (lower chance than regular catch)
    const contestCatchChance = 0.7 + (bestPlayer.getStaminaPercent() * 0.2);
    if (Math.random() > contestCatchChance) {
      this.hud.setStatus("Knock-on in contest! Scrum.");
      ctx.ball.setPosition(bestPlayer.x, bestPlayer.y + 20);
      ctx.kickGroundedBeforeClaim = true;
      // Award scrum to other team
      const receivingTeam = wonByAttacker ? ctx.defenders : ctx.attackers;
      const nearest = getClosestPlayerByHorizontalDistance(receivingTeam, bestPlayer.x);
      this.tackle.triggerTurnover(nearest);
      this.scene.cameras.main.startFollow(nearest, true, 0.16, 0.16);
      return;
    }

    // Successful contest catch
    if (!wonByAttacker) {
      ctx.isKickoffSetPiece = false;
      if (this.isCleanCatchInDefendersInGoal(bestPlayer)) {
        this.handleInGoalCleanCatch20mRestart(bestPlayer);
        return;
      }
      this.tackle.triggerTurnover(bestPlayer);
      ctx.ball.setPosition(bestPlayer.x, bestPlayer.y - 28);
      this.scene.cameras.main.startFollow(bestPlayer, true, 0.16, 0.16);
      this.hud.setStatus("Defence wins bomb contest!");
    } else {
      ctx.isKickoffSetPiece = false;
      ctx.controlledPlayer = bestPlayer;
      ctx.controlledPlayer.setScale(1.12);
      ctx.movement.setControlledPlayer(ctx.controlledPlayer);
      ctx.ball.setCarrier(ctx.controlledPlayer);
      ctx.ball.updateFollow();
      this.scene.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
      ctx.lineReformUntil = this.scene.time.now + 2200;
      this.hud.setStatus("Attack wins bomb - tackle count continues!");
    }
  }

  /** Shared touchline-restart used by offside penalty and kick-out. */
  private restartAtTouchLine(
    restartY: number,
    restartX: number,
    retainPossession: boolean,
    status: string,
  ): void {
    const { ctx } = this;
    
    // Recover 3% stamina on stoppage
    [...ctx.homePlayers, ...ctx.awayPlayers].forEach((player) => {
      player.recoverStamina(3);
    });
    
    ctx.isKickCharging = false;
    ctx.isKickInFlight = false;
    ctx.isKickLoose = false;
    ctx.kickOffsideAttackers.clear();
    ctx.kickAimGraphics.clear();
    ctx.ball.setCarrier(null);

    if (!retainPossession) {
      const nextAttacker = ctx.attackingTeamId === "home" ? "away" : "home";
      ctx.setAttackingTeam(nextAttacker);
    }

    this.restart.resetSetState();

    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    ctx.attackers.forEach((a, i) => {
      a.setPosition(Phaser.Math.Linear(startX, endX, i / 12), restartY);
      a.setScale(1);
      a.haltHorizontal();
      a.haltVertical();
    });
    ctx.defenders.forEach((d, i) => {
      d.setPosition(Phaser.Math.Linear(startX, endX, i / 12), restartY);
      d.setScale(1);
      d.haltHorizontal();
      d.haltVertical();
    });

    const carrier = getClosestPlayerByHorizontalDistance(ctx.attackers, restartX);
    ctx.ball.setCarrier(carrier);
    ctx.ball.setPosition(carrier.x, carrier.y - 28);
    ctx.ball.updateFollow();
    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);

    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    ctx.attackingLineY = ballCarrier.y - 28;
    ctx.previousCarrierY = ballCarrier.y;

    this.line.reseedDefensiveShift();
    this.line.positionDefenders();

    this.hud.updateScore(ctx.home, ctx.away);
    this.hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    this.hud.setStatus(status);
    this.hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);
  }

  // ─── Kick aim arrow ──────────────────────────────────────────────────────────

  drawKickAimArrow(): void {
    const { ctx } = this;
    ctx.kickAimGraphics.clear();
    if (!ctx.isKickCharging) return;

    const fwdDir = ctx.attackDirection === "north" ? -1 : 1;
    
    // Determine arrow direction based on player movement
    let arrowDirectionY = fwdDir;
    const playerVelocity = ctx.controlledPlayer.body?.velocity;
    if (playerVelocity) {
      const velocityY = playerVelocity.y as number;
      if (Math.abs(velocityY) > 20) {
        arrowDirectionY = velocityY > 0 ? 1 : -1;
      }
    }
    
    const startX = ctx.controlledPlayer.x;
    const startY = ctx.controlledPlayer.y - 22;
    const endX = Phaser.Math.Clamp(
      startX + ctx.pitch.metersToPixels(ctx.kickAimSideMeters),
      ctx.pitch.fieldRect.x + 20,
      ctx.pitch.fieldRect.right - 20,
    );
    const kickoffDirectionY = ctx.attackDirection === "north" ? -1 : 1;
    const endY = Phaser.Math.Clamp(
      startY + ctx.pitch.metersToPixels(ctx.kickAimForwardMeters) * (ctx.isKickoffSetPiece ? kickoffDirectionY : arrowDirectionY),
      ctx.pitch.topTryLineY + 18,
      ctx.pitch.bottomTryLineY - 18,
    );

    ctx.kickAimGraphics.lineStyle(5, 0xffb14a, 0.95);
    ctx.kickAimGraphics.lineBetween(startX, startY, endX, endY);

    const angle = Math.atan2(endY - startY, endX - startX);
    const headLen = 16;
    const spread = Math.PI / 7;
    ctx.kickAimGraphics.fillStyle(0xff8a2a, 0.95);
    ctx.kickAimGraphics.fillTriangle(
      endX, endY,
      endX - Math.cos(angle - spread) * headLen, endY - Math.sin(angle - spread) * headLen,
      endX - Math.cos(angle + spread) * headLen, endY - Math.sin(angle + spread) * headLen,
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private isKickOutOfField(): boolean {
    return (
      this.ctx.kickTargetX <= this.ctx.pitch.fieldRect.x ||
      this.ctx.kickTargetX >= this.ctx.pitch.fieldRect.right
    );
  }

  private isOverDeadBallLine(): boolean {
    const { ctx } = this;
    return (
      ctx.kickTargetY <= ctx.pitch.fieldRect.y ||
      ctx.kickTargetY >= ctx.pitch.fieldRect.bottom
    );
  }

  private isBallBeyondDeadBallLineNow(): boolean {
    return (
      this.ctx.ball.y <= this.ctx.pitch.fieldRect.y ||
      this.ctx.ball.y >= this.ctx.pitch.fieldRect.bottom
    );
  }

  private isCleanCatchInDefendersInGoal(player: Player): boolean {
    const { ctx } = this;
    if (ctx.kickGroundedBeforeClaim) return false;

    const inTop = Phaser.Geom.Rectangle.Contains(ctx.pitch.topTryZone, player.x, player.y);
    const inBottom = Phaser.Geom.Rectangle.Contains(ctx.pitch.bottomTryZone, player.x, player.y);
    const defendersOwnGoalIsTop = ctx.attackDirection === "north";
    return defendersOwnGoalIsTop ? inTop : inBottom;
  }

  private handleInGoalCleanCatch20mRestart(receiver: Player): void {
    const { ctx, hud } = this;

    this.tackle.triggerTurnover(receiver);

    ctx.setTackleBonus = 1;
    const setLimit = ctx.maxTackles + ctx.setTackleBonus;
    const restartY = this.getTwentyMeterRestartY();
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    ctx.attackers.forEach((a, i) => {
      a.setPosition(Phaser.Math.Linear(startX, endX, i / 12), restartY);
      a.setScale(1);
      a.haltHorizontal();
      a.haltVertical();
    });

    ctx.defenders.forEach((d, i) => {
      d.setPosition(Phaser.Math.Linear(startX, endX, i / 12), restartY);
      d.setScale(1);
      d.haltHorizontal();
      d.haltVertical();
    });

    const carrier = getClosestPlayerByHorizontalDistance(ctx.attackers, receiver.x);
    ctx.ball.setCarrier(carrier);
    ctx.ball.setPosition(carrier.x, carrier.y - 28);
    ctx.ball.updateFollow();

    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);
    ctx.attackingLineY = carrier.y - 28;
    ctx.previousCarrierY = carrier.y;
    this.line.reseedDefensiveShift();
    this.line.positionDefenders();

    hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    hud.setTackleCount(0, setLimit);
    hud.setStatus(`20m restart. ${setLimit}-tackle set.`);
  }

  private getTwentyMeterRestartY(): number {
    const { ctx } = this;
    const twentyMeters = ctx.pitch.metersToPixels(20);
    return ctx.attackDirection === "north"
      ? ctx.pitch.bottomTryLineY - twentyMeters
      : ctx.pitch.topTryLineY + twentyMeters;
  }

  private resolveKickDeadBall(): void {
    const { ctx } = this;

    ctx.isKickInFlight = false;
    ctx.isKickLoose = false;
    ctx.isTurnoverPause = true;
    ctx.ball.setCarrier(null);
    ctx.ball.setPosition(ctx.kickTargetX, ctx.kickTargetY);

    if (ctx.isKickoffSetPiece) {
      const bouncedDead = ctx.kickGroundedBeforeClaim;
      ctx.isKickoffSetPiece = false;
      if (bouncedDead) {
        this.restartAtHalfway(true, "Kickoff bounced dead. Kicking team gets it back at halfway.");
      } else {
        this.restartAtHalfway(false, "Kickoff on the full dead. Receiving team restarts at halfway.");
      }
      return;
    }

    const attackingDeadBall = ctx.attackDirection === "north"
      ? ctx.kickTargetY <= ctx.pitch.fieldRect.y
      : ctx.kickTargetY >= ctx.pitch.fieldRect.bottom;

    const receivingTeam = ctx.defenders;

    if (attackingDeadBall) {
      this.hud.setStatus("Ball dead. Fetching for 20m restart...");
      this.animateDeadBallRollAndRetrieval(receivingTeam, () => {
        this.hud.setStatus("Dead ball off kick. 20m restart (7 tackles).");
        this.restartAtTwentyWithBonus();
      });
      return;
    }

    this.hud.setStatus("Ball dead. Fetching for dropout...");
    this.animateDeadBallRollAndRetrieval(receivingTeam, () => {
      this.hud.setStatus("Dead ball. Goal-line dropout.");
      this.restart.startGoalLineDropOut();
    });
  }

  private animateKickGroundBounce(onComplete: () => void): void {
    const { ctx, scene } = this;
    const startX = ctx.ball.x;
    const startY = ctx.ball.y;
    const yDrift = ctx.attackDirection === "north"
      ? -ctx.pitch.metersToPixels(2.2)
      : ctx.pitch.metersToPixels(2.2);

    scene.tweens.add({
      targets: ctx.ball,
      x: startX + yDrift * 0.55,
      y: startY - 18,
      duration: 110,
      ease: "Quad.Out",
      onUpdate: (tween) => {
        ctx.ball.setAngle(Number(tween.progress) * 140);
      },
      onComplete: () => {
        scene.tweens.add({
          targets: ctx.ball,
          x: startX + yDrift,
          y: startY + 1,
          duration: 130,
          ease: "Quad.In",
          onUpdate: (tween) => {
            ctx.ball.setAngle(140 + Number(tween.progress) * 140);
          },
          onComplete: () => {
            ctx.kickLastBounceY = ctx.ball.y;
            scene.tweens.add({
              targets: ctx.ball,
              x: startX + yDrift * 1.45,
              y: startY - 8,
              duration: 90,
              ease: "Quad.Out",
              onUpdate: (tween) => {
                ctx.ball.setAngle(280 + Number(tween.progress) * 120);
              },
              onComplete: () => {
                scene.tweens.add({
                  targets: ctx.ball,
                  x: startX + yDrift * 1.9,
                  y: startY,
                  duration: 100,
                  ease: "Quad.In",
                  onComplete: () => {
                    ctx.ball.setAngle(0);
                    onComplete();
                  },
                });
              },
            });
          },
        });
      },
    });
  }

  private animateDeadBallRollAndRetrieval(
    receivingTeam: Player[],
    onComplete: () => void,
  ): void {
    const { ctx, scene } = this;
    const deadAtTop = ctx.kickTargetY <= ctx.pitch.fieldRect.y;
    const offscreenY = deadAtTop
      ? ctx.pitch.fieldRect.y - 85
      : ctx.pitch.fieldRect.bottom + 85;
    const rollX = Phaser.Math.Clamp(
      ctx.ball.x + Phaser.Math.FloatBetween(-26, 26),
      ctx.pitch.fieldRect.x + 24,
      ctx.pitch.fieldRect.right - 24,
    );

    const fetcher = receivingTeam.reduce((closest, p) => {
      const dClosest = Phaser.Math.Distance.Between(closest.x, closest.y, ctx.ball.x, ctx.ball.y);
      const dPlayer = Phaser.Math.Distance.Between(p.x, p.y, ctx.ball.x, ctx.ball.y);
      return dPlayer < dClosest ? p : closest;
    });
    const returnX = fetcher.x;
    const returnY = fetcher.y;

    scene.cameras.main.startFollow(ctx.ball, true, 0.22, 0.22);

    scene.tweens.add({
      targets: ctx.ball,
      x: rollX,
      y: offscreenY,
      angle: deadAtTop ? -220 : 220,
      duration: 620,
      ease: "Sine.In",
      onComplete: () => {
        scene.tweens.add({
          targets: fetcher,
          x: rollX,
          y: offscreenY,
          duration: 520,
          ease: "Sine.InOut",
          onComplete: () => {
            ctx.ball.setVisible(false);

            scene.tweens.add({
              targets: fetcher,
              x: returnX,
              y: returnY,
              duration: 640,
              ease: "Sine.InOut",
              onComplete: () => {
                ctx.ball.setVisible(true);
                ctx.ball.setAngle(0);
                onComplete();
              },
            });
          },
        });
      },
    });
  }

  private restartAtTwentyWithBonus(): void {
    const { ctx, hud } = this;

    // Turn possession over to the defending team for a 20m restart.
    const nextAttacker = ctx.attackingTeamId === "home" ? "away" : "home";
    ctx.setAttackingTeam(nextAttacker);
    this.restart.resetSetState();

    ctx.setTackleBonus = 1;
    const setLimit = ctx.maxTackles + ctx.setTackleBonus;
    const restartY = this.getTwentyMeterRestartY();
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    ctx.attackers.forEach((a, i) => {
      a.setPosition(Phaser.Math.Linear(startX, endX, i / 12), restartY);
      a.setScale(1);
      a.haltHorizontal();
      a.haltVertical();
    });
    ctx.defenders.forEach((d, i) => {
      d.setPosition(Phaser.Math.Linear(startX, endX, i / 12), restartY);
      d.setScale(1);
      d.haltHorizontal();
      d.haltVertical();
    });

    const carrier = getClosestPlayerByHorizontalDistance(ctx.attackers, ctx.pitch.fieldRect.centerX);
    ctx.ball.setCarrier(carrier);
    ctx.ball.setPosition(carrier.x, carrier.y - 28);
    ctx.ball.updateFollow();

    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);
    ctx.attackingLineY = carrier.y - 28;
    ctx.previousCarrierY = carrier.y;
    this.line.reseedDefensiveShift();
    this.line.positionDefenders();

    hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    hud.setTackleCount(0, setLimit);
  }

  private restartAtHalfway(retainPossession: boolean, status: string): void {
    const { ctx, hud } = this;

    if (!retainPossession) {
      const nextAttacker = ctx.attackingTeamId === "home" ? "away" : "home";
      ctx.setAttackingTeam(nextAttacker);
    }

    this.restart.resetSetState();

    const halfwayY = ctx.pitch.getLineYFromTopTryLine(50);
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    ctx.attackers.forEach((a, i) => {
      a.setPosition(Phaser.Math.Linear(startX, endX, i / 12), halfwayY);
      a.setScale(1);
      a.haltHorizontal();
      a.haltVertical();
    });
    ctx.defenders.forEach((d, i) => {
      d.setPosition(Phaser.Math.Linear(startX, endX, i / 12), halfwayY);
      d.setScale(1);
      d.haltHorizontal();
      d.haltVertical();
    });

    const carrier = getClosestPlayerByHorizontalDistance(ctx.attackers, ctx.pitch.fieldRect.centerX);
    ctx.ball.setCarrier(carrier);
    ctx.ball.setPosition(carrier.x, carrier.y - 28);
    ctx.ball.updateFollow();
    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);

    ctx.attackingLineY = carrier.y - 28;
    ctx.previousCarrierY = carrier.y;
    this.line.reseedDefensiveShift();
    this.line.positionDefenders();

    hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    hud.setStatus(status);
    hud.setTackleCount(0, ctx.maxTackles);
  }

  private isAheadOfKicker(player: Player): boolean {
    const kicker = this.ctx.getBallCarrier() ?? this.ctx.controlledPlayer;
    return this.ctx.attackDirection === "north"
      ? player.y < kicker.y
      : player.y > kicker.y;
  }
}
