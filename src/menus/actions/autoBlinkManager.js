/**
 * 自動まばたきマネージャー
 * VRMモデルに自然なまばたきを定期的に実行する。
 * 2〜8秒のランダムな間隔でまばたきアニメーションを再生し、生命感を演出する。
 */
export function createAutoBlinkManager({ vrmManager }) {
  // 自動まばたきの状態管理
  const state = {
    enabled: true, // 自動まばたき有効フラグ
    nextBlinkTime: 5.0, // 次のまばたきまでの残り時間（秒）。初回は5秒後
    minInterval: 2.0, // 最小間隔（秒）
    maxInterval: 8.0, // 最大間隔（秒）
    currentBlink: {
      inProgress: false, // まばたき実行中フラグ
      phase: "closing", // 現在のフェーズ: "closing", "closed", "opening"
      elapsed: 0, // 現在のフェーズの経過時間（秒）
      closeDuration: 0.1, // 目を閉じる時間（秒）
      holdDuration: 0.05, // 目を閉じた状態を保つ時間（秒）
      openDuration: 0.15, // 目を開ける時間（秒）
      currentValue: 0, // 現在のblink expression値（0=開いている、1=閉じている）
    },
  };

  /**
   * ランダムな次回まばたき時間を生成する。
   * minIntervalとmaxIntervalの範囲内でランダムな値を返す。
   * @returns {number} 次回まばたきまでの時間（秒）
   */
  function getRandomBlinkInterval() {
    return state.minInterval + Math.random() * (state.maxInterval - state.minInterval);
  }

  /**
   * 自動まばたきを開始する。
   * VRMの表情管理機能が利用可能かチェックし、まばたき状態を初期化する。
   */
  function startAutoBlink() {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm?.expressionManager) {
      return;
    }

    // まばたき状態を初期化
    state.currentBlink.inProgress = true;
    state.currentBlink.phase = "closing";
    state.currentBlink.elapsed = 0;
    state.currentBlink.currentValue = 0;
  }

  /**
   * まばたきアニメーションを更新する（毎フレーム呼び出される）。
   * 3つのフェーズ（closing, closed, opening）を経過時間に基づいて遷移させる。
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function updateBlinkAnimation(delta) {
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm?.expressionManager) {
      return;
    }

    const blink = state.currentBlink;
    blink.elapsed += delta;

    // フェーズ1: 目を閉じる（0秒 → closeDuration秒）
    if (blink.phase === "closing") {
      const progress = Math.min(blink.elapsed / blink.closeDuration, 1);
      blink.currentValue = progress; // 0 → 1
      vrm.expressionManager.setValue("blink", blink.currentValue);

      if (progress >= 1) {
        blink.phase = "closed";
        blink.elapsed = 0; // 次フェーズ用に経過時間をリセット
      }
    }
    // フェーズ2: 目を閉じた状態を維持（0秒 → holdDuration秒）
    else if (blink.phase === "closed") {
      vrm.expressionManager.setValue("blink", 1);

      if (blink.elapsed >= blink.holdDuration) {
        blink.phase = "opening";
        blink.elapsed = 0; // 次フェーズ用に経過時間をリセット
      }
    }
    // フェーズ3: 目を開ける（0秒 → openDuration秒）
    else if (blink.phase === "opening") {
      const progress = Math.min(blink.elapsed / blink.openDuration, 1);
      blink.currentValue = 1 - progress; // 1 → 0
      vrm.expressionManager.setValue("blink", blink.currentValue);

      if (progress >= 1) {
        // まばたき完了
        vrm.expressionManager.setValue("blink", 0);
        blink.inProgress = false;
        // 次回のまばたき時間をランダムに設定
        state.nextBlinkTime = getRandomBlinkInterval();
      }
    }
  }

  /**
   * 自動まばたきの状態を更新する（毎フレーム呼び出される）。
   * まばたき実行中はアニメーションを更新し、待機中はカウントダウンを行う。
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function update(delta) {
    if (!state.enabled) {
      return;
    }

    if (state.currentBlink.inProgress) {
      // まばたき実行中
      updateBlinkAnimation(delta);
    } else {
      // 次のまばたきまでカウントダウン
      state.nextBlinkTime -= delta;
      if (state.nextBlinkTime <= 0) {
        startAutoBlink();
      }
    }
  }

  /**
   * 自動まばたきを有効化する。
   */
  function enable() {
    if (!state.enabled) {
      state.enabled = true;
      // 有効化時に次回まばたき時間をリセット
      state.nextBlinkTime = getRandomBlinkInterval();
    }
  }

  /**
   * 自動まばたきを無効化する。
   * 実行中のまばたきは完了させる。
   */
  function disable() {
    state.enabled = false;
  }

  /**
   * 自動まばたきが有効かどうかを返す。
   * @returns {boolean} 有効な場合true
   */
  function isEnabled() {
    return state.enabled;
  }

  /**
   * 自動まばたきが実行中かどうかを返す。
   * 手動まばたきとの競合を避けるために使用。
   * @returns {boolean} 実行中の場合true
   */
  function isInProgress() {
    return state.currentBlink.inProgress;
  }

  return {
    update,
    enable,
    disable,
    isEnabled,
    isInProgress,
  };
}
