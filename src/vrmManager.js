import * as THREE from "three";
import { GLTFLoader } from "https://unpkg.com/three@0.164.1/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  VRMUtils,
} from "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.1.3/+esm";
import { logMessage } from "./utils/logger.js";

const ENABLE_ANIMATION_CHANGE_LOG = false;

export class VRMManager {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.mixer = null;
    this.currentAction = null;
    this.currentClipLabel = "";
    this.defaultFadeDuration = 0.35;
    this.reusableBounds = new THREE.Box3();
    this.lipSyncState = {
      talking: false,
      startTime: 0,
    };

    this.loader = new GLTFLoader();
    this.loader.crossOrigin = "anonymous";
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  clear() {
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      this.vrm = null;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.currentAction = null;
    this.currentClipLabel = "";
  }

  async load(url) {
    const gltf = await this.loader.loadAsync(url);
    this.clear();

    const loadedVrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);

    loadedVrm.scene.rotation.y = 0;
    loadedVrm.scene.position.set(0, 0, 0);
    this.scene.add(loadedVrm.scene);

    this.vrm = loadedVrm;
    this.mixer = new THREE.AnimationMixer(loadedVrm.scene);

    const hasLookAt = !!loadedVrm?.lookAt;
    logMessage(
      "Info",
      `[VRMManager] lookAt サポート: ${hasLookAt ? "あり" : "なし"}`
    );
  }

  /**
   * アニメーションクリップを再生する。
   * @param {THREE.AnimationClip} clip - 再生するクリップ
   * @param {Object} options - オプション
   * @param {number} options.fadeDuration - フェード時間(秒)
   * @param {boolean} options.syncWithCurrent - 現在のアクションと同期するか
   * @param {number} options.loopMode - ループモード
   * @param {number} options.repetitions - 繰り返し回数
   * @param {boolean} options.clampWhenFinished - 終了時に最終フレームで固定するか
   * @param {string} options.debugLabel - デバッグ用のラベル
   * @param {string[]} options.excludeBones - 除外するボーン名のリスト(例: ['neck'])
   * @returns {THREE.AnimationAction | null} - 作成されたアクション
   */
  playClip(clip, options = {}) {
    if (!this.vrm || !clip) {
      return null;
    }

    if (!this.mixer) {
      this.mixer = new THREE.AnimationMixer(this.vrm.scene);
    }

    // 呼び出し側からフェードやループモードを細かく指定できるようにする
    const {
      fadeDuration = this.defaultFadeDuration,
      syncWithCurrent = false,
      loopMode,
      repetitions,
      clampWhenFinished = false,
      debugLabel,
      excludeBones = [],
    } = options;
    const transitionDuration = Math.max(0, fadeDuration);
    const clipName =
      debugLabel ||
      clip?.userData?.sourceFile ||
      clip?.name ||
      "Unnamed VRMA Clip";

    // 除外するボーンが指定されている場合、そのトラックを除外した新しいクリップを作成する
    let processedClip = clip;
    if (excludeBones.length > 0) {
      /*
      // デバッグ用: クリップ内の全トラック名を出力
      logMessage("Verbose", `[VRMManager] ${clipName} のトラック一覧`, {
        tracks: clip.tracks.map(t => t.name).sort()
      });
      */

      const filteredTracks = clip.tracks.filter((track) => {
        // トラック名から対象のボーンかどうかを判定
        // 例: "neck.quaternion" や "neck.position" などのトラック名から "neck" を抽出
        const boneName = track.name.split('.')[0];
        const isExcluded = excludeBones.includes(boneName);

        /*
        if (isExcluded) {
          logMessage("Verbose", "[VRMManager] トラック除外", { trackName: track.name });
        }
        */

        return !isExcluded;
      });

      /*
      logMessage("Verbose", "[VRMManager] 除外後のトラック数", {
        before: clip.tracks.length,
        after: filteredTracks.length
      });
      */

      // フィルタリングされたトラックで新しいクリップを作成
      processedClip = new THREE.AnimationClip(
        clip.name + '_filtered',
        clip.duration,
        filteredTracks
      );

      // 元のクリップのuserDataを引き継ぐ
      processedClip.userData = { ...clip.userData };
    }

    const nextAction = this.mixer.clipAction(processedClip);
    if (!nextAction) {
      return null;
    }
    if (this.currentAction === nextAction) {
      return nextAction;
    }

    if (typeof loopMode === "number") {
      nextAction.setLoop(loopMode, repetitions ?? Infinity);
    }
    nextAction.clampWhenFinished = clampWhenFinished;

    if (syncWithCurrent && this.currentAction) {
      // 直前のアクションと再生時間を合わせると足踏みの不連続を抑えやすい
      nextAction.syncWith(this.currentAction);
    }

    nextAction.enabled = true;
    nextAction.reset().play();

    const timestamp = new Date().toISOString();
    const previousClip = this.currentClipLabel || "(none)";

    // 歩きモーションが別のアニメーションで上書きされる場合は警告
    const isWalkAnimation = previousClip.includes("motion003");
    const isOverwritingWalk = isWalkAnimation && !clipName.includes("motion003");
    if (isOverwritingWalk) {
      logMessage("Warn", "⚠️ 歩きモーションが上書きされました", {
        from: previousClip,
        to: clipName,
        fadeSecondsRequested: fadeDuration,
      });
    }

    // Idleアニメーションが連続する場合はログを抑制
    const isIdleAnimation = clipName.includes("Idle") || clipName.includes("idle");
    const isPreviousIdle = previousClip.includes("Idle") || previousClip.includes("idle");
    const shouldSuppressLog = isIdleAnimation && isPreviousIdle && previousClip !== "(none)";

    if (!shouldSuppressLog && ENABLE_ANIMATION_CHANGE_LOG) {
      logMessage("Verbose", "Animation change", {
        from: previousClip,
        to: clipName,
        fadeSecondsRequested: fadeDuration,
        fadeSecondsApplied: transitionDuration,
        syncWithCurrent,
        loopMode:
          typeof loopMode === "number" ? loopMode : "THREE.LoopRepeat (default)",
      });
    }

    if (
      this.currentAction &&
      transitionDuration > 0
    ) {
      // crossFadeFrom を使って「旧アクションを徐々に消す / 新アクションを徐々に出す」
      nextAction.crossFadeFrom(this.currentAction, transitionDuration, false);
    } else if (this.currentAction) {
      this.currentAction.stop();
    }

    this.currentAction = nextAction;
    this.currentClipLabel = clipName;
    return nextAction;
  }

  update(delta) {
    if (this.mixer) {
      this.mixer.update(delta);
    }
    if (this.vrm) {
      // アニメーション後に VRM を更新して、lookAt やスプリング骨が最終ポーズへ反映されるようにする
      this.vrm.update(delta);
    }
  }

  getCurrentVrm() {
    return this.vrm;
  }

  /**
   * 現在の VRM シーン全体の境界ボックスを返す。
   * @param {THREE.Box3} [target]
   * @returns {THREE.Box3 | null}
   */
  getWorldBoundingBox(target = this.reusableBounds) {
    if (!this.vrm) {
      return null;
    }
    this.scene?.updateWorldMatrix(true, false);
    const box = target || new THREE.Box3();
    box.setFromObject(this.vrm.scene);
    return box;
  }

  stopAnimation() {
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.currentAction = null;
    this.currentClipLabel = "";
  }

  /**
   * 口パクを開始する。
   * AI音声再生開始時に呼び出す。
   */
  startLipSync() {
    this.lipSyncState.talking = true;
    this.lipSyncState.startTime = performance.now() / 1000;
    logMessage("Info", "[VRMManager] 口パク開始");
  }

  /**
   * 口パクを停止する。
   * AI音声再生終了時に呼び出す。
   */
  stopLipSync() {
    this.lipSyncState.talking = false;
    // 口を閉じる
    if (this.vrm?.expressionManager) {
      this.vrm.expressionManager.setValue("aa", 0);
    }
    logMessage("Info", "[VRMManager] 口パク停止");
  }

  /**
   * 口パクを更新する。
   * 毎フレーム呼び出す。
   * @param {number} delta - 前回のフレームからの経過時間(秒)
   */
  updateLipSync(delta) {
    if (!this.lipSyncState.talking || !this.vrm?.expressionManager) {
      return;
    }

    const t = (performance.now() / 1000) - this.lipSyncState.startTime;
    // 0..1 を行ったり来たりする口パクアニメーション
    // 周波数10で口をパクパクさせる
    const v = 0.2 + 0.8 * Math.abs(Math.sin(t * 10.0));
    this.vrm.expressionManager.setValue("aa", v);
  }
}
