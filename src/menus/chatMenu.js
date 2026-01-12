import { setStatusText } from "../top_common.js";
import {
  AI_CHARACTER_SYSTEM_PROMPT,
  AI_NAME,
  OPENAI_TTS_CONFIG,
  AIVIS_TTS_CONFIG,
} from "../config.js";
import {
  MIC_PERMISSION_ERROR_CODE,
  MIC_PERMISSION_ERROR_MESSAGE,
} from "../constants/micPermission.js";
import { logMessage } from "../utils/logger.js";

/**
 * チャットメニューを作成する。
 * OpenAI APIキー入力、Aivis APIキー入力、音声認識、Speech to Text、Text to Text（ChatCompletion）、TTS機能を提供する。
 */
export function createChatMenu({
  apiKeyInput,
  aivisApiKeyInput,
  micButton,
  chatTranscript,
  chatStatusElement,
  textInput,
  sendButton,
  ttsAudioPlayer,
  actionMenu,
  vrmManager,
  // Web画面下部のチャット要素
  bottomChatMessages,
  bottomChatTextInput,
  bottomChatMicButton,
  bottomChatSendButton,
}) {
  // NOTE: このアプリはチャットモード専用です。menuActiveは常にtrueとして動作します。
  const state = {
    menuActive: true, // チャット専用のため常にアクティブ
    apiKey: "",
    aivisApiKey: "",
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    chatHistory: [], // チャット履歴（systemメッセージ、userメッセージ、assistantメッセージ）
    isProcessing: false, // AI応答処理中フラグ
    audioElement: null, // TTS音声再生用のAudioElement（Web再生）
    isSpeaking: false, // TTS音声再生中フラグ
    mediaSource: null, // AIVIS用のMediaSource
    ttsAudioPlayer: ttsAudioPlayer || null,
    recordingSource: null, // 録音開始元（"bottomChat" または "settingsMenu"）
  };

  // sessionStorageからAPIキーを復元
  const storedOpenAIKey = sessionStorage.getItem("openai_api_key");
  const storedAivisKey = sessionStorage.getItem("aivis_api_key");
  if (storedOpenAIKey && apiKeyInput) {
    apiKeyInput.value = storedOpenAIKey;
  }
  if (storedAivisKey && aivisApiKeyInput) {
    aivisApiKeyInput.value = storedAivisKey;
  }

  /**
   * マイク権限に紐づくエラーかどうかを判定する。
   * @param {Error|DOMException} error - 判定したいエラー。
   * @returns {boolean} マイク権限エラーの場合は true。
   */
  function isMicPermissionError(error) {
    if (!error) {
      return false;
    }
    if (error?.code === MIC_PERMISSION_ERROR_CODE) {
      return true;
    }
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return true;
    }
    const message = error?.message || "";
    return message.includes("許可") || message.includes("denied");
  }

  /**
   * マイク権限エラーを共通フォーマット（固定文言）に変換する。
   * @param {Error|DOMException} error - 正規化したいエラー。
   * @returns {Error} 共通文言のエラーオブジェクト。
   */
  function normalizeMicPermissionError(error) {
    if (!isMicPermissionError(error)) {
      return error;
    }
    if (error?.code === MIC_PERMISSION_ERROR_CODE || error?.message === MIC_PERMISSION_ERROR_MESSAGE) {
      return error;
    }
    const wrappedError = new Error(MIC_PERMISSION_ERROR_MESSAGE);
    wrappedError.name = "MicPermissionError";
    wrappedError.code = MIC_PERMISSION_ERROR_CODE;
    wrappedError.cause = error;
    return wrappedError;
  }

  /**
   * ステータス表示を更新する。
   */
  function setChatStatus(text) {
    setStatusText(chatStatusElement, text);
  }

  /**
   * トランスクリプト（テキスト表示エリア）にテキストを追加する。
   * @param {string} text - 表示するテキスト
   * @param {string} speaker - 発話者（"user" または "ai"）
   */
  function appendTranscript(text, speaker = "user") {
    if (!chatTranscript) {
      return;
    }
    const speakerLabel = speaker === "ai" ? AI_NAME : "音声入力";
    const entry = `${speakerLabel}：${text}\n`;
    chatTranscript.textContent += entry;
    // 自動スクロール
    chatTranscript.scrollTop = chatTranscript.scrollHeight;

    // Web画面下部のチャットエリアにはAIの発言のみを追加
    if (bottomChatMessages && speaker === "ai") {
      const aiEntry = `${AI_NAME}：${text}`;
      bottomChatMessages.textContent = bottomChatMessages.textContent
        ? `${bottomChatMessages.textContent}\n${aiEntry}`
        : aiEntry;
      // 自動スクロール
      bottomChatMessages.scrollTop = bottomChatMessages.scrollHeight;
    }
  }

  /**
   * AudioContextをユーザー操作中に確実にアンロックする。
   * resume() を試し、必要に応じて無音バッファを再生する。
   * @param {string} triggerLabel - 呼び出し元の識別子
   */
  async function ensureAudioContextUnlocked(triggerLabel = "") {
    const audioContext = state.ttsAudioPlayer?.audioListener?.context;
    if (!audioContext) {
      logMessage("Warn", "[ChatMenu] AudioContext unlock: TTSプレーヤー未設定", { trigger: triggerLabel });
      return;
    }

    if (audioContext.state === "running") {
      return;
    }

    try {
      await audioContext.resume();
    } catch (error) {
      logMessage("Warn", "[ChatMenu] AudioContext resume失敗", { error: error });
    }

    if (audioContext.state === "running") {
      return;
    }

    try {
      // ブラウザの自動再生ポリシーでresumeが拒否された場合でもAudioContextを「ユーザー操作済み」にするため、
      // 短い無音バッファを再生してアクティベーションを強制的に確立する。
      const durationSeconds = 0.05;
      const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
      const silentBuffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
      const source = audioContext.createBufferSource();
      source.buffer = silentBuffer;
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(audioContext.destination);
      await new Promise((resolve) => {
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          resolve();
        };
        source.start();
      });
    } catch (silentError) {
      logMessage("Warn", "[ChatMenu] 無音バッファ再生に失敗", { error: silentError });
    }
  }

  /**
   * APIキーの妥当性を簡易チェックする。
   * OpenAI APIキーが必要。Aivis APIキーは任意（入力されている場合はAIVIS TTSを使用）。
   */
  function validateApiKey() {
    state.apiKey = apiKeyInput?.value?.trim() || "";
    state.aivisApiKey = aivisApiKeyInput?.value?.trim() || "";

    // OpenAI APIキーは常に必要（ChatCompletion用、およびフォールバック用TTS）
    if (!state.apiKey || !state.apiKey.startsWith("sk-")) {
      return false;
    }

    return true;
  }

  /**
   * マイクボタンの有効/無効を更新する。
   */
  function updateMicButtonState() {
    const isValid = validateApiKey();
    if (micButton) {
      micButton.disabled = !state.menuActive || !isValid || state.isRecording;
      if (!isValid && state.menuActive) {
        setChatStatus("OpenAI APIキーを入力してください");
      } else if (isValid && state.menuActive && !state.isRecording) {
        setChatStatus("マイクボタンを押して音声入力を開始");
      }
    }
  }

  /**
   * 音声データをOpenAI Whisper APIに送信してテキストを取得する。
   */
  async function transcribeAudio(audioBlob) {
    if (!state.apiKey) {
      throw new Error("APIキーが設定されていません");
    }

    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "ja");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Whisper API error: ${response.status} - ${errorData.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    return data.text || "";
  }

  /**
   * ユーザーメッセージをOpenAI ChatCompletion APIに送信してAI応答を取得する。
   * @param {string} userMessage - ユーザーのメッセージ
   * @returns {Promise<string>} AIの応答テキスト
   */
  async function sendMessageToAI(userMessage) {
    if (!state.apiKey) {
      throw new Error("APIキーが設定されていません");
    }

    // チャット履歴にユーザーメッセージを追加
    state.chatHistory.push({
      role: "user",
      content: userMessage,
    });

    // システムプロンプトを含むメッセージ配列を構築
    const messages = [
      {
        role: "system",
        content: AI_CHARACTER_SYSTEM_PROMPT,
      },
      ...state.chatHistory,
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messages,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `ChatCompletion API error: ${response.status} - ${errorData.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    const aiMessage = data.choices?.[0]?.message?.content || "";

    if (!aiMessage) {
      throw new Error("AI応答が空です");
    }

    // チャット履歴にAIメッセージを追加
    state.chatHistory.push({
      role: "assistant",
      content: aiMessage,
    });

    return aiMessage;
  }

  /**
   * テキストをOpenAI TTS APIで音声に変換して再生する。
   * @param {string} text - 音声化するテキスト
   * @returns {Promise<void>}
   */
  async function textToSpeechOpenAI(text) {
    if (!state.apiKey) {
      throw new Error("OpenAI APIキーが設定されていません");
    }

    // 既に再生中の音声があれば停止
    if (state.audioElement) {
      state.audioElement.pause();
      state.audioElement = null;
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_TTS_CONFIG.model,
        voice: OPENAI_TTS_CONFIG.voice,
        input: text,
        speed: OPENAI_TTS_CONFIG.speed,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI TTS API error: ${response.status} - ${errorData.error?.message || response.statusText}`
      );
    }

    const audioArrayBuffer = await response.arrayBuffer();

    if (state.ttsAudioPlayer) {
      // 音声再生直前に音源をVRMモデルの現在位置に再アタッチ
      const vrm = vrmManager?.getCurrentVrm?.();
      if (vrm?.scene) {
        state.ttsAudioPlayer.setAudioTarget(vrm.scene);
        logMessage("Info", "[ChatMenu] TTS音源をVRMモデルの現在位置に再アタッチしました");
      }

      state.isSpeaking = true;
      // 口パク開始
      if (vrmManager?.startLipSync) {
        vrmManager.startLipSync();
      }
      try {
        await state.ttsAudioPlayer.playArrayBuffer(audioArrayBuffer);
      } finally {
        state.isSpeaking = false;
        // 口パク停止
        if (vrmManager?.stopLipSync) {
          vrmManager.stopLipSync();
        }
      }
      return;
    }

    const audioBlob = new Blob([audioArrayBuffer], { type: "audio/mpeg" });
    const audioUrl = URL.createObjectURL(audioBlob);

    state.audioElement = new Audio(audioUrl);
    state.isSpeaking = true;

    state.audioElement.onended = () => {
      URL.revokeObjectURL(audioUrl);
      state.isSpeaking = false;
      state.audioElement = null;
    };

    state.audioElement.onerror = (error) => {
      logMessage("Error", "OpenAI audio playback error", { error: error });
      URL.revokeObjectURL(audioUrl);
      state.isSpeaking = false;
      state.audioElement = null;
    };

    await state.audioElement.play();
  }

  /**
   * テキストをAIVIS TTS APIで音声に変換してストリーミング再生する。
   * @param {string} text - 音声化するテキスト
   * @returns {Promise<void>}
   */
  async function textToSpeechAIVIS(text) {
    if (!state.aivisApiKey) {
      throw new Error("Aivis APIキーが設定されていません");
    }

    if (state.audioElement) {
      state.audioElement.pause();
      state.audioElement = null;
    }
    if (state.mediaSource) {
      try {
        if (state.mediaSource.readyState === "open") {
          state.mediaSource.endOfStream();
        }
      } catch (e) {
        // エラーは無視
      }
      state.mediaSource = null;
    }

    const response = await fetch("https://api.aivis-project.com/v1/tts/synthesize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.aivisApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_uuid: AIVIS_TTS_CONFIG.model_uuid,
        text: text,
        use_ssml: AIVIS_TTS_CONFIG.use_ssml,
        use_volume_normalizer: AIVIS_TTS_CONFIG.use_volume_normalizer,
        output_format: AIVIS_TTS_CONFIG.output_format,
        leading_silence_seconds: AIVIS_TTS_CONFIG.leading_silence_seconds,
        trailing_silence_seconds: AIVIS_TTS_CONFIG.trailing_silence_seconds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`AIVIS TTS API error: ${response.status} - ${errorText}`);
    }

    if (state.ttsAudioPlayer) {
      // 音声再生直前に音源をVRMモデルの現在位置に再アタッチ
      const vrm = vrmManager?.getCurrentVrm?.();
      if (vrm?.scene) {
        state.ttsAudioPlayer.setAudioTarget(vrm.scene);
        logMessage("Info", "[ChatMenu] TTS音源をVRMモデルの現在位置に再アタッチしました (AIVIS)");
      }

      const audioArrayBuffer = await response.arrayBuffer();
      state.isSpeaking = true;
      // 口パク開始
      if (vrmManager?.startLipSync) {
        vrmManager.startLipSync();
      }
      try {
        await state.ttsAudioPlayer.playArrayBuffer(audioArrayBuffer);
      } finally {
        state.isSpeaking = false;
        // 口パク停止
        if (vrmManager?.stopLipSync) {
          vrmManager.stopLipSync();
        }
      }
      return;
    }

    const mediaSource = self.MediaSource
      ? new self.MediaSource()
      : new self.ManagedMediaSource();
    state.mediaSource = mediaSource;

    const audio = new Audio(URL.createObjectURL(mediaSource));
    audio.disableRemotePlayback = true;
    state.audioElement = audio;
    state.isSpeaking = true;

    audio.onended = () => {
      state.isSpeaking = false;
      state.audioElement = null;
      state.mediaSource = null;
    };

    audio.onerror = (error) => {
      logMessage("Error", "AIVIS audio playback error", { error: error });
      state.isSpeaking = false;
      state.audioElement = null;
      state.mediaSource = null;
    };

    audio.play().catch(error => logMessage("Error", "AIVIS audio play error", { error: error }));

    await new Promise((resolve, reject) => {
      mediaSource.addEventListener(
        "sourceopen",
        async () => {
          try {
            const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");

            const waitForIdle = () =>
              sourceBuffer.updating
                ? new Promise((r) =>
                    sourceBuffer.addEventListener("updateend", r, { once: true })
                  )
                : Promise.resolve();

            const waitForIdleCompletely = async () => {
              while (sourceBuffer.updating) {
                await waitForIdle();
                await new Promise((r) => setTimeout(r, 0));
              }
            };

            const reader = response.body.getReader();

            for (;;) {
              const { value, done } = await reader.read();

              if (done) {
                await waitForIdleCompletely();
                try {
                  mediaSource.endOfStream();
                } catch (error) {
                  if (error.name === "InvalidStateError" && sourceBuffer.updating) {
                    await waitForIdleCompletely();
                    mediaSource.endOfStream();
                  } else {
                    throw error;
                  }
                }
                resolve();
                break;
              }

              await waitForIdle();
              await new Promise((r) => setTimeout(r, 0));
              sourceBuffer.appendBuffer(value);
            }
          } catch (error) {
            reject(error);
          }
        },
        { once: true }
      );
    });
  }

  /**
   * テキストを音声に変換して再生する。
   * Aivis APIキーが入力されている場合はAIVIS TTSを使用し、それ以外はOpenAI TTSを使用する。
   * @param {string} text - 音声化するテキスト
   * @returns {Promise<void>}
   */
  async function textToSpeech(text) {
    // Aivis APIキーが入力されている場合はAIVIS TTSを使用
    if (state.aivisApiKey) {
      return await textToSpeechAIVIS(text);
    } else {
      return await textToSpeechOpenAI(text);
    }
  }

  /**
   * 音声録音を開始する。
   * @param {boolean} isBottomChat - Web画面下部のチャットボタンからの呼び出しかどうか
   */
  async function startRecording(isBottomChat = false) {
    if (state.isRecording) {
      return;
    }

    logMessage("Info", "[ChatMenu] デスクトップマイクボタン押下", {
      context: isBottomChat ? "bottomChat" : "desktopMenu",
    });

    // マイクボタン押下時に「こっちにくる(正面)」アクションを実行
    if (actionMenu && typeof actionMenu.executeComeHereFrontAction === 'function') {
      try {
        await actionMenu.executeComeHereFrontAction();
        logMessage("Info", "[ChatMenu] こっちにくる(正面)アクションを実行しました", {
          context: isBottomChat ? "bottomChat" : "desktopMenu",
        });
      } catch (error) {
        logMessage("Warn", "[ChatMenu] こっちにくる(正面)アクション実行エラー", {
          context: isBottomChat ? "bottomChat" : "desktopMenu",
          error: error?.message ?? String(error),
        });
      }
    }

    await ensureAudioContextUnlocked("startRecording");

    // 録音開始元を記録
    state.recordingSource = isBottomChat ? "bottomChat" : "settingsMenu";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];

      // MediaRecorderの設定
      const options = { mimeType: "audio/webm" };
      state.mediaRecorder = new MediaRecorder(stream, options);

      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          state.audioChunks.push(event.data);
        }
      };

      state.mediaRecorder.onstop = async () => {
        // 音声ストリームを停止
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(state.audioChunks, { type: "audio/webm" });
        state.audioChunks = [];
        const isBottomChat = state.recordingSource === "bottomChat";

        setChatStatus("音声を処理中...");

        try {
          const transcription = await transcribeAudio(audioBlob);
          if (transcription) {
            if (isBottomChat) {
              // Web画面下部のチャットの場合、入力欄に認識した文字を表示（自動送信はしない）
              if (bottomChatTextInput) {
                bottomChatTextInput.value = transcription;
              }
              setChatStatus("音声認識完了");
            } else {
              // 設定画面のチャットの場合、従来通りの処理
              appendTranscript(transcription, "user");

              // AIに送信して応答を取得
              setChatStatus("AIが応答を生成中...");
              state.isProcessing = true;
              try {
                const aiResponse = await sendMessageToAI(transcription);
                appendTranscript(aiResponse, "ai");

                // TTSで音声再生
                setChatStatus("音声を生成中...");
                try {
                  await textToSpeech(aiResponse);
                  setChatStatus("完了");
                } catch (ttsError) {
                  logMessage("Error", "TTS error", { error: ttsError });
                  setChatStatus(`音声生成エラー: ${ttsError.message}`);
                }
              } catch (aiError) {
                logMessage("Error", "AI response error", { error: aiError });
                setChatStatus(`AIエラー: ${aiError.message}`);
              } finally {
                state.isProcessing = false;
              }
            }
          } else {
            setChatStatus("音声を認識できませんでした");
          }
        } catch (error) {
          logMessage("Error", "Transcription error", { error: error });
          setChatStatus(`エラー: ${error.message}`);
        } finally {
          state.isRecording = false;
          state.recordingSource = null;
          updateMicButtonState();
          updateBottomMicButtonState();
          if (micButton) {
            micButton.textContent = "🎤 マイク";
          }
          if (bottomChatMicButton) {
            bottomChatMicButton.innerHTML = '<i class="fas fa-microphone"></i>';
          }
        }
      };

      state.mediaRecorder.start();
      state.isRecording = true;
      setChatStatus("録音中... (もう一度押すと停止)");
      if (micButton) {
        micButton.textContent = "⏹️ 停止";
        micButton.disabled = false;
      }
      if (bottomChatMicButton) {
        bottomChatMicButton.innerHTML = '<i class="fas fa-stop"></i>';
      }
    } catch (error) {
      const normalizedError = normalizeMicPermissionError(error);
      logMessage("Error", "Recording error", { error: normalizedError });
      if (isMicPermissionError(normalizedError)) {
        setChatStatus(MIC_PERMISSION_ERROR_MESSAGE);
      } else {
        setChatStatus(`マイクエラー: ${normalizedError.message}`);
      }
      state.isRecording = false;
      updateMicButtonState();
    }
  }

  /**
   * 音声録音を停止する。
   */
  function stopRecording() {
    if (!state.isRecording || !state.mediaRecorder) {
      return;
    }

    state.mediaRecorder.stop();
    setChatStatus("録音を停止しました");
  }

  /**
   * マイクボタンのクリックハンドラー。
   */
  function handleMicButtonClick() {
    if (!validateApiKey()) {
      setChatStatus("有効なOpenAI APIキーを入力してください");
      return;
    }

    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  /**
   * APIキー入力欄の変更ハンドラー。
   * APIキーをsessionStorageに保存する。
   */
  function handleApiKeyChange() {
    // sessionStorageにAPIキーを保存
    if (apiKeyInput?.value) {
      sessionStorage.setItem("openai_api_key", apiKeyInput.value);
    } else {
      sessionStorage.removeItem("openai_api_key");
    }
    if (aivisApiKeyInput?.value) {
      sessionStorage.setItem("aivis_api_key", aivisApiKeyInput.value);
    } else {
      sessionStorage.removeItem("aivis_api_key");
    }

    updateMicButtonState();
    updateSendButtonState();
    updateBottomMicButtonState();
    updateBottomSendButtonState();
  }

  /**
   * 送信ボタンの有効/無効を更新する。
   */
  function updateSendButtonState() {
    if (!sendButton) {
      return;
    }
    const isValid = validateApiKey();
    sendButton.disabled = !state.menuActive || !isValid || state.isProcessing || state.isRecording;
  }

  /**
   * Web画面下部のチャットメッセージエリアにシステムメッセージを追加する。
   * @param {string} message - 表示するメッセージ
   */
  function addBottomChatSystemMessage(message) {
    if (!bottomChatMessages) {
      return;
    }
    const systemEntry = `システム：${message}\n`;
    bottomChatMessages.textContent += systemEntry;
    // 自動スクロール
    bottomChatMessages.scrollTop = bottomChatMessages.scrollHeight;
  }

  /**
   * Web画面下部のマイクボタンの有効/無効を更新する。
   * APIキーが未入力でも押せるようにし、押された時にメッセージを表示する。
   */
  function updateBottomMicButtonState() {
    if (!bottomChatMicButton) {
      return;
    }
    // 録音中のみ無効化
    bottomChatMicButton.disabled = state.isRecording;
  }

  /**
   * Web画面下部の送信ボタンの有効/無効を更新する。
   * APIキーが未入力でも押せるようにし、押された時にメッセージを表示する。
   */
  function updateBottomSendButtonState() {
    if (!bottomChatSendButton) {
      return;
    }
    // 処理中または録音中のみ無効化
    bottomChatSendButton.disabled = state.isProcessing || state.isRecording;
  }

  /**
   * テキストメッセージを送信する。
   */
  async function handleSendMessage() {
    if (!validateApiKey()) {
      setChatStatus("有効なOpenAI APIキーを入力してください");
      return;
    }

    if (!textInput || !textInput.value.trim()) {
      setChatStatus("メッセージを入力してください");
      return;
    }

    // 送信ボタン押下時に「こっちにくる(正面)」アクションを実行
    if (actionMenu && typeof actionMenu.executeComeHereFrontAction === 'function') {
      try {
        await actionMenu.executeComeHereFrontAction();
        logMessage("Info", "[ChatMenu] こっちにくる(正面)アクションを実行しました", {
          context: "sendMessage",
        });
      } catch (error) {
        logMessage("Warn", "[ChatMenu] こっちにくる(正面)アクション実行エラー", {
          context: "sendMessage",
          error: error?.message ?? String(error),
        });
      }
    }

    const userMessage = textInput.value.trim();
    textInput.value = "";

    // ユーザーメッセージを表示
    appendTranscript(userMessage, "user");
    setChatStatus("AIが応答を生成中...");
    state.isProcessing = true;
    updateSendButtonState();

    try {
      const aiResponse = await sendMessageToAI(userMessage);
      appendTranscript(aiResponse, "ai");

      // TTSで音声再生
      setChatStatus("音声を生成中...");
      try {
        await textToSpeech(aiResponse);
        setChatStatus("完了");
      } catch (ttsError) {
        logMessage("Error", "TTS error", { error: ttsError });
        setChatStatus(`音声生成エラー: ${ttsError.message}`);
      }
    } catch (error) {
      logMessage("Error", "AI response error", { error: error });
      setChatStatus(`エラー: ${error.message}`);
    } finally {
      state.isProcessing = false;
      updateSendButtonState();
    }
  }

  /**
   * Web画面下部のマイクボタンのクリックハンドラー。
   */
  function handleBottomMicButtonClick() {
    if (!validateApiKey()) {
      addBottomChatSystemMessage("設定画面でAPIキーを入力してください");
      return;
    }

    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording(true); // true を渡してWeb画面下部からの呼び出しであることを示す
    }
  }

  /**
   * Web画面下部の送信ボタンのクリックハンドラー。
   */
  async function handleBottomSendMessage() {
    if (!validateApiKey()) {
      addBottomChatSystemMessage("設定画面でAPIキーを入力してください");
      return;
    }

    if (!bottomChatTextInput || !bottomChatTextInput.value.trim()) {
      addBottomChatSystemMessage("メッセージを入力してください");
      return;
    }

    // 送信ボタン押下時に「こっちにくる(正面)」アクションを実行
    if (actionMenu && typeof actionMenu.executeComeHereFrontAction === 'function') {
      try {
        await actionMenu.executeComeHereFrontAction();
        logMessage("Info", "[ChatMenu] こっちにくる(正面)アクションを実行しました", {
          context: "bottomSendMessage",
        });
      } catch (error) {
        logMessage("Warn", "[ChatMenu] こっちにくる(正面)アクション実行エラー", {
          context: "bottomSendMessage",
          error: error?.message ?? String(error),
        });
      }
    }

    const userMessage = bottomChatTextInput.value.trim();
    bottomChatTextInput.value = "";

    setChatStatus("AIが応答を生成中...");
    state.isProcessing = true;
    updateBottomSendButtonState();

    try {
      const aiResponse = await sendMessageToAI(userMessage);
      // AI応答のみをWeb画面下部のチャットエリアに追加
      if (bottomChatMessages) {
        const aiEntry = `${AI_NAME}：${aiResponse}\n`;
        bottomChatMessages.textContent += aiEntry;
        // 自動スクロール
        bottomChatMessages.scrollTop = bottomChatMessages.scrollHeight;
      }
      // 設定画面のトランスクリプトにも追加
      appendTranscript(userMessage, "user");
      appendTranscript(aiResponse, "ai");

      // TTSで音声再生
      setChatStatus("音声を生成中...");
      try {
        await textToSpeech(aiResponse);
        setChatStatus("完了");
      } catch (ttsError) {
        logMessage("Error", "TTS error", { error: ttsError });
        setChatStatus(`音声生成エラー: ${ttsError.message}`);
      }
    } catch (error) {
      logMessage("Error", "AI response error", { error: error });
      setChatStatus(`エラー: ${error.message}`);
    } finally {
      state.isProcessing = false;
      updateBottomSendButtonState();
    }
  }

  /**
   * メニューがアクティブになった際のハンドラー。
   * NOTE: このアプリはチャット専用のため、通常は常にアクティブ（true）です。
   * この関数は互換性のために残されていますが、実際には使用されていません。
   */
  function setMenuActive(active) {
    state.menuActive = !!active;
    if (!state.menuActive) {
      // メニューが非アクティブになったら録音を停止
      if (state.isRecording) {
        stopRecording();
      }
      // 音声再生を停止
      if (state.audioElement) {
        state.audioElement.pause();
        state.audioElement = null;
        state.isSpeaking = false;
      }
      // MediaSourceをクリーンアップ
      if (state.mediaSource) {
        try {
          if (state.mediaSource.readyState === "open") {
            state.mediaSource.endOfStream();
          }
        } catch (e) {
          // エラーは無視
        }
        state.mediaSource = null;
      }
      if (state.ttsAudioPlayer) {
        state.ttsAudioPlayer.stop();
        state.isSpeaking = false;
      }
      setChatStatus("");
      if (chatTranscript) {
        chatTranscript.textContent = "";
      }
      // チャット履歴をクリア
      state.chatHistory = [];
      state.isProcessing = false;
      return;
    }
    updateMicButtonState();
    updateSendButtonState();
  }

  /**
   * VRM 読み込み完了時の処理。
   */
  function handleVrmReady() {
    if (state.menuActive) {
      updateMicButtonState();
    }
  }

  /**
   * VR用: 現在のAPIキーを取得する。
   */
  function getApiKey() {
    return state.apiKey;
  }

  /**
   * VR用: 録音中かどうかを取得する。
   */
  function isRecording() {
    return state.isRecording;
  }

  /**
   * VR用: 音声録音を開始する。
   * @param {Function} onTranscriptCallback - テキスト認識完了時のコールバック (text: string) => void
   * @param {Function} onErrorCallback - エラー発生時のコールバック (error: Error) => void
   */
  async function startVrRecording(onTranscriptCallback, onErrorCallback) {
    if (state.isRecording) {
      return;
    }

    logMessage("Info", "[ChatMenu][VR] マイクボタン押下", {
      context: "vrMenu",
    });

    if (!state.apiKey) {
      onErrorCallback?.(new Error("APIキーが設定されていません"));
      return;
    }

    if (actionMenu && typeof actionMenu.executeComeHereFrontAction === "function") {
      try {
        await actionMenu.executeComeHereFrontAction();
        logMessage("Info", "[ChatMenu][VR] こっちにくる(正面)アクションを実行しました", {
          context: "vrMenu",
        });
      } catch (error) {
        logMessage("Warn", "[ChatMenu][VR] こっちにくる(正面)アクション実行エラー", {
          context: "vrMenu",
          error: error?.message ?? String(error),
        });
      }
    }

    await ensureAudioContextUnlocked("startVrRecording");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];

      const options = { mimeType: "audio/webm" };
      state.mediaRecorder = new MediaRecorder(stream, options);

      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          state.audioChunks.push(event.data);
        }
      };

      state.mediaRecorder.onstop = async () => {
        // 音声ストリームを停止
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(state.audioChunks, { type: "audio/webm" });
        state.audioChunks = [];

        try {
          const transcription = await transcribeAudio(audioBlob);
          // コールバックを呼ぶ前に録音状態をクリア
          state.isRecording = false;

          if (transcription) {
            // Web版のトランスクリプトにも追加
            appendTranscript(transcription, "user");

            // AIに送信して応答を取得
            state.isProcessing = true;
            try {
              const aiResponse = await sendMessageToAI(transcription);
              appendTranscript(aiResponse, "ai");

              // VRコールバックにはユーザーメッセージとAI応答の両方を通知（音声再生前に即座に表示）
              onTranscriptCallback?.({ user: transcription, ai: aiResponse });

              // TTSで音声再生
              try {
                await textToSpeech(aiResponse);
              } catch (ttsError) {
                logMessage("Error", "VR TTS error", { error: ttsError });
              }
            } catch (aiError) {
              logMessage("Error", "VR AI response error", { error: aiError });
              onErrorCallback?.(aiError);
            } finally {
              state.isProcessing = false;
            }
          } else {
            onErrorCallback?.(new Error("音声を認識できませんでした"));
          }
        } catch (error) {
          logMessage("Error", "VR Transcription error", { error: error });
          state.isRecording = false;
          onErrorCallback?.(error);
        }
      };

      state.mediaRecorder.start();
      state.isRecording = true;
    } catch (error) {
      const normalizedError = normalizeMicPermissionError(error);
      logMessage("Error", "VR Recording error", { error: normalizedError });
      state.isRecording = false;
      onErrorCallback?.(normalizedError);
    }
  }

  /**
   * VR用: 音声録音を停止する。
   */
  function stopVrRecording() {
    if (!state.isRecording || !state.mediaRecorder) {
      return;
    }
    state.mediaRecorder.stop();
  }

  // イベントリスナーの設定
  micButton?.addEventListener("click", handleMicButtonClick);
  apiKeyInput?.addEventListener("input", handleApiKeyChange);
  aivisApiKeyInput?.addEventListener("input", handleApiKeyChange);
  sendButton?.addEventListener("click", handleSendMessage);

  // Web画面下部のチャット要素のイベントリスナー
  bottomChatMicButton?.addEventListener("click", handleBottomMicButtonClick);
  bottomChatSendButton?.addEventListener("click", handleBottomSendMessage);

  // 初期状態を設定
  updateBottomMicButtonState();
  updateBottomSendButtonState();

  /**
   * VR用のサンプル音声を取得して再生する。
   * @returns {Promise<void>}
   */
  async function playSampleAudio() {
    if (!state.ttsAudioPlayer) {
      throw new Error("TTSプレーヤーが利用できません");
    }

    const response = await fetch("./mp3/aivis_sample.mp3");
    if (!response.ok) {
      throw new Error(`サンプル音声の取得に失敗しました (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    await state.ttsAudioPlayer.playArrayBuffer(buffer);
  }

  return {
    setMenuActive,
    handleVrmReady,
    // VR用API
    getApiKey,
    isRecording,
    startVrRecording,
    stopVrRecording,
    playSampleAudio,
  };
}
