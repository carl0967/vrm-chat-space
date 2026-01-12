// 共通処理を集約したモジュール（バージョン表示や汎用 UI ユーティリティ）

import { logMessage } from "./utils/logger.js";

/**
 * ステータス表示用のテキストを更新する。
 */
export function setStatusText(element, text) {
  if (!element) {
    return;
  }
  element.textContent = text || "";
}

/**
 * バージョン表示のラベルとツールチップを更新する。
 */
export function setVersionLabel(element, value, tooltip) {
  if (!element) {
    return;
  }
  element.textContent = value;
  element.title = tooltip || "";
}

/**
 * バージョン値を X.X.X 形式に正規化する。
 */
export function formatSemver(value, fallback = "0.0.0") {
  if (value == null) {
    return fallback;
  }
  const text = String(value).trim();
  if (!text) {
    return fallback;
  }
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return fallback;
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2] ?? "0", 10);
  const patch = Number.parseInt(match[3] ?? "0", 10);
  if ([major, minor, patch].some((num) => Number.isNaN(num))) {
    return fallback;
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * バージョン情報を読み込み、表示要素に反映する。
 */
export async function loadVersionInfo(versionLabelElement, versionPath = "./version.json") {
  if (!versionLabelElement) {
    return;
  }
  try {
    const res = await fetch(versionPath, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`version.json load failed: ${res.status}`);
    }
    const data = await res.json();
    const versionValue = data?.version;
    const normalizedVersion = versionValue != null ? formatSemver(versionValue) : null;
    const label = normalizedVersion ? `Ver. ${normalizedVersion}` : "Ver. --";
    const lastDeployedAt = data?.lastDeployedAt;
    let tooltip = "";
    if (lastDeployedAt) {
      const parsed = new Date(lastDeployedAt);
      if (!Number.isNaN(parsed.valueOf())) {
        tooltip = `最終デプロイ: ${parsed.toLocaleString()}`;
      }
    }
    setVersionLabel(versionLabelElement, label, tooltip);
  } catch (err) {
    logMessage("Warn", "version info load error", { error: err });
    setVersionLabel(versionLabelElement, "Ver. --", "バージョン情報の取得に失敗しました");
  }
}

/**
 * 更新履歴ファイルを読み込み、配列として返す。
 */
export async function loadVersionHistory(historyPath = "./version_history.json") {
  const res = await fetch(historyPath, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`version_history.json load failed: ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}
