import Phaser from "phaser";
import { GameSettings } from "../config/settings";
import { Ball } from "../entities/Ball";
import { Pitch } from "../entities/Pitch";
import { Team } from "../entities/Team";
import { GameStateManager } from "../systems/GameStateManager";
import { MovementController } from "../systems/MovementController";
import { ScoringSystem } from "../systems/ScoringSystem";
import { HUD } from "../ui/HUD";
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
    ctx.ball.setCarrier(ctx.controlledPlayer);

    // â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ctx.movement = new MovementController(this, ctx.controlledPlayer, !settings.verticalOnly);
    this.passKeys = this.input.keyboard!.addKeys("Q,E,SPACE") as {
      Q: Phaser.Input.Keyboard.Key;
      E: Phaser.Input.Keyboard.Key;
      SPACE: Phaser.Input.Keyboard.Key;
    };
    this.kick.initKeys();

    // â”€â”€ Camera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
    this.cameras.main.centerOn(ctx.controlledPlayer.x, ctx.controlledPlayer.y);

    // â”€â”€ HUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.hud.updateScore(home, away);
    this.hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
    this.hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);
    this.hud.setStatus(
      settings.verticalOnly
        ? "Kickoff: Run up/down with W/S or Arrow keys"
        : "Kickoff: Move with WASD or Arrow keys",
    );

    this.stateManager.kickoff();

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

    this.hud.attachToCamera(this.cameras.main);
    ctx.ball.updateFollow();

    // Celebration sequence blocks all gameplay - controllers handle their own tweens
    if (ctx.isTryCelebration) return;

    this.kick.clearAimArrowIfNotCharging();

    if (this.stateManager.currentState !== "live") return;

    // â”€â”€ Kick path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.kick.updateInput();

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
    if (!ctx.isInPlayTheBall) {
      ctx.movement.update();
    }

    this.tackle.update();
    this.handlePassingInput();
    this.line.updateAttackLineAndSupportPlayers();
    this.line.drawControlledPlayerRing();
    this.line.checkDefensiveOffside();

    // â”€â”€ Try detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (Phaser.Geom.Rectangle.Contains(ctx.pitch.topTryZone, ctx.ball.x, ctx.ball.y)) {
      this.restart.completeTry(ctx.home, "Top end");
      return;
    }
    if (Phaser.Geom.Rectangle.Contains(ctx.pitch.bottomTryZone, ctx.ball.x, ctx.ball.y)) {
      this.restart.completeTry(ctx.away, "Bottom end");
    }
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

    if (isForward) {
      ctx.isForwardPassPause = true;
      ctx.isTurnoverPause = true;
      this.line.clearTransientFieldIndicators();
      this.hud.setStatus("Forward pass! Scrum in 2s...");
      this.time.delayedCall(2000, () => {
        ctx.isForwardPassPause = false;
        ctx.isTurnoverPause = false;
        this.tackle.triggerScrum(passer.x, passer.y, false);
      });
      return;
    }

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

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: passDuration,
      ease: "Sine.InOut",
      onUpdate: (tween) => {
        const t = Number(tween.getValue());
        ctx.ball.setPosition(
          Phaser.Math.Linear(Number(startX), Number(targetSnapX), t),
          Phaser.Math.Linear(Number(startY), Number(targetSnapY), t),
        );
      },
      onComplete: () => {
        ctx.ball.setCarrier(ctx.controlledPlayer);
        this.cameras.main.startFollow(ctx.controlledPlayer, true, 0.16, 0.16);
        ctx.isBallInFlight = false;
        ctx.isLineHeldAfterPass = false;
        ctx.detachedFromLine.add(previousCarrier);
      },
    });

    this.hud.setStatus(`Pass ${direction < 0 ? "left" : "right"}...`);
  }
}
