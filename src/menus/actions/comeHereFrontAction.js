import * as THREE from "three";
import { logMessage } from "../../utils/logger.js";

/**
 * 「こっちに来る(正面)」アクション
 * プレイヤーの正面1.5m位置に移動し、移動完了後はプレイヤーの方を向く回転処理を行う。
 * 回転処理はupdate()内で実行される。
 */
export function createComeHereFrontAction({
  vrmManager,
  stage,
  randomMenu,
  walkMenu,
  idleLoopMenu,
  lookAtPlayerMenu,
  setActionStatus,
  formatVectorForLog,
  normalizeRadians,
  applyManualLookDown,
  ENABLE_ACTION_MENU_LOG,
}) {
  const COME_HERE_FRONT_SKIP_THRESHOLD = 1;

  // アクションの状態管理
  const state = {
    inProgress: false, // 移動中フラグ
    turnToPlayerState: {
      active: false, // 回転処理中フラグ
      startAngle: 0, // 回転開始時の角度（ラジアン）
      targetAngle: 0, // 回転目標角度（ラジアン）
      duration: 0.5, // 回転時間（秒）
      elapsed: 0, // 経過時間（秒）
    },
  };

  /**
   * 「こっちに来る(正面)」アクションを実行する。
   * プレイヤーの正面1.5m位置に移動し、移動完了後はプレイヤーの方を向く回転処理を行う。
   * 回転処理はupdate()内で実行される。
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
      // 先にランダムモードのみ停止し、待機アクションは移動確定まで保持する
      randomMenu.deactivateRandomMode();

      // プレイヤーの位置と向きを取得（VRモード時はXRカメラ、通常時は通常カメラを使用）
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

      // カメラの正面方向ベクトルを取得し、プレイヤーの1.5m前方を目標地点とする
      const cameraDirection = new THREE.Vector3();
      baseCamera.getWorldDirection(cameraDirection);
      const frontDistance = 1.5;
      const targetPosition = new THREE.Vector3();
      targetPosition.copy(playerPosition).add(cameraDirection.multiplyScalar(frontDistance));

      // Y座標はVRMの現在の高さに合わせる（地面に埋まったり浮いたりしないように）
      const vrmPosition = new THREE.Vector3();
      vrmManager.getCurrentVrm().scene.getWorldPosition(vrmPosition);
      targetPosition.y = vrmPosition.y;

      const distanceToPlayer = Math.sqrt(
        Math.pow(playerPosition.x - vrmPosition.x, 2) +
          Math.pow(playerPosition.z - vrmPosition.z, 2)
      );
      const distanceToFrontTarget = Math.sqrt(
        Math.pow(targetPosition.x - vrmPosition.x, 2) +
          Math.pow(targetPosition.z - vrmPosition.z, 2)
      );
      const distanceLogPayload = {
        playerPosition: formatVectorForLog(playerPosition),
        vrmPosition: formatVectorForLog(vrmPosition),
        targetPosition: formatVectorForLog(targetPosition),
        playerToVrmDistance: Number(distanceToPlayer.toFixed(3)),
        distanceToFrontTarget: Number(distanceToFrontTarget.toFixed(3)),
        threshold: COME_HERE_FRONT_SKIP_THRESHOLD,
      };
      const shouldSkipFrontMove =
        distanceToFrontTarget <= COME_HERE_FRONT_SKIP_THRESHOLD;

      if (shouldSkipFrontMove) {
        logMessage(
          "Verbose",
          "[ActionMenu] プレイヤー正面まで1m以内のため移動をスキップします",
          Object.assign({}, distanceLogPayload, { shouldSkipFrontMove })
        );
        setActionStatus("既にプレイヤーの正面にいます");
        return;
      }

      // 実際に移動する場合のみ待機モードを解除し、Idle→歩行のフェード破綻を防ぐ
      idleLoopMenu.deactivateIdleLoopMode();

      logMessage(
        "Verbose",
        "[ActionMenu] プレイヤー正面へ移動を開始します",
        Object.assign({}, distanceLogPayload, { shouldSkipFrontMove })
      );

      if (ENABLE_ACTION_MENU_LOG) {
        const randomActive = randomMenu.randomState?.active;
        logMessage("Verbose", "[ActionMenu] こっちに来る(正面)アクション開始", {
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
            x: targetPosition.x.toFixed(2),
            y: targetPosition.y.toFixed(2),
            z: targetPosition.z.toFixed(2),
          },
          distance: Math.sqrt(
            Math.pow(playerPosition.x - vrmPosition.x, 2) +
            Math.pow(playerPosition.z - vrmPosition.z, 2)
          ).toFixed(2) + "m",
        });
      }

      // アクション進行状態を記録
      state.inProgress = true;
      setActionStatus("プレイヤーの正面に向かっています...");

      // walkStateの論理位置をVRMの実際の位置と同期（位置ずれを防ぐ）
      walkMenu.syncLogicalPositionWithVrm();

      // 移動を開始（preserveAnimation: trueで移動完了後も歩きアニメーションを保持）
      // 歩きアニメーションを保持する理由: 移動完了後にプレイヤーの方を向く回転処理を行うため
      // 回転処理はupdate()内で実行され、回転完了後にIdleモードに移行する
      const moveSucceeded = await walkMenu.beginMoveTo(targetPosition.x, targetPosition.z, {
        statusSetter: setActionStatus,
        preparingMessage: "プレイヤーの正面に移動する準備をしています...",
        turningMessageFactory: () => "正面位置の方を向いています...",
        movingMessageFactory: () => "プレイヤーの正面に向かっています...",
        disableWalkButton: false,
        preserveAnimationDisableState: true,
        arrivalMessage: "正面位置に到着しました",
        preserveAnimation: true, // 移動完了後も歩きアニメーションを保持（回転処理のため）
      });

      if (!moveSucceeded) {
        state.inProgress = false;
        setActionStatus("正面に移動できませんでした");
      }
    } catch (err) {
      logMessage("Error", "Come here front action error", { error: err });
      setActionStatus("正面に移動するアクションに失敗しました");
      state.inProgress = false;
    }
  }

  /**
   * アクションの状態を更新する（毎フレーム呼び出される）。
   * 移動完了を検知し、プレイヤーの方への回転処理を管理する。
   * @param {number} delta - 前フレームからの経過時間（秒）
   * @returns {boolean} アクションが完了した場合true
   */
  function update(delta) {
    // 「こっちに来る(正面)」アクションの移動完了チェック
    // 条件:
    //   - inProgressがtrue（アクション実行中）
    //   - walkMenu.isMoving()がfalse（移動完了）
    //   - walkMenu.isLoading()がfalse（アニメーション読み込み完了）
    // ※移動完了後、プレイヤーの方を向く回転処理を開始する
    if (state.inProgress && !walkMenu.isMoving() && !walkMenu.isLoading()) {
      state.inProgress = false;

      // 移動完了後、プレイヤーの方を向く回転処理を開始
      const vrm = vrmManager.getCurrentVrm();
      if (vrm && stage?.renderer && stage?.camera) {
        try {
          const renderer = stage.renderer;
          const baseCamera = renderer.xr.isPresenting
            ? renderer.xr.getCamera(stage.camera)
            : stage.camera;

          if (baseCamera) {
            const playerPosition = new THREE.Vector3();
            playerPosition.setFromMatrixPosition(baseCamera.matrixWorld);

            const vrmPosition = new THREE.Vector3();
            vrm.scene.getWorldPosition(vrmPosition);

            // プレイヤーの方を向く目標角度を計算（XZ平面上の角度）
            const dx = playerPosition.x - vrmPosition.x;
            const dz = playerPosition.z - vrmPosition.z;
            const targetAngle = normalizeRadians(Math.atan2(dx, dz));
            const currentAngle = normalizeRadians(vrm.scene.rotation.y);

            // 回転アニメーション状態を初期化して開始
            state.turnToPlayerState.active = true;
            state.turnToPlayerState.startAngle = currentAngle;
            state.turnToPlayerState.targetAngle = targetAngle;
            state.turnToPlayerState.elapsed = 0;

            setActionStatus("プレイヤーの方を向いています...");

            if (ENABLE_ACTION_MENU_LOG) {
              logMessage("Verbose", "[ActionMenu] プレイヤーの方への回転開始", {
                currentAngle: (currentAngle * 180 / Math.PI).toFixed(2) + "度",
                targetAngle: (targetAngle * 180 / Math.PI).toFixed(2) + "度",
              });
            }
          }
        } catch (err) {
          logMessage("Error", "Turn to player error", { error: err });
          // エラー時はアクション完了を通知
          return true;
        }
      } else {
        // VRMやカメラがない場合はアクション完了を通知
        return true;
      }
    }

    // プレイヤーの方への回転アニメーション処理
    // こっちに来る(正面)アクションの移動完了後に実行される
    if (state.turnToPlayerState.active) {
      const vrm = vrmManager.getCurrentVrm();
      if (!vrm) {
        state.turnToPlayerState.active = false;
        return true;
      }

      // 経過時間を加算して進捗を計算（0.0〜1.0）
      state.turnToPlayerState.elapsed += delta;
      const progress = Math.min(
        state.turnToPlayerState.elapsed /
          Math.max(state.turnToPlayerState.duration, Number.EPSILON),
        1
      );

      // smoothstep関数でイージング（滑らかな加減速）
      const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
      const nextAngle = THREE.MathUtils.lerp(
        state.turnToPlayerState.startAngle,
        state.turnToPlayerState.targetAngle,
        eased
      );

      // VRMモデルの回転を更新
      vrm.scene.rotation.y = nextAngle;

      // 回転完了チェック
      if (progress >= 1) {
        state.turnToPlayerState.active = false;
        setActionStatus("プレイヤーの方を向きました");

        if (ENABLE_ACTION_MENU_LOG) {
          const finalVrmPosition = new THREE.Vector3();
          vrm.scene.getWorldPosition(finalVrmPosition);

          if (stage?.renderer && stage?.camera) {
            try {
              const renderer = stage.renderer;
              const baseCamera = renderer.xr.isPresenting
                ? renderer.xr.getCamera(stage.camera)
                : stage.camera;

              if (baseCamera) {
                const finalPlayerPosition = new THREE.Vector3();
                finalPlayerPosition.setFromMatrixPosition(baseCamera.matrixWorld);

                logMessage("Verbose", "[ActionMenu] プレイヤーの方への回転完了", {
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
              } else {
                logMessage("Verbose", "[ActionMenu] プレイヤーの方への回転完了");
              }
            } catch (err) {
              logMessage("Verbose", "[ActionMenu] プレイヤーの方への回転完了");
            }
          } else {
            logMessage("Verbose", "[ActionMenu] プレイヤーの方への回転完了");
          }
        }

        // 回転完了後、「こっちをみる(首も動かす)」の動きを追加（視線の調整 + 首の角度調整）
        if (stage?.renderer && stage?.camera) {
          const renderer = stage.renderer;
          const baseCamera = renderer.xr.isPresenting
            ? renderer.xr.getCamera(stage.camera)
            : stage.camera;

          if (baseCamera) {
            const playerPos = new THREE.Vector3();
            playerPos.setFromMatrixPosition(baseCamera.matrixWorld);

            // プレイヤーのy座標に応じて首を引く角度を決定
            const neckAngle = playerPos.y < 1 ? 20 : 0;

            // 首を動かす処理を適用
            applyManualLookDown(neckAngle);
          }
        }

        // 視線をプレイヤーに向ける
        lookAtPlayerMenu.lookAtPlayer({ source: "manual" });

        // 回転完了を通知
        return true;
      }
    }

    return false;
  }

  /**
   * アクションが実行中かどうかを返す。
   * @returns {boolean} 実行中の場合true
   */
  function isInProgress() {
    return state.inProgress || state.turnToPlayerState.active;
  }

  return {
    execute,
    update,
    isInProgress,
  };
}
