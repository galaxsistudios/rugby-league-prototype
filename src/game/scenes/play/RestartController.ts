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
import { getClosestPlayerByHorizontalDistance } from "./player-utils";

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
    ctx.setTackleBonus = 0;
    ctx.tackleBustsThisSet = 0;
    ctx.consecutiveTackleBusts = 0;
    hud.setTackleCount(ctx.currentTackleCount, ctx.maxTackles);
    ctx.isInPlayTheBall = false;
    ctx.defendersCanAdvance = true;
    ctx.markerDefenders = [];
    ctx.offsideDefendersAtRuck.clear();
    ctx.isTurnoverPause = false;
    ctx.isForwardPassPause = false;
    ctx.isDiving = false;
    ctx.sixAgainAwardedThisRuck = false;
    ctx.offsideDefenders.clear();
    ctx.offsideLineY = null;
    ctx.officialsLineOverrideY = null;
    ctx.officialsRunLerp = 0.16;
    ctx.tackleCountPopupTween?.stop();
    ctx.tackleCountPopup?.destroy();
    ctx.tackleCountPopup = null;
    ctx.tackleCountPopupTween = null;
    ctx.lineReformUntil = 0;
    ctx.firstReceiverPlayer = null;
    ctx.firstReceiverTargetX = null;
    ctx.firstReceiverTargetY = null;
    this.line.clearOffsideRings();
    this.line.reseedDefensiveShift();
  }

  startGoalLineDropOut(): void {
    const { ctx, hud, scene, stateManager } = this;
    if (ctx.isTryCelebration) return;

    const kickingTeamIsHome = ctx.attackingTeamId === "home";
    const kickingPlayers = kickingTeamIsHome ? ctx.homePlayers : ctx.awayPlayers;
    const receivingPlayers = kickingTeamIsHome ? ctx.awayPlayers : ctx.homePlayers;

    const startX = ctx.pitch.fieldRect.x + 70;
    const endX = ctx.pitch.fieldRect.right - 70;
    const kickNorth = ctx.attackDirection === "north";
    const goalLineY = kickNorth ? ctx.pitch.bottomTryLineY : ctx.pitch.topTryLineY;
    const inGoalOffset = ctx.pitch.metersToPixels(4);
    const kickLineY = kickNorth ? goalLineY + inGoalOffset : goalLineY - inGoalOffset;
    const receivingLineY = Phaser.Math.Clamp(
      goalLineY + (kickNorth ? -ctx.pitch.metersToPixels(28) : ctx.pitch.metersToPixels(28)),
      ctx.pitch.topTryLineY + 24,
      ctx.pitch.bottomTryLineY - 24,
    );

    ctx.isInPlayTheBall = false;
    ctx.isTurnoverPause = true;
    ctx.isKickCharging = false;
    ctx.isKickInFlight = false;
    ctx.isKickLoose = false;
    ctx.isBallInFlight = false;
    ctx.kickAimGraphics.clear();

    [...ctx.homePlayers, ...ctx.awayPlayers].forEach((p) => {
      p.haltHorizontal();
      p.haltVertical();
      p.setScale(1);
    });

    kickingPlayers.forEach((p, i) => {
      p.setPosition(Phaser.Math.Linear(startX, endX, i / 12), kickLineY);
    });
    receivingPlayers.forEach((p, i) => {
      p.setPosition(Phaser.Math.Linear(startX, endX, i / 12), receivingLineY);
    });

    const kicker = kickingPlayers[6] ?? kickingPlayers[0];
    const receiverSlotPool = [2, 4, 6, 7, 8, 9, 10];
    const receiverSlot = receiverSlotPool[Math.floor(Math.random() * receiverSlotPool.length)];
    const receiver = receivingPlayers[receiverSlot] ?? receivingPlayers[6];

    ctx.ball.setCarrier(null);
    ctx.ball.setVisible(true);
    ctx.ball.setAngle(0);
    ctx.ball.setScale(1);
    ctx.ball.setPosition(kicker.x, kicker.y - 18);

    hud.setStatus("Goal-line dropout...");
    scene.cameras.main.startFollow(ctx.ball, true, 0.16, 0.16);

    scene.time.delayedCall(260, () => {
      ctx.isKickInFlight = true;

      const fromX = kicker.x;
      const fromY = kicker.y - 18;
      const toX = receiver.x;
      const toY = receiver.y - 28;
      const distance = Phaser.Math.Distance.Between(fromX, fromY, toX, toY);
      const arcHeight = Phaser.Math.Clamp(distance * 0.24, 70, 170);

      scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: Phaser.Math.Clamp(900 + distance * 1.1, 1000, 1500),
        ease: "Sine.InOut",
        onUpdate: (tween) => {
          const t = Number(tween.getValue());
          const baseX = Phaser.Math.Linear(fromX, toX, t);
          const baseY = Phaser.Math.Linear(fromY, toY, t);
          const lift = Math.sin(t * Math.PI) * arcHeight;
          ctx.ball.setPosition(baseX, baseY - lift);
          ctx.ball.setAngle(t * 500);
          ctx.ball.setScale(1 + Math.sin(t * Math.PI) * 0.28);
        },
        onComplete: () => {
          ctx.isKickInFlight = false;
          ctx.isKickLoose = false;
          ctx.ball.setAngle(0);
          ctx.ball.setScale(1);
          ctx.ball.setPosition(toX, toY);
          ctx.ball.setCarrier(receiver);

          const nextAttacker: "home" | "away" = kickingTeamIsHome ? "away" : "home";
          ctx.setAttackingTeam(nextAttacker);

          this.resetSetState();

          const carrier = getClosestPlayerByHorizontalDistance(ctx.attackers, receiver.x);
          ctx.ball.setCarrier(carrier);
          ctx.ball.updateFollow();
          ctx.syncControlledPlayerToHomeTeam(scene.cameras.main);

          ctx.attackingLineY = carrier.y - 28;
          ctx.previousCarrierY = carrier.y;
          this.line.reseedDefensiveShift();
          this.line.positionDefenders();

          hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
          hud.setStatus("Dropout received. Play on.");
          hud.setTackleCount(0, ctx.maxTackles);

          ctx.isTurnoverPause = false;
          stateManager.kickoff();
        },
      });
    });
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

    // Get the try scorer (ball carrier) and kicker
    const tryScorer = ctx.ball.getCarrier();
    const kickerPlayer = ctx.attackers[10] ?? ctx.attackers[6];
    const diveDistance = ctx.pitch.metersToPixels(Phaser.Math.FloatBetween(2, 4.5)); // 2-4.5m dive
    const diveY = tryAtTop ? tryLineY - diveDistance : tryLineY + diveDistance;
    let finalBallY = tryLineY;
    
    // Award try
    const tryPoints = scoring.awardTry(team);
    
    // Animate the dive
    if (tryScorer) {
      scene.tweens.add({
        targets: tryScorer,
        y: diveY,
        angle: tryAtTop ? -15 : 15, // Slight rotation during dive
        duration: 280,
        ease: "Quad.Out",
        onComplete: () => {
          // Reset rotation
          tryScorer.setAngle(0);
          
          // If try scorer is not the kicker, pass ball to kicker
          if (tryScorer !== kickerPlayer) {
            ctx.ball.setCarrier(null);
            ctx.ball.setPosition(conversionKickX, diveY);
            ctx.ball.setVisible(true);
          } else {
            // Kicker scored - keep ball with them
            ctx.ball.setCarrier(tryScorer);
          }
          finalBallY = diveY;
        }
      });
    } else {
      // Fallback if no carrier
      ctx.ball.setCarrier(null);
      ctx.ball.setPosition(conversionKickX, tryLineY);
      ctx.ball.setVisible(true);
      finalBallY = tryLineY;
    }
    
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
      duration: 10000, // Extended for ball passing/placement animations
      onUpdate: (tween) => {
        const t = tween.getValue();
        
        // Phase 0.5: Pass ball to kicker (t=0.05 or 500ms)
        if (t >= 0.05 && t < 0.06 && !timeline['phase0Started']) {
          timeline['phase0Started'] = true;
          
          // If try scorer is not the kicker, pass the ball
          if (tryScorer && tryScorer !== kickerPlayer) {
            const passDuration = 600;
            const startX = ctx.ball.x;
            const startY = ctx.ball.y;
            const targetX = kickerPlayer.x;
            const targetY = kickerPlayer.y - 28;
            const distance = Phaser.Math.Distance.Between(startX, startY, targetX, targetY);
            const arcHeight = Math.min(distance * 0.12, 35);
            
            ctx.ball.setVisible(true);
            
            scene.tweens.addCounter({
              from: 0,
              to: 1,
              duration: passDuration,
              ease: "Sine.InOut",
              onUpdate: (passTween) => {
                const pt = passTween.getValue();
                const baseX = Phaser.Math.Linear(startX, targetX, pt);
                const baseY = Phaser.Math.Linear(startY, targetY, pt);
                const heightProgress = Math.sin(pt * Math.PI);
                const arcOffset = heightProgress * arcHeight;
                
                ctx.ball.setAngle(pt * 360); // Ball rotation
                ctx.ball.setScale(1 + (heightProgress * 0.15)); // Slight scaling
                ctx.ball.setPosition(baseX, baseY - arcOffset);
              },
              onComplete: () => {
                ctx.ball.setAngle(0);
                ctx.ball.setScale(1.0);
                ctx.ball.setCarrier(kickerPlayer);
              }
            });
          } else if (tryScorer === kickerPlayer) {
            // Kicker scored - already has ball
            ctx.ball.setCarrier(kickerPlayer);
          } else {
            // Fallback: teleport ball to kicker
            ctx.ball.setCarrier(kickerPlayer);
          }
        }
        
        // Phase 1: Kicker walks to conversion spot with ball (t=0.12 or 1200ms)
        if (t >= 0.12 && t < 0.13 && !timeline['phase1Started']) {
          timeline['phase1Started'] = true;
          
          const halfwayY = ctx.pitch.getLineYFromTopTryLine(50);
          
          // Kicker walks to conversion spot (ball follows automatically via carrier)
          scene.tweens.add({
            targets: kickerPlayer,
            x: conversionKickX,
            y: kickerFieldY,
            duration: 1400,
            ease: "Sine.InOut",
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

          // Defenders behind goal line - OPPOSITE side of goal post from kick
          const kickIsLeft = conversionKickX < cx;
          const inGoalY = tryAtTop
            ? ctx.pitch.fieldRect.y + ctx.pitch.metersToPixels(4)
            : ctx.pitch.fieldRect.bottom - ctx.pitch.metersToPixels(4);
          
          // Position defenders on opposite side
          const defenderCenterX = kickIsLeft ? cx + 80 : cx - 80;

          ctx.defenders.forEach((p, i) => {
            const angle = Math.PI + (i / ctx.defenders.length) * Math.PI;
            scene.tweens.add({
              targets: p,
              x: defenderCenterX + Math.cos(angle) * 55 + Phaser.Math.FloatBetween(-8, 8),
              y: inGoalY + Math.sin(angle) * 28,
              duration: 850,
              ease: "Sine.Out",
            });
          });
        }
        
        // Phase 1.5: Kicker places ball down (t=0.35 or 3500ms)
        if (t >= 0.35 && t < 0.36 && !timeline['phase1_5Started']) {
          timeline['phase1_5Started'] = true;
          
          // Kicker releases ball and places it down
          ctx.ball.setCarrier(null);
          ctx.ball.setVisible(true);
          ctx.ball.setPosition(conversionKickX, kickerFieldY);
          ctx.ball.setAngle(0);
          ctx.ball.setScale(1.0);
          
          // Ball placement animation (vertical placement like kickoff)
          scene.tweens.add({
            targets: ctx.ball,
            angle: 90, // Rotate to vertical
            duration: 300,
            ease: "Quad.Out",
          });
        }
        
        // Phase 2: Conversion kick animation (t=0.4 or 4000ms)
        if (t >= 0.4 && t < 0.41 && !timeline['phase2Started']) {
          timeline['phase2Started'] = true;
          
          // Calculate conversion outcome
          const conversion = scoring.attemptConversion(
            team,
            conversionKickX,
            cx,
            ctx.pitch.fieldRect.width / 2,
            settings.placeKickSkill,
          );
          
          // Goal post dimensions
          const postHalfWidth = 48;
          const postHeight = tryAtTop ? -126 : 126;
          const leftPostX = cx - postHalfWidth;
          const rightPostX = cx + postHalfWidth;
          const crossbarY = tryLineY + postHeight;
          
          // Ball is already vertical and positioned from Phase 1.5
          
          // Calculate kick trajectory
          let targetX = cx; // Default: center
          let targetY = crossbarY;
          let hitPost = false;
          let missDirection: 'left' | 'right' | null = null;
          
          if (conversion.success) {
            // Success: goes through the posts (slightly randomized)
            targetX = cx + Phaser.Math.FloatBetween(-35, 35);
            targetY = crossbarY + (tryAtTop ? -40 : 40); // Above/below crossbar
          } else {
            // Miss: calculate how far off
            const difficulty = Math.abs(conversionKickX - cx) / (ctx.pitch.fieldRect.width / 2);
            const isBadMiss = Math.random() < 0.08; // 8% chance of really bad miss
            const isCloseMiss = Math.random() < 0.35; // 35% chance of close miss
            const isPostHit = Math.random() < 0.15 && !isBadMiss; // 15% chance to hit post
            
            if (isPostHit) {
              hitPost = true;
              missDirection = conversionKickX < cx ? 'left' : 'right';
              targetX = missDirection === 'left' ? leftPostX : rightPostX;
              targetY = crossbarY + Phaser.Math.FloatBetween(10, 60) * (tryAtTop ? -1 : 1);
            } else if (isBadMiss) {
              missDirection = conversionKickX < cx ? 'left' : 'right';
              const missAmount = Phaser.Math.FloatBetween(70, 140);
              targetX = missDirection === 'left' ? leftPostX - missAmount : rightPostX + missAmount;
              targetY = crossbarY + Phaser.Math.FloatBetween(-20, 40) * (tryAtTop ? -1 : 1);
            } else if (isCloseMiss) {
              missDirection = conversionKickX < cx ? 'left' : 'right';
              const missAmount = Phaser.Math.FloatBetween(12, 45);
              targetX = missDirection === 'left' ? leftPostX - missAmount : rightPostX + missAmount;
              targetY = crossbarY + Phaser.Math.FloatBetween(-10, 30) * (tryAtTop ? -1 : 1);
            } else {
              // Regular miss
              missDirection = conversionKickX < cx ? 'left' : 'right';
              const missAmount = Phaser.Math.FloatBetween(50, 85);
              targetX = missDirection === 'left' ? leftPostX - missAmount : rightPostX + missAmount;
              targetY = crossbarY + Phaser.Math.FloatBetween(-15, 35) * (tryAtTop ? -1 : 1);
            }
          }
          
          // Animate the kick
          const kickDuration = 850;
          scene.tweens.add({
            targets: ctx.ball,
            x: targetX,
            y: targetY,
            duration: kickDuration,
            ease: "Quad.InOut",
            onUpdate: (tween) => {
              // Arc effect: ball goes up then down
              const progress = tween.progress;
              const arcHeight = 80;
              const arc = Math.sin(progress * Math.PI) * arcHeight;
              const baseY = Phaser.Math.Linear(kickerFieldY, targetY, progress);
              ctx.ball.setY(baseY - arc * (tryAtTop ? 1 : -1));
              
              // Ball rotation during flight (spinning end-over-end)
              const rotationSpeed = 720; // degrees per complete animation
              ctx.ball.setAngle(90 + (progress * rotationSpeed));
              
              // Ball scaling: larger as it goes higher
              const heightProgress = Math.sin(progress * Math.PI); // 0 -> 1 -> 0
              const scaleMultiplier = 1 + (heightProgress * 0.4); // Scale up to 1.4x at peak
              ctx.ball.setScale(scaleMultiplier);
            },
            onComplete: () => {
              if (hitPost) {
                // Ball hits post and deflects
                const deflectX = missDirection === 'left' ? leftPostX - 60 : rightPostX + 60;
                const deflectY = targetY + Phaser.Math.FloatBetween(30, 50) * (tryAtTop ? 1 : -1);
                
                scene.tweens.add({
                  targets: ctx.ball,
                  x: deflectX,
                  y: deflectY,
                  duration: 350,
                  ease: "Bounce.Out",
                  onUpdate: (tween) => {
                    // Continue rotation and scaling during deflection
                    const progress = tween.progress;
                    ctx.ball.setAngle(ctx.ball.angle + 12);
                    ctx.ball.setScale(1.4 - (progress * 0.6)); // Scale down as it falls
                  },
                  onComplete: () => {
                    ctx.ball.setVisible(false);
                    ctx.ball.setAngle(0);
                    ctx.ball.setScale(1);
                  }
                });
              } else {
                // Ball continues past posts or through them
                ctx.ball.setVisible(false);
                ctx.ball.setAngle(0);
                ctx.ball.setScale(1);
              }
              
              // Update HUD
              hud.updateScore(ctx.home, ctx.away);
              hud.setStatus(
                conversion.success
                  ? `Conversion good!  +${conversion.points}  —  ${team.name}: ${team.score}`
                  : hitPost
                  ? `Conversion hit the post!  —  ${team.name}: ${team.score}`
                  : `Conversion missed  —  ${team.name}: ${team.score}`,
              );
            }
          });
          
          // Store conversion result for Phase 3
          timeline['conversionSuccess'] = conversion.success;
        }
        
        // Phase 3: Return to positions and kickoff setup (t=0.62 or 6200ms)
        if (t >= 0.62 && t < 0.63 && !timeline['phase3Started']) {
          timeline['phase3Started'] = true;
          
          ctx.officialsGraphics.clear();
          ctx.celebrationGraphics.clear();
          
          const halfwayY = ctx.pitch.getLineYFromTopTryLine(50);
          const kickingPlayers = concedingTeam === ctx.home ? ctx.homePlayers : ctx.awayPlayers;
          const receivingPlayers = concedingTeam === ctx.home ? ctx.awayPlayers : ctx.homePlayers;
          
          // Find the goal kicker (slot 6 from attacking team)
          const kickerPlayer = ctx.attackers[10] ?? ctx.attackers[6];
          
          const startX = ctx.pitch.fieldRect.x + 70;
          const endX = ctx.pitch.fieldRect.right - 70;
          
          // Calculate kicker's destination at 50m line
          const kickerIndex = receivingPlayers.indexOf(kickerPlayer);
          const kickerDestX = Phaser.Math.Linear(startX, endX, kickerIndex / 12);
          const receivingY = getKickoffCarrierY(ctx.pitch, ctx.attackDirection);
          
          // Add depth for kicker position (slightly deeper as center player)
          const kickerDepthFactor = Math.sin((kickerIndex / 12) * Math.PI) * 0.5;
          const kickerDepthOffset = ctx.pitch.metersToPixels(8) * kickerDepthFactor;
          const kickerDestY = ctx.attackDirection === "south" 
            ? receivingY + kickerDepthOffset 
            : receivingY - kickerDepthOffset;
          
          hud.setStatus("Returning to positions for kickoff...");
          
          // Follow the kicker back to their position
          scene.cameras.main.startFollow(kickerPlayer, true, 0.08, 0.08); // Slower lerp for smoother follow
          
          // Move kicker to their kickoff position (slowed down)
          scene.tweens.add({
            targets: kickerPlayer,
            x: kickerDestX,
            y: kickerDestY,
            duration: 2400, // Slowed from 1200 to 2400ms
            ease: "Sine.InOut",
            onUpdate: (tween) => {
              // When kicker is 65% of the way there, start panning camera to kicking team
              if (tween.progress >= 0.65 && !timeline['cameraPanStarted']) {
                timeline['cameraPanStarted'] = true;
                scene.cameras.main.stopFollow();
                
                // Pan towards the kicking team at 50m line
                scene.tweens.add({
                  targets: scene.cameras.main,
                  scrollX: cx - scene.cameras.main.width / 2,
                  scrollY: halfwayY - scene.cameras.main.height / 2,
                  duration: 1200,
                  ease: "Sine.InOut"
                });
              }
            }
          });
          
          // Rest of scoring team spreads out in receiving formation (maintain left-right order with depth)
          receivingPlayers.forEach((p, i) => {
            if (p === kickerPlayer) return; // Already moved above
            
            const baseX = Phaser.Math.Linear(startX, endX, i / 12);
            const depthFactor = Math.sin((i / 12) * Math.PI) * 0.5;
            const depthOffset = ctx.pitch.metersToPixels(8) * depthFactor;
            const yPos = ctx.attackDirection === "south" 
              ? receivingY + depthOffset 
              : receivingY - depthOffset;
            
            scene.tweens.add({
              targets: p,
              x: baseX,
              y: yPos,
              duration: 2400, // Match kicker's duration
              ease: "Sine.InOut",
            });
          });
          
          // Conceding team (kicking team) runs to 50m line simultaneously
          kickingPlayers.forEach((p, i) => {
            scene.tweens.add({
              targets: p,
              x: Phaser.Math.Linear(startX, endX, i / 12),
              y: halfwayY,
              duration: 2400, // Match other players
              ease: "Sine.InOut",
              onComplete: () => {
                // All players are in position - update status
                if (i === 6) { // When the main kicker is in position
                  scene.time.delayedCall(300, () => {
                    hud.setStatus("Ready for kickoff...");
                  });
                }
              },
            });
          });

          this.resetSetState();
        }
        
        // Phase 4: Kickoff (t=0.87 or 8700ms - after teams settle and camera pan)
        if (t >= 0.87 && t < 0.88 && !timeline['phase4Started']) {
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
          
          // Position ball with kicker - VERTICAL for place kick
          ctx.ball.setCarrier(null);
          ctx.ball.setVisible(true);
          ctx.ball.setPosition(kicker.x, kicker.y - 22);
          ctx.ball.setAngle(90); // Vertical orientation for kickoff
          ctx.ball.setScale(1);

          hud.setStatus(`Kickoff — to #${ctx.rugbyLeagueNumberBySlot[receiverSlot]}`);

          // Kick the ball to the receiver after a brief pause
          scene.time.delayedCall(600, () => {
            // Camera follows the ball during kickoff
            scene.cameras.main.startFollow(ctx.ball, true, 0.14, 0.14);
            
            const kickDistance = Phaser.Math.Distance.Between(kicker.x, kicker.y, receiver.x, receiver.y);
            const kickDuration = Math.min(1200, 800 + kickDistance * 0.8);
            
            scene.tweens.add({
              targets: ctx.ball,
              x: receiver.x,
              y: receiver.y - 28,
              duration: kickDuration,
              ease: "Sine.InOut",
              onUpdate: (tween) => {
                // Add arc to kickoff flight
                const progress = tween.progress;
                const arcHeight = Math.min(100, kickDistance * 0.18);
                const arc = Math.sin(progress * Math.PI) * arcHeight;
                const baseY = Phaser.Math.Linear(kicker.y - 22, receiver.y - 28, progress);
                ctx.ball.setY(baseY - arc);
                
                // Ball rotation during flight (end-over-end spin)
                const rotationSpeed = 540; // degrees
                ctx.ball.setAngle(90 + (progress * rotationSpeed));
                
                // Ball scaling: larger as it goes higher
                const heightProgress = Math.sin(progress * Math.PI);
                const scaleMultiplier = 1 + (heightProgress * 0.35);
                ctx.ball.setScale(scaleMultiplier);
              },
              onComplete: () => {
                // Reset ball orientation and scale
                ctx.ball.setAngle(0);
                ctx.ball.setScale(1);
                
                // Give ball to receiver
                ctx.ball.setCarrier(receiver);
                ctx.setAttackingTeam(receivingPlayers === ctx.homePlayers ? "home" : "away");
                
                // Set controlled player
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

                // Set up play state
                ctx.attackingLineY = receiver.y - 28;
                ctx.previousCarrierY = receiver.y;
                this.line.reseedDefensiveShift();
                this.line.positionDefenders();

                hud.setDirection(ctx.getAttackingTeam().name, ctx.attackDirection);
                hud.setStatus("Kickoff received! Drive to the line.");
                
                // Resume play
                ctx.isTryCelebration = false;
                stateManager.kickoff();
              },
            });
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
      ctx.setAttackingTeam(receivingPlayers === ctx.homePlayers ? "home" : "away");

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
