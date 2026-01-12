// Walk メニュー担当モジュール
// NOTE: このモジュールはDOM要素に依存しません。純粋な歩行ロジックを提供します。
import * as THREE from "three";
import { logMessage } from "../utils/logger.js";
import { getAnimationFileByLabel } from "../vrma/loader.js";

let WALK_ANIMATION_FILE = null;
const TURN_THRESHOLD = THREE.MathUtils.degToRad(120);
const TURN_MIN_DURATION = 0.35;
const TURN_MAX_DURATION = 0.8;
const TURN_DURATION_PER_RAD = 0.35;
const ENABLE_WALK_MENU_LOG = false;

/**
 * 歩行機能を提供するモジュール。
 * DOM要素への依存はなく、純粋なロジックのみを提供する。
 */
export function createWalkMenu({
  vrmManager,
  getAnimationClip,
  AnimationBlend,
  vrmaBasePath,
}) {
  const walkState = {
    loading: false,
    moving: false,
    target: { x: 0, z: 0 },
    speed: 0.9,
    stopDistance: 0.02,
    logicalPosition: { x: 0, y: 0, z: 0 },
    turnState: {
      active: false,
      startAngle: 0,
      targetAngle: 0,
      duration: 0,
      elapsed: 0,
    },
    statusSetter: null,
    movingMessageFactory: null,
    turningMessageFactory: null,
    arrivalMessage: "",
    preserveAnimationOnFinish: false,
  };

  function applyLogicalPosition() {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      return;
    }
    const pos = walkState.logicalPosition;
    vrm.scene.position.set(pos.x, pos.y, pos.z);
  }

  function normalizeRadians(angle) {
    return (
      THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
    );
  }

  function beginTurnTowards(desiredAngle) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      walkState.turnState.active = false;
      return false;
    }
    const currentAngle = normalizeRadians(vrm.scene.rotation.y);
    const delta = normalizeRadians(desiredAngle - currentAngle);
    if (Math.abs(delta) < TURN_THRESHOLD) {
      walkState.turnState.active = false;
      walkState.turnState.elapsed = 0;
      return false;
    }
    const duration = THREE.MathUtils.clamp(
      Math.abs(delta) * TURN_DURATION_PER_RAD,
      TURN_MIN_DURATION,
      TURN_MAX_DURATION
    );
    walkState.turnState.active = true;
    walkState.turnState.startAngle = currentAngle;
    walkState.turnState.targetAngle = currentAngle + delta;
    walkState.turnState.elapsed = 0;
    walkState.turnState.duration = duration;
    return true;
  }

  function prepareTurnForCurrentTarget() {
    const pos = walkState.logicalPosition;
    const dx = walkState.target.x - pos.x;
    const dz = walkState.target.z - pos.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= 1e-4) {
      walkState.turnState.active = false;
      walkState.turnState.elapsed = 0;
      return;
    }
    const desiredAngle = Math.atan2(dx, dz);
    beginTurnTowards(desiredAngle);
  }

  function advanceTurn(delta) {
    if (!walkState.turnState.active) {
      return true;
    }
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      walkState.turnState.active = false;
      return true;
    }
    walkState.turnState.elapsed += delta;
    const progress = Math.min(
      walkState.turnState.elapsed /
        Math.max(walkState.turnState.duration, Number.EPSILON),
      1
    );
    const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
    const nextAngle = THREE.MathUtils.lerp(
      walkState.turnState.startAngle,
      walkState.turnState.targetAngle,
      eased
    );
    vrm.scene.rotation.y = nextAngle;
    if (progress >= 1) {
      walkState.turnState.active = false;
      return true;
    }
    return false;
  }

  /**
   * 歩行を終了する。
   * @param {string} statusMessage - ステータスメッセージ
   * @param {Object} options - オプション
   */
  function finishWalking(statusMessage, options = {}) {
    const { preserveAnimation = false, statusSetter } = options;
    if (ENABLE_WALK_MENU_LOG) {
      logMessage("Verbose", "[WalkMenu] finishWalking", {
        statusMessage,
        preserveAnimation,
      });
    }
    walkState.moving = false;
    if (!preserveAnimation) {
      vrmManager.stopAnimation();
    }
    walkState.turnState.active = false;
    walkState.turnState.elapsed = 0;
    const setter = statusSetter || walkState.statusSetter;
    if (statusMessage != null && setter) {
      setter(statusMessage);
    }
    walkState.statusSetter = null;
    walkState.movingMessageFactory = null;
    walkState.turningMessageFactory = null;
    walkState.arrivalMessage = "";
    walkState.preserveAnimationOnFinish = false;
  }

  /**
   * 指定された座標への移動を開始する。
   * @param {number} x - 目標X座標
   * @param {number} z - 目標Z座標
   * @param {Object} moveOptions - 移動オプション
   * @returns {Promise<boolean>} 移動開始に成功したらtrue
   */
  async function beginMoveTo(x, z, moveOptions = {}) {
    if (walkState.loading || walkState.moving) {
      return false;
    }
    if (!vrmManager.getCurrentVrm()) {
      const onNoVrm = moveOptions.onNoVrm;
      if (onNoVrm) {
        onNoVrm();
      }
      return false;
    }

    walkState.loading = true;

    const statusSetter = moveOptions.statusSetter;
    walkState.statusSetter = statusSetter;
    walkState.movingMessageFactory = moveOptions.movingMessageFactory;
    walkState.turningMessageFactory = moveOptions.turningMessageFactory;
    walkState.arrivalMessage =
      moveOptions.arrivalMessage ?? "目的地に到着しました";
    walkState.preserveAnimationOnFinish = !!moveOptions.preserveAnimation;

    if (moveOptions.preparingMessage && statusSetter) {
      statusSetter(moveOptions.preparingMessage);
    }

    try {
      // manifest.jsonから歩行アニメーションファイル名を取得
      if (!WALK_ANIMATION_FILE) {
        WALK_ANIMATION_FILE = await getAnimationFileByLabel("Walk", vrmaBasePath);
        if (!WALK_ANIMATION_FILE) {
          throw new Error("manifest.jsonに'Walk'ラベルのアニメーションが見つかりません");
        }
      }

      const clip = await getAnimationClip(WALK_ANIMATION_FILE);
      if (!clip) {
        throw new Error("Walk アニメーションが読み込めませんでした");
      }
      walkState.target.x = x;
      walkState.target.z = z;
      walkState.moving = true;
      prepareTurnForCurrentTarget();

      if (ENABLE_WALK_MENU_LOG) {
        logMessage("Verbose", "[WalkMenu] 歩きモーション開始", {
          targetX: x.toFixed(2),
          targetZ: z.toFixed(2),
          turning: walkState.turnState.active,
          currentAnimation: vrmManager.currentClipLabel,
        });
      }

      vrmManager.playClip(clip, {
        fadeDuration: AnimationBlend.LOCOMOTION,
        syncWithCurrent: true,
        debugLabel: WALK_ANIMATION_FILE,
      });
      const messageFactory = walkState.turnState.active
        ? walkState.turningMessageFactory
        : walkState.movingMessageFactory;
      if (messageFactory && statusSetter) {
        statusSetter(messageFactory(walkState.target));
      }
      return true;
    } catch (err) {
      logMessage("Error", "walk error", { error: err });
      if (statusSetter) {
        statusSetter("歩行アニメーションの準備に失敗しました");
      }
      return false;
    } finally {
      walkState.loading = false;
    }
  }

  /**
   * 毎フレーム呼ばれる更新処理。
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function updateWalk(delta) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      return;
    }

    applyLogicalPosition();

    if (!walkState.moving) {
      return;
    }

    if (walkState.turnState.active) {
      const finishedTurning = advanceTurn(delta);
      if (!finishedTurning) {
        return;
      }
      if (walkState.statusSetter && walkState.movingMessageFactory) {
        walkState.statusSetter(walkState.movingMessageFactory(walkState.target));
      }
    }

    const position = walkState.logicalPosition;
    const dx = walkState.target.x - position.x;
    const dz = walkState.target.z - position.z;
    const distance = Math.hypot(dx, dz);

    if (ENABLE_WALK_MENU_LOG) {
      logMessage("Verbose", "[WalkMenu] updateWalk", {
        currentPos: { x: position.x.toFixed(2), z: position.z.toFixed(2) },
        targetPos: { x: walkState.target.x.toFixed(2), z: walkState.target.z.toFixed(2) },
        distance: distance.toFixed(2) + "m",
        stopDistance: walkState.stopDistance.toFixed(2) + "m",
      });
    }

    if (distance <= walkState.stopDistance) {
      position.x = walkState.target.x;
      position.z = walkState.target.z;
      applyLogicalPosition();
      if (ENABLE_WALK_MENU_LOG) {
        logMessage("Verbose", "[WalkMenu] 到着しました");
      }
      finishWalking(walkState.arrivalMessage, {
        preserveAnimation: walkState.preserveAnimationOnFinish,
        statusSetter: walkState.statusSetter,
      });
      return;
    }

    const dirX = dx / distance;
    const dirZ = dz / distance;
    const move = Math.min(distance, walkState.speed * delta);
    position.x += dirX * move;
    position.z += dirZ * move;
    applyLogicalPosition();
    vrm.scene.rotation.y = Math.atan2(dirX, dirZ);
  }

  /**
   * VRMの現在位置と論理位置を同期する。
   */
  function syncLogicalPositionWithVrm() {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      return;
    }
    const pos = vrm.scene.position;
    walkState.logicalPosition.x = pos.x;
    walkState.logicalPosition.y = pos.y;
    walkState.logicalPosition.z = pos.z;
    applyLogicalPosition();
  }

  return {
    walkState,
    beginMoveTo,
    updateWalk,
    finishWalking,
    syncLogicalPositionWithVrm,
    isMoving: () => walkState.moving,
    isLoading: () => walkState.loading,
  };
}
