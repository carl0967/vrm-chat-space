/**
 * 手動まばたきアクション
 * ユーザーが明示的に「まばたきをする」ボタンを押した時に実行される。
 * 自動まばたきとは独立して動作する。
 */
export function createBlinkAction({ vrmManager, setActionStatus, finishActionAndReturnToIdle }) {
  // 手動まばたきの状態管理
  const state = {
    inProgress: false, // まばたき実行中フラグ
    phase: "closing", // 現在のフェーズ: "closing", "closed", "opening"
    elapsed: 0, // 現在のフェーズの経過時間（秒）
    closeDuration: 0.1, // 目を閉じる時間（秒）
    holdDuration: 0.05, // 目を閉じた状態を保つ時間（秒）
    openDuration: 0.15, // 目を開ける時間（秒）
    currentValue: 0, // 現在のblink expression値（0=開いている、1=閉じている）
  };

  /**
   * まばたきアクションを実行する。
   * VRMの表情制御機能を使用して、目を閉じて開くアニメーションを行う。
   */
  function execute() {
    if (state.inProgress) {
      setActionStatus("既にまばたき中です");
      return;
    }
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    // VRMの表情管理機能が利用可能かチェック
    const vrm = vrmManager.getCurrentVrm();
    if (!vrm.expressionManager) {
      setActionStatus("このモデルは表情制御に対応していません");
      return;
    }

    // まばたきの状態を初期化して開始
    state.inProgress = true;
    state.phase = "closing";
    state.elapsed = 0;
    state.currentValue = 0;

    setActionStatus("まばたきをしています...");
  }

  /**
   * まばたきアニメーションを更新する（毎フレーム呼び出される）。
   * 3つのフェーズ（closing, closed, opening）を経過時間に基づいて遷移させる。
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function update(delta) {
    if (!state.inProgress) {
      return;
    }

    const vrm = vrmManager.getCurrentVrm();
    if (!vrm?.expressionManager) {
      state.inProgress = false;
      setActionStatus("まばたきに失敗しました");
      return;
    }

    state.elapsed += delta;

    // フェーズ1: 目を閉じる（0秒 → closeDuration秒）
    if (state.phase === "closing") {
      const progress = Math.min(state.elapsed / state.closeDuration, 1);
      state.currentValue = progress; // 0 → 1
      vrm.expressionManager.setValue("blink", state.currentValue);

      if (progress >= 1) {
        state.phase = "closed";
        state.elapsed = 0; // 次フェーズ用に経過時間をリセット
      }
    }
    // フェーズ2: 目を閉じた状態を維持（0秒 → holdDuration秒）
    else if (state.phase === "closed") {
      vrm.expressionManager.setValue("blink", 1);

      if (state.elapsed >= state.holdDuration) {
        state.phase = "opening";
        state.elapsed = 0; // 次フェーズ用に経過時間をリセット
      }
    }
    // フェーズ3: 目を開ける（0秒 → openDuration秒）
    else if (state.phase === "opening") {
      const progress = Math.min(state.elapsed / state.openDuration, 1);
      state.currentValue = 1 - progress; // 1 → 0
      vrm.expressionManager.setValue("blink", state.currentValue);

      if (progress >= 1) {
        // まばたき完了
        vrm.expressionManager.setValue("blink", 0);
        state.inProgress = false;
        setActionStatus("まばたきしました");
        // まばたき後、待機アクションに移行
        finishActionAndReturnToIdle();
      }
    }
  }

  /**
   * まばたきが実行中かどうかを返す。
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
