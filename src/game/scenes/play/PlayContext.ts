import Phaser from "phaser";
import { Ball } from "../../entities/Ball";
import { Pitch } from "../../entities/Pitch";
import { Player } from "../../entities/Player";
import { Team } from "../../entities/Team";
import { MovementController } from "../../systems/MovementController";
import { getClosestPlayerByDistance } from "./player-utils";

/**
 * Central mutable state bag for PlayScene.
 * All controllers read from and write to this object. Graphics handles are also
 * stored here so every controller can access them without extra constructor params.
 */
export class PlayContext {
  // ─── Entities ───────────────────────────────────────────────────────────────
  pitch!: Pitch;
  ball!: Ball;
  movement!: MovementController;
  home!: Team;
  away!: Team;
  homePlayers: Player[] = [];
  awayPlayers: Player[] = [];
  attackers: Player[] = [];
  defenders: Player[] = [];
  controlledPlayer!: Player;

  // ─── Graphics ───────────────────────────────────────────────────────────────
  offsideGraphics!: Phaser.GameObjects.Graphics;
  officialsGraphics!: Phaser.GameObjects.Graphics;
  kickAimGraphics!: Phaser.GameObjects.Graphics;
  controlledPlayerRingGraphics!: Phaser.GameObjects.Graphics;
  debugLinesGraphics: Phaser.GameObjects.Graphics | null = null;
  debugEnabled = false;

  // ─── Slot / rule constants ───────────────────────────────────────────────────
  // Slot layout (left to right): Wings → Centers → Halves → Second Rows → Props → middle,
  // with Fullback (1) and Lock (13) in the two central support slots.
  readonly rugbyLeagueNumberBySlot = [5, 4, 6, 11, 8, 1, 9, 13, 10, 12, 7, 3, 2];
  readonly attackingLineIndices = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly supportPodIndices = [0, 1, 11, 12];
  readonly markerDefenderIndices = [5, 6];
  readonly maxTackles = 6;
  readonly maxTackleBustsPerSet = 2;
  readonly maxConsecutiveTackleBusts = 1;
  readonly tackleCooldownMs = 700;
  readonly controlledTeamId: "home" | "away" = "home";

  // ─── Attack-line state ───────────────────────────────────────────────────────
  attackingLineY = 0;
  supportDepthMeters = 5;
  supportPodDepthMeters = 10;
  passLineHoldMeters = 5;
  isLineHeldAfterPass = false;
  heldLineY = 0;
  holdStartCarrierY = 0;
  holdReleaseDistancePx = 0;
  detachedFromLine = new Set<Player>();
  dragLineWithCarrier = false;
  previousCarrierY = 0;
  lineReformUntil = 0;
  firstReceiverPlayer: Player | null = null;
  firstReceiverTargetX: number | null = null;
  firstReceiverTargetY: number | null = null;

  // ─── Match state ─────────────────────────────────────────────────────────────
  attackingTeamId: "home" | "away" = "home";
  attackDirection: "north" | "south" = "north";
  readonly homeAttackDirection: "north" | "south" = "north";
  readonly awayAttackDirection: "north" | "south" = "south";

  // ─── Tackle / ruck state ─────────────────────────────────────────────────────
  currentTackleCount = 0;
  setTackleBonus = 0;
  tackleBustsThisSet = 0;
  consecutiveTackleBusts = 0;
  isInPlayTheBall = false;
  defendersCanAdvance = true;
  playTheBallMarkY = 0;
  markerDefenders: Player[] = [];
  offsideDefendersAtRuck = new Set<Player>();
  offsideDefenders = new Set<Player>();
  offsideLineY: number | null = null;
  lastTackleAt = 0;
  sixAgainAwardedThisRuck = false;

  // ─── Defence ─────────────────────────────────────────────────────────────────
  defensiveLineGapMeters = 10;
  defensiveRetreatMeters = 10;
  defensiveChaseSpeedScale = 1;
  defensiveShiftMeters: number[] = [];

  // ─── Officials ───────────────────────────────────────────────────────────────
  refereeDotX: number | null = null;
  refereeDotY: number | null = null;
  officialsLineOverrideY: number | null = null;
  officialsRunLerp = 0.16;
  tackleCountPopup: Phaser.GameObjects.Text | null = null;
  tackleCountPopupTween: Phaser.Tweens.Tween | null = null;

  // ─── Celebration / scoring transition ────────────────────────────────────────
  isTryCelebration = false;
  celebrationGraphics!: Phaser.GameObjects.Graphics;

  // ─── Pause / transition flags ────────────────────────────────────────────────
  isTurnoverPause = false;
  isForwardPassPause = false;
  isScrumPause = false;
  scrumWinnerIsAttacker = true;
  isBallInFlight = false;
  isDiving = false;
  isPrematchSequence = false;
  isKickoffSetPiece = false;

  // ─── Kick state ──────────────────────────────────────────────────────────────
  isKickCharging = false;
  isKickInFlight = false;
  isKickLoose = false;
  kickType: "punt" | "bomb" | "chip" | null = null;
  kickOwnerTeamId: "home" | "away" = "home";  
  kickStartY = 0; // Track where kick originated for 40/20 rules
  kickLastBounceY = 0; // Track last bounce position
  kickBouncedOut = false; // Did ball bounce before going out
  kickContestPlayers: Player[] = []; // Players contesting bomb catch
  // ─── Stamina system ──────────────────────────────────────────────────────────
  isShiftPressed = false;
  lastStaminaUpdate = 0;  kickOffsideAttackers = new Set<Player>();
  kickAimForwardMeters = 28;
  kickAimSideMeters = 0;
  kickTargetX = 0;
  kickTargetY = 0;
  kickGroundedBeforeClaim = false;

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  getBallCarrier(): Player | null {
    if (!this.ball) return null;
    return this.ball.getCarrier() as Player | null;
  }

  syncTeamRoles(): void {
    this.attackers = this.attackingTeamId === "home" ? this.homePlayers : this.awayPlayers;
    this.defenders = this.attackingTeamId === "home" ? this.awayPlayers : this.homePlayers;
  }

  setAttackingTeam(teamId: "home" | "away"): void {
    this.attackingTeamId = teamId;
    this.attackDirection = teamId === "home" ? this.homeAttackDirection : this.awayAttackDirection;
    this.syncTeamRoles();
  }

  getControlledTeamPlayers(): Player[] {
    return this.controlledTeamId === "home" ? this.homePlayers : this.awayPlayers;
  }

  isHomeTeamInPossession(): boolean {
    const carrier = this.getBallCarrier();
    return carrier ? this.homePlayers.includes(carrier) : false;
  }

  getAttackingTeam(): Team {
    return this.attackingTeamId === "home" ? this.home : this.away;
  }

  getForwardProgress(fromY: number, toY: number): number {
    return this.attackDirection === "north" ? fromY - toY : toY - fromY;
  }

  /** Transfer camera + movement control to the nearest home-team player (or ball carrier). */
  syncControlledPlayerToHomeTeam(
    camera: Phaser.Cameras.Scene2D.Camera,
    preferBallCarrier = true,
  ): void {
    const ballCarrier = this.getBallCarrier();
    if (preferBallCarrier && ballCarrier && this.homePlayers.includes(ballCarrier)) {
      this.controlledPlayer = ballCarrier;
    } else {
      this.controlledPlayer = getClosestPlayerByDistance(
        this.homePlayers,
        this.ball.x,
        this.ball.y,
      );
    }
    this.controlledPlayer.setScale(1.12);
    this.movement.setControlledPlayer(this.controlledPlayer);
    camera.startFollow(this.controlledPlayer, true, 0.16, 0.16);
    camera.centerOn(this.controlledPlayer.x, this.controlledPlayer.y);
  }
}
