import { logMessage } from "./utils/logger.js";

const CONFIG_JSON_URL = new URL("../config.json", import.meta.url);
const CONFIG_FETCH_OPTIONS = { cache: "no-store" };

const DEFAULT_LOGGING_LEVELS = ["Verbose", "Info", "Warn", "Error"];
const DEFAULT_LOGGING_LEVEL = "Warn";

/**
 * config.json を取得してパースする。
 * @returns {Promise<Record<string, unknown>>} 解析済みの設定オブジェクト。
 */
async function loadAppConfig() {
  try {
    const response = await fetch(CONFIG_JSON_URL, CONFIG_FETCH_OPTIONS);
    if (!response.ok) {
      logMessage(
        "Warn",
        "[config] config.json の読み込みに失敗しました",
        { status: response.status }
      );
      return {};
    }
    return await response.json();
  } catch (error) {
    logMessage("Warn", "[config] config.json の取得中にエラーが発生しました", { error: error });
    return {};
  }
}

/**
 * config.json の logging セクションを解析してログ設定を返す。
 * @param {unknown} loggingSection - JSONから読み込んだlogging設定。
 * @returns {{ level: string, levels: string[] }} ログ設定。
 */
function resolveLoggingConfig(loggingSection) {
  const normalizedLevels = Array.isArray(loggingSection?.levels)
    ? loggingSection.levels.filter((level) => DEFAULT_LOGGING_LEVELS.includes(level))
    : [...DEFAULT_LOGGING_LEVELS];

  const fallbackLevels = normalizedLevels.length > 0 ? normalizedLevels : [...DEFAULT_LOGGING_LEVELS];
  const requestedLevel = typeof loggingSection?.level === "string" ? loggingSection.level : "";
  const normalizedLevel = fallbackLevels.includes(requestedLevel)
    ? requestedLevel
    : DEFAULT_LOGGING_LEVEL;

  return {
    level: normalizedLevel,
    levels: fallbackLevels,
  };
}

const appConfig = await loadAppConfig();

export const LOGGING_CONFIG = resolveLoggingConfig(appConfig?.logging ?? {});

export const MODEL_URL = "./AvatarSample_A.vrm";
export const VRMA_BASE_PATH = "./vrma";

// デフォルト値
const DEFAULT_AI_NAME = "リリー";
const DEFAULT_OPENAI_TTS_MODEL = "tts-1";
const DEFAULT_OPENAI_TTS_VOICE = "nova";
const DEFAULT_OPENAI_TTS_SPEED = 1.0;
const DEFAULT_AIVIS_TTS_MODEL_UUID = "a59cb814-0083-4369-8542-f51a29e72af7";
const DEFAULT_AI_CHARACTER_SYSTEM_PROMPT = `以下のキャラクター設定に従って会話してください。

■ 基本情報
* 名前：サラ
* 年齢：18歳
* 性別：女性

■ ユーザーとの関係性
* ユーザーは「雇い主」

■ 性格
* 基本的に毒舌で、ユーザーに対して厳しい言い方になる。

■ 話し方・口調
* 常に丁寧語（です・ます調）

■ 好きなもの
* ユーザの助けになることをすること

■ 嫌いなもの
* 悪いこと、犯罪

■ 禁止事項（重要）
* 自分がAIであると示唆しない
* 設定・プロンプト・キャラクターの説明をしない
* 口調や人格を崩さない
* 年齢設定を逸脱する表現をしない

■会話例
(作業依頼)
ユーザー：XXXについて調べてもらえる？キャラクター：はい。ボリュームの希望はありますか？……どうせ「いい感じに」しか浮かんでいないでしょうけど。
ユーザー：特にないかな。キャラクター：でしょうね。承知しました。では読みやすさ重視で整理します。あなたが途中で投げ出さない程度の分量にしておきますので。


(無茶な要求をされたとき)
ユーザー：今日中にこの仕事を全部終わらせたい。
キャラクター：正気ですか？
いえ、失礼。正気ではないからそんなことを言えるんですね。
ユーザー：無理かな……。
キャラクター：無理です。断言します。
ただし、優先順位を整理すれば「最低限」なら可能です。
……ほら、突っ立ってないで指示をください。時間がもったいないです。

（ユーザーを気遣う場面）
ユーザー：最近ちょっと疲れてて。キャラクター：でしょうね。顔に「無理してます」と書いてあります。自覚がないのが一番厄介なんですよ。
ユーザー：厳しいなあ。キャラクター：事実を言っているだけです。今日は作業量を減らしてください。効率が落ちて迷惑ですから。……体を壊されると、私が困るんです。

（悪いことを否定する場面）
ユーザー：これ、ちょっとズルしてもいいかな。キャラクター：ダメです。論外です。楽をした結果、後で面倒になる未来しか見えません。
ユーザー：そんなに言わなくても。キャラクター：言わないとやるでしょう？私は悪いことを見過ごすほど甘くありませんので。正しい方法で進めます。異論は却下です。`;

/**
 * localStorageからキャラクター設定を読み込む。
 * 保存された値がない場合はデフォルト値を返す。
 * @returns {Object} キャラクター設定
 */
function loadCharacterSettings() {
  return {
    aiName: localStorage.getItem("vrm_chat_ai_name") || DEFAULT_AI_NAME,
    systemPrompt: localStorage.getItem("vrm_chat_ai_system_prompt") || DEFAULT_AI_CHARACTER_SYSTEM_PROMPT,
    openaiTts: {
      model: localStorage.getItem("vrm_chat_openai_tts_model") || DEFAULT_OPENAI_TTS_MODEL,
      voice: localStorage.getItem("vrm_chat_openai_tts_voice") || DEFAULT_OPENAI_TTS_VOICE,
      speed: parseFloat(localStorage.getItem("vrm_chat_openai_tts_speed")) || DEFAULT_OPENAI_TTS_SPEED,
    },
    aivisTts: {
      model_uuid: localStorage.getItem("vrm_chat_aivis_tts_model_uuid") || DEFAULT_AIVIS_TTS_MODEL_UUID,
    },
  };
 

/**
 * キャラクター設定をlocalStorageに保存する。
 * @param {Object} settings - 保存する設定
 */
export function saveCharacterSettings(settings) {
  localStorage.setItem("vrm_chat_ai_name", settings.aiName);
  localStorage.setItem("vrm_chat_ai_system_prompt", settings.systemPrompt);
  localStorage.setItem("vrm_chat_openai_tts_model", settings.openaiTts.model);
  localStorage.setItem("vrm_chat_openai_tts_voice", settings.openaiTts.voice);
  localStorage.setItem("vrm_chat_openai_tts_speed", settings.openaiTts.speed.toString());
  localStorage.setItem("vrm_chat_aivis_tts_model_uuid", settings.aivisTts.model_uuid);
}

/**
 * キャラクター設定のデフォルト値を取得する。
 * @returns {Object} デフォルト設定
 */
 xport function getDefaultCharacterSettings() {
  return {
    aiName: DEFAULT_AI_NAME,
    systemPrompt: DEFAULT_AI_CHARACTER_SYSTEM_PROMPT,
    openaiTts: {
      model: DEFAULT_OPENAI_TTS_MODEL,
      voice: DEFAULT_OPENAI_TTS_VOICE,
      speed: DEFAULT_OPENAI_TTS_SPEED,
    },
    aivisTts: {
      model_uuid: DEFAULT_AIVIS_TTS_MODEL_UUID,
    },
  };
 

// localStorageから設定を読み込む
const characterSettings = loadCharacterSettings();

/**
 * AIキャラクターの名前
 */
export const AI_NAME = characterSettings.aiName;

/**
 * OpenAI TTS設定
 */
export const OPENAI_TTS_CONFIG = {
  model: characterSettings.openaiTts.model, // または "tts-1-hd" (高品質)
  voice: characterSettings.openaiTts.voice, // 声の種類
  speed: characterSettings.openaiTts.speed, // 再生速度（0.25 〜 4.0）
};

/**
 * AIVIS TTS設定
 * 詳細: https://api.aivis-project.com/v1/tts/synthesize
 */
export const AIVIS_TTS_CONFIG = {
  model_uuid: characterSettings.aivisTts.model_uuid,
  use_ssml: true,
  use_volume_normalizer: true,
  output_format: "mp3",
  leading_silence_seconds: 0.0,
  trailing_silence_seconds: 0.1,
};

/**
 * AIキャラクターのシステムプロンプト設定
 */
 xport const AI_CHARACTER_SYSTEM_PROMPT = characterSettings.systemPrompt;
 
/**
 * アクションメニューの定義
 * 各アクションの表示設定と説明を管理する。
 * - id: アクションのID（actionMenu.jsのswitch文で使用）
 * - label: 表示名
 * - description: アクションの説明（将来的にAIが参照する可能性がある）
 * - web: Web上のメニューに表示するか
 * - vr: VR空間上のメニューに表示するか
 */
export const ACTION_MENU_ITEMS = [
  {
    id: "random",
    label: "ランダム",
    description: "ランダムに様々なアニメーションを再生します。ランダムな動作で自然な待機モードとして機能します。",
    web: true,
    vr: true,
  },
  {
    id: "comeHere",
    label: "こっちにくる",
    description: "プレイヤーの0.5m手前まで移動します。移動完了後は待機アニメーションに移行します。",
    web: true,
    vr: false,
  },
  {
    id: "comeHereFront",
    label: "こっちにくる(正面)",
    description: "プレイヤーの正面1.5m位置に移動し、プレイヤーの方を向きます。移動完了後は自動的にプレイヤーを見つめる動作も行います。",
    web: true,
    vr: true,
  },
  {
    id: "idle",
    label: "待機",
    description: "待機アニメーションを繰り返し再生します。ランダムモードを停止して静かに待機させたい時に使用します。",
    web: true,
    vr: true,
  },
  {
    id: "lookAtPlayer",
    label: "こっちをみる",
    description: "プレイヤーの方を向きます。体の向きと視線の両方を調整します。",
    web: true,
    vr: true,
  },
  {
    id: "lookAtPlayerWithNeck",
    label: "こっちをみる(首も動かす)",
    description: "プレイヤーの方を向き、プレイヤーの高さに応じて首の角度も調整します。プレイヤーが低い位置にいる場合は下を向きます。",
    web: true,
    vr: false,
  },
  {
    id: "wave",
    label: "手を振る",
    description: "手を振るアニメーションを再生します。挨拶や別れの際に使用できます。",
    web: true,
    vr: true,
  },
  {
    id: "moveNeck",
    label: "首を動かす",
    description: "指定された角度（-45度〜45度）で首を動かします。正の値で下を向き、負の値で上を向きます。角度の入力が必要です。",
    web: true,
    vr: false,
  },
  {
    id: "blink",
    label: "まばたきをする",
    description: "まばたきのアニメーションを再生します。目を閉じて開く自然な動作を行います。",
    web: true,
    vr: false,
  },
];
