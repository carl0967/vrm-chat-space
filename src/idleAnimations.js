import { getAnimationFileByLabel } from "./vrma/loader.js";

// 待機アニメーションファイルのキャッシュ
let idleFilesCache = null;

/**
 * manifest.jsonから待機アニメーションファイルを取得する。
 * @param {string} vrmaBasePath - VRMAファイルのベースパス
 * @returns {Promise<string[]>} 待機アニメーションファイルの配列
 */
async function loadIdleFiles(vrmaBasePath) {
  if (idleFilesCache) {
    return idleFilesCache;
  }

  const idle2Long = await getAnimationFileByLabel("Idle2 long", vrmaBasePath);
  const idle2LongAlt = await getAnimationFileByLabel("Idle2 long alt", vrmaBasePath);

  idleFilesCache = [idle2Long, idle2LongAlt].filter(file => file != null);

  if (idleFilesCache.length === 0) {
    throw new Error("manifest.jsonに待機アニメーションが見つかりません");
  }

  return idleFilesCache;
}

/**
 * ランダム移動中の待機フェーズでも待機メニューと同じ長尺 Idle を再生する。
 * @param {string} vrmaBasePath - VRMAファイルのベースパス
 * @returns {Promise<string[]>} ランダムモード用の待機アニメーションファイルの配列
 */
export async function getRandomIdleFiles(vrmaBasePath) {
  return loadIdleFiles(vrmaBasePath);
}

/**
 * 待機アニメーションメニュー用。ランダムモードと完全一致させる。
 * @param {string} vrmaBasePath - VRMAファイルのベースパス
 * @returns {Promise<string[]>} 待機アニメーションファイルの配列
 */
export async function getIdleTestLoopFiles(vrmaBasePath) {
  return loadIdleFiles(vrmaBasePath);
}

// Idle 切り替え時に確保するクロスフェード重なり秒数
export const IDLE_OVERLAP_SECONDS = 0.5;

/**
 * Idle 切り替えタイミングを一定に保つ。
 * 0.0s: Idle2 を開始 (長さ 2.9s) → 2.4s 時点で Idle2_2 を再生開始。
 * 両者は 0.5s 分クロスフェードし、2.9s で Idle2 が終わる。
 * その後 4.8s (= 2.4 + 2.4) で Idle2 が再度始まり、同じく 0.5s の重なりが発生する。
 *
 * @param {number} clipDuration - クリップの実長
 * @returns {number} 次の Idle を開始するまでの秒数
 */
export function calculateIdleSwitchDelay(clipDuration) {
  const duration = Math.max(clipDuration || 2.9, 0.6);
  const safeOverlap = Math.min(IDLE_OVERLAP_SECONDS, Math.max(duration - 0.1, 0.1));
  return Math.max(duration - safeOverlap, 0.1);
}
