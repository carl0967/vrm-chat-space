import { GLTFLoader } from "https://unpkg.com/three@0.164.1/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm-animation@2.1.3/+esm";
import { decodePackedVrma } from "./pack.js";

const vrmaLoader = new GLTFLoader();
vrmaLoader.crossOrigin = "anonymous";
vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

/**
 * VRMA もしくは VRMAPACK を取得して元の ArrayBuffer を返す。
 */
async function loadAnimationBinary(basePath, file) {
  const res = await fetch(`${basePath}/${file}`);
  if (!res.ok) {
    throw new Error(`VRMA の取得に失敗しました: ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  const isPacked = file.toLowerCase().endsWith(".vrmapack");
  return isPacked ? decodePackedVrma(buffer) : buffer;
}

/**
 * GLTFLoader を用いて ArrayBuffer から VRMAnimation を取り出す。
 */
function parseAnimation(arrayBuffer, basePath) {
  if (typeof vrmaLoader.parseAsync === "function") {
    return vrmaLoader.parseAsync(arrayBuffer, `${basePath}/`);
  }
  return new Promise((resolve, reject) => {
    vrmaLoader.parse(arrayBuffer, `${basePath}/`, resolve, reject);
  });
}

/**
 * VRMA manifest を取得する。
 */
export async function fetchAnimationManifest(basePath) {
  const res = await fetch(`${basePath}/manifest.json`);
  if (!res.ok) {
    throw new Error(`manifest load failed: ${res.status}`);
  }
  return res.json();
}

/**
 * 指定された VRM と manifest エントリに基づき AnimationClip を生成する。
 */
export async function loadAnimationClip(file, basePath, vrm) {
  if (!vrm || !file) {
    return null;
  }
  const arrayBuffer = await loadAnimationBinary(basePath, file);
  const gltf = await parseAnimation(arrayBuffer, basePath);
  const vrmAnimation = gltf.userData?.vrmAnimations?.[0];
  if (!vrmAnimation) {
    throw new Error("VRMAnimation が見つかりません");
  }
  const clip = createVRMAnimationClip(vrmAnimation, vrm);
  clip.name = file;
  clip.userData = clip.userData || {};
  clip.userData.sourceFile = file;
  clip.userData.durationSeconds = typeof clip.duration === "number" ? clip.duration : null;
  return clip;
}
