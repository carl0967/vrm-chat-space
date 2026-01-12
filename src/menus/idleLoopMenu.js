import {
  IDLE_TEST_LOOP_FILES,
  calculateIdleSwitchDelay,
} from "../idleAnimations.js";
import { logMessage } from "../utils/logger.js";

/**
 * 待機アニメーションだけをフェード切り替えで繰り返すメニューコントローラー。
 */
export function createIdleLoopMenu({
  vrmManager,
  walkMenu,
  getAnimationClip,
  AnimationBlend,
}) {
  const idleState = {
    active: false,
    idleSequenceIndex: 0,
    idleSwitchTimer: 0,
    idleRequestInFlight: false,
    previousAnimationDisabled: false,
  };


  function nextIdleFile() {
    if (!IDLE_TEST_LOOP_FILES.length) {
      return "";
    }
    const file = IDLE_TEST_LOOP_FILES[idleState.idleSequenceIndex];
    idleState.idleSequenceIndex =
      (idleState.idleSequenceIndex + 1) % IDLE_TEST_LOOP_FILES.length;
    return file;
  }

  async function playNextIdle() {
    if (idleState.idleRequestInFlight || !idleState.active) {
      return;
    }
    idleState.idleRequestInFlight = true;
    try {
      const targetFile = nextIdleFile();
      if (!targetFile) {
        return;
      }
      const clip = await getAnimationClip(targetFile);
      if (!clip || !idleState.active || !vrmManager.getCurrentVrm() || walkMenu.isMoving()) {
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
        debugLabel: targetFile,
        excludeBones: ['Normalized_J_Bip_C_Head'],
      });
      idleState.idleSwitchTimer = calculateIdleSwitchDelay(durationSeconds);
    } catch (err) {
      logMessage("Error", "idle loop tester error", { error: err });
    } finally {
      idleState.idleRequestInFlight = false;
    }
  }

  function activateIdleLoopMode() {
    idleState.active = true;
    idleState.idleSequenceIndex = 0;
    idleState.idleSwitchTimer = 0;
    idleState.idleRequestInFlight = false;
    idleState.previousAnimationDisabled = false;

    if (!vrmManager.getCurrentVrm()) {
      return;
    }
    playNextIdle();
  }

  function deactivateIdleLoopMode() {
    idleState.active = false;
    idleState.idleSequenceIndex = 0;
    idleState.idleSwitchTimer = 0;
    idleState.idleRequestInFlight = false;
    idleState.previousAnimationDisabled = false;
  }

  function updateIdleLoopMode(delta) {
    if (!idleState.active || !vrmManager.getCurrentVrm()) {
      return;
    }
    idleState.idleSwitchTimer = Math.max(
      0,
      idleState.idleSwitchTimer - delta
    );
    if (
      idleState.idleSwitchTimer <= 0 &&
      !idleState.idleRequestInFlight &&
      !walkMenu.isMoving()
    ) {
      playNextIdle();
    }
  }

  function handleVrmReady() {
    if (idleState.active) {
      playNextIdle();
    }
  }

  return {
    activateIdleLoopMode,
    deactivateIdleLoopMode,
    updateIdleLoopMode,
    handleVrmReady,
  };
}
