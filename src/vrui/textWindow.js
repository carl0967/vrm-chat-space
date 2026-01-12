import * as THREE from "three";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 640;

/**
 * VR空間内に配置するテキストウインドウを生成し、CanvasTextureで動的に描画するクラス。
 */
export class VrTextWindow {
  /**
   * コンストラクター。幅・高さや配色を受け取って平面メッシュを構築する。
   * @param {{ width?: number, height?: number, backgroundColor?: string, textColor?: string, paddingRatio?: number }} [options]
   */
  constructor(options = {}) {
    const {
      width = 0.62,
      height = 0.22,
      backgroundColor = "#0c111c",
      textColor = "#f4f6fb",
      paddingRatio = 0.08,
    } = options;

    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    /** @type {CanvasRenderingContext2D | null} */
    this.context = this.canvas.getContext("2d");
    this.backgroundColor = backgroundColor;
    this.textColor = textColor;
    this.paddingRatio = paddingRatio;
    this.currentText = "";

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    material.depthWrite = false;
    this.mesh = new THREE.Mesh(geometry, material);

    this.updateText("状態: 初期化中");
  }

  /**
   * このウインドウのメッシュ参照を返す。
   * @returns {THREE.Mesh}
   */
  getObject3D() {
    return this.mesh;
  }

  /**
   * 表示テキストを受け取り、キャンバスに描画してテクスチャを更新する。
   * @param {string} message
   */
  updateText(message, options = {}) {
    if (!this.context) {
      return;
    }
    const { force = false } = options;
    if (!force && this.currentText === message) {
      return;
    }
    this.currentText = message;
    drawPanel(this.context, this.canvas.width, this.canvas.height, this.backgroundColor);
    drawPanelText(this.context, this.canvas.width, this.canvas.height, message, this.textColor, this.paddingRatio);
    this.texture.needsUpdate = true;
  }
}

/**
 * 角丸矩形を描画して背景をリセットする。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string} fillStyle
 */
function drawPanel(ctx, width, height, fillStyle) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = fillStyle;
  const radius = Math.min(width, height) * 0.05;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();
}

/**
 * 指定テキストをキャンバス中央に描画する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string} text
 * @param {string} color
 * @param {number} paddingRatio
 */
function drawPanelText(ctx, width, height, text, color, paddingRatio) {
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = height * 0.04;
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim());
  const usableHeight = height * (1 - paddingRatio * 2);
  const lineCount = Math.max(lines.length, 1);
  const lineHeight = usableHeight / lineCount;
  const fontSize = Math.max(Math.floor(lineHeight * 0.72), 10);
  ctx.font = `600 ${fontSize}px "Noto Sans JP", sans-serif`;
  const startX = width * paddingRatio * 1.4;
  const startY = (height - lineHeight * (lineCount - 1)) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line || "", startX, startY + lineHeight * index, width * (1 - paddingRatio * 2));
  });
}
