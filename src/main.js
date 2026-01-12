import { initStage } from "./stage.js";
import { VRMManager } from "./vrmManager.js";
import { MODEL_URL, VRMA_BASE_PATH, saveCharacterSettings, getDefaultCharacterSettings, ACTION_MENU_ITEMS } from "./config.js";
import { logMessage } from "./utils/logger.js";
import { loadAnimationClip } from "./vrma/loader.js";
import { loadVersionHistory, loadVersionInfo, setStatusText } from "./top_common.js";
import { createWalkMenu } from "./menus/walkMenu.js";
import { createRandomMenu } from "./menus/randomMenu.js";
import { createIdleLoopMenu } from "./menus/idleLoopMenu.js";
import { createLookAtPlayerMenu } from "./menus/lookAtPlayerMenu.js";
import { createChatMenu } from "./menus/chatMenu.js";
import { createActionMenu } from "./menus/actionMenu.js";
import { HandInteractionManager } from "./handInteractions.js";
import { VrButtonOverlay } from "./vrui/vrButtonOverlay.js";
import { TtsAudioPlayer } from "./audio/ttsAudioPlayer.js";

const actionNeckAngleRow = document.getElementById("actionNeckAngleRow");
const actionSelect = document.getElementById("actionSelect");
const actionExecuteButton = document.getElementById("actionExecuteButton");
const actionStatus = document.getElementById("actionStatus");
const settingsButton = document.getElementById("settingsButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const infoButton = document.getElementById("infoButton");
const infoOverlay = document.getElementById("infoOverlay");
const closeInfoButton = document.getElementById("closeInfoButton");
const apiKeyInput = document.getElementById("apiKeyInput");
const aivisApiKeyInput = document.getElementById("aivisApiKeyInput");
const micButton = document.getElementById("micButton");
const chatTextInput = document.getElementById("chatTextInput");
const chatSendButton = document.getElementById("chatSendButton");
const chatTranscript = document.getElementById("chatTranscript");
const chatStatus = document.getElementById("chatStatus");
const currentPosition = document.getElementById("currentPosition");
const cameraPositionLabel = document.getElementById("cameraPosition");
const versionButton = document.getElementById("appVersionButton");
const versionHistoryOverlay = document.getElementById("versionHistoryOverlay");
const closeVersionHistoryButton = document.getElementById("closeVersionHistoryButton");
const versionHistoryContent = document.getElementById("versionHistoryContent");
const debugDisplayToggle = document.getElementById("debugDisplayToggle");
const positionDisplay = document.getElementById("positionDisplay");
const bottomChatMessages = document.getElementById("bottomChatMessages");
const bottomChatTextInput = document.getElementById("bottomChatTextInput");
const bottomChatMicButton = document.getElementById("bottomChatMicButton");
const bottomChatSendButton = document.getElementById("bottomChatSendButton");
const openCharacterSettingsButton = document.getElementById("openCharacterSettingsButton");
const characterSettingsOverlay = document.getElementById("characterSettingsOverlay");
const closeCharacterSettingsButton = document.getElementById("closeCharacterSettingsButton");
const saveCharacterSettingsButton = document.getElementById("saveCharacterSettingsButton");
const cancelCharacterSettingsButton = document.getElementById("cancelCharacterSettingsButton");
const aiNameInput = document.getElementById("aiNameInput");
const aiSystemPromptInput = document.getElementById("aiSystemPromptInput");
const openaiTtsModelInput = document.getElementById("openaiTtsModelInput");
const openaiTtsVoiceInput = document.getElementById("openaiTtsVoiceInput");
const openaiTtsSpeedInput = document.getElementById("openaiTtsSpeedInput");
const aivisTtsModelUuidInput = document.getElementById("aivisTtsModelUuidInput");
const changeVrmModelButton = document.getElementById("changeVrmModelButton");
const vrmFileInput = document.getElementById("vrmFileInput");

// アニメーション種別ごとにフェード時間の目安を決めておく（値は秒）
const AnimationBlend = Object.freeze({
  DEFAULT: 0.35,
  LOCOMOTION: 0.6,
  IDLE: 0.5,
  GESTURE: 0.22,
});

const clipCache = new Map();

// アップロードされたVRMファイルのObjectURL（メモリリーク防止のため保持）
let uploadedVrmObjectUrl = null;

const stage = initStage();
const ttsAudioPlayer = new TtsAudioPlayer({ camera: stage.camera, renderer: stage.renderer });
const vrmManager = new VRMManager(stage.world);
const handInteractionManager = new HandInteractionManager(stage.scene, stage.renderer, {
  spawnParent: stage.world,
  floorY: stage.floor?.position?.y ?? 0,
});
handInteractionManager.init();

// chatMenuの作成は後で（actionMenuが必要なため）
let chatMenu;

// VrButtonOverlayの初期化（actionMenuは後で設定）
const vrButtonOverlay = new VrButtonOverlay({
  world: stage.world,
  renderer: stage.renderer,
  interactionManager: handInteractionManager,
  chatMenu,
});
setupDesktopCubeSpawn();

/**
 * OrbitControls のカメラ位置を UI に反映する。
 */
function updateCameraPositionLabel() {
  if (!cameraPositionLabel || !stage || !stage.camera) {
    return;
  }
  const pos = stage.camera.position;
  setStatusText(
    cameraPositionLabel,
    `x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}`
  );
}

function invalidateClips() {
  clipCache.clear();
}

/**
 * 更新履歴を UI に描画する。
 */
function renderVersionHistory(items) {
  if (!versionHistoryContent) {
    return;
  }
  versionHistoryContent.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "更新履歴がまだ登録されていません。";
    versionHistoryContent.appendChild(emptyMessage);
    return;
  }
  items.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "history-entry";

    const heading = document.createElement("h3");
    const dateText = item?.date ? String(item.date) : "--";
    const versionText = item?.version ? String(item.version) : "--";
    heading.textContent = `${dateText} / Ver. ${versionText}`;
    entry.appendChild(heading);

    if (item?.summary) {
      const summary = document.createElement("p");
      summary.textContent = String(item.summary);
      entry.appendChild(summary);
    }

    if (Array.isArray(item?.notes) && item.notes.length > 0) {
      const list = document.createElement("ul");
      item.notes.forEach((note) => {
        const li = document.createElement("li");
        li.textContent = String(note);
        list.appendChild(li);
      });
      entry.appendChild(list);
    }
    versionHistoryContent.appendChild(entry);
  });
}

/**
 * 更新履歴ファイルを読み込み、表示内容を更新する。
 */
async function refreshVersionHistory() {
  if (!versionHistoryContent) {
    return;
  }
  versionHistoryContent.innerHTML = "<p>読み込み中...</p>";
  try {
    const items = await loadVersionHistory();
    renderVersionHistory(items);
  } catch (err) {
    logMessage("Warn", "version history load error", { error: err });
    versionHistoryContent.innerHTML = "<p>更新履歴の取得に失敗しました。</p>";
  }
}

/**
 * VRMモデルを読み込んで初期化する。
 * @param {string} url - VRMファイルのURL
 */
async function loadVrmModel(url) {
  try {
    await vrmManager.load(url);

    // VRMモデルのロード後、音源をVRMの位置にアタッチ
    const vrm = vrmManager.getCurrentVrm();
    if (vrm?.scene && ttsAudioPlayer) {
      ttsAudioPlayer.setAudioTarget(vrm.scene);
      logMessage("Info", "[main] TTS音源をVRMモデルにアタッチしました");
    }

    handInteractionManager.setCharacterColliderProvider((target) =>
      vrmManager.getWorldBoundingBox(target)
    );
    invalidateClips();
    walkMenu.syncLogicalPositionWithVrm();

    // VRM読み込み完了時にアクションメニューとチャットメニューを初期化
    actionMenu.handleVrmReady();
    chatMenu.handleVrmReady();

    return true;
  } catch (err) {
    logMessage("Error", "VRM load error", { error: err });
    return false;
  }
}

/**
 * デスクトップ操作時に canvas をクリックするとキューブを生成する。
 */
function setupDesktopCubeSpawn() {
  stage.renderer?.domElement?.addEventListener("click", (event) => {
    if (stage.renderer.xr.isPresenting || event.button !== 0) {
      return;
    }
    handInteractionManager.spawnCubeFrom(stage.camera);
  });
}

async function getAnimationClip(file) {
  if (!vrmManager.getCurrentVrm() || !file) {
    return null;
  }
  if (clipCache.has(file)) {
    return clipCache.get(file);
  }
  const clip = await loadAnimationClip(file, VRMA_BASE_PATH, vrmManager.getCurrentVrm());
  clipCache.set(file, clip);
  return clip;
}

const walkMenu = createWalkMenu({
  vrmManager,
  getAnimationClip,
  AnimationBlend,
  vrmaBasePath: VRMA_BASE_PATH,
});

const randomMenu = createRandomMenu({
  vrmManager,
  walkMenu,
  getAnimationClip,
  AnimationBlend,
  vrmaBasePath: VRMA_BASE_PATH,
});

const idleLoopMenu = createIdleLoopMenu({
  vrmManager,
  walkMenu,
  getAnimationClip,
  AnimationBlend,
  vrmaBasePath: VRMA_BASE_PATH,
});

const lookAtPlayerMenu = createLookAtPlayerMenu({
  vrmManager,
  stage,
});

const actionMenu = createActionMenu({
  vrmManager,
  stage,
  randomMenu,
  walkMenu,
  idleLoopMenu,
  lookAtPlayerMenu,
  actionSelect,
  actionExecuteButton,
  actionStatusElement: actionStatus,
  getAnimationClip,
  AnimationBlend,
  vrmaBasePath: VRMA_BASE_PATH,
});

// VrButtonOverlayにactionMenuを設定
vrButtonOverlay.actionMenu = actionMenu;

// chatMenuを作成（actionMenuとvrmManagerを渡す）
chatMenu = createChatMenu({
  apiKeyInput,
  aivisApiKeyInput,
  micButton,
  chatTranscript,
  chatStatusElement: chatStatus,
  textInput: chatTextInput,
  sendButton: chatSendButton,
  ttsAudioPlayer,
  actionMenu,
  vrmManager,
  // Web画面下部のチャット要素
  bottomChatMessages,
  bottomChatTextInput,
  bottomChatMicButton,
  bottomChatSendButton,
});

// VrButtonOverlayにchatMenuを再設定
vrButtonOverlay.chatMenu = chatMenu;
// chatMenu設定後、VR空間のメニュー表示を更新
vrButtonOverlay.updateChatStatus();

// アクション選択時にactionNeckAngleRowの表示/非表示を切り替える
actionSelect?.addEventListener("change", () => {
  const selectedAction = actionSelect.value;
  if (selectedAction === "moveNeck") {
    actionNeckAngleRow?.classList.remove("hidden");
  } else {
    actionNeckAngleRow?.classList.add("hidden");
  }
});

// NOTE: このアプリはチャットモード専用です。
// VrButtonOverlayとchatMenuはデフォルトでチャットモードとして初期化されます。

/**
 * config.jsのACTION_MENU_ITEMSからWeb用のアクションメニューを生成する。
 */
function populateActionMenu() {
  if (!actionSelect) {
    logMessage("Warn", "[main] actionSelect要素が見つかりません");
    return;
  }

  // 既存のoption要素をクリア（最初の「アクションを選択」以外）
  while (actionSelect.options.length > 1) {
    actionSelect.remove(1);
  }

  // ACTION_MENU_ITEMSからWeb表示するアクションのみを追加
  ACTION_MENU_ITEMS.filter((item) => item.web).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    actionSelect.appendChild(option);
  });
}

async function init() {
  // アクションメニューを生成
  populateActionMenu();

  // VRMモデルを読み込む
  const success = await loadVrmModel(MODEL_URL);
  if (!success) {
    logMessage("Error", "[main] VRMモデルの読み込みに失敗しました");
    return;
  }
}

// デバッグ表示チェックボックスの制御
debugDisplayToggle?.addEventListener("change", (event) => {
  if (event.target.checked) {
    positionDisplay?.classList.remove("hidden");
  } else {
    positionDisplay?.classList.add("hidden");
  }
});

// 設定ボタンとポップアップの制御
settingsButton?.addEventListener("click", () => {
  settingsOverlay?.classList.remove("hidden");
});

closeSettingsButton?.addEventListener("click", () => {
  settingsOverlay?.classList.add("hidden");
});

// オーバーレイの背景をクリックしたときに閉じる
settingsOverlay?.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    settingsOverlay.classList.add("hidden");
  }
});

// Infoボタンとポップアップの制御
infoButton?.addEventListener("click", () => {
  infoOverlay?.classList.remove("hidden");
});

closeInfoButton?.addEventListener("click", () => {
  infoOverlay?.classList.add("hidden");
});

// オーバーレイの背景をクリックしたときに閉じる
infoOverlay?.addEventListener("click", (event) => {
  if (event.target === infoOverlay) {
    infoOverlay.classList.add("hidden");
  }
});

// バージョンボタンと更新履歴ポップアップの制御
versionButton?.addEventListener("click", () => {
  versionHistoryOverlay?.classList.remove("hidden");
  refreshVersionHistory();
});

closeVersionHistoryButton?.addEventListener("click", () => {
  versionHistoryOverlay?.classList.add("hidden");
});

// オーバーレイの背景をクリックしたときに閉じる
versionHistoryOverlay?.addEventListener("click", (event) => {
  if (event.target === versionHistoryOverlay) {
    versionHistoryOverlay.classList.add("hidden");
  }
});

/**
 * キャラクター設定画面に現在の設定値を読み込む。
 */
function loadCharacterSettingsToForm() {
  const defaultSettings = getDefaultCharacterSettings();
  // localStorageから読み込まれた現在の設定値を取得
  // (config.jsでexportされている定数は既にlocalStorageから読み込まれている)
  const currentSettings = {
    aiName: localStorage.getItem("vrm_chat_ai_name") || defaultSettings.aiName,
    systemPrompt: localStorage.getItem("vrm_chat_ai_system_prompt") || defaultSettings.systemPrompt,
    openaiTts: {
      model: localStorage.getItem("vrm_chat_openai_tts_model") || defaultSettings.openaiTts.model,
      voice: localStorage.getItem("vrm_chat_openai_tts_voice") || defaultSettings.openaiTts.voice,
      speed: parseFloat(localStorage.getItem("vrm_chat_openai_tts_speed")) || defaultSettings.openaiTts.speed,
    },
    aivisTts: {
      model_uuid: localStorage.getItem("vrm_chat_aivis_tts_model_uuid") || defaultSettings.aivisTts.model_uuid,
    },
  };

  aiNameInput.value = currentSettings.aiName;
  aiSystemPromptInput.value = currentSettings.systemPrompt;
  openaiTtsModelInput.value = currentSettings.openaiTts.model;
  openaiTtsVoiceInput.value = currentSettings.openaiTts.voice;
  openaiTtsSpeedInput.value = currentSettings.openaiTts.speed;
  aivisTtsModelUuidInput.value = currentSettings.aivisTts.model_uuid;
}

// キャラクター設定変更ボタンとポップアップの制御
openCharacterSettingsButton?.addEventListener("click", () => {
  loadCharacterSettingsToForm();
  characterSettingsOverlay?.classList.remove("hidden");
});

closeCharacterSettingsButton?.addEventListener("click", () => {
  characterSettingsOverlay?.classList.add("hidden");
});

// キャンセルボタンのイベントリスナー
cancelCharacterSettingsButton?.addEventListener("click", () => {
  characterSettingsOverlay?.classList.add("hidden");
});

// 保存ボタンのイベントリスナー
saveCharacterSettingsButton?.addEventListener("click", () => {
  const settings = {
    aiName: aiNameInput.value.trim() || getDefaultCharacterSettings().aiName,
    systemPrompt: aiSystemPromptInput.value.trim() || getDefaultCharacterSettings().systemPrompt,
    openaiTts: {
      model: openaiTtsModelInput.value.trim() || getDefaultCharacterSettings().openaiTts.model,
      voice: openaiTtsVoiceInput.value.trim() || getDefaultCharacterSettings().openaiTts.voice,
      speed: parseFloat(openaiTtsSpeedInput.value) || getDefaultCharacterSettings().openaiTts.speed,
    },
    aivisTts: {
      model_uuid: aivisTtsModelUuidInput.value.trim() || getDefaultCharacterSettings().aivisTts.model_uuid,
    },
  };

  // 設定を保存
  saveCharacterSettings(settings);

  // ページをリロードして新しい設定を反映
  alert("キャラクター設定を保存しました。ページをリロードします。");
  location.reload();
});

// オーバーレイの背景をクリックしたときに閉じる
characterSettingsOverlay?.addEventListener("click", (event) => {
  if (event.target === characterSettingsOverlay) {
    characterSettingsOverlay.classList.add("hidden");
  }
});

// VRMモデル変更ボタンのイベントリスナー
changeVrmModelButton?.addEventListener("click", () => {
  vrmFileInput?.click();
});

// VRMファイル選択時のイベントリスナー
vrmFileInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  // ファイルがVRM形式かどうかを確認
  if (!file.name.toLowerCase().endsWith(".vrm")) {
    alert("VRMファイルを選択してください。");
    return;
  }

  // 設定画面を閉じる
  settingsOverlay?.classList.add("hidden");

  // 前回のObjectURLを解放（メモリリーク防止）
  if (uploadedVrmObjectUrl) {
    URL.revokeObjectURL(uploadedVrmObjectUrl);
    uploadedVrmObjectUrl = null;
  }

  // ObjectURLを作成してVRMモデルを読み込む
  const objectUrl = URL.createObjectURL(file);
  const success = await loadVrmModel(objectUrl);

  if (success) {
    // 読み込み成功時のみObjectURLを保持
    uploadedVrmObjectUrl = objectUrl;
    logMessage("Info", `[main] VRMモデルを変更しました: ${file.name}`);
    alert(`VRMモデルを「${file.name}」に変更しました。`);
  } else {
    // 読み込み失敗時はObjectURLを解放
    URL.revokeObjectURL(objectUrl);
    alert("VRMモデルの読み込みに失敗しました。");
  }

  // 入力をクリアして、同じファイルを再度選択できるようにする
  event.target.value = "";
});

loadVersionInfo(versionButton);
init();

stage.renderer.setAnimationLoop((_, xrFrame) => {
  const delta = stage.clock.getDelta();
  stage.updateKeyboardMovement?.(delta);
  stage.controls.update();
  vrmManager.update(delta);
  vrmManager.updateLipSync(delta);
  walkMenu.updateWalk(delta);
  randomMenu.updateRandomBehavior(delta);
  idleLoopMenu.updateIdleLoopMode(delta);
  lookAtPlayerMenu.updateLookAtPlayer(delta, xrFrame);
  actionMenu.updateAction(delta);
  handInteractionManager.update(delta);
  vrButtonOverlay.update();
  updateCameraPositionLabel();
  stage.renderer.render(stage.scene, stage.camera);
});

window.addEventListener("beforeunload", () => {
  vrButtonOverlay?.dispose();
  ttsAudioPlayer?.dispose?.();
  // アップロードされたVRMのObjectURLを解放
  if (uploadedVrmObjectUrl) {
    URL.revokeObjectURL(uploadedVrmObjectUrl);
    uploadedVrmObjectUrl = null;
  }
});
