import { LOGGING_CONFIG } from "../config.js";

const LEVEL_PRIORITY = {
  Verbose: 0,
  Info: 1,
  Warn: 2,
  Error: 3,
};

const LEVEL_METHOD = {
  Verbose: "log",
  Info: "log",
  Warn: "warn",
  Error: "error",
};

const ACTIVE_LEVEL = LOGGING_CONFIG?.level ?? "Warn";

/**
 * HH:mm:ss 形式のタイムスタンプを返す。
 * @param {Date} date - 任意指定の日付。省略時は現在時刻。
 * @returns {string} HH:mm:ss 形式の文字列。
 */
function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 指定レベルのログを出力すべきかどうかを判定する。
 * @param {string} level - 出力を試みるログレベル。
 * @returns {boolean} 出力すべき場合は true。
 */
function shouldLog(level) {
  const normalizedLevel = LOGGING_CONFIG?.levels?.includes(level)
    ? level
    : ACTIVE_LEVEL;
  return LEVEL_PRIORITY[normalizedLevel] >= LEVEL_PRIORITY[ACTIVE_LEVEL];
}

/**
 * 共通ログ関数。ログレベルとタイムスタンプを付与して console に出力する。
 * @param {"Verbose"|"Info"|"Warn"|"Error"} level - ログレベル。
 * @param {string} message - ログメッセージ。
 * @param {Record<string, unknown>} [details] - 追加情報。
 */
export function logMessage(level, message, details) {
  if (!shouldLog(level)) {
    return;
  }
  const timestamp = formatTimestamp();
  const method = LEVEL_METHOD[level] || "log";
  const consoleMessage = `[${timestamp}][${level}] ${message}`;
  if (details === undefined) {
    console[method](consoleMessage);
  } else {
    console[method](consoleMessage, details);
  }
}
