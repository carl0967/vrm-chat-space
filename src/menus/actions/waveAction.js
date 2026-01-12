import * as THREE from "three";
import { logMessage } from "../../utils/logger.js";
import { getAnimationFileByLabel } from "../../vrma/loader.js";

/**
 * 手を振るアクション
 * WaveHand.vrmaアニメーションをフェード付きで再生する。
 */
export function createWaveAction({
  vrmManager,
  setActionStatus,
  getAnimationClip,
  AnimationBlend,
  finishActionAndReturnToIdle,
  vrmaBasePath,
}) {
  let WAVE_ANIMATION_FILE = null;

  // 手を振るアクションの状態管理
  const state = {
    inProgress: false, // 手を振っている最中フラグ
    resumeTimer: 0, // アニメーション終了までの残り時間（秒）
  };

  /**
   * 「手を振る」アクションを実行する。
   * WaveHand.vrmaをフェード付きで再生する。
   */
  async function execute() {
    if (state.inProgress) {
      setActionStatus("既に手を振っています");
      return;
    }
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    try {
      setActionStatus("手を振る準備中...");

      // manifest.jsonから手を振るアニメーションファイルを取得
      if (!WAVE_ANIMATION_FILE) {
        WAVE_ANIMATION_FILE = await getAnimationFileByLabel("Wave hand", vrmaBasePath);
        if (!WAVE_ANIMATION_FILE) {
          throw new Error("manifest.jsonに'Wave hand'ラベルのアニメーションが見つかりません");
        }
      }

      const clip = await getAnimationClip(WAVE_ANIMATION_FILE);
      if (!clip) {
        throw new Error("手を振るアニメーションが読み込めませんでした");
      }

      state.inProgress = true;
      state.resumeTimer = clip.duration || 2.5;

      vrmManager.playClip(clip, {
        fadeDuration: AnimationBlend.GESTURE,
        loopMode: THREE.LoopOnce,
        repetitions: 1,
        clampWhenFinished: true,
        debugLabel: WAVE_ANIMATION_FILE,
      });

      setActionStatus("手を振っています");
    } catch (err) {
      logMessage("Error", "Wave animation error", { error: err });
      setActionStatus("手を振るアクションに失敗しました");
      state.inProgress = false;
    }
  }

  /**
   * 手を振るアクションの状態を更新する（毎フレーム呼び出される）。
   * アニメーションの終了をタイマーで管理する。
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function update(delta) {
    if (!state.inProgress) {
      return;
    }

    state.resumeTimer -= delta;
    if (state.resumeTimer <= 0) {
      state.inProgress = false;
      // 手を振った後、待機アクションに移行
      finishActionAndReturnToIdle();
    }
  }

  /**
   * 手を振るアクションが実行中かどうかを返す。
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
