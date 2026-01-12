import * as THREE from "three";
import { VrTextWindow } from "./textWindow.js";
import { VrButton } from "./vrButton.js";
import { VrListBox } from "./vrListBox.js";
import { AI_NAME, ACTION_MENU_ITEMS } from "../config.js";
import {
  MIC_PERMISSION_ERROR_CODE,
  MIC_PERMISSION_ERROR_MESSAGE,
} from "../constants/micPermission.js";
import { logMessage } from "../utils/logger.js";

const tempMatrix = new THREE.Matrix4();

/**
 * VR空間に配置するシンプルな「テストボタン」とテキストウインドウをまとめたオーバーレイ。
 * コントローラーやハンドピンチの select/pinch イベントを横取りし、ホバー中のみボタン押下として扱う。
 * チャットモード時はマイクボタンとして動作する。
 */
export class VrButtonOverlay {
  /**
   * @param {{ world: THREE.Object3D, renderer: THREE.WebGLRenderer, origin?: THREE.Vector3, interactionManager?: any, chatMenu?: any, actionMenu?: any }} options
   */
  constructor(options = {}) {
    const { world, renderer, origin, interactionManager, chatMenu, actionMenu } = options;
    this.world = world;
    this.renderer = renderer;
    this.interactionManager = interactionManager || null;
    this.chatMenu = chatMenu || null;
    this.actionMenu = actionMenu || null;
    this.origin = origin ?? new THREE.Vector3(0.6, 0.75, -0.8);

    // NOTE: このアプリはチャットモード専用です。モード切り替え機能は削除されました。
    this.transcriptHistory = []; // チャット履歴

    this.root = new THREE.Group();
    this.root.position.copy(this.origin);
    this.root.rotation.y = -Math.PI / 5;
    this.world.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.controllers = [];
    this.hoverState = { hovering: false, controllerIndex: null };
    this.actionListHoverState = { upHovering: false, downHovering: false, controllerIndex: null };
    this.actionButtonHoverState = { hovering: false, controllerIndex: null };
    this.cubeSpawnCheckboxHoverState = { hovering: false, controllerIndex: null };
    this.textWindow = null;
    this.button = null;
    this.actionListBox = null;
    this.actionButton = null;
    this.cubeSpawnCheckbox = null;
    this.cubeSpawnEnabled = false; // デフォルトはオフ
    this.dragButton = null; // メニュー移動用ボタン
    this.isDragging = false; // ドラッグ中かどうか
    this.dragController = null; // ドラッグ中のコントローラー
    this.dragHand = null; // ドラッグ中のハンド
    this.originalParent = null; // ドラッグ前の親オブジェクト
    this.dragButtonHoverState = { hovering: false, controllerIndex: null };
    this.removeSelectGuard = null;
    this.removePinchGuard = null;
    this.removePinchEndGuard = null;

    this.setupPanel();
    this.cacheControllers();
    this.setupSelectGuard();
    this.setupPinchGuard();
    this.setupPinchEndGuard();

    // チャットモード専用のため、初期化時にマイクボタンを設定
    this.button.setLabel("🎤 マイク");
    this.updateChatStatus();
  }

  /**
   * 背景パネルとテキストウインドウ、マイクボタン、アクションリストボックス、アクション実行ボタンを生成してルートに追加する。
   */
  setupPanel() {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.7, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x05070f,
        roughness: 0.85,
        metalness: 0.08,
        opacity: 0.85,
        transparent: true,
        side: THREE.DoubleSide,
      })
    );
    panel.position.z = -0.015;
    panel.receiveShadow = true;
    this.root.add(panel);
    this.panelMesh = panel; // ドラッグのヒットターゲットとして保存

    this.textWindow = new VrTextWindow({ width: 1.15, height: 0.34, paddingRatio: 0.05 });
    const textMesh = this.textWindow.getObject3D();
    textMesh.position.set(0, 0.13, 0.01);
    this.root.add(textMesh);
    this.textWindow.updateText("", { force: true });

    // マイクボタン（左下）
    this.button = new VrButton({ label: "テスト", width: 0.25 });
    const buttonMesh = this.button.getObject3D();
    buttonMesh.position.set(-0.43, -0.2, 0.02);
    this.root.add(buttonMesh);

    // アクションリストボックス（中央下）
    // config.jsのACTION_MENU_ITEMSからVR表示するアクションのみを抽出
    const vrActionOptions = [
      { value: "", label: "選択してください" },
      ...ACTION_MENU_ITEMS.filter((item) => item.vr).map((item) => ({
        value: item.id,
        label: item.label,
      })),
    ];
    this.actionListBox = new VrListBox({
      width: 0.35,
      height: 0.08,
      options: vrActionOptions,
    });
    const listBoxMesh = this.actionListBox.getObject3D();
    listBoxMesh.position.set(0, -0.2, 0.02);
    this.root.add(listBoxMesh);

    // アクション実行ボタン（右下）
    this.actionButton = new VrButton({ label: "実行", width: 0.25 });
    const actionButtonMesh = this.actionButton.getObject3D();
    actionButtonMesh.position.set(0.43, -0.2, 0.02);
    this.root.add(actionButtonMesh);

    // キューブ発射チェックボックス（実行ボタンの下）
    this.cubeSpawnCheckbox = new VrButton({
      label: "☐ キューブ発射",
      width: 0.25,
      height: 0.08,
      idleColor: 0x424242,
      hoverColor: 0x616161,
      pressedColor: 0x212121
    });
    const checkboxMesh = this.cubeSpawnCheckbox.getObject3D();
    checkboxMesh.position.set(0.43, -0.28, 0.02);
    this.root.add(checkboxMesh);

    // ドラッグで移動ボタン（マイクボタンの下）
    this.dragButton = new VrButton({
      label: "ドラッグで移動",
      width: 0.25,
      height: 0.08,
      idleColor: 0x2a4d2a,
      hoverColor: 0x3d6b3d,
      pressedColor: 0x1a3d1a
    });
    const dragButtonMesh = this.dragButton.getObject3D();
    dragButtonMesh.position.set(-0.43, -0.28, 0.02);
    this.root.add(dragButtonMesh);
  }



  /**
   * チャットステータスを更新する。
   */
  updateChatStatus() {
    if (!this.chatMenu) {
      this.textWindow.updateText("エラー: chatMenuが設定されていません", { force: true });
      return;
    }

    const apiKey = this.chatMenu.getApiKey();
    if (!apiKey) {
      this.textWindow.updateText("設定画面でAPIキーを入力してください", { force: true });
      return;
    }

    const isRecording = this.chatMenu.isRecording();
    if (isRecording) {
      this.button.setLabel("⏹️ 停止");
      this.textWindow.updateText("録音中...\nもう一度押すと停止します", { force: true });
    } else {
      this.button.setLabel("🎤 マイク");
      if (this.transcriptHistory.length === 0) {
        this.textWindow.updateText("マイクボタンを押して\n音声入力を開始", { force: true });
      } else {
        // 最新の認識結果を表示
        const latestTranscripts = this.transcriptHistory.slice(-3).join("\n");
        this.textWindow.updateText(latestTranscripts, { force: true });
      }
    }
  }

  /**
   * 現在の XR セッションから 2 本のコントローラー参照をキャッシュする。
   */
  cacheControllers() {
    this.controllers.length = 0;
    for (let i = 0; i < 2; i += 1) {
      const controller = this.renderer.xr.getController(i);
      if (controller) {
        this.controllers.push(controller);
      }
    }
  }

  /**
   * HandInteractionManager の select ガードを登録する。
   */
  setupSelectGuard() {
    if (!this.interactionManager?.addSelectGuard) {
      return;
    }
    this.removeSelectGuard = this.interactionManager.addSelectGuard((controller) =>
      this.handleControllerSelect(controller)
    );
  }

  /**
   * HandInteractionManager の pinch ガードを登録する。
   */
  setupPinchGuard() {
    if (!this.interactionManager?.addPinchGuard) {
      return;
    }
    this.removePinchGuard = this.interactionManager.addPinchGuard((hand) => this.handleHandPinch(hand));
  }

  /**
   * HandInteractionManager の pinchEnd ガードを登録する。
   */
  setupPinchEndGuard() {
    if (!this.interactionManager?.addPinchEndGuard) {
      return;
    }
    this.removePinchEndGuard = this.interactionManager.addPinchEndGuard((hand) => this.handleHandPinchEnd(hand));
  }

  /**
   * VRボタンが押されたことをログ出力する。
   * @param {string} label - ボタン名
   */
  logButtonPress(label) {
    logMessage("Verbose", `[VrButtonOverlay] ${label} が押されました`);
  }

  /**
   * コントローラー selectstart を横取りし、マイクボタン、アクションリストボックス、アクション実行ボタンを押したら true->キャンセルさせる。
   * @param {THREE.Object3D} controller
   * @returns {boolean}
   */
  handleControllerSelect(controller) {
    controller?.updateMatrixWorld?.(true);
    this.updateRayFromController(controller);
    const controllerIndex = this.controllers.indexOf(controller);

    // マイクボタンのチェック
    if (this.button && this.button.getHitObject()) {
      const isMainHover = this.hoverState.hovering && (this.hoverState.controllerIndex === null || controllerIndex === this.hoverState.controllerIndex);
      if (isMainHover) {
        this.button.getHitObject().updateWorldMatrix(true, false);
        const intersections = this.raycaster.intersectObject(this.button.getHitObject(), false);
        if (intersections.length > 0) {
          this.logButtonPress(this.button?.getLabel?.() ?? "メインボタン");
          this.button.playPressedFeedback();
          this.handleButtonPress();
          return false;
        }
      }
    }

    // アクションリストボックスの上下ボタンのチェック
    if (this.actionListBox) {
      const upButton = this.actionListBox.getUpButtonHitObject();
      const downButton = this.actionListBox.getDownButtonHitObject();

      if (upButton) {
        upButton.updateWorldMatrix(true, false);
        const upIntersections = this.raycaster.intersectObject(upButton, false);
        if (upIntersections.length > 0) {
          this.logButtonPress("アクションリスト：上ボタン");
          this.actionListBox.playButtonPressedFeedback("up");
          this.actionListBox.handleUpButton();
          return false;
        }
      }

      if (downButton) {
        downButton.updateWorldMatrix(true, false);
        const downIntersections = this.raycaster.intersectObject(downButton, false);
        if (downIntersections.length > 0) {
          this.logButtonPress("アクションリスト：下ボタン");
          this.actionListBox.playButtonPressedFeedback("down");
          this.actionListBox.handleDownButton();
          return false;
        }
      }
    }

    // アクション実行ボタンのチェック
    if (this.actionButton && this.actionButton.getHitObject()) {
      const isActionButtonHover = this.actionButtonHoverState.hovering && (this.actionButtonHoverState.controllerIndex === null || controllerIndex === this.actionButtonHoverState.controllerIndex);
      if (isActionButtonHover) {
        this.actionButton.getHitObject().updateWorldMatrix(true, false);
        const intersections = this.raycaster.intersectObject(this.actionButton.getHitObject(), false);
        if (intersections.length > 0) {
          this.logButtonPress(this.actionButton?.getLabel?.() ?? "アクションボタン");
          this.actionButton.playPressedFeedback();
          this.handleActionButtonPress();
          return false;
        }
      }
    }

    // キューブ発射チェックボックスのチェック
    if (this.cubeSpawnCheckbox && this.cubeSpawnCheckbox.getHitObject()) {
      const isCheckboxHover = this.cubeSpawnCheckboxHoverState.hovering && (this.cubeSpawnCheckboxHoverState.controllerIndex === null || controllerIndex === this.cubeSpawnCheckboxHoverState.controllerIndex);
      if (isCheckboxHover) {
        this.cubeSpawnCheckbox.getHitObject().updateWorldMatrix(true, false);
        const intersections = this.raycaster.intersectObject(this.cubeSpawnCheckbox.getHitObject(), false);
        if (intersections.length > 0) {
          this.logButtonPress(this.cubeSpawnCheckbox?.getLabel?.() ?? "キューブチェックボックス");
          this.cubeSpawnCheckbox.playPressedFeedback();
          this.handleCubeSpawnCheckboxPress();
          return false;
        }
      }
    }

    // ドラッグボタンのチェック
    if (this.dragButton && this.dragButton.getHitObject()) {
      const isDragButtonHover = this.dragButtonHoverState.hovering && (this.dragButtonHoverState.controllerIndex === null || controllerIndex === this.dragButtonHoverState.controllerIndex);
      if (isDragButtonHover) {
        this.dragButton.getHitObject().updateWorldMatrix(true, false);
        const intersections = this.raycaster.intersectObject(this.dragButton.getHitObject(), false);
        if (intersections.length > 0) {
          this.logButtonPress(this.dragButton?.getLabel?.() ?? "ドラッグボタン");
          this.dragButton.playPressedFeedback();
          this.handleDragButtonPress(controller);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * ハンドのピンチ入力を横取りし、ホバー中ならボタン押下扱いにする。
   * @param {THREE.Object3D} hand
   * @returns {boolean}
   */
  handleHandPinch(hand) {
    // マイクボタンのチェック
    const isMainHover = this.hoverState.hovering && this.button;
    if (isMainHover) {
      this.logButtonPress(this.button?.getLabel?.() ?? "メインボタン");
      this.button.playPressedFeedback();
      this.handleButtonPress();
      return false;
    }

    // アクションリストボックスのチェック
    if (this.actionListHoverState.upHovering && this.actionListBox) {
      this.logButtonPress("アクションリスト：上ボタン");
      this.actionListBox.playButtonPressedFeedback("up");
      this.actionListBox.handleUpButton();
      return false;
    }

    if (this.actionListHoverState.downHovering && this.actionListBox) {
      this.logButtonPress("アクションリスト：下ボタン");
      this.actionListBox.playButtonPressedFeedback("down");
      this.actionListBox.handleDownButton();
      return false;
    }

    // アクション実行ボタンのチェック
    const isActionButtonHover = this.actionButtonHoverState.hovering && this.actionButton;
    if (isActionButtonHover) {
      this.logButtonPress(this.actionButton?.getLabel?.() ?? "アクションボタン");
      this.actionButton.playPressedFeedback();
      this.handleActionButtonPress();
      return false;
    }

    // キューブ発射チェックボックスのチェック
    const isCheckboxHover = this.cubeSpawnCheckboxHoverState.hovering && this.cubeSpawnCheckbox;
    if (isCheckboxHover) {
      this.logButtonPress(this.cubeSpawnCheckbox?.getLabel?.() ?? "キューブチェックボックス");
      this.cubeSpawnCheckbox.playPressedFeedback();
      this.handleCubeSpawnCheckboxPress();
      return false;
    }

    // ドラッグボタンのチェック
    const isDragButtonHover = this.dragButtonHoverState.hovering && this.dragButton;
    if (isDragButtonHover) {
      this.logButtonPress(this.dragButton?.getLabel?.() ?? "ドラッグボタン");
      this.dragButton.playPressedFeedback();
      this.handleDragStart(hand);
      return false;
    }

    return true;
  }

  /**
   * ハンドのピンチ終了入力を処理する。
   * @param {THREE.Object3D} hand
   * @returns {boolean}
   */
  handleHandPinchEnd(hand) {
    if (this.isDragging && this.dragHand === hand) {
      this.handleDragEnd();
      return false;
    }
    return true;
  }

  /**
   * ボタンが押された時の処理（チャット専用）。
   */
  handleButtonPress() {
    if (!this.chatMenu) {
      this.textWindow.updateText("エラー: chatMenuが設定されていません", { force: true });
      return;
    }

    const apiKey = this.chatMenu.getApiKey();
    if (!apiKey) {
      this.textWindow.updateText("エラー: APIキーが設定されていません", { force: true });
      return;
    }

    const isRecording = this.chatMenu.isRecording();
    if (isRecording) {
      // 録音を停止
      this.chatMenu.stopVrRecording();
      this.textWindow.updateText("音声を処理中...", { force: true });
    } else {
      // 録音を開始
      this.textWindow.updateText("録音中...\nもう一度押すと停止します", { force: true });
      this.button.setLabel("⏹️ 停止");

      this.chatMenu.startVrRecording(
        (result) => {
          // 認識成功時のコールバック
          // resultは { user: string, ai: string } の形式
          if (result && result.user && result.ai) {
            this.transcriptHistory.push(`音声入力：${result.user}`);
            this.transcriptHistory.push(`${AI_NAME}：${result.ai}`);
            // AI応答を適切に改行してテキストウィンドウに表示
            const wrappedUserText = wrapText(result.user);
            const wrappedAiText = wrapText(result.ai);
            this.textWindow.updateText(`音声入力：${wrappedUserText}\n\n${AI_NAME}：${wrappedAiText}`, { force: true });
          }
          this.button.setLabel("🎤 マイク");
        },
        (error) => {
          // エラー時のコールバック
          if (
            error?.code === MIC_PERMISSION_ERROR_CODE ||
            error?.message === MIC_PERMISSION_ERROR_MESSAGE
          ) {
            this.textWindow.updateText(MIC_PERMISSION_ERROR_MESSAGE, { force: true });
          } else {
            this.textWindow.updateText(`エラー: ${error?.message ?? "不明なエラー"}`, { force: true });
          }
          this.button.setLabel("🎤 マイク");
        }
      );
    }
  }

  /**
   * アクション実行ボタン押下時の処理。
   */
  handleActionButtonPress() {
    if (!this.actionListBox || !this.actionMenu) {
      this.textWindow.updateText("エラー: アクション機能が設定されていません", { force: true });
      return;
    }

    const selectedValue = this.actionListBox.getValue();
    if (!selectedValue) {
      this.textWindow.updateText("アクションを選択してください", { force: true });
      return;
    }

    // actionMenuのexecuteActionを呼び出す
    // actionSelectの値を一時的に設定してexecuteActionを呼び出す
    const actionSelect = document.getElementById("actionSelect");
    if (actionSelect) {
      const previousValue = actionSelect.value;
      actionSelect.value = selectedValue;
      this.actionMenu.executeAction();
      actionSelect.value = previousValue;
    }
  }

  /**
   * キューブ発射チェックボックス押下時の処理。
   */
  handleCubeSpawnCheckboxPress() {
    // 状態を切り替え
    this.cubeSpawnEnabled = !this.cubeSpawnEnabled;

    // ラベルを更新
    const label = this.cubeSpawnEnabled ? "☑ キューブ" : "☐ キューブ";
    this.cubeSpawnCheckbox.setLabel(label);

    // HandInteractionManagerに通知
    if (this.interactionManager && typeof this.interactionManager.setCubeSpawnEnabled === "function") {
      this.interactionManager.setCubeSpawnEnabled(this.cubeSpawnEnabled);
    }

    logMessage("Info", `[VrButtonOverlay] キューブ発射: ${this.cubeSpawnEnabled ? "有効" : "無効"}`);
  }

  /**
   * ドラッグ開始処理。
   * メニュー全体をコントローラーまたはハンドに追従させる。
   * @param {THREE.Object3D} source - コントローラーまたはハンド
   */
  handleDragStart(source) {
    if (this.isDragging) {
      return;
    }

    // 元の親を保存
    this.originalParent = this.root.parent;

    // コントローラーかハンドかを判定
    // ハンドの場合は joints プロパティが存在する
    let dragTarget;
    if (source?.joints) {
      this.dragHand = source;
      this.dragController = null;

      // ハンドの場合は手首ジョイントを使用
      const wristJoint = source.joints["wrist"];
      if (!wristJoint) {
        logMessage("Error", "[VrButtonOverlay] エラー: 手首ジョイントが見つかりません");
        this.originalParent = null;
        return;
      }
      dragTarget = wristJoint;
    } else {
      this.dragController = source;
      this.dragHand = null;
      dragTarget = source;

      // コントローラーの場合のみ selectend イベントリスナーを追加
      const onSelectEnd = () => {
        this.handleDragEnd();
        source.removeEventListener("selectend", onSelectEnd);
      };
      source.addEventListener("selectend", onSelectEnd);
    }

    // Three.jsのattach()を使用してメニューをドラッグターゲットの子にする
    // これにより、ワールド座標を維持したまま親子関係が変わる
    dragTarget.attach(this.root);

    this.isDragging = true;
  }

  /**
   * ドラッグボタン押下時の処理（コントローラー用）。
   * @param {THREE.Object3D} controller - コントローラー
   */
  handleDragButtonPress(controller) {
    this.handleDragStart(controller);
  }

  /**
   * ドラッグ終了時の処理。
   */
  handleDragEnd() {
    if (!this.isDragging) {
      return;
    }

    // 元の親にattach()で戻す（ワールド座標を維持）
    if (this.originalParent) {
      this.originalParent.attach(this.root);
    }

    this.isDragging = false;
    this.dragController = null;
    this.dragHand = null;
    this.originalParent = null;
  }

  /**
   * ホバー状態を更新し、ボタンのビジュアルを切り替える。毎フレーム呼び出される。
   */
  update() {
    // ドラッグ中は親子関係で自動的に追従するため、特に処理は不要

    if (!this.button) {
      return;
    }
    const mainHitMesh = this.button?.getHitObject();

    if (!mainHitMesh) {
      return;
    }
    mainHitMesh?.updateWorldMatrix(true, false);

    const mainHover = { hovering: false, controllerIndex: null };
    const actionListUpHover = { hovering: false, controllerIndex: null };
    const actionListDownHover = { hovering: false, controllerIndex: null };
    const actionButtonHover = { hovering: false, controllerIndex: null };
    const cubeSpawnCheckboxHover = { hovering: false, controllerIndex: null };
    const dragButtonHover = { hovering: false, controllerIndex: null };

    for (let i = 0; i < this.controllers.length; i += 1) {
      const controller = this.controllers[i];
      if (!controller) {
        continue;
      }
      controller.updateMatrixWorld(true);
      this.updateRayFromController(controller);

      // マイクボタンのホバーチェック
      if (!mainHover.hovering && mainHitMesh) {
        const intersections = this.raycaster.intersectObject(mainHitMesh, false);
        if (intersections.length > 0) {
          mainHover.hovering = true;
          mainHover.controllerIndex = i;
        }
      }

      // アクションリストボックスの上ボタンのホバーチェック
      if (!actionListUpHover.hovering && this.actionListBox) {
        const upButton = this.actionListBox.getUpButtonHitObject();
        if (upButton) {
          upButton.updateWorldMatrix(true, false);
          const intersections = this.raycaster.intersectObject(upButton, false);
          if (intersections.length > 0) {
            actionListUpHover.hovering = true;
            actionListUpHover.controllerIndex = i;
          }
        }
      }

      // アクションリストボックスの下ボタンのホバーチェック
      if (!actionListDownHover.hovering && this.actionListBox) {
        const downButton = this.actionListBox.getDownButtonHitObject();
        if (downButton) {
          downButton.updateWorldMatrix(true, false);
          const intersections = this.raycaster.intersectObject(downButton, false);
          if (intersections.length > 0) {
            actionListDownHover.hovering = true;
            actionListDownHover.controllerIndex = i;
          }
        }
      }

      // アクション実行ボタンのホバーチェック
      if (!actionButtonHover.hovering && this.actionButton) {
        const actionHitMesh = this.actionButton.getHitObject();
        if (actionHitMesh) {
          actionHitMesh.updateWorldMatrix(true, false);
          const intersections = this.raycaster.intersectObject(actionHitMesh, false);
          if (intersections.length > 0) {
            actionButtonHover.hovering = true;
            actionButtonHover.controllerIndex = i;
          }
        }
      }

      // キューブ発射チェックボックスのホバーチェック
      if (!cubeSpawnCheckboxHover.hovering && this.cubeSpawnCheckbox) {
        const checkboxHitMesh = this.cubeSpawnCheckbox.getHitObject();
        if (checkboxHitMesh) {
          checkboxHitMesh.updateWorldMatrix(true, false);
          const intersections = this.raycaster.intersectObject(checkboxHitMesh, false);
          if (intersections.length > 0) {
            cubeSpawnCheckboxHover.hovering = true;
            cubeSpawnCheckboxHover.controllerIndex = i;
          }
        }
      }

      // ドラッグボタンのホバーチェック
      if (!dragButtonHover.hovering && this.dragButton) {
        const dragButtonHitMesh = this.dragButton.getHitObject();
        if (dragButtonHitMesh) {
          dragButtonHitMesh.updateWorldMatrix(true, false);
          const intersections = this.raycaster.intersectObject(dragButtonHitMesh, false);
          if (intersections.length > 0) {
            dragButtonHover.hovering = true;
            dragButtonHover.controllerIndex = i;
          }
        }
      }
    }

    // マイクボタンの状態を更新
    this.hoverState.hovering = mainHover.hovering;
    this.hoverState.controllerIndex = mainHover.controllerIndex;
    this.button?.setState(mainHover.hovering ? "hover" : "idle");

    // アクションリストボックスの状態を更新
    this.actionListHoverState.upHovering = actionListUpHover.hovering;
    this.actionListHoverState.downHovering = actionListDownHover.hovering;
    this.actionListHoverState.controllerIndex = actionListUpHover.hovering
      ? actionListUpHover.controllerIndex
      : actionListDownHover.controllerIndex;
    if (this.actionListBox) {
      this.actionListBox.setButtonState("up", actionListUpHover.hovering ? "hover" : "idle");
      this.actionListBox.setButtonState("down", actionListDownHover.hovering ? "hover" : "idle");
    }

    // アクション実行ボタンの状態を更新
    this.actionButtonHoverState.hovering = actionButtonHover.hovering;
    this.actionButtonHoverState.controllerIndex = actionButtonHover.controllerIndex;
    this.actionButton?.setState(actionButtonHover.hovering ? "hover" : "idle");

    // キューブ発射チェックボックスの状態を更新
    this.cubeSpawnCheckboxHoverState.hovering = cubeSpawnCheckboxHover.hovering;
    this.cubeSpawnCheckboxHoverState.controllerIndex = cubeSpawnCheckboxHover.controllerIndex;
    this.cubeSpawnCheckbox?.setState(cubeSpawnCheckboxHover.hovering ? "hover" : "idle");

    // ドラッグボタンの状態を更新
    this.dragButtonHoverState.hovering = dragButtonHover.hovering;
    this.dragButtonHoverState.controllerIndex = dragButtonHover.controllerIndex;
    this.dragButton?.setState(dragButtonHover.hovering ? "hover" : "idle");
  }

  /**
   * コントローラーの姿勢から Raycaster を更新する。
   * @param {THREE.Object3D} controller
   */
  updateRayFromController(controller) {
    const ray = this.raycaster.ray;
    ray.origin.setFromMatrixPosition(controller.matrixWorld);
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix).normalize();
  }

  /**
   * リスナーやガードを解除する。
   */
  dispose() {
    if (typeof this.removeSelectGuard === "function") {
      this.removeSelectGuard();
      this.removeSelectGuard = null;
    }
    if (typeof this.removePinchGuard === "function") {
      this.removePinchGuard();
      this.removePinchGuard = null;
    }
    if (typeof this.removePinchEndGuard === "function") {
      this.removePinchEndGuard();
      this.removePinchEndGuard = null;
    }
    // ドラッグ状態をクリア
    if (this.isDragging) {
      this.handleDragEnd();
    }
    this.controllers.length = 0;
  }
}

/**
 * Date から HH:MM:SS を生成するヘルパー。
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * テキストを適切な長さで改行する。
 * VR空間での表示に適した長さ（約30文字）で改行を挿入する。
 * @param {string} text - 改行処理するテキスト
 * @param {number} maxLength - 1行あたりの最大文字数（デフォルト: 30）
 * @returns {string} 改行処理されたテキスト
 */
function wrapText(text, maxLength = 30) {
  if (!text) {
    return "";
  }

  const lines = [];
  let currentLine = "";

  // 既存の改行で分割
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    // 空行はそのまま保持
    if (paragraph.trim() === "") {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      lines.push("");
      continue;
    }

    // 句読点で分割して処理
    const chars = Array.from(paragraph);
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      currentLine += char;

      // 行の長さが最大値に達したか、句読点の後の場合
      const isBreakPoint = char === "。" || char === "！" || char === "？" || char === "." || char === "!" || char === "?";
      const isMaxLength = currentLine.length >= maxLength;

      if (isBreakPoint && currentLine.length >= maxLength * 0.6) {
        // 句読点で改行（最小長さの60%以上の場合）
        lines.push(currentLine);
        currentLine = "";
      } else if (isMaxLength) {
        // 最大長さに達したら強制改行
        lines.push(currentLine);
        currentLine = "";
      }
    }

    // 残りの文字列を追加
    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }
  }

  return lines.join("\n");
}
