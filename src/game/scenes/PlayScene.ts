import Phaser from "phaser";
import { GameSettings } from "../config/settings";
import { Ball } from "../entities/Ball";
import { Pitch } from "../entities/Pitch";
import { Player } from "../entities/Player";
import { Team } from "../entities/Team";
import { GameStateManager } from "../systems/GameStateManager";
import { MovementController } from "../systems/MovementController";
import { ScoringSystem } from "../systems/ScoringSystem";
import { HUD } from "../ui/HUD";
import { getKickoffCarrierY, getKickingTeamKickoffY } from "./play/field-positioning";
import { getClosestPlayerByHorizontalDistance } from "./play/player-utils";
import { KickController } from "./play/KickController";
import { LineController } from "./play/LineController";
import { PlayContext } from "./play/PlayContext";
import { RestartController } from "./play/RestartController";
import { TackleController } from "./play/TackleController";

export class PlayScene extends Phaser.Scene {
  // â”€â”€â”€ Controllers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private ctx!: PlayContext;
  private line!: LineController;
  private restart!: RestartController;
  private tackle!: TackleController;
  private kick!: KickController;

  // â”€â”€â”€ Systems â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private stateManager!: GameStateManager;
  private hud!: HUD;

  // â”€â”€â”€ Keyboard (passing kept here â€“ tightly coupled to tweens + camera) â”€â”€â”€â”€â”€â”€â”€
  private passKeys!: {
    Q: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };
  private diveKey!: Phaser.Input.Keyboard.Key;
  private startTeamId: "home" | "away" = "home";
  constructor() {
    super("PlayScene");
  }

  // â”€â”€â”€ Lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  create(): void {
    const settings = this.registry.get("settings") as GameSettings;

    this.cameras.main.setBackgroundColor("#0c4b25");

    const pitch = new Pitch(this, this.scale.width, this.scale.height);
    const pitchGraphics = this.add.graphics();
    pitch.render(pitchGraphics);

    this.physics.world.setBounds(
      pitch.fieldRect.x,
      pitch.fieldRect.y,
      pitch.fieldRect.width,
      pitch.fieldRect.height,
    );
    this.cameras.main.setBounds(
      pitch.fieldRect.x,
      pitch.fieldRect.y,
      pitch.fieldRect.width,
      pitch.fieldRect.height,
    );
    this.cameras.main.setZoom(1.25);

    const home = new Team("home", settings.teams.homeName, settings.teams.homeColor);
    const away = new Team("away", settings.teams.awayName, settings.teams.awayColor);

    // â”€â”€ Build shared state bag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const ctx = new PlayContext();
    ctx.pitch = pitch;
    ctx.home = home;
    ctx.away = away;
    ctx.offsideGraphics = this.add.graphics().setDepth(1800);
    ctx.officialsGraphics = this.add.graphics().setDepth(1750);
    ctx.kickAimGraphics = this.add.graphics().setDepth(1900);
    ctx.controlledPlayerRingGraphics = this.add.graphics().setDepth(1950);
    ctx.celebrationGraphics = this.add.graphics().setDepth(2100);
    ctx.debugEnabled = import.meta.env.DEV;
    ctx.debugLinesGraphics = ctx.debugEnabled
      ? this.add.graphics().setDepth(1700)
      : null;
    this.ctx = ctx;

    // â”€â”€ Systems â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.stateManager = new GameStateManager();
    const scoring = new ScoringSystem(settings.scoring);
    this.hud = new HUD(this);
    this.hud.attachToCamera(this.cameras.main);

    // â”€â”€ Controllers (dependency order: line â†’ restart â†’ tackle â†’ kick) â”€â”€â”€â”€â”€â”€
    this.line = new LineController(this, ctx);
    this.restart = new RestartController(this, ctx, this.hud, settings, scoring, this.stateManager, this.line);
    this.tackle = new TackleController(this, ctx, this.hud, settings, this.line, this.restart);
    this.kick = new KickController(this, ctx, this.hud, settings, this.line, this.tackle, this.restart);

    // â”€â”€ Players + ball â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.restart.createAttackUnit();

    ctx.ball = new Ball(this, ctx.controlledPlayer.x, ctx.controlledPlayer.y - 28, "ball");
    ctx.ball.setCarrier(null);
    ctx.ball.setVisible(false);

    // â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ctx.movement = new MovementController(this, ctx.controlledPlayer, !settings.verticalOnly);
    this.passKeys = this.input.keyboard!.addKeys("Q,E,SPACE") as {
      Q: Phaser.Input.Keyboard.Key;
      E: Phaser.Input.Keyboard.Key;
      SPACE: Phaser.Input.Keyboard.Key;
    };
    this.diveKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.kick.initKeys();

    // â”€â”€ Camera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
    this.cameras.main.centerOn(ctx.controlledPlayer.x, ctx.controlledPlayer.y);

    // â”€â”€ HUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.hud.updateScore(home, away);
    this.hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    this.hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);
    this.hud.setStatus("Teams coming out of the sheds...");

    ctx.isPrematchSequence = true;
    this.startTeamId = Math.random() < 0.5 ? "home" : "away";
    this.beginPrematchRunout();

    // â”€â”€ Menu button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.add
      .text(this.scale.width - 80, 30, "Menu", {
        fontFamily: "Verdana",
        fontSize: "28px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setScrollFactor(0)
      .on("pointerdown", () => this.scene.start("MenuScene"));
  }

  update(): void {
    const { ctx } = this;

    if (ctx.isPrematchSequence) {
      return;
    }

    this.hud.attachToCamera(this.cameras.main);
    
    // Only update ball follow when not kicking
    if (!ctx.isKickInFlight && !ctx.isKickCharging && !ctx.isKickLoose) {
      ctx.ball.updateFollow();
    }

    // Celebration sequence blocks all gameplay - controllers handle their own tweens
    if (ctx.isTryCelebration) return;

    this.kick.clearAimArrowIfNotCharging();

    if (this.stateManager.currentState !== "live") return;

    // â”€â”€ Kick path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.kick.updateInput();
    
      if (ctx.isKickoffSetPiece && !ctx.isKickInFlight && !ctx.isKickLoose) {
        this.line.drawControlledPlayerRing();
        this.hud.updateStamina(ctx.controlledPlayer.getStaminaPercent());
        return;
      }

    if (ctx.isKickCharging || ctx.isKickInFlight || ctx.isKickLoose) {
      this.kick.updateFlow();
      return;
    }

    // â”€â”€ Paused states â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (ctx.isForwardPassPause || ctx.isScrumPause) {
      this.line.clearTransientFieldIndicators();
      return;
    }

    // â”€â”€ Normal live gameplay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!ctx.isInPlayTheBall && !ctx.isDiving) {
      ctx.movement.update();
    }

    this.handleDiveInput();
    this.tackle.update();
    this.handlePassingInput();
    this.line.updateAttackLineAndSupportPlayers();
    this.line.drawControlledPlayerRing();
    this.line.checkDefensiveOffside();
    
    // Update stamina UI
    this.hud.updateStamina(ctx.controlledPlayer.getStaminaPercent());

    const carrier = ctx.getBallCarrier();
    const overDeadBallLine = carrier
      ? carrier.y <= ctx.pitch.fieldRect.y + 2 || carrier.y >= ctx.pitch.fieldRect.bottom - 2
      : ctx.isBallInFlight && (ctx.ball.y <= ctx.pitch.fieldRect.y || ctx.ball.y >= ctx.pitch.fieldRect.bottom);

    if (overDeadBallLine) {
      this.restart.startGoalLineDropOut();
      return;
    }

  }

  private beginPrematchRunout(): void {
    const { ctx, hud } = this;
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;
    const offscreenX = ctx.pitch.fieldRect.x - 180;

    const awayTeam = ctx.awayPlayers;
    const homeTeam = ctx.homePlayers;

    const kickoffTeam = this.startTeamId === "home" ? homeTeam : awayTeam;
    const receivingTeam = this.startTeamId === "home" ? awayTeam : homeTeam;

    const kickoffY = getKickingTeamKickoffY(ctx.pitch, ctx.attackDirection);
    const receivingY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);

    const placeTeamAtShed = (team: typeof kickoffTeam, y: number) => {
      team.forEach((p) => {
        p.setPosition(offscreenX + Phaser.Math.FloatBetween(-28, 28), y + Phaser.Math.FloatBetween(-12, 12));
        p.haltHorizontal();
        p.haltVertical();
        p.setScale(1);
      });
    };

    placeTeamAtShed(awayTeam, kickoffY);
    placeTeamAtShed(homeTeam, receivingY);

    const runTeamOut = (team: typeof kickoffTeam, targetY: number, duration: number, onComplete: () => void) => {
      let remaining = team.length;
      team.forEach((p, i) => {
        this.tweens.add({
          targets: p,
          x: Phaser.Math.Linear(startX, endX, i / 12),
          y: targetY,
          duration,
          ease: "Sine.Out",
          onComplete: () => {
            remaining--;
            if (remaining === 0) onComplete();
          },
        });
      });
    };

    hud.setStatus(`${ctx.away.name} run out...`);
    runTeamOut(awayTeam, kickoffY, 1300, () => {
      hud.setStatus(`${ctx.home.name} run out...`);
      this.time.delayedCall(250, () => {
        runTeamOut(homeTeam, receivingY, 1300, () => {
          this.time.delayedCall(350, () => this.beginInitialKickoffSetPiece());
        });
      });
    });
  }

  private beginInitialKickoffSetPiece(): void {
    const { ctx, hud } = this;
    ctx.isPrematchSequence = false;
    ctx.setAttackingTeam(this.startTeamId);
    this.restart.resetSetState();

    const kickoffY = getKickingTeamKickoffY(ctx.pitch, ctx.attackDirection);
    const receivingY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);
    const kickoffTeam = this.startTeamId === "home" ? ctx.homePlayers : ctx.awayPlayers;
    const receivingTeam = this.startTeamId === "home" ? ctx.awayPlayers : ctx.homePlayers;
    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;

    kickoffTeam.forEach((p, i) => p.setPosition(Phaser.Math.Linear(startX, endX, i / 12), kickoffY));
    receivingTeam.forEach((p, i) => p.setPosition(Phaser.Math.Linear(startX, endX, i / 12), receivingY));

    const kicker = kickoffTeam[6] ?? kickoffTeam[0];
    ctx.ball.setVisible(true);
    ctx.ball.setCarrier(kicker);
    ctx.ball.updateFollow();

    if (this.startTeamId === "home") {
      ctx.controlledPlayer = kicker;
      ctx.controlledPlayer.setScale(1.12);
      ctx.movement.setControlledPlayer(ctx.controlledPlayer);
      this.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
      this.cameras.main.centerOn(ctx.controlledPlayer.x, ctx.controlledPlayer.y);
      this.kick.armControlledKickoff();
    } else {
      // Computer kickoff when away starts.
      const receiver = receivingTeam[Phaser.Math.RND.pick([2, 4, 6, 7, 8, 9, 10])] ?? receivingTeam[6];
      const kickStartX = kicker.x;
      const kickStartY = kicker.y - 24;
      const kickTargetX = receiver.x;
      const kickTargetY = receiver.y - 28;
      const distance = Phaser.Math.Distance.Between(kickStartX, kickStartY, kickTargetX, kickTargetY);

      ctx.ball.setCarrier(null);
      ctx.ball.setPosition(kickStartX, kickStartY);
      ctx.isKickoffSetPiece = true;
      ctx.kickGroundedBeforeClaim = false;
      ctx.kickOwnerTeamId = "away";
      ctx.kickTargetX = kickTargetX;
      ctx.kickTargetY = kickTargetY;
      ctx.isKickInFlight = true;

      hud.setStatus("Kickoff: away team starts.");
      this.cameras.main.startFollow(ctx.ball, true, 0.16, 0.16);

      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: Phaser.Math.Clamp(900 + distance, 1000, 1600),
        ease: "Sine.InOut",
        onUpdate: (tw) => {
          const t = Number(tw.getValue());
          const baseX = Phaser.Math.Linear(kickStartX, kickTargetX, t);
          const baseY = Phaser.Math.Linear(kickStartY, kickTargetY, t);
          const arc = Math.sin(t * Math.PI) * Math.min(130, distance * 0.22);
          ctx.ball.setPosition(baseX, baseY - arc);
          ctx.ball.setAngle(t * 420);
        },
        onComplete: () => {
          ctx.ball.setAngle(0);
          ctx.isKickInFlight = false;
          ctx.isKickLoose = true;
          this.hud.setStatus("Kick chase.");
        },
      });
    }

    this.stateManager.kickoff();
  }

  // â”€â”€â”€ Passing (stays in PlayScene â€“ tightly uses tweens, cameras, and keys) â”€â”€

  private handlePassingInput(): void {
    const { ctx } = this;

    if (
      ctx.isBallInFlight ||
      ctx.isInPlayTheBall ||
      ctx.isTurnoverPause ||
      ctx.isForwardPassPause ||
      ctx.isScrumPause ||
      ctx.isKickCharging ||
      ctx.isKickInFlight ||
      ctx.isKickLoose ||
      ctx.isDiving ||
      !ctx.isHomeTeamInPossession()
    ) return;

    if (Phaser.Input.Keyboard.JustDown(this.passKeys.SPACE)) {
      this.tackle.onTackleMade();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.passKeys.Q)) {
      this.passToDirection(-1);
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.passKeys.E)) {
      this.passToDirection(1);
    }
  }

  private passToDirection(direction: -1 | 1): void {
    const { ctx } = this;
    const passer = ctx.getBallCarrier() ?? ctx.controlledPlayer;

    const candidates = ctx.attackers.filter((a) => {
      if (a === ctx.controlledPlayer) return false;
      return direction < 0
        ? a.x < ctx.controlledPlayer.x - 8
        : a.x > ctx.controlledPlayer.x + 8;
    });

    if (candidates.length === 0) return;

    const target = getClosestPlayerByHorizontalDistance(candidates, ctx.controlledPlayer.x);
    const targetSnapX = target.x;
    const targetSnapY = target.y - 28;

    const isForward =
      ctx.attackDirection === "north"
        ? targetSnapY < passer.y - ctx.pitch.metersToPixels(0.4)
        : targetSnapY > passer.y + ctx.pitch.metersToPixels(0.4);

    const previousCarrier = ctx.controlledPlayer;
    const passDuration = Phaser.Math.Clamp(360 - passer.getStats().passing * 1.4, 180, 360);
    ctx.isBallInFlight = true;

    previousCarrier.setScale(1);
    ctx.controlledPlayer = target;
    ctx.controlledPlayer.setScale(1.12);
    ctx.movement.setControlledPlayer(ctx.controlledPlayer);

    ctx.ball.setCarrier(null);
    this.cameras.main.startFollow(ctx.ball, true, 0.22, 0.22);

    const startX = Number(ctx.ball.x);
    const startY = Number(ctx.ball.y);
    const distance = Phaser.Math.Distance.Between(startX, startY, targetSnapX, targetSnapY);
    const arcHeight = Math.min(distance * 0.15, 40); // Arc height based on distance

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: passDuration,
      ease: "Sine.InOut",
      onUpdate: (tween) => {
        const t = Number(tween.getValue());
        const baseX = Phaser.Math.Linear(Number(startX), Number(targetSnapX), t);
        const baseY = Phaser.Math.Linear(Number(startY), Number(targetSnapY), t);
        
        // Add arc to the pass
        const heightProgress = Math.sin(t * Math.PI);
        const arcOffset = heightProgress * arcHeight;
        
        // Ball rotation during pass (360° spin)
        ctx.ball.setAngle(t * 360);
        
        // Ball scaling (slightly larger at peak of arc)
        const scale = 1 + (heightProgress * 0.2);
        ctx.ball.setScale(scale);
        
        ctx.ball.setPosition(baseX, baseY - arcOffset);
      },
      onComplete: () => {
        // Reset ball angle and scale
        ctx.ball.setAngle(0);
        ctx.ball.setScale(1.0);
        
        if (isForward) {
          // Forward pass detected - trigger penalty after animation
          ctx.ball.setCarrier(null);
          ctx.ball.setVisible(true);
          ctx.isForwardPassPause = true;
          ctx.isTurnoverPause = true;
          this.line.clearTransientFieldIndicators();
          this.hud.setStatus("Forward pass! Scrum in 2s...");
          this.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
          ctx.isBallInFlight = false;
          
          this.time.delayedCall(2000, () => {
            ctx.isForwardPassPause = false;
            ctx.isTurnoverPause = false;
            this.tackle.triggerScrum(passer.x, passer.y, false);
          });
        } else {
          // Valid pass - give ball to receiver
          ctx.ball.setCarrier(ctx.controlledPlayer);
          this.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
          ctx.isBallInFlight = false;
          ctx.isLineHeldAfterPass = false;
          ctx.detachedFromLine.add(previousCarrier);
        }
      },
    });

    this.hud.setStatus(`Pass ${direction < 0 ? "left" : "right"}...`);
  }

  private handleDiveInput(): void {
    const { ctx } = this;
    if (!Phaser.Input.Keyboard.JustDown(this.diveKey)) return;

    if (
      ctx.isDiving ||
      ctx.isBallInFlight ||
      ctx.isInPlayTheBall ||
      ctx.isTurnoverPause ||
      ctx.isForwardPassPause ||
      ctx.isScrumPause ||
      ctx.isKickCharging ||
      ctx.isKickInFlight ||
      ctx.isKickLoose ||
      !ctx.isHomeTeamInPossession()
    ) {
      return;
    }

    const carrier = ctx.getBallCarrier() ?? ctx.controlledPlayer;
    if (!ctx.homePlayers.includes(carrier)) return;

    ctx.isDiving = true;
    carrier.haltHorizontal();
    carrier.haltVertical();

    const fwdDir = ctx.attackDirection === "north" ? -1 : 1;
    const diveMeters = Phaser.Math.FloatBetween(1, 5);
    const totalDive = ctx.pitch.metersToPixels(diveMeters) * fwdDir;
    const startX = carrier.x;
    const startY = carrier.y;
    const targetY = Phaser.Math.Clamp(
      startY + totalDive,
      ctx.pitch.fieldRect.y + 2,
      ctx.pitch.fieldRect.bottom - 2,
    );
    const midY = Phaser.Math.Linear(startY, targetY, 0.72);
    const xJitter = Phaser.Math.FloatBetween(-8, 8);

    this.tweens.killTweensOf(carrier);

    this.tweens.add({
      targets: carrier,
      x: startX + xJitter,
      y: midY,
      duration: 180,
      ease: "Quad.Out",
      onComplete: () => {
        this.tweens.add({
          targets: carrier,
          x: startX + xJitter * 0.35,
          y: targetY,
          duration: 220,
          ease: "Sine.Out",
          onComplete: () => {
            if (!ctx.isDiving) return;
            ctx.isDiving = false;
            this.resolveDiveOutcome(carrier);
          },
        });
      },
    });
  }

  private resolveDiveOutcome(carrier: Player): void {
    const { ctx } = this;
    const inTop = Phaser.Geom.Rectangle.Contains(ctx.pitch.topTryZone, carrier.x, carrier.y);
    const inBottom = Phaser.Geom.Rectangle.Contains(ctx.pitch.bottomTryZone, carrier.x, carrier.y);
    const reachedTopTryLine = carrier.y <= ctx.pitch.topTryLineY;
    const reachedBottomTryLine = carrier.y >= ctx.pitch.bottomTryLineY;

    if (ctx.attackDirection === "north") {
      if (inTop || reachedTopTryLine) {
        this.restart.completeTry(ctx.getAttackingTeam(), "Top end");
        return;
      }
      if (inBottom || reachedBottomTryLine) {
        this.restart.startGoalLineDropOut();
        return;
      }
    } else {
      if (inBottom || reachedBottomTryLine) {
        this.restart.completeTry(ctx.getAttackingTeam(), "Bottom end");
        return;
      }
      if (inTop || reachedTopTryLine) {
        this.restart.startGoalLineDropOut();
        return;
      }
    }

    this.hud.setStatus("Dived to ground.");
  }
}
