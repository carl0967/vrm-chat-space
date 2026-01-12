import * as THREE from "three";
import { logMessage } from "../utils/logger.js";

/**
 * Text to Speech音声をWebXRの3D空間音響（PositionalAudio）として再生するプレーヤー。
 * VRヘッドセットでも正しく音声が再生されるよう、THREE.AudioListenerをカメラに追加し、
 * 音源をVRMモデルの位置にアタッチすることで、モデルのいる位置から音が聞こえるようにします。
 */
export class TtsAudioPlayer {
  /**
   * @param {{ camera: THREE.Camera, renderer?: THREE.WebGLRenderer, audioTarget?: THREE.Object3D }} options
   */
  constructor(options = {}) {
    const { camera, renderer, audioTarget } = options;
    if (!camera) {
      throw new Error("TtsAudioPlayer: camera is required");
    }
    this.camera = camera;
    this.renderer = renderer || null;
    this.audioTarget = audioTarget || null; // 音源をアタッチする対象（VRMモデルのルートシーンなど）

    logMessage("Info", "[TtsAudioPlayer] 初期化: AudioListenerをカメラに追加します");
    this.audioListener = new THREE.AudioListener();

    // PositionalAudioを使用して3D空間音響を実現
    this.audioSource = new THREE.PositionalAudio(this.audioListener);
    this.audioSource.setLoop(false);
    this.audioSource.setVolume(1.0);

    // 音の距離減衰パラメータを設定
    // refDistance: この距離までは音量が最大（デフォルト1）
    // maxDistance: この距離を超えると音量が0になる（デフォルト10000）
    // rolloffFactor: 距離による減衰の強さ（デフォルト1、大きいほど急激に減衰）
    this.audioSource.setRefDistance(1.5); // VR空間で1.5m以内は最大音量
    this.audioSource.setMaxDistance(10); // 10m離れると聞こえなくなる
    this.audioSource.setRolloffFactor(1.2); // やや急な減衰

    // 音源を指定された対象にアタッチ（後から設定することも可能）
    if (this.audioTarget) {
      this.audioTarget.add(this.audioSource);
      logMessage("Info", "[TtsAudioPlayer] 音源をオブジェクトにアタッチしました");
    }

    if (this.renderer?.xr?.setAudioListener) {
      this.renderer.xr.setAudioListener(this.audioListener);
      logMessage("Info", "[TtsAudioPlayer] renderer.xr.setAudioListener を設定しました");
    }

    this.activeSourceNode = null;
    this.currentPlayback = null;

    this.onSessionStart = () => this.handleSessionStart();
    this.onSessionEnd = () => this.handleSessionEnd();
    this.attachListenerToCamera(this.camera);
    this.registerXrEvents();
    logMessage("Info", "[TtsAudioPlayer] 初期化完了");
  }

  /**
   * AudioListenerを指定のカメラに付け替える。
   * @param {THREE.Object3D} targetCamera
   */
  attachListenerToCamera(targetCamera) {
    if (!targetCamera) {
      logMessage("Warn", "[TtsAudioPlayer] attachListenerToCamera: targetCameraが未定義");
      return;
    }
    if (this.audioListener.parent === targetCamera) {
      return;
    }
    if (this.audioListener.parent) {
      this.audioListener.parent.remove(this.audioListener);
    }
    targetCamera.add(this.audioListener);
    logMessage("Info", "[TtsAudioPlayer] AudioListenerをカメラへアタッチ", {
      cameraType: targetCamera.type,
      name: targetCamera.name,
    });
  }

  /**
   * 音源のアタッチ先を設定する。
   * VRMモデルのロード後など、後から音源の位置を変更する際に使用する。
   * @param {THREE.Object3D} target - 音源をアタッチする対象オブジェクト
   */
  setAudioTarget(target) {
    if (!target) {
      logMessage("Warn", "[TtsAudioPlayer] setAudioTarget: targetが未定義");
      return;
    }
    // 既に別のオブジェクトにアタッチされている場合は取り外す
    if (this.audioSource.parent) {
      this.audioSource.parent.remove(this.audioSource);
    }
    // 新しいターゲットにアタッチ
    target.add(this.audioSource);
    this.audioTarget = target;
    logMessage("Info", "[TtsAudioPlayer] 音源のアタッチ先を変更しました", {
      targetType: target.type,
      targetName: target.name || "(unnamed)",
    });
  }

  /**
   * XRセッション開始/終了イベントを監視してAudioListenerの付け替えを行う。
   */
  registerXrEvents() {
    if (!this.renderer?.xr) {
      return;
    }
    this.renderer.xr.addEventListener("sessionstart", this.onSessionStart);
    this.renderer.xr.addEventListener("sessionend", this.onSessionEnd);
  }

  handleSessionStart() {
    logMessage("Info", "[TtsAudioPlayer] XR session start: AudioListenerをXRカメラへ移動します");
    const xrCamera =
      this.renderer?.xr?.getCamera?.(this.camera) ?? this.renderer?.xr?.getCamera?.();
    if (!xrCamera) {
      logMessage("Warn", "[TtsAudioPlayer] XR session start: XRカメラ取得に失敗");
      return;
    }
    if (xrCamera.isArrayCamera && xrCamera.cameras?.length > 0) {
      this.attachListenerToCamera(xrCamera.cameras[0]);
    } else {
      this.attachListenerToCamera(xrCamera);
    }
  }

  handleSessionEnd() {
    logMessage("Info", "[TtsAudioPlayer] XR session end: AudioListenerを通常カメラへ戻します");
    this.attachListenerToCamera(this.camera);
  }

  /**
   * ArrayBufferのMP3データをデコードして再生する。再生が完了するまで解決しないPromiseを返す。
   * @param {ArrayBuffer} arrayBuffer - MP3バイナリデータ
   * @returns {Promise<void>}
   */
  async playArrayBuffer(arrayBuffer) {
    if (!arrayBuffer) {
      throw new Error("TtsAudioPlayer: audio data is empty");
    }

    logMessage("Info", "[TtsAudioPlayer] 再生要求: ArrayBuffer bytes=", { bytes: arrayBuffer.byteLength });
    const context = this.audioListener.context;
    if (context?.state === "suspended") {
      logMessage("Info", "[TtsAudioPlayer] AudioContextがsuspendedのためresumeを要求");
      try {
        await context.resume();
      } catch (error) {
        logMessage(
          "Warn",
          "[TtsAudioPlayer] AudioContext resume失敗: ブラウザに再生が拒否された可能性があります",
          { error: error }
        );
      }
    }

    // soundサンプルと同じく「THREE.Audio + decoded AudioBuffer」を使うことで
    // WebXR/非XR双方で一貫した再生パスを確保する。
    const audioBuffer = await this.decodeArrayBuffer(arrayBuffer);
    if (!audioBuffer) {
      throw new Error("TtsAudioPlayer: failed to decode audio");
    }
    this.stop();
    this.audioSource.setBuffer(audioBuffer);
    logMessage("Info", "[TtsAudioPlayer] AudioBuffer duration=", { duration: audioBuffer.duration });

    return new Promise((resolve, reject) => {
      this.currentPlayback = { resolve, reject };
      try {
        logMessage("Info", "[TtsAudioPlayer] 再生開始");
        this.audioSource.play();
      } catch (error) {
        logMessage("Error", "[TtsAudioPlayer] 再生開始に失敗", { error: error });
        this.currentPlayback = null;
        reject(error);
        return;
      }

      const sourceNode = this.audioSource.source;
      if (!sourceNode) {
        this.currentPlayback = null;
        resolve();
        return;
      }

      this.activeSourceNode = sourceNode;
      sourceNode.onended = () => {
        logMessage("Info", "[TtsAudioPlayer] 再生完了");
        sourceNode.onended = null;
        this.activeSourceNode = null;
        if (this.currentPlayback) {
          this.currentPlayback.resolve();
          this.currentPlayback = null;
        }
      };
    });
  }

  /**
   * AudioContextを用いてArrayBufferからAudioBufferへデコードする。
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<AudioBuffer>}
   */
  async decodeArrayBuffer(arrayBuffer) {
    const audioContext = this.audioListener.context;
    if (!audioContext) {
      throw new Error("TtsAudioPlayer: audio context is unavailable");
    }

    logMessage("Info", "[TtsAudioPlayer] decodeArrayBuffer開始");
    if (typeof audioContext.decodeAudioData === "function" && audioContext.decodeAudioData.length <= 1) {
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      logMessage("Info", "[TtsAudioPlayer] decodeArrayBuffer成功( Promise )");
      return decoded;
    }

    return await new Promise((resolve, reject) => {
      audioContext.decodeAudioData(
        arrayBuffer,
        (decoded) => {
          logMessage("Info", "[TtsAudioPlayer] decodeArrayBuffer成功( callback )");
          resolve(decoded);
        },
        (error) => {
          logMessage("Error", "[TtsAudioPlayer] decodeArrayBuffer失敗", { error: error });
          reject(error);
        }
      );
    });
  }

  /**
   * 再生中の音声を停止し、待機中のPromiseを解決しておく。
   */
  stop() {
    logMessage("Info", "[TtsAudioPlayer] stop() 呼び出し");
    if (this.audioSource?.isPlaying) {
      logMessage("Info", "[TtsAudioPlayer] 再生中の音声を停止");
      this.audioSource.stop();
    }
    if (this.activeSourceNode) {
      this.activeSourceNode.onended = null;
      this.activeSourceNode = null;
    }
    if (this.currentPlayback) {
      this.currentPlayback.resolve();
      this.currentPlayback = null;
    }
  }

  /**
   * AudioListenerとAudioリソースを解放する。
   */
  dispose() {
    logMessage("Info", "[TtsAudioPlayer] dispose() 呼び出し");
    this.stop();
    if (this.renderer?.xr) {
      this.renderer.xr.removeEventListener("sessionstart", this.onSessionStart);
      this.renderer.xr.removeEventListener("sessionend", this.onSessionEnd);
    }
    // 音源をアタッチ先から取り外す
    if (this.audioSource?.parent) {
      this.audioSource.parent.remove(this.audioSource);
    }
    if (this.audioListener?.parent) {
      this.audioListener.parent.remove(this.audioListener);
    }
    this.audioSource?.disconnect?.();
    this.audioSource = null;
    this.audioListener = null;
    this.audioTarget = null;
    this.camera = null;
  }
}
