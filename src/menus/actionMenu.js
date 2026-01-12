import * as THREE from "three";
import { setStatusText } from "../top_common.js";
import { createAutoBlinkManager } from "./actions/autoBlinkManager.js";
import { createBlinkAction } from "./actions/blinkAction.js";
import { createWaveAction } from "./actions/waveAction.js";
import { createComeHereAction } from "./actions/comeHereAction.js";
import { createComeHereFrontAction } from "./actions/comeHereFrontAction.js";
import { createLookDownAction } from "./actions/lookDownAction.js";
import { createIdleAction } from "./actions/idleAction.js";

/**
 * アクションメニューを管理するモジュール。
 * 各アクションは個別ファイルに分離され、このモジュールはルーティングと共通処理を担当する。
 */
export function createActionMenu({
  vrmManager,
  stage,
  randomMenu,
  walkMenu,
  idleLoopMenu,
  lookAtPlayerMenu,
  actionSelect,
  actionExecuteButton,
  actionStatusElement,
  getAnimationClip,
  AnimationBlend,
}) {
  const ENABLE_ACTION_MENU_LOG = false; // デバッグ時にtrueにすると詳細ログが出力される

  // アクション管理の状態
  const actionState = {
    currentAction: "", // 現在実行中のアクション名
    lookAtPlayerInProgress: false, // こっちをみるアクション実行中フラグ
  };

  /**
   * アクションステータスを設定する。
   * @param {string} text - 表示するステータステキスト
   */
  function setActionStatus(text) {
    setStatusText(actionStatusElement, text);
  }

  /**
   * アクション完了後の共通処理。
   * ランダムアクション以外の場合は待機アクションに移行する。
   */
  function finishActionAndReturnToIdle() {
    if (actionState.currentAction !== "random") {
      idleAction.execute();
    }
  }

  /**
   * 角度を -π ~ π の範囲に正規化する。
   * @param {number} angle - 正規化する角度（ラジアン）
   * @returns {number} 正規化された角度（ラジアン）
   */
  function normalizeRadians(angle) {
    return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
  }

  /**
   * ログ出力向けに Vector3 を丸めて整形する。
   * @param {THREE.Vector3} vector - 変換対象のVector3
   * @returns {{ x: number, y: number, z: number }} ログ用の座標情報
   */
  function formatVectorForLog(vector) {
    if (!vector) {
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x: Number(vector.x.toFixed(3)),
      y: Number(vector.y.toFixed(3)),
      z: Number(vector.z.toFixed(3)),
    };
  }

  // 各アクションモジュールを初期化
  const autoBlinkManager = createAutoBlinkManager({ vrmManager });

  const blinkAction = createBlinkAction({
    vrmManager,
    setActionStatus,
    finishActionAndReturnToIdle,
  });

  const waveAction = createWaveAction({
    vrmManager,
    setActionStatus,
    getAnimationClip,
    AnimationBlend,
    finishActionAndReturnToIdle,
  });

  const comeHereAction = createComeHereAction({
    vrmManager,
    stage,
    randomMenu,
    walkMenu,
    idleLoopMenu,
    setActionStatus,
    formatVectorForLog,
    ENABLE_ACTION_MENU_LOG,
  });

  const comeHereFrontAction = createComeHereFrontAction({
    vrmManager,
    stage,
    randomMenu,
    walkMenu,
    idleLoopMenu,
    lookAtPlayerMenu,
    setActionStatus,
    formatVectorForLog,
    normalizeRadians,
    applyManualLookDown: (angleDeg) => lookDownAction.applyManual(angleDeg),
    ENABLE_ACTION_MENU_LOG,
  });

  const lookDownAction = createLookDownAction({ vrmManager });

  const idleAction = createIdleAction({
    vrmManager,
    randomMenu,
    idleLoopMenu,
    setActionStatus,
  });

  /**
   * 「ランダム」アクションを実行する。
   * 既存のランダムアニメーション確認の動きを実行する。
   */
  function executeRandomAction() {
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    // 他のモードを停止
    idleLoopMenu.deactivateIdleLoopMode();
    lookAtPlayerMenu.setMenuActive(false);

    // ランダムモードを開始
    randomMenu.activateRandomMode();
    setActionStatus("ランダムアニメーションを開始しました");
  }

  /**
   * 「こっちをみる」アクションを実行する。
   * プレイヤーの方を見る。体の向きも調整する。
   */
  function executeLookAtPlayerAction() {
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    // ランダムモードと待機モードを停止
    randomMenu.deactivateRandomMode();
    idleLoopMenu.deactivateIdleLoopMode();

    // プレイヤーの方を見るメニューをアクティブ化して、手動で1回実行
    lookAtPlayerMenu.setMenuActive(true);

    // lookAtPlayerMenuのlookAtPlayer機能を呼び出すために、
    // lookAtPlayerボタンをプログラム的にクリックする
    const lookButton = document.getElementById("lookAtPlayerButton");
    if (lookButton) {
      actionState.lookAtPlayerInProgress = true;
      lookButton.click();
    } else {
      setActionStatus("プレイヤーの方を見る機能を実行できませんでした");
    }
  }

  /**
   * 「こっちをみる(首も動かす)」アクションを実行する。
   * プレイヤーの方を見る動作に加えて、プレイヤーのy座標に応じて首を引く角度を調整する。
   * - プレイヤーのy座標が1未満: 首を20度引く
   * - プレイヤーのy座標が1以上: 首の角度を0度にする
   */
  function executeLookAtPlayerWithNeckAction() {
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    if (!stage?.renderer || !stage?.camera) {
      setActionStatus("カメラ情報を取得できませんでした");
      return;
    }

    // ランダムモードと待機モードを停止
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

    // プレイヤーのy座標に応じて首を引く角度を決定
    const neckAngle = playerPosition.y < 1 ? 20 : 0;

    // 首を動かす処理を適用
    const result = lookDownAction.applyManual(neckAngle);

    // プレイヤーの方を見るメニューをアクティブ化して、手動で1回実行
    lookAtPlayerMenu.setMenuActive(true);
    actionState.lookAtPlayerInProgress = true;
    const success = lookAtPlayerMenu.lookAtPlayer({ source: "manual" });

    if (success && result?.success) {
      const formatted = result.angleDeg.toFixed(1);
      setActionStatus(`プレイヤーの方を見ています (首: ${formatted}°)`);
    } else if (success) {
      setActionStatus("プレイヤーの方を見ています");
    } else {
      setActionStatus("プレイヤーの方を見ることができませんでした");
    }
  }

  /**
   * 「首を動かす」アクションを実行する。
   * 指定された角度で首を引く（下を向く）動作を行う。
   */
  function executeMoveNeckAction() {
    if (!vrmManager.getCurrentVrm()) {
      setActionStatus("VRMの読み込みをお待ちください");
      return;
    }

    // 入力された角度を取得
    const neckAngleInput = document.getElementById("neckAngleInput");
    if (!neckAngleInput) {
      setActionStatus("角度入力フィールドが見つかりません");
      return;
    }

    const rawValue = Number.parseFloat(neckAngleInput.value ?? "0");
    const levelDegrees = Number.isFinite(rawValue) ? rawValue : 0;

    // ランダムモードと待機モードを停止
    randomMenu.deactivateRandomMode();
    idleLoopMenu.deactivateIdleLoopMode();
    lookAtPlayerMenu.setMenuActive(false);

    // 首を動かす処理を適用
    const result = lookDownAction.applyManual(levelDegrees);

    if (result?.success) {
      const formatted = result.angleDeg.toFixed(1);
      setActionStatus(`首を ${formatted}° 動かしました`);
    } else {
      setActionStatus("首を動かすことができませんでした");
    }

    // 首を動かした後、待機アクションに移行
    finishActionAndReturnToIdle();
  }

  /**
   * 選択されたアクションを実行する。
   */
  function executeAction() {
    const selectedAction = actionSelect.value;
    if (!selectedAction) {
      setActionStatus("アクションを選択してください");
      return;
    }

    actionState.currentAction = selectedAction;

    switch (selectedAction) {
      case "random":
        executeRandomAction();
        break;
      case "comeHere":
        comeHereAction.execute();
        break;
      case "comeHereFront":
        comeHereFrontAction.execute();
        break;
      case "idle":
        idleAction.execute();
        break;
      case "lookAtPlayer":
        executeLookAtPlayerAction();
        break;
      case "lookAtPlayerWithNeck":
        executeLookAtPlayerWithNeckAction();
        break;
      case "wave":
        waveAction.execute();
        break;
      case "moveNeck":
        executeMoveNeckAction();
        break;
      case "blink":
        blinkAction.execute();
        break;
      default:
        setActionStatus("不明なアクションです");
    }
  }

  /**
   * アクションの状態を毎フレーム更新する。
   * - 各アクションの更新処理
   * - こっちをみるアクションの完了チェック
   * - 首を動かす機能の適用
   * - 自動まばたきの更新
   * @param {number} delta - 前フレームからの経過時間（秒）
   */
  function updateAction(delta) {
    // 各アクションの更新処理
    blinkAction.update(delta);
    waveAction.update(delta);

    // こっちに来るアクションの更新と完了チェック
    if (comeHereAction.update()) {
      // 移動完了後、待機アクションに移行
      finishActionAndReturnToIdle();
    }

    // こっちに来る(正面)アクションの更新と完了チェック
    if (comeHereFrontAction.update(delta)) {
      // 回転完了後、待機アクションに移行
      finishActionAndReturnToIdle();
    }

    // こっちをみるアクションの終了チェック
    if (actionState.lookAtPlayerInProgress && !lookAtPlayerMenu.isTurning()) {
      actionState.lookAtPlayerInProgress = false;
      // こっちをみるアクションが終了したら、待機アクションに移行
      finishActionAndReturnToIdle();
    }

    // 首を動かす骨制御を適用
    lookDownAction.applyPose(delta);

    // 自動まばたきの更新
    // 手動まばたき中は自動まばたきをスキップ
    if (!blinkAction.isInProgress()) {
      autoBlinkManager.update(delta);
    }
  }

  /**
   * VRM読み込み完了時の処理。
   */
  function handleVrmReady() {
    lookDownAction.reset();
    // デフォルトでランダムアニメーションを開始
    executeRandomAction();
  }

  // イベントリスナーの設定
  actionExecuteButton?.addEventListener("click", executeAction);

  return {
    executeAction,
    updateAction,
    handleVrmReady,
    setActionStatus,
    executeComeHereFrontAction: () => comeHereFrontAction.execute(),
    applyManualLookDown: (angleDeg) => lookDownAction.applyManual(angleDeg),
    autoBlinkManager, // 外部から自動まばたきの制御が必要な場合のために公開
  };
}
