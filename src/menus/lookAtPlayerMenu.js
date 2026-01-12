import * as THREE from "three";

const STATUS_UPDATE_INTERVAL = 0.2;
const MIN_DISTANCE_SQ = 1e-4;
const BODY_TURN_THRESHOLD = THREE.MathUtils.degToRad(90);
const BODY_TURN_MIN_DURATION = 0.35;
const BODY_TURN_MAX_DURATION = 0.8;
const BODY_TURN_DURATION_PER_RAD = 0.35;

/**
 * プレイヤーの視点位置を取得し、VRM の視線をその方向へ向けるメニューを構築する。
 * NOTE: DOM要素への依存はなく、純粋なロジックのみを提供する。
 */
export function createLookAtPlayerMenu({
  vrmManager,
  stage,
}) {
  const state = {
    menuActive: false,
    autoLook: false,
    statusTimer: 0,
    lastPlayerPosition: new THREE.Vector3(),
    turnState: {
      active: false,
      startAngle: 0,
      targetAngle: 0,
      duration: 0,
      elapsed: 0,
      resumeSource: "auto",
    },
  };
  const playerHeadPosition = new THREE.Vector3();
  const vrmWorldPosition = new THREE.Vector3();
  const lookAtTarget = new THREE.Object3D();

  /**
   * ステータス表示を更新する。
   */

  /**
   * WebXR のカメラまたは通常カメラからプレイヤーの頭の位置を取得する。
   */
  function samplePlayerHeadPosition() {
    if (!stage?.renderer || !stage?.camera) {
      return null;
    }
    const renderer = stage.renderer;
    const baseCamera = renderer.xr.isPresenting
      ? renderer.xr.getCamera(stage.camera)
      : stage.camera;
    if (!baseCamera) {
      return null;
    }
    playerHeadPosition.setFromMatrixPosition(baseCamera.matrixWorld);
    state.lastPlayerPosition.copy(playerHeadPosition);
    return playerHeadPosition;
  }

  /**
   * VRM の視線ターゲットを指定したプレイヤー位置へ合わせる。
   * @param {THREE.Vector3} playerPosition プレイヤーの頭位置
   * @returns {boolean} 視線更新の成否
   */
  function updateVrmGazeTarget(playerPosition) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm?.lookAt || !playerPosition) {
      return false;
    }
    lookAtTarget.position.copy(playerPosition);
    vrm.lookAt.target = lookAtTarget;
    vrm.lookAt.lookAt?.(lookAtTarget.position);
    return true;
  }

  /**
   * 角度を -PI ~ PI に正規化する。
   */
  function normalizeRadians(angle) {
    return (
      THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
    );
  }

  /**
   * プレイヤー方向の Yaw 角を計算する。
   */
  function computeDesiredYawToPlayer(playerPosition) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm || !playerPosition) {
      return null;
    }
    vrm.scene.getWorldPosition(vrmWorldPosition);
    const dx = playerPosition.x - vrmWorldPosition.x;
    const dz = playerPosition.z - vrmWorldPosition.z;
    if (dx * dx + dz * dz <= MIN_DISTANCE_SQ) {
      return null;
    }
    return Math.atan2(dx, dz);
  }

  /**
   * VRM の体を一定時間かけて回転させる。
   */
  function beginBodyTurn(desiredAngle, source) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      state.turnState.active = false;
      return false;
    }
    const currentAngle = normalizeRadians(vrm.scene.rotation.y);
    const delta = normalizeRadians(desiredAngle - currentAngle);
    if (Math.abs(delta) < BODY_TURN_THRESHOLD) {
      state.turnState.active = false;
      state.turnState.elapsed = 0;
      return false;
    }
    const duration = THREE.MathUtils.clamp(
      Math.abs(delta) * BODY_TURN_DURATION_PER_RAD,
      BODY_TURN_MIN_DURATION,
      BODY_TURN_MAX_DURATION
    );
    state.turnState.active = true;
    state.turnState.startAngle = currentAngle;
    state.turnState.targetAngle = currentAngle + delta;
    state.turnState.elapsed = 0;
    state.turnState.duration = duration;
    state.turnState.resumeSource = source;
    return true;
  }

  /**
   * 体を回転させる処理がアクティブであれば進行させる。
   */
  function advanceBodyTurn(delta) {
    if (!state.turnState.active) {
      return;
    }
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      state.turnState.active = false;
      return;
    }
    state.turnState.elapsed += delta;
    const progress = Math.min(
      state.turnState.elapsed /
        Math.max(state.turnState.duration, Number.EPSILON),
      1
    );
    const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
    const nextAngle = THREE.MathUtils.lerp(
      state.turnState.startAngle,
      state.turnState.targetAngle,
      eased
    );
    vrm.scene.rotation.y = nextAngle;
    if (progress >= 1) {
      state.turnState.active = false;
      const resumeSource = state.turnState.resumeSource || "auto";
      state.turnState.resumeSource = "auto";
      // 体の回転が終わったら、直ちに視線合わせを再試行する
      lookAtPlayer({ source: resumeSource });
    }
  }

  /**
   * VRM の視線をプレイヤーの頭方向へ向ける。
   */
  function lookAtPlayer(options = {}) {
    const { source = "auto" } = options;
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm) {
      return false;
    }
    const playerPosition = samplePlayerHeadPosition();
    if (!playerPosition) {
      return false;
    }
    const desiredYaw = computeDesiredYawToPlayer(playerPosition);
    if (desiredYaw == null) {
      return false;
    }
    if (state.turnState.active) {
      state.turnState.resumeSource = source;
      return false;
    }
    const currentAngle = normalizeRadians(vrm.scene.rotation.y);
    const delta = normalizeRadians(desiredYaw - currentAngle);
    if (Math.abs(delta) >= BODY_TURN_THRESHOLD) {
      const turned = beginBodyTurn(desiredYaw, source);
      if (turned) {
        return false;
      }
    }
    const success = updateVrmGazeTarget(playerPosition);
    if (!success) {
      return false;
    }
    return true;
  }

  /**
   * メニューがアクティブになった際のハンドラー。
   */
  function setMenuActive(active) {
    state.menuActive = !!active;
    if (!state.menuActive) {
      state.autoLook = false;
    }
  }

  /**
   * VRM 読み込み完了時の処理。
   */
  function handleVrmReady() {
    // VRM読み込み完了時の初期化処理（現在は特に必要なし）
  }

  /**
   * 毎フレームの更新（自動追従が有効な場合に実行）。
   */
  function updateLookAtPlayer(delta) {
    advanceBodyTurn(delta);
    if (!state.menuActive || !state.autoLook) {
      return;
    }
    state.statusTimer += delta;
    const success = lookAtPlayer({ source: "auto" });
    if (!success) {
      return;
    }
    if (state.statusTimer >= STATUS_UPDATE_INTERVAL) {
      state.statusTimer = 0;
    }
  }



  return {
    setMenuActive,
    handleVrmReady,
    updateLookAtPlayer,
    /**
     * 体の回転が進行中かどうかを返す。
     */
    isTurning: () => state.turnState.active,
    /**
     * VRM の視線をプレイヤーの頭方向へ向ける。
     */
    lookAtPlayer,
  };
}
