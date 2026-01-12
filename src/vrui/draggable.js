import * as THREE from "three";
import { logMessage } from "../utils/logger.js";

/**
 * ドラッグ可能なオブジェクトを管理するクラス。
 * ハンドピンチやコントローラーのselectでオブジェクトをアタッチし、ハンド位置に追従させる。
 */
export class Draggable {
  /**
   * @param {THREE.Object3D} object - ドラッグ対象のオブジェクト
   * @param {object} [options]
   * @param {THREE.Object3D} [options.hitTarget] - レイキャストのヒット判定用オブジェクト（未指定の場合はobjectを使用）
   */
  constructor(object, options = {}) {
    /** @type {THREE.Object3D} ドラッグ対象のオブジェクト */
    this.object = object;

    /** @type {THREE.Object3D} レイキャストのヒット判定用オブジェクト */
    this.hitTarget = options.hitTarget || object;

    /** @type {THREE.Object3D | null} 元の親オブジェクト */
    this.originalParent = object.parent;

    /** @type {THREE.Vector3} 元の位置（親座標系） */
    this.originalPosition = object.position.clone();

    /** @type {THREE.Quaternion} 元の回転（親座標系） */
    this.originalRotation = object.quaternion.clone();

    /** @type {THREE.Object3D | null} アタッチ先のハンドまたはコントローラー */
    this.attachedHand = null;

    /** @type {boolean} 現在ホバー中かどうか */
    this.isHovered = false;

    /** @type {THREE.Matrix4} アタッチ時のオフセット行列 */
    this.offsetMatrix = new THREE.Matrix4();

    /** @type {THREE.Vector3} 一時的な計算用ベクトル */
    this.tempPosition = new THREE.Vector3();

    /** @type {THREE.Quaternion} 一時的な計算用クォータニオン */
    this.tempQuaternion = new THREE.Quaternion();

    /** @type {THREE.Matrix4} 一時的な計算用行列 */
    this.tempMatrix = new THREE.Matrix4();
  }

  /**
   * ヒット判定用のオブジェクトを取得する。
   * @returns {THREE.Object3D}
   */
  getHitTarget() {
    return this.hitTarget;
  }

  /**
   * ホバー状態を設定する。
   * @param {boolean} hovered
   */
  setHovered(hovered) {
    this.isHovered = hovered;
    logMessage("Verbose", `[Draggable] ホバー状態変更: ${hovered}`);
    // スケールでホバーフィードバックを表現
    if (hovered && !this.isAttached()) {
      this.object.scale.multiplyScalar(1.05);
      logMessage("Verbose", "[Draggable] スケールアップ (ホバー)");
    } else if (!hovered && !this.isAttached()) {
      // 元のスケールに戻す（初期値が1と仮定）
      this.object.scale.set(1, 1, 1);
      logMessage("Verbose", "[Draggable] スケールリセット");
    }
  }

  /**
   * 現在アタッチ中かどうかを返す。
   * @returns {boolean}
   */
  isAttached() {
    return this.attachedHand !== null;
  }

  /**
   * ハンドまたはコントローラーにアタッチする。
   * @param {THREE.Object3D} hand - アタッチ先のハンドまたはコントローラー
   */
  attach(hand) {
    if (this.isAttached()) {
      return;
    }

    this.attachedHand = hand;

    // 元の親を記憶
    this.originalParent = this.object.parent;

    // ワールド座標での現在の姿勢を保持
    this.object.updateWorldMatrix(true, false);
    const worldMatrix = this.object.matrixWorld.clone();

    // ハンドの逆行列を計算
    hand.updateWorldMatrix(true, false);
    this.tempMatrix.copy(hand.matrixWorld).invert();

    // オフセット行列 = ハンドの逆行列 × オブジェクトのワールド行列
    this.offsetMatrix.multiplyMatrices(this.tempMatrix, worldMatrix);

    // ハンドにアタッチ（ワールド座標を維持）
    if (hand.children && hand.children.length > 0) {
      // ハンドの子がある場合は最初の子にアタッチ（サンプルコードと同様）
      hand.children[0].attach(this.object);
    } else {
      // 子がない場合は直接ハンドにアタッチ
      hand.attach(this.object);
    }

    logMessage("Verbose", "[Draggable] アタッチしました");
  }

  /**
   * ハンドまたはコントローラーからデタッチする。
   */
  detach() {
    if (!this.isAttached()) {
      return;
    }

    // ワールド座標での現在の姿勢を保持
    this.object.updateWorldMatrix(true, false);
    const worldMatrix = this.object.matrixWorld.clone();

    // 元の親に戻す（ワールド座標を維持）
    if (this.originalParent) {
      this.originalParent.attach(this.object);
    }

    this.attachedHand = null;

    // スケールを元に戻す
    this.object.scale.set(1, 1, 1);

    logMessage("Verbose", "[Draggable] デタッチしました");
  }

  /**
   * 更新処理（毎フレーム呼び出す）。
   * アタッチ中の場合は特に何もしない（親子関係で自動的に追従する）。
   * @param {number} delta - デルタ時間
   */
  update(delta) {
    // アタッチ中は親子関係で自動的に追従するため、特に処理は不要
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    if (this.isAttached()) {
      this.detach();
    }
    this.object = null;
    this.hitTarget = null;
    this.originalParent = null;
    this.attachedHand = null;
  }
}
