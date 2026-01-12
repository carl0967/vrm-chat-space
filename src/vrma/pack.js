import { inflate } from "https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm";
import { logMessage } from "../utils/logger.js";

const PACK_MAGIC = "VRMP";
const PACK_VERSION = 1;
const PACK_HEADER_SIZE = 18;
const PACK_FLAG_DEFLATE = 0x01;
const PACK_FLAG_SCRAMBLED = 0x02;
const PACK_XOR_BASE = 0x5a;
const PACK_XOR_MOD = 251;
const asciiDecoder = new TextDecoder("ascii");

export function decodePackedVrma(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < PACK_HEADER_SIZE) {
    throw new Error("VRMA パックのヘッダーが壊れています");
  }
  const view = new DataView(buffer);
  const magic = asciiDecoder.decode(bytes.subarray(0, 4));
  if (magic !== PACK_MAGIC) {
    throw new Error("未知の VRMA パック形式です");
  }
  const version = view.getUint8(4);
  if (version !== PACK_VERSION) {
    throw new Error(`サポートされていない VRMA パックバージョン: ${version}`);
  }
  const flags = view.getUint8(5);
  const chunkCount = view.getUint32(6, true);
  const originalLength = view.getUint32(10, true);
  const compressedLength = view.getUint32(14, true);
  let offset = PACK_HEADER_SIZE;
  let written = 0;
  const combined = new Uint8Array(compressedLength);

  for (let i = 0; i < chunkCount; i++) {
    if (offset + 4 > bytes.length) {
      throw new Error("VRMA パックのチャンク長が不正です");
    }
    const chunkLength = view.getUint32(offset, true);
    offset += 4;
    if (offset + chunkLength > bytes.length) {
      throw new Error("VRMA パックのチャンクデータが短すぎます");
    }
    const chunk = bytes.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    for (let j = 0; j < chunkLength; j++) {
      const key = (PACK_XOR_BASE + ((written + j) % PACK_XOR_MOD)) & 0xff;
      combined[written + j] = chunk[j] ^ key;
    }
    written += chunkLength;
  }

  if (written !== compressedLength) {
    throw new Error("VRMA パックのチャンク長とヘッダー情報が一致しません");
  }

  let restored = combined;
  if (flags & PACK_FLAG_DEFLATE) {
    restored = inflate(combined);
  }
  if (restored.length !== originalLength) {
    logMessage("Warn", "VRMA パックの展開サイズが想定と異なります", {
      actualLength: restored.length,
      expectedLength: originalLength
    });
  }
  return restored.buffer.slice(restored.byteOffset, restored.byteOffset + restored.byteLength);
}
