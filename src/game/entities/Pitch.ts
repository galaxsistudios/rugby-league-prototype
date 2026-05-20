import Phaser from "phaser";

export class Pitch {
  private readonly pixelsPerMeter = 24;
  private readonly inGoalMeters = 10;
  private readonly fieldMeters = 100;

  readonly fieldRect: Phaser.Geom.Rectangle;
  readonly topTryZone: Phaser.Geom.Rectangle;
  readonly bottomTryZone: Phaser.Geom.Rectangle;
  readonly topTryLineY: number;
  readonly bottomTryLineY: number;
  private markerTexts: Phaser.GameObjects.Text[] = [];

  constructor(readonly scene: Phaser.Scene, width: number, height: number) {
    const totalMeters = this.fieldMeters + this.inGoalMeters * 2;
    const targetHeight = totalMeters * this.pixelsPerMeter;
    const fieldHeight = targetHeight;
    const fieldWidth = Math.max(1200, width - 80);

    this.fieldRect = new Phaser.Geom.Rectangle(
      (width - fieldWidth) / 2,
      40,
      fieldWidth,
      fieldHeight,
    );

    const inGoalDepth = this.inGoalMeters * this.pixelsPerMeter;
    this.topTryZone = new Phaser.Geom.Rectangle(
      this.fieldRect.x,
      this.fieldRect.y,
      this.fieldRect.width,
      inGoalDepth,
    );
    this.bottomTryZone = new Phaser.Geom.Rectangle(
      this.fieldRect.x,
      this.fieldRect.bottom - inGoalDepth,
      this.fieldRect.width,
      inGoalDepth,
    );

    this.topTryLineY = this.topTryZone.bottom;
    this.bottomTryLineY = this.bottomTryZone.y;
  }

  getLineYFromTopTryLine(meters: number): number {
    return this.topTryLineY + meters * this.pixelsPerMeter;
  }

  metersToPixels(meters: number): number {
    return meters * this.pixelsPerMeter;
  }

  getReceivingKickoffY(attackingToNorth: boolean): number {
    const receiveMetersFromOpponentTryLine = 12;
    if (attackingToNorth) {
      return this.getLineYFromTopTryLine(receiveMetersFromOpponentTryLine);
    }

    return this.getLineYFromTopTryLine(this.fieldMeters - receiveMetersFromOpponentTryLine);
  }

  render(graphics: Phaser.GameObjects.Graphics): void {
    this.clearMarkers();

    graphics.clear();
    graphics.fillStyle(0x0d7b36, 1);
    graphics.fillRectShape(this.fieldRect);

    graphics.fillStyle(0x1a9445, 1);
    graphics.fillRectShape(this.topTryZone);
    graphics.fillRectShape(this.bottomTryZone);

    graphics.lineStyle(4, 0xffffff, 1);
    graphics.strokeRectShape(this.fieldRect);

    const centerY = this.fieldRect.y + this.fieldRect.height / 2;
    graphics.lineStyle(2, 0xffffff, 0.75);
    graphics.lineBetween(this.fieldRect.x, centerY, this.fieldRect.right, centerY);

    graphics.lineStyle(2, 0xffffff, 0.4);
    graphics.lineBetween(
      this.fieldRect.x,
      this.topTryLineY,
      this.fieldRect.right,
      this.topTryLineY,
    );
    graphics.lineBetween(
      this.fieldRect.x,
      this.bottomTryLineY,
      this.fieldRect.right,
      this.bottomTryLineY,
    );

    this.drawDistanceLines(graphics);

    this.drawPosts(graphics, this.topTryLineY, this.fieldRect.centerX, false);
    this.drawPosts(graphics, this.bottomTryLineY, this.fieldRect.centerX, true);
  }

  private drawDistanceLines(graphics: Phaser.GameObjects.Graphics): void {
    const leftMarkerX = this.fieldRect.x + 10 * this.pixelsPerMeter;
    const rightMarkerX = this.fieldRect.right - 10 * this.pixelsPerMeter;

    for (let meter = 10; meter < this.fieldMeters; meter += 10) {
      const y = this.getLineYFromTopTryLine(meter);
      const isHalfway = meter === 50;
      const nearestTryDistance = Math.min(meter, this.fieldMeters - meter);
      const isRedLine = nearestTryDistance === 20 || nearestTryDistance === 40;

      const lineColor = isRedLine ? 0xde4d4d : 0xffffff;
      const lineAlpha = isRedLine ? 0.7 : isHalfway ? 0.85 : 0.45;
      const lineThickness = isHalfway ? 3 : isRedLine ? 2.5 : 1.5;

      graphics.lineStyle(lineThickness, lineColor, lineAlpha);
      graphics.lineBetween(this.fieldRect.x, y, this.fieldRect.right, y);

      const arrow = isHalfway ? "" : meter < 50 ? "^" : "v";
      this.drawMeterMarker(leftMarkerX, y, nearestTryDistance, arrow, -90);
      this.drawMeterMarker(rightMarkerX, y, nearestTryDistance, arrow, 90);
    }
  }

  private drawMeterMarker(
    x: number,
    y: number,
    meters: number,
    arrow: string,
    angle: number,
  ): void {
    const numberText = this.scene.add
      .text(x, y, `${meters}`, {
        fontFamily: "Verdana",
        fontSize: "18px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setAngle(angle);

    this.markerTexts.push(numberText);

    if (!arrow) {
      return;
    }

    const arrowOffsetY = arrow === "^" ? -18 : 18;
    const arrowText = this.scene.add
      .text(x, y + arrowOffsetY, arrow, {
        fontFamily: "Verdana",
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.markerTexts.push(arrowText);
  }

  private clearMarkers(): void {
    this.markerTexts.forEach((text) => text.destroy());
    this.markerTexts = [];
  }

  private drawPosts(
    graphics: Phaser.GameObjects.Graphics,
    lineY: number,
    centerX: number,
    faceDown: boolean,
  ): void {
    const postHalfWidth = 48;
    const crossbarOffset = faceDown ? 42 : -42;
    const postHeight = faceDown ? 126 : -126;

    graphics.lineStyle(5, 0xffffff, 1);
    graphics.lineBetween(centerX - postHalfWidth, lineY, centerX - postHalfWidth, lineY + postHeight);
    graphics.lineBetween(centerX + postHalfWidth, lineY, centerX + postHalfWidth, lineY + postHeight);
    graphics.lineBetween(
      centerX - postHalfWidth,
      lineY + crossbarOffset,
      centerX + postHalfWidth,
      lineY + crossbarOffset,
    );
  }
}
