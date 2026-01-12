/**
 * 待機アクション
 * ランダムモードを停止し、待機アニメーションを開始する。
 */
export function createIdleAction({ vrmManager, randomMenu, idleLoopMenu, setActionStatus }) {
  /**
   * 「待機」アクションを実行する。
   * idle2.vrmaとidle_2.vrmaを繰り返す。
   */
  function execute() {
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    // ランダムモードを停止
    randomMenu.deactivateRandomMode();

    // 待機アニメーションを開始
    idleLoopMenu.activateIdleLoopMode();
    setActionStatus("待機アニメーションを開始しました");
  }

  return {
    execute,
  };
}
