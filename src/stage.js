import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@0.164.1/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "https://unpkg.com/three@0.164.1/examples/jsm/webxr/VRButton.js";
import { logMessage } from "./utils/logger.js";

const PAN_BUTTON = 1;
const DESKTOP_PAN_SPEED = 0.0035;
const KEYBOARD_MOVE_SPEED = 2.25;
const tempRight = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const movementVector = new THREE.Vector3();

const MOVEMENT_KEY_BINDINGS = Object.freeze({
  KeyW: { forward: 1 },
  KeyS: { forward: -1 },
  KeyA: { strafe: -1 },
  KeyD: { strafe: 1 },
  KeyR: { vertical: 1 },
  KeyF: { vertical: -1 },
});

/**
 * ライティングと床グリッドなど、舞台の固定オブジェクトを生成する。
 * @param {THREE.Object3D} container
 * @returns {{ floor: THREE.Mesh, grid: THREE.Object3D }}
 */
function addStageElements(container) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  container.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(2.0, 3.8, 2.5);
  container.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x88b7ff, 0.8);
  rimLight.position.set(-2.5, 3.0, -2.5);
  container.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 64),
    new THREE.MeshStandardMaterial({
      color: 0x101010,
      roughness: 0.9,
      metalness: 0.05,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  container.add(floor);

  const grid = new THREE.GridHelper(6, 30, 0x444444, 0x222222);
  grid.position.y = 0.001;
  container.add(grid);

  return { floor, grid };
}

/**
 * カメラ視点を前後左右に平行移動する補助関数。
 */
function translateViewer(camera, controls, rightAmount, forwardAmount, verticalAmount) {
  if (!camera || (!rightAmount && !forwardAmount && !verticalAmount)) {
    return false;
  }

  tempRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  tempRight.y = 0;
  const hasRightAxis = tempRight.lengthSq() > 0;
  if (hasRightAxis) {
    tempRight.normalize();
  }

  tempForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  tempForward.y = 0;
  const hasForwardAxis = tempForward.lengthSq() > 0;
  if (hasForwardAxis) {
    tempForward.normalize();
  }

  const hasVerticalAmount = typeof verticalAmount === "number" && verticalAmount !== 0;

  if (!hasRightAxis && !hasForwardAxis && !hasVerticalAmount) {
    return false;
  }

  if (hasRightAxis && rightAmount) {
    camera.position.addScaledVector(tempRight, rightAmount);
    controls?.target?.addScaledVector(tempRight, rightAmount);
  }
  if (hasForwardAxis && forwardAmount) {
    camera.position.addScaledVector(tempForward, forwardAmount);
    controls?.target?.addScaledVector(tempForward, forwardAmount);
  }
  if (hasVerticalAmount) {
    camera.position.y += verticalAmount;
    if (controls?.target) {
      controls.target.y += verticalAmount;
    }
  }
  return true;
}

/**
 * 中ボタンのドラッグで視点をスライドさせる入力を設定する。
 */
function setupPointerPanning(camera, renderer, controls) {
  const dom = renderer.domElement;
  const panState = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  };

  function endPan(pointerId) {
    if (!panState.active || panState.pointerId !== pointerId) {
      return;
    }
    panState.active = false;
    if (dom.hasPointerCapture(pointerId)) {
      dom.releasePointerCapture(pointerId);
    }
    panState.pointerId = null;
  }

  dom.addEventListener("pointerdown", (event) => {
    if (event.button !== PAN_BUTTON || renderer.xr.isPresenting) {
      return;
    }
    panState.active = true;
    panState.pointerId = event.pointerId;
    panState.lastX = event.clientX;
    panState.lastY = event.clientY;
    dom.setPointerCapture(event.pointerId);
  });

  dom.addEventListener("pointerup", (event) => {
    if (event.button !== PAN_BUTTON) {
      return;
    }
    endPan(event.pointerId);
  });

  dom.addEventListener("pointercancel", (event) => {
    endPan(event.pointerId);
  });

  dom.addEventListener("pointermove", (event) => {
    if (!panState.active || renderer.xr.isPresenting) {
      return;
    }
    const dx = event.clientX - panState.lastX;
    const dy = event.clientY - panState.lastY;
    panState.lastX = event.clientX;
    panState.lastY = event.clientY;

    const moved = translateViewer(
      camera,
      controls,
      -dx * DESKTOP_PAN_SPEED,
      dy * DESKTOP_PAN_SPEED
    );
    if (moved) {
      controls?.update();
    }
  });
}

/**
 * WASD キー入力から視点移動を制御し、アニメーションループから呼び出せる updater を返す。
 */
function setupKeyboardMovement(camera, renderer, controls) {
  const pressedKeys = new Set();

  function handleKeyDown(event) {
    if (renderer.xr.isPresenting) {
      return;
    }
    // 入力要素にフォーカスがある場合はカメラ移動を無効化
    const target = event.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }
    if (!MOVEMENT_KEY_BINDINGS[event.code]) {
      return;
    }
    pressedKeys.add(event.code);
    event.preventDefault();
  }

  function handleKeyUp(event) {
    // 入力要素にフォーカスがある場合はカメラ移動を無効化
    const target = event.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }
    if (!MOVEMENT_KEY_BINDINGS[event.code]) {
      return;
    }
    pressedKeys.delete(event.code);
  }

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", () => {
    pressedKeys.clear();
  });

  return function updateKeyboardMovement(delta) {
    if (renderer.xr.isPresenting || pressedKeys.size === 0) {
      return;
    }

    movementVector.set(0, 0, 0);
    pressedKeys.forEach((code) => {
      const binding = MOVEMENT_KEY_BINDINGS[code];
      if (!binding) {
        return;
      }
      movementVector.x += binding.strafe ?? 0;
      movementVector.y += binding.forward ?? 0;
      movementVector.z += binding.vertical ?? 0;
    });

    if (movementVector.lengthSq() === 0) {
      return;
    }

    const horizontalLength = Math.hypot(movementVector.x, movementVector.y);
    if (horizontalLength > 1) {
      movementVector.x /= horizontalLength;
      movementVector.y /= horizontalLength;
    }
    movementVector.z = THREE.MathUtils.clamp(movementVector.z, -1, 1);

    const moveSpeed = KEYBOARD_MOVE_SPEED * delta;
    translateViewer(camera, controls, movementVector.x * moveSpeed, movementVector.y * moveSpeed, movementVector.z * moveSpeed);
  };
}

/**
 * Three.js のシーンとレンダラーをまとめて初期化し、移動制御を返す。
 */
export function initStage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040404);
  const world = new THREE.Group();
  // VR セッション開始時にユーザー原点からステージ全体を後退させたいので
  // VRM や床などの「環境」要素は world グループに集約し、カメラ基準の scene とは分離する。
  scene.add(world);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  // カメラの初期座標
  camera.position.set(0, 1.5, 2.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  const xrSessionInit = { requiredFeatures: ["hand-tracking"] };
  const isWebxrSupported = typeof navigator !== "undefined" && "xr" in navigator;
  const vrButton = VRButton.createButton(renderer, xrSessionInit);
  vrButton.id = "VRButton";
  const isFallbackVrLink = vrButton.tagName !== "BUTTON";
  let suppressVrButtonObserver = false;
  let vrButtonObserverResumeTimer = null;
  let vrButtonStyleObserver = null;

  // VRモード開始前にマイク許可を取得
  if (isWebxrSupported) {
    vrButton.addEventListener("click", async () => {
      try {
        // マイク許可を事前に取得（VRモードに入る前に）
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // すぐに停止（許可だけ取得する）
        stream.getTracks().forEach((track) => track.stop());
        logMessage("Info", "マイク許可を取得しました");
      } catch (error) {
        logMessage("Warn", "マイク許可の取得に失敗しました", { error: error });
        // エラーでもVRモードには入れるようにする
      }
    });
  }

  document.body.appendChild(vrButton);
  applyVRButtonBaseStyles();
  setupVrButtonStyleObserver();

  /**
   * VRButtonをアクションパネルのすぐ下に配置する。
   */
  function updateVRButtonPosition() {
    const actionPanel = document.querySelector(".action-panel");
    if (!actionPanel) {
      return;
    }
    const rect = actionPanel.getBoundingClientRect();
    // アクションパネルの下端 + マージン（20px）
    const topPosition = rect.bottom + 20;
    runWithVrButtonObserverSuppressed(() => {
      vrButton.style.setProperty("top", `${topPosition}px`, "important");
    });
  }

  // 初回位置設定
  updateVRButtonPosition();

  // リサイズ時やページ読み込み完了時に位置を更新
  window.addEventListener("resize", updateVRButtonPosition);
  window.addEventListener("load", updateVRButtonPosition);
  // DOMの変更を監視（アクションパネルのサイズが変わった場合）
  const observer = new MutationObserver(updateVRButtonPosition);
  const actionPanel = document.querySelector(".action-panel");
  if (actionPanel) {
    observer.observe(actionPanel, { childList: true, subtree: true, characterData: true });
  }

  /**
   * Safariで縦長になる問題を避けるため、VRButtonのベーススタイルを強制的に適用する。
   */
  function applyVRButtonBaseStyles() {
    if (!vrButton) {
      return;
    }
    runWithVrButtonObserverSuppressed(() => {
      if (isFallbackVrLink) {
        vrButton.removeAttribute("style");
      }
      const style = vrButton.style;
      style.setProperty("position", "fixed", "important");
      style.setProperty("left", "50%", "important");
      style.setProperty("transform", "translateX(-50%)", "important");
      style.setProperty("bottom", "auto", "important");
      style.setProperty("width", "auto", "important");
      style.setProperty("min-width", "170px", "important");
      style.setProperty("max-width", "240px", "important");
      style.setProperty("height", "auto", "important");
      style.setProperty("min-height", "44px", "important");
      style.setProperty("max-height", "72px", "important");
      style.setProperty("padding", "12px 24px", "important");
      style.setProperty("display", "inline-flex", "important");
      style.setProperty("align-items", "center", "important");
      style.setProperty("justify-content", "center", "important");
      style.setProperty("white-space", "nowrap", "important");
      style.setProperty("font-size", "13px", "important");
      style.setProperty("line-height", "1.4", "important");
      style.setProperty("box-sizing", "border-box", "important");
      style.setProperty("-webkit-appearance", "none", "important");
      style.setProperty("appearance", "none", "important");
      style.setProperty("text-decoration", "none", "important");
      style.setProperty("touch-action", "manipulation", "important");
      style.setProperty("color", "rgba(255, 255, 255, 0.85)", "important");
      style.setProperty("background", "rgba(5, 5, 5, 0.25)", "important");
      style.setProperty("border", "1px solid rgba(255, 255, 255, 0.25)", "important");
      style.setProperty("border-radius", "12px", "important");
      style.setProperty("backdrop-filter", "blur(8px)", "important");
      style.setProperty("box-shadow", "0 4px 16px rgba(0, 0, 0, 0.25)", "important");
      style.setProperty("opacity", "0.85", "important");
      style.setProperty("cursor", "pointer", "important");
    });
  }

  /**
   * Three.js側によるstyle書き換えを検知し、即座にカスタムスタイルを再適用する。
   */
  function setupVrButtonStyleObserver() {
    if (!isWebxrSupported) {
      return;
    }
    if (vrButtonStyleObserver) {
      vrButtonStyleObserver.disconnect();
    }
    vrButtonStyleObserver = new MutationObserver((mutations) => {
      if (suppressVrButtonObserver) {
        return;
      }
      const hasStyleMutation = mutations.some(
        (mutation) => mutation.type === "attributes" && mutation.attributeName === "style"
      );
      if (hasStyleMutation) {
        applyVRButtonBaseStyles();
        updateVRButtonPosition();
      }
    });
    vrButtonStyleObserver.observe(vrButton, { attributes: true, attributeFilter: ["style"] });
  }

  /**
   * MutationObserver を一時停止した状態でコールバックを実行する。
   * DOMを書き換えるたびに再帰的な通知が発生するのを避けるために使用する。
   * @param {() => void} task - スタイルを書き換える処理
   */
  function runWithVrButtonObserverSuppressed(task) {
    if (!isWebxrSupported) {
      task();
      return;
    }
    suppressVrButtonObserver = true;
    try {
      task();
    } finally {
      if (vrButtonObserverResumeTimer !== null) {
        clearTimeout(vrButtonObserverResumeTimer);
      }
      vrButtonObserverResumeTimer = setTimeout(() => {
        suppressVrButtonObserver = false;
        vrButtonObserverResumeTimer = null;
      }, 0);
    }
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.35, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 6.5;
  controls.minPolarAngle = Math.PI / 4;
  controls.maxPolarAngle = Math.PI / 2;
  controls.update();

  const { floor } = addStageElements(world);
  setupPointerPanning(camera, renderer, controls);
  const updateKeyboardMovement = setupKeyboardMovement(
    camera,
    renderer,
    controls
  );

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    world,
    floor,
    camera,
    renderer,
    controls,
    clock: new THREE.Clock(),
    updateKeyboardMovement,
  };
}
