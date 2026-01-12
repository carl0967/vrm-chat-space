// Animation メニュー担当モジュール
import { setStatusText } from "../top_common.js";
import { logMessage } from "../utils/logger.js";

export function createAnimationMenu({
  animationSelect,
  animationStatusElement,
  vrmManager,
  getAnimationClip,
  AnimationBlend,
}) {
  function setAnimationStatus(text) {
    setStatusText(animationStatusElement, text);
  }

  function populateAnimationSelect(list) {
    animationSelect.innerHTML = "";
    if (!list.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "アニメーションが見つかりません";
      animationSelect.append(option);
      animationSelect.disabled = true;
      return;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "アニメーションを選択";
    placeholder.selected = true;
    animationSelect.append(placeholder);

    for (const item of list) {
      const option = document.createElement("option");
      option.value = item.file;
      option.textContent = item.label || item.file;
      animationSelect.append(option);
    }
    animationSelect.disabled = false;
  }

  async function playAnimation(file) {
    if (!vrmManager.getCurrentVrm() || !file) {
      return;
    }
    try {
      setAnimationStatus("アニメーション読み込み中...");
      animationSelect.disabled = true;

      const clip = await getAnimationClip(file);
      vrmManager.playClip(clip, {
        fadeDuration: AnimationBlend.DEFAULT,
        debugLabel: file,
      });

      setAnimationStatus(`再生中: ${file}`);
    } catch (err) {
      logMessage("Error", "VRMA load error", { error: err });
      setAnimationStatus("アニメーションの読み込みに失敗しました");
    } finally {
      animationSelect.disabled = false;
    }
  }

  animationSelect?.addEventListener("change", () => {
    const value = animationSelect.value;
    if (value) {
      playAnimation(value);
    }
  });

  return {
    populateAnimationSelect,
    setAnimationStatus,
    setDisabled(value) {
      animationSelect.disabled = !!value;
    },
    isDisabled() {
      return animationSelect.disabled;
    },
  };
}
