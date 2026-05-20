import Phaser from "phaser";
import { GameSettings } from "../../config/settings";
import { Player } from "../../entities/Player";
import { Team } from "../../entities/Team";
import { GameStateManager } from "../../systems/GameStateManager";
import { ScoringSystem } from "../../systems/ScoringSystem";
import { HUD } from "../../ui/HUD";
import { getKickoffCarrierY, getKickingTeamKickoffY } from "./field-positioning";
import { LineController } from "./LineController";
import { PlayContext } from "./PlayContext";

/**
 * Handles try scoring, all post-score transitions, kickoff formation setup,
 * and the shared resetSetState() helper that every other controller calls.
 */
export class RestartController {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: PlayContext,
    private readonly hud: HUD,
    private readonly settings: GameSettings,
    private readonly scoring: ScoringSystem,
    private readonly stateManager: GameStateManager,
    private readonly line: LineController,
  ) {}

  // ─── Shared reset helpers ────────────────────────────────────────────────────

  /** Clears all tackle / ruck / pause flags back to a clean set-start state. */
  resetSetState(): void {
    const { ctx, hud } = this;
    ctx.currentTackleCount = 0;
    ctx.tackleBustsThisSet = 0;
    ctx.consecutiveTackleBusts = 0;
    hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);
    ctx.isInPlayTheBall = false;
    ctx.defendersCanAdvance = true;
    ctx.isTurnoverPause = false;
    ctx.isForwardPassPause = false;
    ctx.sixAgainAwardedThisRuck = false;
    ctx.officialsLineOverrideY = null;
    ctx.officialsRunLerp = 0.16;
    this.line.clearOffsideRings();
    this.line.reseedDefensiveShift();
  }

  // ─── Try scoring — full animated sequence ────────────────────────────────────

  completeTry(team: Team, endLabel: string): void {
    const { ctx, hud, scoring, settings, scene, stateManager } = this;
    if (ctx.isTryCelebration) return;

    ctx.isTryCelebration = true;

    // Halt all players
    [...ctx.homePlayers, ...ctx.awayPlayers].forEach((p) => {
      p.haltHorizontal();
      p.haltVertical();
      p.setScale(1);
    });

    const conversionKickX = ctx.ball.x;
    const tryAtTop = endLabel === "Top end";
    const tryLineY = tryAtTop ? ctx.pitch.topTryLineY : ctx.pitch.bottomTryLineY;
    const cx = ctx.pitch.fieldRect.centerX;
    const concedingTeam = team === ctx.home ? ctx.away : ctx.home;

    const kickDistMeters = Phaser.Math.Between(10, 30);
    const kickerFieldY = tryAtTop
      ? tryLineY + ctx.pitch.metersToPixels(kickDistMeters)
      : tryLineY - ctx.pitch.metersToPixels(kickDistMeters);

    // Award try
    const tryPoints = scoring.awardTry(team);
    ctx.ball.setCarrier(null);
    ctx.ball.setPosition(conversionKickX, tryLineY);
    ctx.ball.setVisible(true);
    
    // Clear all overlays
    ctx.officialsGraphics.clear();
    ctx.celebrationGraphics.clear();
    ctx.controlledPlayerRingGraphics.clear();
    ctx.kickAimGraphics.clear();
    ctx.offsideGraphics.clear();

    hud.updateScore(ctx.home, ctx.away);
    hud.setStatus(`TRY!  ${team.name}  +${tryPoints} pts`);
    hud.setTackleCount(0, ctx.maxTackles);

    scene.cameras.main.stopFollow();

    // Use a counter tween to sequence everything (bypasses scene.time blocking)
    const timeline = { progress: 0 };
    
    scene.tweens.add({
      targets: timeline,
      progress: 1,
      duration: 5500,
      onUpdate: (tween) => {
        const t = tween.getValue();
        
        // Phase 1: Celebration formations (t=0.08 or 450ms)
        if (t >= 0.08 && t < 0.09 && !timeline['phase1Started']) {
          timeline['phase1Started'] = true;
          
          const kickerPlayer = ctx.attackers[10] ?? ctx.attackers[6];
          const halfwayY = ctx.pitch.getLineYFromTopTryLine(50);
          
          // Kicker to conversion spot
          scene.tweens.add({
            targets: kickerPlayer,
            x: conversionKickX,
            y: kickerFieldY,
            duration: 900,
            ease: "Sine.Out",
          });

          // Rest circle at halfway
          const nonKickers = ctx.attackers.filter((p) => p !== kickerPlayer);
          nonKickers.forEach((p, i) => {
            const angle = (i / nonKickers.length) * Math.PI * 2;
            scene.tweens.add({
              targets: p,
              x: cx + Math.cos(angle) * 68 + Phaser.Math.FloatBetween(-10, 10),
              y: halfwayY + Math.sin(angle) * 36 + Phaser.Math.FloatBetween(-10, 10),
              duration: 900,
              ease: "Sine.Out",
            });
          });

          // Defenders behind goal line
          const inGoalY = tryAtTop
            ? ctx.pitch.fieldRect.y + ctx.pitch.metersToPixels(4)
            : ctx.pitch.fieldRect.bottom - ctx.pitch.metersToPixels(4);

          ctx.defenders.forEach((p, i) => {
            const angle = Math.PI + (i / ctx.defenders.length) * Math.PI;
            scene.tweens.add({
              targets: p,
              x: cx + Math.cos(angle) * 62 + Phaser.Math.FloatBetween(-8, 8),
              y: inGoalY + Math.sin(angle) * 30,
              duration: 850,
              ease: "Sine.Out",
            });
          });
        }
        
        // Phase 2: Conversion (t=0.4 or 2200ms)
        if (t >= 0.4 && t < 0.41 && !timeline['phase2Started']) {
          timeline['phase2Started'] = true;
          
          ctx.ball.setVisible(false);
          const conversion = scoring.attemptConversion(
            team,
            conversionKickX,
            cx,
            ctx.pitch.fieldRect.width / 2,
            settings.placeKickSkill,
          );
          hud.updateScore(ctx.home, ctx.away);
          hud.setStatus(
            conversion.success
              ? `Conversion good!  +${conversion.points}  —  ${team.name}: ${team.score}`
              : `Conversion missed  —  ${team.name}: ${team.score}`,
          );
        }
        
        // Phase 3: Kickoff setup (t=0.64 or 3500ms)
        if (t >= 0.64 && t < 0.65 && !timeline['phase3Started']) {
          timeline['phase3Started'] = true;
          
          ctx.officialsGraphics.clear();
          ctx.celebrationGraphics.clear();
          hud.setStatus("Teams lining up for kickoff...");

          const halfwayY = ctx.pitch.getLineYFromTopTryLine(50);
          scene.cameras.main.pan(cx, halfwayY, 800, "Sine.InOut");

          const kickingPlayers = concedingTeam === ctx.home ? ctx.homePlayers : ctx.awayPlayers;
          const receivingPlayers = concedingTeam === ctx.home ? ctx.awayPlayers : ctx.homePlayers;
          
          const kickoffY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);
          const kickerY = getKickingTeamKickoffY(ctx.pitch, ctx.attackDirection);
          const startX = ctx.pitch.fieldRect.x + 70;
          const endX = ctx.pitch.fieldRect.right - 70;
          
          receivingPlayers.forEach((p, i) => {
            p.setPosition(Phaser.Math.Linear(startX, endX, i / 12), kickoffY);
          });
          
          kickingPlayers.forEach((p, i) => {
            p.setPosition(Phaser.Math.Linear(startX, endX, i / 12), kickerY);
          });

          this.resetSetState();
        }
        
        // Phase 4: Kickoff (t=0.82 or 4500ms)
        if (t >= 0.82 && t < 0.83 && !timeline['phase4Started']) {
          timeline['phase4Started'] = true;
          
          const kickingPlayers = concedingTeam === ctx.home ? ctx.homePlayers : ctx.awayPlayers;
          const receivingPlayers = concedingTeam === ctx.home ? ctx.awayPlayers : ctx.homePlayers;
          
          const kicker = kickingPlayers[6];
          const halfSlots = [2, 10];
          const forwardSlots = [4, 6, 7, 8, 9];
          const isHalf = Math.random() < 0.87;
          const receiverSlot = (isHalf ? halfSlots : forwardSlots)[
            Math.floor(Math.random() * (isHalf ? 2 : 5))
          ];
          const receiver = receivingPlayers[receiverSlot];
          
          ctx.ball.setCarrier(null);
          ctx.ball.setVisible(true);
          ctx.ball.setPosition(kicker.x, kicker.y - 22);

          hud.setStatus(`Kickoff — to #${ctx.rugbyLeagueNumberBySlot[receiverSlot]}`);

          scene.tweens.add({
            targets: ctx.ball,
            x: receiver.x,
            y: receiver.y - 28,
            duration: 980,
            ease: "Sine.Out",
            onComplete: () => {
              ctx.ball.setCarrier(receiver);
              ctx.attackingTeamId = receivingPlayers === ctx.homePlayers ? "home" : "away";
              ctx.syncTeamRoles();
              
              if (ctx.homePlayers.includes(receiver)) {
                ctx.controlledPlayer = receiver;
              } else {
                ctx.controlledPlayer = ctx.homePlayers.reduce((closest, p) => {
                  const d1 = Phaser.Math.Distance.Between(p.x, p.y, receiver.x, receiver.y);
                  const d2 = Phaser.Math.Distance.Between(closest.x, closest.y, receiver.x, receiver.y);
                  return d1 < d2 ? p : closest;
                });
              }
              
              ctx.controlledPlayer.setScale(1.12);
              ctx.movement.setControlledPlayer(ctx.controlledPlayer);
              scene.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);

              ctx.attackingLineY = receiver.y - 28;
              ctx.previousCarrierY = receiver.y;
              this.line.reseedDefensiveShift();
              this.line.positionDefenders();

              hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
              hud.setStatus("Kickoff received! Drive to the line.");
              
              ctx.isTryCelebration = false;
              stateManager.kickoff();
            },
          });
        }
      },
    });
  }

  // ─── Formation display ────────────────────────────────────────────────────────

  private showCelebrationFormation(
    tryAtTop: boolean,
    tryLineY: number,
    kickerPlayer: Player,
    kickerFieldY: number,
    kickX: number,
  ): void {
    const { ctx, scene } = this;
    const cx = ctx.pitch.fieldRect.centerX;
    const halfwayY = ctx.pitch.getLineYFromTopTryLine(50);

    // ── Scoring team ──────────────────────────────────────────────────────────
    // Kicker walks to their conversion position (10–30 m from the try line)
    scene.tweens.add({
      targets: kickerPlayer,
      x: kickX,
      y: kickerFieldY,
      duration: 900,
      ease: "Sine.Out",
    });

    // Rest of scoring team forms a circle behind the kicker at the 50 m line
    const nonKickers = ctx.attackers.filter((p) => p !== kickerPlayer);
    nonKickers.forEach((p, i) => {
      const angle = (i / nonKickers.length) * Math.PI * 2;
      const jitter = Phaser.Math.FloatBetween(-10, 10);
      scene.tweens.add({
        targets: p,
        x: cx + Math.cos(angle) * 68 + jitter,
        y: halfwayY + Math.sin(angle) * 36 + jitter,
        duration: 900,
        ease: "Sine.Out",
      });
    });

    // ── Defending team ────────────────────────────────────────────────────────
    // Team that conceded retreats into their own in-goal zone behind the goal line
    const inGoalY = tryAtTop
      ? ctx.pitch.fieldRect.y + ctx.pitch.metersToPixels(4)
      : ctx.pitch.fieldRect.bottom - ctx.pitch.metersToPixels(4);

    ctx.defenders.forEach((p, i) => {
      const angle = Math.PI + (i / ctx.defenders.length) * Math.PI;
      const jitter = Phaser.Math.FloatBetween(-8, 8);
      scene.tweens.add({
        targets: p,
        x: cx + Math.cos(angle) * 62 + jitter,
        y: inGoalY + Math.sin(angle) * 30,
        duration: 850,
        ease: "Sine.Out",
      });
    });
  }

  // ─── Touch judges at goal posts ───────────────────────────────────────────────

  private drawConversionTouchJudges(tryLineY: number, tryAtTop: boolean, cx: number): void {
    const { ctx } = this;
    // TJs stand just behind the goal line (in-goal side) flanking the posts
    const tjY = tryAtTop
      ? tryLineY - ctx.pitch.metersToPixels(2)
      : tryLineY + ctx.pitch.metersToPixels(2);
    const spread = 52;

    ctx.officialsGraphics.clear();
    ctx.officialsGraphics.fillStyle(0xffe16a, 1);
    ctx.officialsGraphics.fillCircle(cx - spread, tjY, 6);
    ctx.officialsGraphics.fillCircle(cx + spread, tjY, 6);
    // Small flag lines
    ctx.officialsGraphics.lineStyle(3, 0xffe16a, 0.9);
    ctx.officialsGraphics.lineBetween(cx - spread, tjY - 6, cx - spread, tjY - 22);
    ctx.officialsGraphics.lineBetween(cx + spread, tjY - 6, cx + spread, tjY - 22);
  }

  // ─── Conversion kick animation ────────────────────────────────────────────────

  private animateConversionKick(
    kickX: number,
    kickY: number,
    tryLineY: number,
    tryAtTop: boolean,
    success: boolean,
    onResult: () => void,
    onFlashComplete: () => void,
  ): void {
    const { scene, ctx } = this;
    const cx = ctx.pitch.fieldRect.centerX;
    const arcHeight = ctx.pitch.metersToPixels(8);
    const midX = Phaser.Math.Linear(kickX, cx, 0.45);
    const midY = tryAtTop ? tryLineY - arcHeight : tryLineY + arcHeight;

    const ballDot = scene.add.circle(kickX, kickY, 7, 0xffe066, 1).setDepth(2200);

    // Rising arc (kick leaves foot)
    scene.tweens.add({
      targets: ballDot,
      x: midX,
      y: midY,
      scaleX: 2.4,
      scaleY: 2.4,
      duration: 580,
      ease: "Sine.Out",
      onComplete: () => {
        // Descending arc (ball falls toward posts)
        scene.tweens.add({
          targets: ballDot,
          x: cx,
          y: tryLineY,
          scaleX: 0.8,
          scaleY: 0.8,
          duration: 500,
          ease: "Sine.In",
          onComplete: () => {
            ballDot.destroy();
            onResult();
            this.flashConversionResult(cx, tryLineY, tryAtTop, success, onFlashComplete);
          },
        });
      },
    });
  }

  private flashConversionResult(
    cx: number,
    tryLineY: number,
    tryAtTop: boolean,
    success: boolean,
    onComplete: () => void,
  ): void {
    const { scene, ctx } = this;
    const ringColor = success ? 0x44ff88 : 0xff4444;
    const label = success ? "CONVERSION!" : "MISSED!";
    const textColor = success ? "#44ff88" : "#ff5555";

    ctx.celebrationGraphics.lineStyle(7, ringColor, 1);
    ctx.celebrationGraphics.strokeCircle(cx, tryLineY, 38);

    const textY = tryAtTop
      ? tryLineY - ctx.pitch.metersToPixels(2.5)
      : tryLineY + ctx.pitch.metersToPixels(2.5);

    const txt = scene.add
      .text(cx, textY, label, {
        fontFamily: "Verdana",
        fontSize: "34px",
        color: textColor,
        stroke: "#000000",
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(2200);

    scene.tweens.add({
      targets: txt,
      alpha: 0,
      y: txt.y - 55,
      duration: 1400,
      delay: 700,
      onComplete: () => {
        txt.destroy();
        onComplete(); // triggers Phase 3 run-back
      },
    });
  }

  // ─── Run back to halfway ──────────────────────────────────────────────────────

  private animateRunBack(kickingTeam: Team): void {
    const { ctx, scene } = this;
    ctx.detachedFromLine.clear();
    ctx.dragLineWithCarrier = false;
    ctx.isLineHeldAfterPass = false;
    ctx.isBallInFlight = false;

    const kickingPlayers = kickingTeam === ctx.home ? ctx.homePlayers : ctx.awayPlayers;
    const receivingPlayers = kickingTeam === ctx.home ? ctx.awayPlayers : ctx.homePlayers;

    const kickoffY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);
    const kickerY = getKickingTeamKickoffY(ctx.pitch, ctx.attackDirection);
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    // Reset all player scales first
    [...ctx.homePlayers, ...ctx.awayPlayers].forEach(p => p.setScale(1));

    receivingPlayers.forEach((p, i) => {
      const targetX = Phaser.Math.Linear(startX, endX, i / 12);
      scene.tweens.add({
        targets: p,
        x: targetX,
        y: kickoffY,
        duration: 1400,
        ease: "Sine.InOut",
      });
    });

    kickingPlayers.forEach((p, i) => {
      const targetX = Phaser.Math.Linear(startX, endX, i / 12);
      scene.tweens.add({
        targets: p,
        x: targetX,
        y: kickerY,
        duration: 1400,
        ease: "Sine.InOut",
      });
    });
  }

  // ─── Kickoff ball flight ──────────────────────────────────────────────────────

  private animateKickoffFlight(kickingTeam: Team): void {
    const { ctx, hud, settings, scene, stateManager } = this;

    const kickingPlayers = kickingTeam === ctx.home ? ctx.homePlayers : ctx.awayPlayers;
    const receivingPlayers = kickingTeam === ctx.home ? ctx.awayPlayers : ctx.homePlayers;

    // Central player (index 6, jersey 9) takes the kick.
    const kicker = kickingPlayers[6];
    if (!kicker) {
      console.error("Kicker not found!");
      ctx.isTryCelebration = false;
      stateManager.kickoff();
      return;
    }

    // 87 % → half (jersey 6 = slot 2, jersey 7 = slot 10)
    // 13 % → forward (slots 4,6,7,8,9 = jerseys 8,9,10,11,12)
    const halfSlots = [2, 10];
    const forwardSlots = [4, 6, 7, 8, 9];
    const isHalf = Math.random() < 0.87;
    const pool = isHalf ? halfSlots : forwardSlots;
    const receiverSlot = pool[Math.floor(Math.random() * pool.length)];
    const receiver = receivingPlayers[receiverSlot];
    
    if (!receiver) {
      console.error("Receiver not found!");
      ctx.isTryCelebration = false;
      stateManager.kickoff();
      return;
    }
    
    const jerseyNum = ctx.rugbyLeagueNumberBySlot[receiverSlot];

    ctx.ball.setCarrier(null);
    ctx.ball.setVisible(true);
    ctx.ball.setPosition(kicker.x, kicker.y - 22);

    hud.setStatus(
      isHalf
        ? `Kickoff — high ball to #${jerseyNum} (half)`
        : `Kickoff — into the forwards #${jerseyNum}`,
    );

    let finalized = false;
    const finalizeKickoff = () => {
      if (finalized) return;
      finalized = true;

      ctx.ball.setCarrier(receiver);
      ctx.ball.updateFollow();

      // Set attacking team to the receiving team
      ctx.attackingTeamId = receivingPlayers === ctx.homePlayers ? "home" : "away";
      ctx.syncTeamRoles();

      // Sync controlled player and camera
      if (ctx.homePlayers.includes(receiver)) {
        ctx.controlledPlayer = receiver;
      } else {
        const closestHome = ctx.homePlayers.reduce((closest, p) => {
          const dist = Phaser.Math.Distance.Between(p.x, p.y, receiver.x, receiver.y);
          const closestDist = Phaser.Math.Distance.Between(closest.x, closest.y, receiver.x, receiver.y);
          return dist < closestDist ? p : closest;
        });
        ctx.controlledPlayer = closestHome;
      }
      
      ctx.controlledPlayer.setScale(1.12);
      ctx.movement.setControlledPlayer(ctx.controlledPlayer);
      scene.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);

      ctx.attackingLineY = receiver.y - 28;
      ctx.previousCarrierY = receiver.y;
      this.line.reseedDefensiveShift();
      this.line.positionDefenders();

      hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
      hud.setStatus(
        settings.verticalOnly
          ? "Kickoff received! Drive up the field."
          : "Kickoff received! Drive to the line.",
      );
      hud.setTackleCount(0, ctx.maxTackles);

      // Final cleanup
      ctx.controlledPlayerRingGraphics.clear();
      ctx.celebrationGraphics.clear();
      ctx.officialsGraphics.clear();
      ctx.kickAimGraphics.clear();
      ctx.offsideGraphics.clear();

      ctx.isTryCelebration = false;
      stateManager.kickoff(); // -> "live"
    };

    scene.tweens.add({
      targets: ctx.ball,
      x: receiver.x,
      y: receiver.y - 28,
      duration: 980,
      ease: "Sine.Out",
      onComplete: finalizeKickoff,
    });

    // Failsafe in case tween completion callback doesn't fire for any reason.
    scene.time.delayedCall(1300, finalizeKickoff);
  }

  // ─── Attack unit creation / kickoff reset ────────────────────────────────────

  createAttackUnit(): void {
    const { ctx, settings } = this;
    ctx.homePlayers = [];
    ctx.awayPlayers = [];
    ctx.syncTeamRoles();
    ctx.defensiveShiftMeters = [];
    ctx.detachedFromLine.clear();

    const kickoffY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);
    const kickerY = getKickingTeamKickoffY(ctx.pitch, ctx.attackDirection);
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    for (let i = 0; i < 13; i++) {
      const x = Phaser.Math.Linear(startX, endX, i / 12);

      const homePlayer = new Player(this.scene, x, kickoffY, "player");
      homePlayer.setTint(ctx.home.color);
      homePlayer.setJerseyNumber(ctx.rugbyLeagueNumberBySlot[i]);
      ctx.homePlayers.push(homePlayer);

      const awayPlayer = new Player(this.scene, x, kickerY, "player");
      awayPlayer.setTint(ctx.away.color);
      awayPlayer.setJerseyNumber(ctx.rugbyLeagueNumberBySlot[i]);
      ctx.awayPlayers.push(awayPlayer);
    }

    ctx.controlledPlayer = ctx.homePlayers[6];
    ctx.controlledPlayer.setScale(1.12);
    ctx.attackingLineY = kickoffY - 28;
    ctx.previousCarrierY = ctx.controlledPlayer.y;

    ctx.syncTeamRoles();
    this.line.reseedDefensiveShift();
    this.line.positionDefenders();
  }

  resetAttackUnitForKickoff(): void {
    const { ctx } = this;
    ctx.detachedFromLine.clear();
    ctx.dragLineWithCarrier = false;
    ctx.isLineHeldAfterPass = false;
    ctx.isBallInFlight = false;

    this.resetSetState();

    const kickoffY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);
    const kickerY = getKickingTeamKickoffY(ctx.pitch, ctx.attackDirection);
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    ctx.homePlayers.forEach((player, i) => {
      player.setPosition(Phaser.Math.Linear(startX, endX, i / 12), kickoffY);
      player.setScale(1);
      player.haltHorizontal();
      player.haltVertical();
    });

    ctx.awayPlayers.forEach((player, i) => {
      player.setPosition(Phaser.Math.Linear(startX, endX, i / 12), kickerY);
      player.setScale(1);
      player.haltHorizontal();
      player.haltVertical();
    });

    ctx.syncControlledPlayerToHomeTeam(this.scene.cameras.main, true);
    this.scene.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
    this.scene.cameras.main.centerOn(ctx.controlledPlayer.x, ctx.controlledPlayer.y);

    ctx.attackingLineY = ctx.controlledPlayer.y - 28;
    ctx.previousCarrierY = ctx.getBallCarrier()?.y ?? ctx.controlledPlayer.y;

    this.line.reseedDefensiveShift();
    this.line.positionDefenders();
  }
}
