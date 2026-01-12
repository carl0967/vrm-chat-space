import * as THREE from "three";
import { logMessage } from "../../utils/logger.js";

/**
 * 「こっちに来る」アクション
 * プレイヤーの0.5m手前まで移動する。移動完了後は歩きアニメーションを停止する。
 */
export function createComeHereAction({
  vrmManager,
  stage,
  randomMenu,
  walkMenu,
  idleLoopMenu,
  setActionStatus,
  formatVectorForLog,
  ENABLE_ACTION_MENU_LOG,
}) {
  // アクションの状態管理
  const state = {
    inProgress: false, // 移動中フラグ
  };

  /**
   * 「こっちに来る」アクションを実行する。
   * プレイヤーの0.5m手前まで移動する。移動完了後は歩きアニメーションを停止する。
   */
  async function execute() {
    if (state.inProgress) {
      setActionStatus("既にこっちに向かっています");
      return;
    }

    // 既に移動中（ランダムモードなど）の場合は、その移動をキャンセルして新しい移動を開始
    if (walkMenu.isMoving()) {
      walkMenu.finishWalking("", { preserveAnimation: false });
    }

    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }
    if (!stage?.renderer || !stage?.camera) {
      setActionStatus("カメラ情報を取得できませんでした");
      return;
    }

    try {
      // ランダムモードと待機モードを停止（歩きアニメーションが上書きされないように）
      randomMenu.deactivateRandomMode();
      idleLoopMenu.deactivateIdleLoopMode();

      // プレイヤーの位置を取得（VRモード時はXRカメラ、通常時は通常カメラを使用）
      const renderer = stage.renderer;
      const baseCamera = renderer.xr.isPresenting
        ? renderer.xr.getCamera(stage.camera)
        : stage.camera;

      if (!baseCamera) {
        setActionStatus("カメラ情報を取得できませんでした");
        return;
      }

      const playerPosition = new THREE.Vector3();
      playerPosition.setFromMatrixPosition(baseCamera.matrixWorld);

      // VRMの現在位置を取得
      const vrmPosition = new THREE.Vector3();
      vrmManager.getCurrentVrm().scene.getWorldPosition(vrmPosition);

      // プレイヤーとVRMの距離を計算し、プレイヤーの0.5m手前を目標地点とする
      const dx = playerPosition.x - vrmPosition.x;
      const dz = playerPosition.z - vrmPosition.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const approachDistance = Math.max(distance - 0.5, 0.1);
      const targetX = vrmPosition.x + (dx / distance) * approachDistance;
      const targetZ = vrmPosition.z + (dz / distance) * approachDistance;

      if (ENABLE_ACTION_MENU_LOG) {
        const randomActive = randomMenu.randomState?.active;
        logMessage("Verbose", "[ActionMenu] こっちに来るアクション開始", {
          randomModeActive: randomActive,
          currentAnimation: vrmManager.currentClipLabel,
          playerPosition: {
            x: playerPosition.x.toFixed(2),
            y: playerPosition.y.toFixed(2),
            z: playerPosition.z.toFixed(2),
          },
          vrmPosition: {
            x: vrmPosition.x.toFixed(2),
            y: vrmPosition.y.toFixed(2),
            z: vrmPosition.z.toFixed(2),
          },
          targetPosition: {
            x: targetX.toFixed(2),
            z: targetZ.toFixed(2),
          },
          distance: distance.toFixed(2) + "m",
          approachDistance: approachDistance.toFixed(2) + "m",
        });
      }

      // アクション進行状態を記録
      state.inProgress = true;
      setActionStatus("こっちに向かっています...");

      // walkStateの論理位置をVRMの実際の位置と同期（位置ずれを防ぐ）
      walkMenu.syncLogicalPositionWithVrm();

      // 移動を開始（preserveAnimation: falseで移動完了後に歩きアニメーションを停止）
      const moveSucceeded = await walkMenu.beginMoveTo(targetX, targetZ, {
        statusSetter: setActionStatus,
        preparingMessage: "こっちに来る準備をしています...",
        turningMessageFactory: () => "プレイヤーの方を向いています...",
        movingMessageFactory: () => "こっちに向かっています...",
        disableWalkButton: false,
        preserveAnimationDisableState: true,
        arrivalMessage: "到着しました",
        preserveAnimation: false, // 移動完了後、歩きアニメーションを停止
      });

      if (!moveSucceeded) {
        state.inProgress = false;
        setActionStatus("こっちに来ることができませんでした");
      }
    } catch (err) {
      logMessage("Error", "Come here action error", { error: err });
      setActionStatus("こっちに来るアクションに失敗しました");
      state.inProgress = false;
    }
  }

  /**
   * アクションの状態を更新する（毎フレーム呼び出される）。
   * 移動完了を検知する。
   * @returns {boolean} アクションが完了した場合true
   */
  function update() {
    // 「こっちに来る」アクションの終了チェック
    // 条件:
    //   - inProgressがtrue（アクション実行中）
    //   - walkMenu.isMoving()がfalse（移動完了）
    //   - walkMenu.isLoading()がfalse（アニメーション読み込み完了）
    // ※isLoading()チェックが重要: 非同期でアニメーション読み込み中はwalkState.movingがまだfalseのため、
    //   isMoving()だけでは誤判定してしまう（レースコンディション防止）
    if (state.inProgress && !walkMenu.isMoving() && !walkMenu.isLoading()) {
      state.inProgress = false;

      if (ENABLE_ACTION_MENU_LOG) {
        const vrm = vrmManager.getCurrentVrm();
        if (vrm && stage?.renderer && stage?.camera) {
          try {
            const renderer = stage.renderer;
            const baseCamera = renderer.xr.isPresenting
              ? renderer.xr.getCamera(stage.camera)
              : stage.camera;

            if (baseCamera) {
              const finalPlayerPosition = new THREE.Vector3();
              finalPlayerPosition.setFromMatrixPosition(baseCamera.matrixWorld);

              const finalVrmPosition = new THREE.Vector3();
              vrm.scene.getWorldPosition(finalVrmPosition);

              logMessage("Verbose", "[ActionMenu] こっちに来るアクション完了", {
                playerPosition: {
                  x: finalPlayerPosition.x.toFixed(2),
                  y: finalPlayerPosition.y.toFixed(2),
                  z: finalPlayerPosition.z.toFixed(2),
                },
                vrmPosition: {
                  x: finalVrmPosition.x.toFixed(2),
                  y: finalVrmPosition.y.toFixed(2),
                  z: finalVrmPosition.z.toFixed(2),
                },
                distance: Math.sqrt(
                  Math.pow(finalPlayerPosition.x - finalVrmPosition.x, 2) +
                    Math.pow(finalPlayerPosition.z - finalVrmPosition.z, 2)
                ).toFixed(2) + "m",
              });
            }
          } catch (err) {
            logMessage("Error", "Failed to log comeHere completion", { error: err });
          }
        }
      }

      // 移動完了を通知
      return true;
    }

    return false;
  }

  /**
   * アクションが実行中かどうかを返す。
   * @returns {boolean} 実行中の場合true
   */
  function isInProgress() {
    return state.inProgress;
  }

  return {
    execute,
    update,
    isInProgress,
  };
}
