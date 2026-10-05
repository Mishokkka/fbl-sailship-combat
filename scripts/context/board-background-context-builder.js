import { cellPath, getHexMetrics } from "../board/board-geometry.js";

export class BoardBackgroundContextBuilder {
  static build(board, pixelWidth, pixelHeight, seed = "battle") {
    const width = Number(board?.width ?? 0);
    const height = Number(board?.height ?? 0);
    const metrics = getHexMetrics(board?.cellSize ?? 48);
    const patternPath = [];
    for (let y = -1; y <= 1; y++) {
      for (let x = 0; x <= 1; x++) patternPath.push(cellPath(board, x, y));
    }
    const safeSeed = String(seed || "battle").replace(/[^a-z0-9_-]/gi, "-");
    const padX = pixelWidth * 2 + metrics.width;
    const padY = pixelHeight * 2 + metrics.height;
    const image = this.buildImagePattern(board?.background, safeSeed);
    return {
      pattern: {
        id: `ssc-hex-pattern-${safeSeed}-${Math.round(metrics.height)}`,
        width: metrics.columnStep * 2,
        height: metrics.height,
        path: patternPath.join(" ")
      },
      image,
      backdrop: {
        x: -padX,
        y: -padY,
        width: pixelWidth + padX * 2,
        height: pixelHeight + padY * 2
      },
      bounds: { x: 0, y: 0, width: pixelWidth, height: pixelHeight }
    };
  }

  static buildImagePattern(background, safeSeed) {
    if (!background?.enabled || !background.src) return { enabled: false };
    const tileSize = Math.max(64, Math.min(2048, Number(background.tileSize ?? 512)));
    const opacity = Math.max(0, Math.min(1, Number(background.opacity ?? 0.35)));
    return {
      enabled: true,
      id: `ssc-bg-image-${safeSeed}-${Math.round(tileSize)}`,
      href: String(background.src),
      tileSize: Math.round(tileSize),
      opacity
    };
  }
}
