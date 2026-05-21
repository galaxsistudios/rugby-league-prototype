import Phaser from "phaser";
import { PlayerRole } from "../../config/player-profiles";
import { GameSettings } from "../../config/settings";
import { Player } from "../../entities/Player";
import { HUD } from "../../ui/HUD";
import { getClosestPlayerByDistance } from "./player-utils";
import { getScrumLayout } from "./scrum-layout";
import { LineController } from "./LineController";
import { PlayContext } from "./PlayContext";
import { RestartController } from "./RestartController";

/**
 * Handles all tackle / play-the-ball / scrum / turnover logic.
 */
export class TackleController {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: PlayContext,
    private readonly hud: HUD,
    private readonly settings: GameSettings,
    private readonly line: LineController,
    private readonly restart: RestartController,
  ) {}

  // ─── Per-frame update ────────────────────────────────────────────────────────

  update(): void {
    const { ctx } = this;
    if (
      ctx.isBallInFlight ||
      ctx.isInPlayTheBall ||
      ctx.isTurnoverPause ||
      ctx.isKickCharging ||
      ctx.isKickInFlight ||
      ctx.isKickLoose
    ) return;

    if (this.scene.time.now - ctx.lastTackleAt < ctx.tackleCooldownMs) return;

    const tackler = ctx.defenders.find((d) => this.isDefenderTouchingCarrier(d));
    if (!tackler) return;

    if (this.line.isDefenderOffside(tackler)) {
      this.applyOffsidePenaltyReset(tackler);
      return;
    }

    this.onTackleMade();
  }

  private applyOffsidePenaltyReset(_tackler: Player): void {
    const { ctx, hud } = this;
    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;

    ctx.currentTackleCount = 0;
    ctx.sixAgainAwardedThisRuck = false;
    ctx.playTheBallMarkY = ballCarrier.y;
    ctx.isInPlayTheBall = true;
    ctx.defendersCanAdvance = false;
    ballCarrier.haltHorizontal();
    ballCarrier.haltVertical();

    this.line.captureRuckState();
    hud.setTackleCount(0, this.getSetTackleLimit());
    hud.setStatus("Penalty: offside tackle. Line reset.");
    this.performPlayTheBall();
  }

  // ─── Tackle handling ─────────────────────────────────────────────────────────

  onTackleMade(): void {
    const { ctx, hud } = this;
    ctx.lastTackleAt = this.scene.time.now;
    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;

    const wasDiving = ctx.isDiving;
    if (wasDiving) {
      ctx.isDiving = false;
      this.scene.tweens.killTweensOf(ballCarrier);
    }

    if (!wasDiving && this.tryBreakTackle(ballCarrier)) return;
    
    // Check for stamina-powered tackle (shift held + has stamina)
    if (!wasDiving && this.tryPowerThroughTackle(ballCarrier)) return;

    if (this.isCarrierInOwnInGoal(ballCarrier)) {
      this.hud.setStatus("Held in-goal. Goal-line dropout.");
      this.restart.startGoalLineDropOut();
      return;
    }

    ctx.consecutiveTackleBusts = 0;
    ctx.playTheBallMarkY = ballCarrier.y;
    ctx.isInPlayTheBall = true;
    ctx.defendersCanAdvance = false;
    ctx.sixAgainAwardedThisRuck = false;
    ballCarrier.haltHorizontal();
    ballCarrier.haltVertical();
    this.line.captureRuckState();

    ctx.currentTackleCount++;
    const tackleLimit = this.getSetTackleLimit();
    hud.setTackleCount(ctx.currentTackleCount, tackleLimit);
    this.showTackleCountPopup(ctx.currentTackleCount);

    if (ctx.currentTackleCount >= tackleLimit) {
      this.startFinalTackleTurnoverPause();
      return;
    }

    this.performPlayTheBall();
  }

  private showTackleCountPopup(count: number): void {
    const { ctx, scene } = this;
    const carrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    const anchorX = ctx.refereeDotX ?? carrier.x;
    const anchorY = ctx.refereeDotY ?? carrier.y;
    const isLastTackle = count >= ctx.maxTackles - 1;
    const popupColor = isLastTackle ? "#ff4f4f" : "#fff4cf";

    ctx.tackleCountPopupTween?.stop();
    ctx.tackleCountPopup?.destroy();

    const popup = scene.add
      .text(anchorX, anchorY - 18, `${count}`, {
        fontFamily: "Verdana",
        fontSize: "24px",
        color: popupColor,
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(2050)
      .setScale(0.65)
      .setAlpha(0.95);

    ctx.tackleCountPopup = popup;
    ctx.tackleCountPopupTween = scene.tweens.add({
      targets: popup,
      y: anchorY - 44,
      alpha: 0,
      scale: 1.05,
      duration: 720,
      ease: "Cubic.Out",
      onComplete: () => {
        popup.destroy();
        if (ctx.tackleCountPopup === popup) {
          ctx.tackleCountPopup = null;
          ctx.tackleCountPopupTween = null;
        }
      },
    });
  }

  private performPlayTheBall(): void {
    const { ctx, settings, hud, line } = this;
    const tackled = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    const others = ctx.attackers.filter((a) => a !== tackled);
    const hooker = others.find((a) => a.getRole() === "hooker");
    const dummy = hooker ?? getClosestPlayerByDistance(others, tackled.x, tackled.y);

    const supportDir = ctx.attackDirection === "north" ? 1 : -1;
    const dummyY = Phaser.Math.Clamp(
      ctx.playTheBallMarkY + ctx.pitch.metersToPixels(1.2) * supportDir,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );

    const delayMin = Math.max(
      100,
      Math.min(
        Math.round(settings.playTheBall.dummyHalfDelayMinSeconds * 1000),
        Math.round(settings.playTheBall.dummyHalfDelayMaxSeconds * 1000),
      ),
    );
    const delayMax = Math.max(
      delayMin,
      Math.round(settings.playTheBall.dummyHalfDelayMaxSeconds * 1000),
    );
    const duration = Phaser.Math.Between(delayMin, delayMax);

    dummy.haltHorizontal();
    dummy.haltVertical();
    tackled.setScale(1);

    this.configureFifthTackleFirstReceiver(tackled, dummy, dummyY, supportDir);

    hud.setStatus(`Tackle ${ctx.currentTackleCount}. Play the ball...`);

    this.scene.tweens.add({
      targets: dummy,
      x: tackled.x,
      y: dummyY,
      duration,
      ease: "Sine.InOut",
      onComplete: () => {
        ctx.ball.setCarrier(dummy);
        ctx.ball.updateFollow();
        ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);
        ctx.defendersCanAdvance = true;
        ctx.isInPlayTheBall = false;
        line.clearRuckState();
        line.reseedDefensiveShift();
      },
    });
  }

  private configureFifthTackleFirstReceiver(
    tackled: Player,
    dummy: Player,
    dummyY: number,
    supportDir: number,
  ): void {
    const { ctx } = this;
    if (ctx.currentTackleCount !== ctx.maxTackles - 1) {
      ctx.firstReceiverPlayer = null;
      ctx.firstReceiverTargetX = null;
      ctx.firstReceiverTargetY = null;
      return;
    }

    const halves = ctx.attackers.filter(
      (a) => a.getRole() === "half" && a !== tackled && a !== dummy,
    );

    if (halves.length === 0) {
      ctx.firstReceiverPlayer = null;
      ctx.firstReceiverTargetX = null;
      ctx.firstReceiverTargetY = null;
      return;
    }

    const firstReceiver = getClosestPlayerByDistance(halves, tackled.x, tackled.y);
    const horizontalBias = firstReceiver.x < tackled.x ? -1 : 1;

    ctx.firstReceiverPlayer = firstReceiver;
    ctx.firstReceiverTargetX = Phaser.Math.Clamp(
      tackled.x + ctx.pitch.metersToPixels(1.5) * horizontalBias,
      ctx.pitch.fieldRect.x + 24,
      ctx.pitch.fieldRect.right - 24,
    );
    ctx.firstReceiverTargetY = Phaser.Math.Clamp(
      dummyY + ctx.pitch.metersToPixels(2.6) * supportDir,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );
  }

  // ─── Tackle break ────────────────────────────────────────────────────────────

  private tryBreakTackle(ballCarrier: Player): boolean {
    const { ctx } = this;
    if (ctx.tackleBustsThisSet >= ctx.maxTackleBustsPerSet) return false;
    if (ctx.consecutiveTackleBusts >= ctx.maxConsecutiveTackleBusts) return false;

    const roleBonusByType: Record<PlayerRole, number> = {
      fullback: 0.05, winger: 0.04, center: 0.09, half: 0.02,
      prop: 0.24, "second-row": 0.14, hooker: 0.06, lock: 0.18,
    };

    const strengthFactor = (ballCarrier.getStats().strength - 50) / 220;
    const chance = Phaser.Math.Clamp(
      0.04 + roleBonusByType[ballCarrier.getRole()] + strengthFactor,
      0.04,
      0.5,
    );

    if (Math.random() > chance) return false;

    ctx.tackleBustsThisSet++;
    ctx.consecutiveTackleBusts++;
    ctx.lastTackleAt = this.scene.time.now;

    const surgeMeters = Phaser.Math.Linear(1.3, 2.6, ballCarrier.getStats().strength / 100);
    const fwdDir = ctx.attackDirection === "north" ? -1 : 1;
    const surgeY = Phaser.Math.Clamp(
      ballCarrier.y + ctx.pitch.metersToPixels(surgeMeters) * fwdDir,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );

    ballCarrier.setPosition(ballCarrier.x, surgeY);
    ctx.ball.updateFollow();
    this.hud.setStatus("Tackle break!");
    return true;
  }
  
  // ─── Stamina power through ──────────────────────────────────────────────────
  
  private tryPowerThroughTackle(ballCarrier: Player): boolean {
    const { ctx } = this;
    
    // Only works if player is sprinting (shift held) and has stamina
    if (!ballCarrier.isSprinting || !ballCarrier.hasStamina(10)) return false;
    
    // Use 10 stamina for power through attempt
    ballCarrier.drainStamina(10);
    
    // Power through chance based on strength + remaining stamina
    const strengthFactor = ballCarrier.getStats().strength / 100;
    const staminaFactor = ballCarrier.getStaminaPercent();
    const powerChance = strengthFactor * staminaFactor * 0.3; // Up to 30% chance
    
    if (Math.random() > powerChance) return false;
    
    // Power through successful - push forward 1-2 meters
    const pushMeters = Phaser.Math.FloatBetween(1.0, 2.0);
    const fwdDir = ctx.attackDirection === "north" ? -1 : 1;
    const pushY = Phaser.Math.Clamp(
      ballCarrier.y + ctx.pitch.metersToPixels(pushMeters) * fwdDir,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );
    
    ballCarrier.setPosition(ballCarrier.x, pushY);
    ctx.ball.updateFollow();
    ctx.playTheBallMarkY = pushY;
    this.hud.setStatus("Powered through the tackle!");
    
    // Still gets tackled, but gained ground
    return false; // Return false to continue with tackle
  }
  
  // ─── Stamina recovery ────────────────────────────────────────────────────────
  
  private recoverStaminaOnStoppage(): void {
    const { ctx } = this;
    const recoveryAmount = 3; // 3% recovery on stoppages
    
    [...ctx.homePlayers, ...ctx.awayPlayers].forEach((player) => {
      player.recoverStamina(recoveryAmount);
    });
  }

  private getSetTackleLimit(): number {
    return this.ctx.maxTackles + this.ctx.setTackleBonus;
  }

  private isCarrierInOwnInGoal(ballCarrier: Player): boolean {
    const { ctx } = this;
    const inTopInGoal = Phaser.Geom.Rectangle.Contains(ctx.pitch.topTryZone, ballCarrier.x, ballCarrier.y);
    const inBottomInGoal = Phaser.Geom.Rectangle.Contains(ctx.pitch.bottomTryZone, ballCarrier.x, ballCarrier.y);

    // If attacking north, own in-goal is the bottom try zone. If attacking south, own in-goal is top.
    return ctx.attackDirection === "north" ? inBottomInGoal : inTopInGoal;
  }

  // ─── Turnover ────────────────────────────────────────────────────────────────

  triggerTurnover(newCarrier?: Player): void {
    const { ctx, hud, line, restart } = this;
    const nextAttacker = ctx.attackingTeamId === "home" ? "away" : "home";
    ctx.setAttackingTeam(nextAttacker);
    restart.resetSetState();

    ctx.attackers.forEach((a) => a.setScale(1));
    ctx.defenders.forEach((d) => d.setScale(1));

    const carrier =
      newCarrier ?? getClosestPlayerByDistance(ctx.attackers, ctx.ball.x, ctx.ball.y);

    ctx.ball.setCarrier(carrier);
    ctx.ball.updateFollow();
    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);
    ctx.lineReformUntil = this.scene.time.now + 2200;

    hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    hud.setStatus("Turnover. New set.");
    line.reseedDefensiveShift();
  }

  startFinalTackleTurnoverPause(): void {
    const { ctx, hud, line } = this;
    ctx.isTurnoverPause = true;
    ctx.defendersCanAdvance = false;
    ctx.officialsRunLerp = 0.24;

    const nextFwdDir = ctx.attackDirection === "north" ? 1 : -1;
    ctx.officialsLineOverrideY = Phaser.Math.Clamp(
      ctx.playTheBallMarkY +
        ctx.pitch.metersToPixels(ctx.defensiveLineGapMeters) * nextFwdDir,
      ctx.pitch.topTryLineY + 20,
      ctx.pitch.bottomTryLineY - 20,
    );

    hud.setStatus("Last tackle. Turnover in 2s...");

    this.scene.time.delayedCall(2000, () => {
      ctx.officialsLineOverrideY = null;
      ctx.officialsRunLerp = 0.16;
      this.triggerTurnover();
    });
  }

  // ─── Scrum ───────────────────────────────────────────────────────────────────

  triggerScrum(scrumX: number, scrumY: number, attackerFeeds: boolean): void {
    const { ctx, hud } = this;
    
    // Recover 3% stamina for all players on stoppage
    this.recoverStaminaOnStoppage();
    
    ctx.isScrumPause = true;
    ctx.scrumWinnerIsAttacker = attackerFeeds;
    ctx.ball.setCarrier(null);
    ctx.isKickCharging = false;
    ctx.isKickInFlight = false;
    ctx.isKickLoose = false;
    ctx.isInPlayTheBall = false;

    const clampedX = Phaser.Math.Clamp(
      scrumX,
      ctx.pitch.fieldRect.x + 80,
      ctx.pitch.fieldRect.right - 80,
    );
    const clampedY = Phaser.Math.Clamp(
      scrumY,
      ctx.pitch.topTryLineY + 50,
      ctx.pitch.bottomTryLineY - 50,
    );

    const layout = getScrumLayout(ctx.pitch, clampedX, clampedY, ctx.attackDirection);

    const snap = (player: Player | undefined, x: number, y: number) => {
      if (!player) return;
      this.scene.tweens.add({
        targets: player,
        x: Phaser.Math.Clamp(x, ctx.pitch.fieldRect.x + 30, ctx.pitch.fieldRect.right - 30),
        y: Phaser.Math.Clamp(y, ctx.pitch.topTryLineY + 15, ctx.pitch.bottomTryLineY - 15),
        duration: 500,
        ease: "Sine.InOut",
      });
    };

    layout.attackerTargets.forEach((t) => snap(ctx.attackers[t.slot], t.x, t.y));
    layout.defenderTargets.forEach((t) => snap(ctx.defenders[t.slot], t.x, t.y));

    const feeder = this.getScrumFeeder(attackerFeeds, clampedX);
    hud.setStatus(`Scrum forming... #${feeder.getJerseyNumber()} to feed.`);
    this.scene.time.delayedCall(900, () => {
      this.animateScrumFeed(feeder, clampedX, clampedY, () => this.resolveScrum(clampedX, clampedY));
    });
  }

  private getScrumFeeder(attackerFeeds: boolean, scrumX: number): Player {
    const { ctx } = this;
    const feedingTeam = attackerFeeds ? ctx.attackers : ctx.defenders;
    const halfSix = feedingTeam[2];
    const halfSeven = feedingTeam[10];

    if (!halfSix && !halfSeven) return feedingTeam[6] ?? feedingTeam[0];
    if (!halfSix) return halfSeven;
    if (!halfSeven) return halfSix;

    const centerX = ctx.pitch.fieldRect.centerX;
    const sidePreferred = scrumX <= centerX ? halfSix : halfSeven;
    const sideOther = sidePreferred === halfSix ? halfSeven : halfSix;

    const preferredDist = Phaser.Math.Distance.Between(sidePreferred.x, sidePreferred.y, scrumX, sidePreferred.y);
    const otherDist = Phaser.Math.Distance.Between(sideOther.x, sideOther.y, scrumX, sideOther.y);
    return preferredDist <= otherDist + 10 ? sidePreferred : sideOther;
  }

  private animateScrumFeed(
    feeder: Player,
    scrumX: number,
    scrumY: number,
    onComplete: () => void,
  ): void {
    const { ctx, scene } = this;
    const feedFromLeft = feeder.x <= scrumX;
    const feedOffsetX = ctx.pitch.metersToPixels(1.15) * (feedFromLeft ? -1 : 1);
    const feedX = Phaser.Math.Clamp(
      scrumX + feedOffsetX,
      ctx.pitch.fieldRect.x + 24,
      ctx.pitch.fieldRect.right - 24,
    );
    const feedY = Phaser.Math.Clamp(
      scrumY + ctx.pitch.metersToPixels(0.25),
      ctx.pitch.topTryLineY + 18,
      ctx.pitch.bottomTryLineY - 18,
    );

    feeder.haltHorizontal();
    feeder.haltVertical();
    ctx.ball.setCarrier(null);
    ctx.ball.setVisible(true);
    ctx.ball.setScale(1);
    ctx.ball.setAngle(0);

    scene.tweens.add({
      targets: feeder,
      x: feedX,
      y: feedY,
      duration: 220,
      ease: "Sine.Out",
      onComplete: () => {
        ctx.ball.setPosition(feedX, feedY - 8);

        scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: 280,
          ease: "Sine.InOut",
          onUpdate: (tween) => {
            const t = Number(tween.getValue());
            const x = Phaser.Math.Linear(feedX, scrumX, t);
            const y = Phaser.Math.Linear(feedY - 8, scrumY - 6, t) + Math.sin(t * Math.PI) * 2;
            ctx.ball.setPosition(x, y);
            ctx.ball.setAngle(t * 120);
          },
          onComplete: () => {
            ctx.ball.setPosition(scrumX, scrumY - 8);
            ctx.ball.setAngle(0);
            onComplete();
          },
        });
      },
    });
  }

  private resolveScrum(scrumX: number, scrumY: number): void {
    const { ctx, hud, restart, line } = this;
    ctx.isScrumPause = false;
    restart.resetSetState();

    const feedWinChance = 0.92;
    const attackerWins = ctx.scrumWinnerIsAttacker
      ? Math.random() < feedWinChance
      : Math.random() < (1 - feedWinChance);

    const giveScrum = (toAttacker: boolean) => {
      if (!toAttacker) {
        const nextAttacker = ctx.attackingTeamId === "home" ? "away" : "home";
        ctx.setAttackingTeam(nextAttacker);
        ctx.attackers.forEach((a) => a.setScale(1));
        ctx.defenders.forEach((d) => d.setScale(1));
        hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
        line.reseedDefensiveShift();
      }
      const hooker = ctx.attackers.find((p) => p.getRole() === "hooker");
      const base = hooker ?? ctx.attackers[6];
      base.setPosition(scrumX, scrumY);
      ctx.ball.setCarrier(base);
      ctx.ball.setPosition(scrumX, scrumY - 28);
      ctx.ball.updateFollow();
      ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);
      ctx.attackingLineY = scrumY;
      ctx.previousCarrierY = scrumY;
    };

    if (attackerWins) {
      giveScrum(true);
      hud.setStatus("Scrum: attacking team wins ball.");
    } else {
      giveScrum(false);
      hud.setStatus("Scrum: defending team steals ball!");
    }

    line.positionDefenders();
  }

  // ─── Collision helpers ───────────────────────────────────────────────────────

  isDefenderTouchingCarrier(defender: Player): boolean {
    const defBody = defender.body as Phaser.Physics.Arcade.Body | null;
    const carrier = this.ctx.getBallCarrier() ?? this.ctx.controlledPlayer;
    const carrierBody = carrier.body as Phaser.Physics.Arcade.Body | null;

    if (!defBody || !carrierBody) return false;

    return (
      Math.abs(defBody.center.x - carrierBody.center.x) <=
        (defBody.width + carrierBody.width) * 0.5 &&
      Math.abs(defBody.center.y - carrierBody.center.y) <=
        (defBody.height + carrierBody.height) * 0.5
    );
  }
}
