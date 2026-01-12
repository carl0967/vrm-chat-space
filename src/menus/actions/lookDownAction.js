import * as THREE from "three";
import { VRMHumanBoneName } from "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.1.3/+esm";
import { logMessage } from "../../utils/logger.js";

/**
 * 首を動かす機能（見下ろし制御）
 * VRMの首・頭ボーンを回転させて、指定された角度で首を動かす。
 * 手動指定とプレイヤー位置に応じた自動調整の両方をサポートする。
 */
export function createLookDownAction({ vrmManager }) {
  const MANUAL_LOOK_DOWN_MIN_DEGREES = -45;
  const MANUAL_LOOK_DOWN_MAX_DEGREES = 45;
  const MANUAL_LOOK_DOWN_MAX_RADIANS = THREE.MathUtils.degToRad(MANUAL_LOOK_DOWN_MAX_DEGREES);
  const LOOK_DOWN_BONE_MIN_RAD = THREE.MathUtils.degToRad(-65);
  const LOOK_DOWN_BONE_MAX_RAD = THREE.MathUtils.degToRad(35);
  const LOOK_DOWN_APPLY_SPEED = 8;
  const LOOK_DOWN_RELEASE_SPEED = 5;
  const LOOK_DOWN_EPSILON = THREE.MathUtils.degToRad(0.5);

  // 見下ろし制御の状態管理
  const state = {
    enabled: false, // 見下ろし制御が有効かどうか
    targetAngleRad: 0, // 目標角度（ラジアン）。正の値: 下方向、負の値: 上方向
    mode: "manual", // "manual" または "auto"
    boneOffsets: new Map(), // 各ボーンの現在のオフセット値（ラジアン）
  };

  const lookDownBoneCache = new Map();
  const LOOK_DOWN_BONE_WEIGHTS = [
    { name: VRMHumanBoneName.Head, weight: 0.68 },
    { name: VRMHumanBoneName.Neck, weight: 0.32 },
  ];

  /**
   * 見下ろし対象ボーンを取得（キャッシュ付き）。
   * @param {VRMHumanBoneName} boneName - ボーン名
   * @returns {THREE.Object3D|null} ボーンオブジェクト
   */
  function getLookDownBone(boneName) {
    if (lookDownBoneCache.has(boneName)) {
      return lookDownBoneCache.get(boneName);
    }
    const vrm = vrmManager.getCurrentVrm();
    const bone = vrm?.humanoid?.getNormalizedBoneNode(boneName) ?? null;
    if (bone) {
      lookDownBoneCache.set(boneName, bone);
    }
    return bone;
  }

  /**
   * 指数移動を用いたスムージング係数を返す。
   * @param {number} delta - 前フレームからの経過時間（秒）
   * @param {number} speedPerSec - 1秒あたりの速度係数
   * @returns {number} スムージング係数（0〜1）
   */
  function computeSmoothingAlpha(delta, speedPerSec) {
    const clampedDelta = Math.min(Math.max(delta ?? 0.016, 0.005), 0.1);
    return 1 - Math.exp(-speedPerSec * clampedDelta);
  }

  /**
   * 見下ろし角度の目標値を設定する。
   * @param {number} angleRad - -45度から45度の範囲の弧度法角度（正の値: 下方向、負の値: 上方向）
   * @param {"auto"|"manual"} mode - 設定モード
   */
  function setTarget(angleRad, mode) {
    const maxRad = MANUAL_LOOK_DOWN_MAX_RADIANS;
    const clamped = THREE.MathUtils.clamp(angleRad, -maxRad, maxRad);
    state.targetAngleRad = clamped;
    state.enabled = Math.abs(clamped) > LOOK_DOWN_EPSILON;
    state.mode = mode;
  }

  /**
   * VRMの首・頭ボーンへ顎を引く角度を適用する。
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function applyPose(delta) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm?.humanoid) {
      return;
    }

    const targetAngleRad = state.enabled ? state.targetAngleRad : 0;
    const smoothingFactor = computeSmoothingAlpha(
      delta,
      state.enabled ? LOOK_DOWN_APPLY_SPEED : LOOK_DOWN_RELEASE_SPEED
    );
    let maxAbsOffset = 0;

    LOOK_DOWN_BONE_WEIGHTS.forEach(({ name, weight }) => {
      const bone = getLookDownBone(name);
      if (!bone) {
        return;
      }

      const previousOffset = state.boneOffsets.get(name) ?? 0;
      const baseRotationX = bone.rotation.x - previousOffset;
      const desiredOffset =
        Math.abs(targetAngleRad) > LOOK_DOWN_EPSILON ? targetAngleRad * weight : 0;
      const nextOffset = THREE.MathUtils.lerp(
        previousOffset,
        desiredOffset,
        smoothingFactor
      );
      maxAbsOffset = Math.max(maxAbsOffset, Math.abs(nextOffset));

      const finalRotation = THREE.MathUtils.clamp(
        baseRotationX + nextOffset,
        LOOK_DOWN_BONE_MIN_RAD,
        LOOK_DOWN_BONE_MAX_RAD
      );
      bone.rotation.x = finalRotation;

      if (Math.abs(nextOffset) < LOOK_DOWN_EPSILON && !state.enabled) {
        state.boneOffsets.delete(name);
      } else {
        state.boneOffsets.set(name, nextOffset);
      }
    });

    if (!state.enabled && maxAbsOffset <= LOOK_DOWN_EPSILON) {
      state.boneOffsets.clear();
    }
  }

  /**
   * 手動見下ろしリクエストを処理する。
   * @param {number} levelDegrees - 首を動かす角度(度)。正の値: 下を向く、負の値: 上を向く。
   * @returns {{ success: boolean, angleDeg: number, reason: string }} 処理結果
   */
  function applyManual(levelDegrees) {
    const safeDegrees = Number.isFinite(levelDegrees)
      ? THREE.MathUtils.clamp(levelDegrees, MANUAL_LOOK_DOWN_MIN_DEGREES, MANUAL_LOOK_DOWN_MAX_DEGREES)
      : 0;
    const angleRad = THREE.MathUtils.degToRad(safeDegrees);
    setTarget(angleRad, "manual");

    const appliedDeg = THREE.MathUtils.radToDeg(state.targetAngleRad);
    logMessage("Info", "[ActionMenu] 手動見下ろし角度を更新しました", {
      requestedDegrees: Number(levelDegrees),
      appliedDegrees: Number(appliedDeg.toFixed(2)),
    });

    return {
      success: true,
      angleDeg: appliedDeg,
      reason: "manual",
    };
  }

  /**
   * 見下ろし制御の内部状態を初期化する。
   */
  function reset() {
    state.enabled = false;
    state.targetAngleRad = 0;
    state.mode = "manual";
    state.boneOffsets.clear();
    lookDownBoneCache.clear();
  }

  return {
    applyPose,
    applyManual,
    setTarget,
    reset,
  };
}
