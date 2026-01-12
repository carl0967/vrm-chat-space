// Random メニュー担当モジュール
import * as THREE from "three";

import {
  getRandomIdleFiles,
  calculateIdleSwitchDelay,
} from "../idleAnimations.js";
import { logMessage } from "../utils/logger.js";
import { getAnimationFileByLabel } from "../vrma/loader.js";

let RANDOM_WAVE_FILE = null;
let RANDOM_IDLE_FILES = null;
const RANDOM_RANGE = { min: -3, max: 3 };
const RANDOM_WAIT_SECONDS = 6;
const RANDOM_WAVE_DELAY_RANGE = { min: 1.5, max: 4 };

/**
 * ランダム行動機能を提供するモジュール。
 * NOTE: DOM要素への依存はなく、純粋なロジックのみを提供する。
 */
export function createRandomMenu({
  vrmManager,
  walkMenu,
  getAnimationClip,
  AnimationBlend,
  vrmaBasePath,
}) {
  const randomState = {
    active: false,
    phase: "idle",
    waitRemaining: 0,
    waveTimer: 0,
    playingWave: false,
    wavePlayedThisCycle: false,
    idleResumeTimer: 0,
    idleSwitchTimer: 0,
    idleRequestInFlight: false,
    pendingMove: false,
    waveRequestInFlight: false,
    previousAnimationDisabled: false,
    currentTarget: null,
    idleSequenceIndex: 0,
  };

  function randomCoordinate() {
    const range = RANDOM_RANGE.max - RANDOM_RANGE.min;
    return RANDOM_RANGE.min + Math.random() * range;
  }

  function updateRandomWaitingStatus() {
    // ステータス更新用のコールバックがある場合のみ使用
    // 現在はDOM依存を削除したため、内部状態の更新のみ行う
    if (!randomState.active || randomState.phase !== "waiting") {
      return;
    }
  }

  // Idle 再生に使うファイル名を順番に取り出す（フェードの対象を切り替える）
  function nextIdleFile() {
    if (!RANDOM_IDLE_FILES || !RANDOM_IDLE_FILES.length) {
      return "";
    }
    const file = RANDOM_IDLE_FILES[randomState.idleSequenceIndex];
    randomState.idleSequenceIndex =
      (randomState.idleSequenceIndex + 1) % RANDOM_IDLE_FILES.length;
    return file;
  }

  async function startIdleLoopForRandom() {
    if (randomState.idleRequestInFlight) {
      return;
    }
    randomState.idleRequestInFlight = true;
    try {
      // manifest.jsonから待機アニメーションファイルを取得
      if (!RANDOM_IDLE_FILES) {
        RANDOM_IDLE_FILES = await getRandomIdleFiles(vrmaBasePath);
      }

      const idleFile = nextIdleFile();
      if (!idleFile) {
        return;
      }
      const clip = await getAnimationClip(idleFile);
      if (
        !clip ||
        !randomState.active ||
        randomState.phase !== "waiting" ||
        walkMenu.isMoving() ||
        randomState.playingWave
      ) {
        return;
      }
      const durationSeconds =
        typeof clip?.userData?.durationSeconds === "number"
          ? clip.userData.durationSeconds
          : clip?.duration;
      // 待機アニメーション再生時は首のボーンを除外して、首が大きく動かないようにする
      vrmManager.playClip(clip, {
        fadeDuration: AnimationBlend.IDLE,
        syncWithCurrent: true,
        debugLabel: idleFile,
        excludeBones: ['Normalized_J_Bip_C_Head'],
      });
      randomState.idleSwitchTimer = calculateIdleSwitchDelay(durationSeconds);
    } catch (err) {
      logMessage("Error", "idle animation error", { error: err });
    } finally {
      randomState.idleRequestInFlight = false;
    }
  }

  async function playRandomWave() {
    try {
      // manifest.jsonから手を振るアニメーションファイルを取得
      if (!RANDOM_WAVE_FILE) {
        RANDOM_WAVE_FILE = await getAnimationFileByLabel("Wave hand", vrmaBasePath);
        if (!RANDOM_WAVE_FILE) {
          throw new Error("manifest.jsonに'Wave hand'ラベルのアニメーションが見つかりません");
        }
      }

      const clip = await getAnimationClip(RANDOM_WAVE_FILE);
      if (
        !clip ||
        !randomState.active ||
        randomState.phase !== "waiting" ||
        walkMenu.isMoving()
      ) {
        return;
      }
      randomState.playingWave = true;
      randomState.wavePlayedThisCycle = true;
      randomState.idleResumeTimer = clip.duration || 2.5;
      vrmManager.playClip(clip, {
        fadeDuration: AnimationBlend.GESTURE,
        loopMode: THREE.LoopOnce,
        repetitions: 1,
        clampWhenFinished: true,
        debugLabel: RANDOM_WAVE_FILE,
      });
    } catch (err) {
      logMessage("Error", "WaveHand animation error", { error: err });
    } finally {
      randomState.waveRequestInFlight = false;
    }
  }

  function beginRandomWaitPhase() {
    if (!randomState.active) {
      return;
    }
    randomState.phase = "waiting";
    randomState.waitRemaining = RANDOM_WAIT_SECONDS;
    const shouldPlayWave = Math.random() > 0.5;
    if (shouldPlayWave) {
      const delayRange =
        RANDOM_WAVE_DELAY_RANGE.max - RANDOM_WAVE_DELAY_RANGE.min;
      const delay =
        RANDOM_WAVE_DELAY_RANGE.min + Math.random() * delayRange;
      randomState.waveTimer = Math.min(
        Math.max(delay, 0.8),
        Math.max(RANDOM_WAIT_SECONDS - 1, 1)
      );
      randomState.wavePlayedThisCycle = false;
    } else {
      randomState.waveTimer = Number.POSITIVE_INFINITY;
      randomState.wavePlayedThisCycle = true;
    }
    randomState.playingWave = false;
    randomState.waveRequestInFlight = false;
    randomState.idleResumeTimer = 0;
    randomState.idleSwitchTimer = 0;
    startIdleLoopForRandom();
    updateRandomWaitingStatus();
  }

  async function startRandomMove() {
    if (
      !randomState.active ||
      randomState.pendingMove ||
      walkMenu.isMoving()
    ) {
      return;
    }
    if (!vrmManager.getCurrentVrm()) {
      return;
    }

    randomState.pendingMove = true;
    randomState.phase = "moving";
    randomState.wavePlayedThisCycle = false;
    randomState.playingWave = false;
    randomState.waveRequestInFlight = false;
    randomState.currentTarget = {
      x: randomCoordinate(),
      z: randomCoordinate(),
    };


    try {
      const moveSucceeded = await walkMenu.beginMoveTo(
        randomState.currentTarget.x,
        randomState.currentTarget.z,
        {
          preparingMessage: "ランダム移動の準備をしています...",
          turningMessageFactory: (target) =>
            `移動前に方向調整中: x=${target.x.toFixed(
              2
            )}, z=${target.z.toFixed(2)}`,
          movingMessageFactory: (target) =>
            `ランダム移動中: x=${target.x.toFixed(
              2
            )}, z=${target.z.toFixed(2)}`,
          disableWalkButton: false,
          preserveAnimationDisableState: true,
          arrivalMessage: "",
          preserveAnimation: true,
        }
      );
      if (!moveSucceeded && randomState.active) {
        randomState.phase = "idle";
      }
    } catch (err) {
      logMessage("Error", "random walk error", { error: err });
      randomState.phase = "idle";
    } finally {
      randomState.pendingMove = false;
    }
  }

  function activateRandomMode() {
    randomState.active = true;
    randomState.phase = "idle";
    randomState.waitRemaining = 0;
    randomState.waveTimer = 0;
    randomState.wavePlayedThisCycle = false;
    randomState.playingWave = false;
    randomState.waveRequestInFlight = false;
    randomState.pendingMove = false;
    randomState.currentTarget = null;
    randomState.idleResumeTimer = 0;
    randomState.idleSwitchTimer = 0;
    randomState.idleRequestInFlight = false;
    randomState.idleSequenceIndex = 0;
    if (walkMenu.isMoving()) {
      walkMenu.finishWalking("ランダムモードに切り替えました");
    }
    if (vrmManager.getCurrentVrm()) {
      startRandomMove();
    }
  }

  function deactivateRandomMode() {
    randomState.active = false;
    randomState.phase = "idle";
    randomState.waitRemaining = 0;
    randomState.waveTimer = 0;
    randomState.playingWave = false;
    randomState.wavePlayedThisCycle = false;
    randomState.waveRequestInFlight = false;
    randomState.pendingMove = false;
    randomState.currentTarget = null;
    randomState.idleResumeTimer = 0;
    randomState.idleSwitchTimer = 0;
    randomState.idleRequestInFlight = false;
    randomState.idleSequenceIndex = 0;
    if (walkMenu.isMoving()) {
      walkMenu.finishWalking("", { preserveAnimation: false });
    }
    randomState.previousAnimationDisabled = false;
  }

  function updateRandomBehavior(delta) {
    if (!randomState.active) {
      return;
    }

    if (randomState.phase === "moving") {
      if (!walkMenu.isMoving() && !randomState.pendingMove) {
        beginRandomWaitPhase();
      }
      return;
    }

    if (randomState.phase !== "waiting") {
      return;
    }

    randomState.waitRemaining = Math.max(0, randomState.waitRemaining - delta);

    if (!randomState.wavePlayedThisCycle) {
      randomState.waveTimer -= delta;
      if (randomState.waveTimer <= 0 && !randomState.waveRequestInFlight) {
        randomState.waveRequestInFlight = true;
        playRandomWave();
      }
    }

    if (randomState.playingWave) {
      randomState.idleResumeTimer -= delta;
      if (randomState.idleResumeTimer <= 0) {
        randomState.playingWave = false;
        startIdleLoopForRandom();
      }
    } else {
      randomState.idleSwitchTimer = Math.max(
        0,
        randomState.idleSwitchTimer - delta
      );
      if (
        randomState.idleSwitchTimer <= 0 &&
        !randomState.idleRequestInFlight &&
        !randomState.waveRequestInFlight &&
        !walkMenu.isMoving()
      ) {
        startIdleLoopForRandom();
      }
    }

    if (randomState.waitRemaining <= 0 && !randomState.pendingMove) {
      startRandomMove();
    } else {
      updateRandomWaitingStatus();
    }
  }

  function handleVrmReady() {
    if (randomState.active) {
      startRandomMove();
    }
  }

  return {
    randomState,
    activateRandomMode,
    deactivateRandomMode,
    updateRandomBehavior,
    handleVrmReady,
  };
}
