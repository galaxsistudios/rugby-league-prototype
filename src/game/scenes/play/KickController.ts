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
  private kickKey!: Phaser.Input.Keyboard.Key;
  private kickCursors!: Phaser.Types.Input.Keyboard.CursorKeys;

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
    this.kickKey = this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.kickCursors = this.scene.input.keyboard!.createCursorKeys();
  }

  // ─── Per-frame input ─────────────────────────────────────────────────────────

  updateInput(): void {
    const { ctx } = this;

    if (!ctx.isKickCharging && Phaser.Input.Keyboard.JustDown(this.kickKey)) {
      if (
        ctx.isInPlayTheBall ||
        ctx.isTurnoverPause ||
        ctx.isKickInFlight ||
        ctx.isKickLoose ||
        !ctx.isHomeTeamInPossession()
      ) return;
      this.beginKickCharge();
      return;
    }

    if (!ctx.isKickCharging) return;
    this.updateKickAim();
    if (Phaser.Input.Keyboard.JustUp(this.kickKey)) this.releaseKick();
  }

  // ─── Per-frame kick flow (chase / ball claim) ─────────────────────────────────

  updateFlow(): void {
    this.updateKickChasePlayers();

    const touching = this.getTouchingPlayerWithBall();
    if (!touching) return;

    if (this.ctx.kickOffsideAttackers.has(touching)) {
      this.resolveKickOffsidePenalty(touching);
      return;
    }

    this.claimKickBall(touching, this.ctx.attackers.includes(touching));
  }

  clearAimArrowIfNotCharging(): void {
    if (!this.ctx.isKickCharging) this.ctx.kickAimGraphics.clear();
  }

  // ─── Charge ──────────────────────────────────────────────────────────────────

  private beginKickCharge(): void {
    const { ctx } = this;
    ctx.isKickCharging = true;
    ctx.kickOwnerTeamId = ctx.attackingTeamId;
    ctx.kickAimForwardMeters = 28;
    ctx.kickAimSideMeters = 0;
    this.hud.setStatus("Kick held. Aim with arrows, release C.");
    this.drawKickAimArrow();
  }

  private updateKickAim(): void {
    const { ctx } = this;
    const lateralStep = 1.1;
    const forwardStep = 1.4;

    if (this.kickCursors.left.isDown) ctx.kickAimSideMeters -= lateralStep;
    if (this.kickCursors.right.isDown) ctx.kickAimSideMeters += lateralStep;
    if (this.kickCursors.up.isDown) ctx.kickAimForwardMeters += forwardStep;
    if (this.kickCursors.down.isDown) ctx.kickAimForwardMeters -= forwardStep;

    ctx.kickAimSideMeters = Phaser.Math.Clamp(ctx.kickAimSideMeters, -14, 14);
    ctx.kickAimForwardMeters = Phaser.Math.Clamp(ctx.kickAimForwardMeters, 14, 48);

    this.hud.setStatus(
      `Kick aim: ${Math.round(ctx.kickAimForwardMeters)}m forward, ` +
        `${Math.round(Math.abs(ctx.kickAimSideMeters))}` +
        `${ctx.kickAimSideMeters < 0 ? "m left" : "m right"}`,
    );
    this.drawKickAimArrow();
  }

  // ─── Release ─────────────────────────────────────────────────────────────────

  private releaseKick(): void {
    const { ctx } = this;
    ctx.isKickCharging = false;
    ctx.kickAimGraphics.clear();
    ctx.isKickInFlight = true;

    const kicker = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    ctx.kickOffsideAttackers = new Set(
      ctx.getControlledTeamPlayers().filter(
        (p) => p !== kicker && this.isAheadOfKicker(p),
      ),
    );

    const fwdDir = ctx.attackDirection === "north" ? -1 : 1;
    const stats = kicker.getStats();
    const distScale = Phaser.Math.Linear(0.82, 1.2, stats.kicking / 100);
    const jitterM = (100 - stats.kicking) / 30;
    const sideJitter = Phaser.Math.FloatBetween(-jitterM, jitterM);
    const fwdJitter = Phaser.Math.FloatBetween(-jitterM * 0.6, jitterM * 0.6);

    const aimX = kicker.x + ctx.pitch.metersToPixels(ctx.kickAimSideMeters + sideJitter);
    const aimY =
      kicker.y +
      ctx.pitch.metersToPixels(ctx.kickAimForwardMeters * distScale + fwdJitter) * fwdDir;

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

    ctx.ball.setCarrier(null);

    const dist = Phaser.Math.Distance.Between(
      ctx.ball.x, ctx.ball.y,
      ctx.kickTargetX, ctx.kickTargetY,
    );
    const duration = Phaser.Math.Clamp(650 + dist * 10, 700, 1700);

    this.hud.setStatus("Kick away...");

    this.scene.tweens.add({
      targets: ctx.ball,
      x: ctx.kickTargetX,
      y: ctx.kickTargetY,
      duration,
      ease: "Sine.Out",
      onComplete: () => {
        ctx.isKickInFlight = false;
        ctx.ball.setPosition(ctx.kickTargetX, ctx.kickTargetY);
        if (this.isKickOutOfField()) {
          this.resolveKickTouchOut();
          return;
        }
        ctx.isKickLoose = true;
        this.hud.setStatus("Kick chase.");
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

    const ownDist = getDistanceFromOwnTryLine(ctx.pitch, ctx.attackDirection, ctx.controlledPlayer.y);
    const oppDist = getDistanceFromOpponentTryLine(ctx.pitch, ctx.attackDirection, restartY);
    const is40to20 = ownDist <= 40 && oppDist <= 20;
    const is20to40 = ownDist <= 20 && oppDist <= 40;

    if (is40to20 || is20to40) {
      this.restartAtTouchLine(
        restartY,
        restartX,
        true,
        is40to20 ? "40/20. Kicking team retains." : "20/40. Kicking team retains.",
      );
      return;
    }
    this.restartAtTouchLine(restartY, restartX, false, "Kick out. Other team restart.");
  }

  private claimKickBall(player: Player, sameTeam: boolean): void {
    const { ctx } = this;
    ctx.isKickLoose = false;
    ctx.isKickInFlight = false;

    if (!sameTeam) {
      this.tackle.triggerTurnover(player);
      ctx.ball.setPosition(player.x, player.y - 28);
      return;
    }

    ctx.controlledPlayer = player;
    ctx.controlledPlayer.setScale(1.12);
    ctx.movement.setControlledPlayer(ctx.controlledPlayer);
    ctx.ball.setCarrier(ctx.controlledPlayer);
    ctx.ball.updateFollow();
    this.scene.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
    this.hud.setStatus("Kick caught.");
  }

  /** Shared touchline-restart used by offside penalty and kick-out. */
  private restartAtTouchLine(
    restartY: number,
    restartX: number,
    retainPossession: boolean,
    status: string,
  ): void {
    const { ctx } = this;
    ctx.isKickCharging = false;
    ctx.isKickInFlight = false;
    ctx.isKickLoose = false;
    ctx.kickOffsideAttackers.clear();
    ctx.kickAimGraphics.clear();
    ctx.ball.setCarrier(null);

    if (!retainPossession) {
      ctx.attackingTeamId = ctx.attackingTeamId === "home" ? "away" : "home";
      ctx.attackDirection = ctx.attackDirection === "north" ? "south" : "north";
    }

    ctx.syncTeamRoles();
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
    const startX = ctx.controlledPlayer.x;
    const startY = ctx.controlledPlayer.y - 22;
    const endX = Phaser.Math.Clamp(
      startX + ctx.pitch.metersToPixels(ctx.kickAimSideMeters),
      ctx.pitch.fieldRect.x + 20,
      ctx.pitch.fieldRect.right - 20,
    );
    const endY = Phaser.Math.Clamp(
      startY + ctx.pitch.metersToPixels(ctx.kickAimForwardMeters) * fwdDir,
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

  private isAheadOfKicker(player: Player): boolean {
    const kicker = this.ctx.getBallCarrier() ?? this.ctx.controlledPlayer;
    return this.ctx.attackDirection === "north"
      ? player.y < kicker.y
      : player.y > kicker.y;
  }
}
