import * as THREE from "three";
import { logMessage } from "../utils/logger.js";

const LABEL_CANVAS_WIDTH = 512;
const LABEL_CANVAS_HEIGHT = 256;

/**
 * VR用のシンプルな押しボタンを生成し、ラベル付きのボックスメッシュで表現するクラス。
 */
export class VrButton {
  /**
   * コンストラクター。サイズや色を受け取り、内部メッシュを構築する。
   * @param {{ width?: number, height?: number, depth?: number, label?: string, idleColor?: number, hoverColor?: number, pressedColor?: number }} [options]
   */
  constructor(options = {}) {
    const {
      width = 0.2,
      height = 0.08,
      depth = 0.02,
      label = "PUSH",
      idleColor = 0x1976d2,
      hoverColor = 0x42a5f5,
      pressedColor = 0x0d47a1,
    } = options;

    this.colors = { idle: idleColor, hover: hoverColor, pressed: pressedColor };
    this.group = new THREE.Group();
    this.buttonMaterial = new THREE.MeshStandardMaterial({ color: idleColor, roughness: 0.4, metalness: 0.18 });
    this.buttonMesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.buttonMaterial);
    this.buttonMesh.castShadow = true;
    this.buttonMesh.receiveShadow = true;
    this.group.add(this.buttonMesh);
    this.labelText = label;

    this.labelWidth = width * 0.82;
    this.labelHeight = height * 0.7;
    this.labelDepth = depth * 0.5 + 0.0001;

    const labelTexture = createLabelTexture(label);
    this.labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true });
    this.labelMaterial.depthWrite = false;
    this.labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(this.labelWidth, this.labelHeight), this.labelMaterial);
    this.labelMesh.position.z = this.labelDepth;
    this.buttonMesh.add(this.labelMesh);

    this.currentState = "idle";
    this.desiredState = "idle";
    this.feedbackActive = false;
    this.resetTimeout = null;
  }

  /**
   * ボタンのベースとなる Three.js オブジェクトを返す。
   * @returns {THREE.Object3D}
   */
  getObject3D() {
    return this.group;
  }

  /**
   * レイキャスト対象にすべき衝突メッシュを返す。
   * @returns {THREE.Mesh}
   */
  getHitObject() {
    return this.buttonMesh;
  }

  /**
   * ボタンのラベルを動的に変更する。
   * @param {string} newLabel - 新しいラベルテキスト
   */
  setLabel(newLabel) {
    const newTexture = createLabelTexture(newLabel);
    this.labelMaterial.map = newTexture;
    this.labelMaterial.needsUpdate = true;
    this.labelText = newLabel;
  }

  /**
   * 現在のラベル文字列を返す。
   * @returns {string}
   */
  getLabel() {
    return this.labelText;
  }

  /**
   * 視覚状態を切り替える。hover や pressed にそった配色・スケールを適用する。
   * @param {"idle" | "hover" | "pressed"} state
   */
  setState(state) {
    if (!this.colors[state]) {
      state = "idle";
    }
    this.desiredState = state;
    if (this.feedbackActive && state !== "pressed") {
      return;
    }
    this.applyStateVisuals(state);
  }

  /**
   * 押下したときのワンショットなビジュアルフィードバックを与える。
   */
  playPressedFeedback() {
    const label = this.labelText || "ボタン";
    logMessage("Verbose", `[VrButton] ${label} が押されました`);
    this.feedbackActive = true;
    this.applyStateVisuals("pressed");
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
    }
    this.resetTimeout = window.setTimeout(() => {
      this.feedbackActive = false;
      this.applyStateVisuals(this.desiredState);
    }, 160);
  }

  /**
   * 内部状態に応じたスケールと色を適用する。
   * @param {"idle" | "hover" | "pressed"} state
   */
  applyStateVisuals(state) {
    this.currentState = state;
    const scale = state === "pressed" ? 0.94 : state === "hover" ? 1.05 : 1;
    this.buttonMesh.scale.set(scale, scale, state === "pressed" ? 0.9 : 1);
    this.buttonMaterial.color.setHex(this.colors[state]);
  }
}

/**
 * キャンバスを用いてボタンラベルのテクスチャを生成する。
 * @param {string} label
 * @returns {THREE.CanvasTexture}
 */
function createLabelTexture(label) {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#fefefe");
  gradient.addColorStop(1, "#dde9ff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0d47a1";
  ctx.font = "600 130px 'Noto Sans JP', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width * 0.9);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
