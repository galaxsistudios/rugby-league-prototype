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

    if (this.line.isDefenderOffside(tackler) && !ctx.sixAgainAwardedThisRuck) {
      ctx.sixAgainAwardedThisRuck = true;
      ctx.currentTackleCount = 0;
      this.hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);
      this.hud.setStatus("Offside tackle. Six Again (10m).");
    }

    this.onTackleMade();
  }

  // ─── Tackle handling ─────────────────────────────────────────────────────────

  onTackleMade(): void {
    const { ctx, hud } = this;
    ctx.lastTackleAt = this.scene.time.now;
    const ballCarrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;

    if (this.tryBreakTackle(ballCarrier)) return;
    
    // Check for stamina-powered tackle (shift held + has stamina)
    if (this.tryPowerThroughTackle(ballCarrier)) return;

    ctx.consecutiveTackleBusts = 0;
    ctx.playTheBallMarkY = ballCarrier.y;
    ctx.isInPlayTheBall = true;
    ctx.defendersCanAdvance = false;
    ctx.sixAgainAwardedThisRuck = false;
    ballCarrier.haltHorizontal();
    ballCarrier.haltVertical();

    ctx.currentTackleCount++;
    hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);

    if (ctx.currentTackleCount >= ctx.maxTackles) {
      this.startFinalTackleTurnoverPause();
      return;
    }

    this.performPlayTheBall();
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
        line.reseedDefensiveShift();
      },
    });
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

  // ─── Turnover ────────────────────────────────────────────────────────────────

  triggerTurnover(newCarrier?: Player): void {
    const { ctx, hud, line, restart } = this;
    ctx.attackingTeamId = ctx.attackingTeamId === "home" ? "away" : "home";
    ctx.attackDirection = ctx.attackDirection === "north" ? "south" : "north";
    ctx.syncTeamRoles();
    restart.resetSetState();

    ctx.attackers.forEach((a) => a.setScale(1));
    ctx.defenders.forEach((d) => d.setScale(1));

    const carrier =
      newCarrier ?? getClosestPlayerByDistance(ctx.attackers, ctx.ball.x, ctx.ball.y);

    ctx.ball.setCarrier(carrier);
    ctx.ball.updateFollow();
    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main);

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

    hud.setStatus("Scrum forming...");
    this.scene.time.delayedCall(1400, () => this.resolveScrum(clampedX, clampedY));
  }

  private resolveScrum(scrumX: number, scrumY: number): void {
    const { ctx, hud, restart, line } = this;
    ctx.isScrumPause = false;
    restart.resetSetState();

    const attackerWins = ctx.scrumWinnerIsAttacker
      ? Math.random() < 0.72
      : Math.random() < 0.28;

    const giveScrum = (toAttacker: boolean) => {
      if (!toAttacker) {
        ctx.attackingTeamId = ctx.attackingTeamId === "home" ? "away" : "home";
        ctx.attackDirection = ctx.attackDirection === "north" ? "south" : "north";
        ctx.syncTeamRoles();
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
