import * as THREE from "three";

const LABEL_CANVAS_WIDTH = 512;
const LABEL_CANVAS_HEIGHT = 256;

/**
 * VR用のリストボックスコンポーネント。上下ボタンで選択肢を変更できる。
 */
export class VrListBox {
  /**
   * コンストラクター。
   * @param {{ width?: number, height?: number, depth?: number, options?: Array<{value: string, label: string}>, idleColor?: number, hoverColor?: number, pressedColor?: number }} [config]
   */
  constructor(config = {}) {
    const {
      width = 0.3,
      height = 0.08,
      depth = 0.02,
      options = [],
      idleColor = 0x1976d2,
      hoverColor = 0x42a5f5,
      pressedColor = 0x0d47a1,
    } = config;

    this.width = width;
    this.height = height;
    this.depth = depth;
    this.colors = { idle: idleColor, hover: hoverColor, pressed: pressedColor };

    this.options = options;
    this.selectedIndex = 0;

    this.group = new THREE.Group();

    // 上ボタン（▲）
    this.upButton = this.createButton("▲", 0.06, 0.06);
    this.upButton.mesh.position.set(0, height / 2 + 0.04, 0);
    this.upButton.state = "idle";
    this.upButton.feedbackActive = false;
    this.group.add(this.upButton.mesh);

    // 選択肢表示領域
    this.displayBox = this.createDisplayBox(width, height, depth);
    this.group.add(this.displayBox.mesh);

    // 下ボタン（▼）
    this.downButton = this.createButton("▼", 0.06, 0.06);
    this.downButton.mesh.position.set(0, -height / 2 - 0.04, 0);
    this.downButton.state = "idle";
    this.downButton.feedbackActive = false;
    this.group.add(this.downButton.mesh);

    this.updateDisplay();
  }

  /**
   * ボタンを作成する。
   * @param {string} label - ボタンのラベル
   * @param {number} width - ボタンの幅
   * @param {number} height - ボタンの高さ
   * @returns {{mesh: THREE.Mesh, material: THREE.MeshStandardMaterial, labelMesh: THREE.Mesh}}
   */
  createButton(label, width, height) {
    const depth = 0.02;
    const material = new THREE.MeshStandardMaterial({
      color: this.colors.idle,
      roughness: 0.4,
      metalness: 0.18,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const labelWidth = width * 0.82;
    const labelHeight = height * 0.7;
    const labelDepth = depth * 0.5 + 0.0001;

    const labelTexture = this.createLabelTexture(label, 80);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true });
    labelMaterial.depthWrite = false;
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(labelWidth, labelHeight), labelMaterial);
    labelMesh.position.z = labelDepth;
    mesh.add(labelMesh);

    return { mesh, material, labelMesh };
  }

  /**
   * 表示ボックスを作成する。
   * @param {number} width - ボックスの幅
   * @param {number} height - ボックスの高さ
   * @param {number} depth - ボックスの深さ
   * @returns {{mesh: THREE.Mesh, material: THREE.MeshStandardMaterial, labelMesh: THREE.Mesh, labelMaterial: THREE.MeshBasicMaterial}}
   */
  createDisplayBox(width, height, depth) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2a3f5f,
      roughness: 0.6,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const labelWidth = width * 0.9;
    const labelHeight = height * 0.7;
    const labelDepth = depth * 0.5 + 0.0001;

    const labelTexture = this.createLabelTexture("", 50);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true });
    labelMaterial.depthWrite = false;
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(labelWidth, labelHeight), labelMaterial);
    labelMesh.position.z = labelDepth;
    mesh.add(labelMesh);

    return { mesh, material, labelMesh, labelMaterial };
  }

  /**
   * ラベルテクスチャを作成する。
   * @param {string} label - ラベルテキスト
   * @param {number} fontSize - フォントサイズ
   * @returns {THREE.CanvasTexture}
   */
  createLabelTexture(label, fontSize = 130) {
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
    ctx.font = `600 ${fontSize}px 'Noto Sans JP', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width * 0.9);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /**
   * 選択肢を設定する。
   * @param {Array<{value: string, label: string}>} options - 選択肢の配列
   */
  setOptions(options) {
    this.options = options;
    this.selectedIndex = 0;
    this.updateDisplay();
  }

  /**
   * 表示を更新する。
   */
  updateDisplay() {
    let displayText = "選択してください";
    if (this.options.length > 0 && this.selectedIndex >= 0 && this.selectedIndex < this.options.length) {
      displayText = this.options[this.selectedIndex].label;
    }
    const newTexture = this.createLabelTexture(displayText, 50);
    this.displayBox.labelMaterial.map = newTexture;
    this.displayBox.labelMaterial.needsUpdate = true;
  }

  /**
   * 上ボタンが押された時の処理。
   */
  handleUpButton() {
    if (this.options.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length;
    this.updateDisplay();
  }

  /**
   * 下ボタンが押された時の処理。
   */
  handleDownButton() {
    if (this.options.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
    this.updateDisplay();
  }

  /**
   * 現在選択されている値を取得する。
   * @returns {string} 選択されている値
   */
  getValue() {
    if (this.options.length === 0 || this.selectedIndex < 0 || this.selectedIndex >= this.options.length) {
      return "";
    }
    return this.options[this.selectedIndex].value;
  }

  /**
   * ボタンの状態を設定する。
   * @param {"up" | "down"} button - ボタンの種類
   * @param {"idle" | "hover" | "pressed"} state - 状態
   */
  setButtonState(button, state) {
    const btn = button === "up" ? this.upButton : this.downButton;
    if (!this.colors[state]) {
      state = "idle";
    }
    btn.state = state;
    if (btn.feedbackActive && state !== "pressed") {
      return;
    }
    this.applyButtonVisuals(btn, state);
  }

  /**
   * ボタンの押下フィードバックを再生する。
   * @param {"up" | "down"} button - ボタンの種類
   */
  playButtonPressedFeedback(button) {
    const btn = button === "up" ? this.upButton : this.downButton;
    btn.feedbackActive = true;
    this.applyButtonVisuals(btn, "pressed");
    if (btn.resetTimeout) {
      clearTimeout(btn.resetTimeout);
    }
    btn.resetTimeout = window.setTimeout(() => {
      btn.feedbackActive = false;
      this.applyButtonVisuals(btn, btn.state);
    }, 160);
  }

  /**
   * ボタンのビジュアルを適用する。
   * @param {{mesh: THREE.Mesh, material: THREE.MeshStandardMaterial}} btn - ボタンオブジェクト
   * @param {"idle" | "hover" | "pressed"} state - 状態
   */
  applyButtonVisuals(btn, state) {
    const scale = state === "pressed" ? 0.94 : state === "hover" ? 1.05 : 1;
    btn.mesh.scale.set(scale, scale, state === "pressed" ? 0.9 : 1);
    btn.material.color.setHex(this.colors[state]);
  }

  /**
   * ベースとなる Three.js オブジェクトを返す。
   * @returns {THREE.Group}
   */
  getObject3D() {
    return this.group;
  }

  /**
   * 上ボタンのヒットオブジェクトを返す。
   * @returns {THREE.Mesh}
   */
  getUpButtonHitObject() {
    return this.upButton.mesh;
  }

  /**
   * 下ボタンのヒットオブジェクトを返す。
   * @returns {THREE.Mesh}
   */
  getDownButtonHitObject() {
    return this.downButton.mesh;
  }
}
