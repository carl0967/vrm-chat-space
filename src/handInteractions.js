import * as THREE from "three";
import { XRControllerModelFactory } from "https://unpkg.com/three@0.164.1/examples/jsm/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "https://unpkg.com/three@0.164.1/examples/jsm/webxr/XRHandModelFactory.js";

const CUBE_SIZE = 0.08;
const CUBE_LIFETIME_SEC = 10;
const INITIAL_THROW_SPEED = 2.8;
const GRAVITY = -9.8 * 0.35;
const CUBE_RADIUS = CUBE_SIZE * 0.5;
const CUBE_RESTITUTION = 0.45;
const FLOOR_RESTITUTION = 0.4;
const LATERAL_DAMPING = 0.75;
const tempQuaternion = new THREE.Quaternion();
const tempDirection = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const sharedCubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
const tempParentQuaternion = new THREE.Quaternion();
const tempInverseParentQuaternion = new THREE.Quaternion();
const tempParentMatrixInverse = new THREE.Matrix4();
const tempBounds = new THREE.Box3();
const tempClosestPoint = new THREE.Vector3();
const tempNormal = new THREE.Vector3();
const tempSeparation = new THREE.Vector3();
const tempRelativeVelocity = new THREE.Vector3();
const tempRayOrigin = new THREE.Vector3();
const tempRayDirection = new THREE.Vector3();
const tempMatrix4 = new THREE.Matrix4();

/**
 * XR コントローラーとハンド入力を束ね、select イベント時にカラフルなキューブを生成するマネージャー。
 * また、ドラッグ可能なオブジェクトの管理も行う。
 */
export class HandInteractionManager {
  /**
   * コンストラクター。Three.js のシーンとレンダラー参照を受け取り状態を初期化する。
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [options]
   * @param {THREE.Object3D} [options.spawnParent] キューブなど動的オブジェクトをぶら下げる親
   * World グループに spawnParent を向けることで、ユーザー原点からオフセットされた環境に
   * 自動追従させることができる。
   * @param {number} [options.floorY=0] 床面の高さ（world 座標基準）
   * @param {(target: THREE.Box3) => THREE.Box3 | null | undefined} [options.characterColliderProvider]
   * キャラクターの当たり判定を返す関数。VRM 読み込み後に setCharacterColliderProvider で差し替え可能。
   */
  constructor(scene, renderer, options = {}) {
    /** @type {THREE.Scene} */
    this.scene = scene;
    /** @type {THREE.WebGLRenderer} */
    this.renderer = renderer;
    this.spawnParent = options.spawnParent || scene;
    this.floorY = typeof options.floorY === "number" ? options.floorY : 0;
    /** @type {((target: THREE.Box3) => THREE.Box3 | null | undefined) | null} */
    this.characterColliderProvider = options.characterColliderProvider || null;
    this.controllers = [];
    this.controllerGrips = [];
    this.hands = [];
    this.spawnedCubes = [];
    this.controllerModelFactory = new XRControllerModelFactory();
    this.handModelFactory = new XRHandModelFactory();
    this.handModelFactory.setPath("https://threejs.org/examples/models/gltf/Hand/glTF/");
    this.initialized = false;
    this.internalCharacterBounds = new THREE.Box3();
    this.selectGuards = [];
    this.pinchGuards = [];
    this.pinchEndGuards = [];
    /** キューブ発射が有効かどうか（デフォルトはfalse） */
    this.cubeSpawnEnabled = false;
    /** @type {Array<import('./vrui/draggable.js').Draggable>} ドラッグ可能なオブジェクトのリスト */
    this.draggableObjects = [];
    /** @type {THREE.Raycaster} ドラッグ検出用のレイキャスター */
    this.dragRaycaster = new THREE.Raycaster();
    /** @type {Map<THREE.Object3D, import('./vrui/draggable.js').Draggable>} ハンドごとに現在ドラッグ中のオブジェクト */
    this.currentDragTargets = new Map();
    /** @type {Map<THREE.Object3D, import('./vrui/draggable.js').Draggable>} ハンドごとに現在ホバー中のオブジェクト */
    this.currentHoverTargets = new Map();
  }

  /**
   * コントローラー・ハンドのセットアップを 1 度だけ実行する。
   */
  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    for (let i = 0; i < 2; i += 1) {
      this.setupController(i);
      this.setupControllerGrip(i);
      this.setupHand(i);
    }
  }

  /**
   * 指定 index のコントローラーにイベントハンドラとビジュアルを紐づける。
   * @param {number} index
   */
  setupController(index) {
    const controller = this.renderer.xr.getController(index);
    controller.addEventListener("selectstart", (event) => {
      if (!this.shouldHandleSelect(controller, event)) {
        return;
      }
      this.spawnCubeFrom(event.target);
    });
    controller.addEventListener("selectend", (event) => {
      // selectend イベント処理（必要に応じて実装）
    });
    controller.addEventListener("connected", (event) => {
      this.addControllerVisual(controller, event.data);
    });
    controller.addEventListener("disconnected", () => {
      while (controller.children.length > 0) {
        controller.remove(controller.children[0]);
      }
    });
    this.scene.add(controller);
    this.controllers.push(controller);
  }

  /**
   * selectstart ハンドリング前にガード関数を実行し、false が返ったら処理を中断する。
   * @param {THREE.Object3D} controller
   * @param {Event} event
   * @returns {boolean}
   */
  shouldHandleSelect(controller, event) {
    if (!this.selectGuards || this.selectGuards.length === 0) {
      return true;
    }
    for (let i = 0; i < this.selectGuards.length; i += 1) {
      const guard = this.selectGuards[i];
      if (typeof guard !== "function") {
        continue;
      }
      const result = guard(controller, event);
      if (result === false) {
        return false;
      }
    }
    return true;
  }

  /**
   * selectstart を横取りしたい処理を登録する。false を返すと既定の spawnCube がキャンセルされる。
   * @param {(controller: THREE.Object3D, event: Event) => boolean | void} guard
   * @returns {() => void} remove 関数
   */
  addSelectGuard(guard) {
    if (typeof guard !== "function") {
      return () => {};
    }
    this.selectGuards.push(guard);
    return () => {
      const index = this.selectGuards.indexOf(guard);
      if (index >= 0) {
        this.selectGuards.splice(index, 1);
      }
    };
  }

  /**
   * pinchstart 前にガード関数を実行し、false を返したガードがある場合は処理を打ち切る。
   * @param {THREE.Object3D} hand
   * @param {Event} event
   * @returns {boolean}
   */
  shouldHandlePinch(hand, event) {
    if (!this.pinchGuards || this.pinchGuards.length === 0) {
      return true;
    }
    for (let i = 0; i < this.pinchGuards.length; i += 1) {
      const guard = this.pinchGuards[i];
      if (typeof guard !== "function") {
        continue;
      }
      if (guard(hand, event) === false) {
        return false;
      }
    }
    return true;
  }

  /**
   * pinchstart を横取りしたい処理を登録する。false を返すと spawnCubeFromJoint がキャンセルされる。
   * @param {(hand: THREE.Object3D, event: Event) => boolean | void} guard
   * @returns {() => void}
   */
  addPinchGuard(guard) {
    if (typeof guard !== "function") {
      return () => {};
    }
    this.pinchGuards.push(guard);
    return () => {
      const index = this.pinchGuards.indexOf(guard);
      if (index >= 0) {
        this.pinchGuards.splice(index, 1);
      }
    };
  }

  /**
   * pinchend 前にガード関数を実行し、false を返したガードがある場合は処理を打ち切る。
   * @param {THREE.Object3D} hand
   * @param {Event} event
   * @returns {boolean}
   */
  shouldHandlePinchEnd(hand, event) {
    if (!this.pinchEndGuards || this.pinchEndGuards.length === 0) {
      return true;
    }
    for (let i = 0; i < this.pinchEndGuards.length; i += 1) {
      const guard = this.pinchEndGuards[i];
      if (typeof guard !== "function") {
        continue;
      }
      const result = guard(hand, event);
      if (result === false) {
        return false;
      }
    }
    return true;
  }

  /**
   * pinchend を横取りしたい処理を登録する。
   * @param {(hand: THREE.Object3D, event: Event) => boolean | void} guard
   * @returns {() => void}
   */
  addPinchEndGuard(guard) {
    if (typeof guard !== "function") {
      return () => {};
    }
    this.pinchEndGuards.push(guard);
    return () => {
      const index = this.pinchEndGuards.indexOf(guard);
      if (index >= 0) {
        this.pinchEndGuards.splice(index, 1);
      }
    };
  }

  /**
   * コントローラーグリップモデルを追加する。
   * @param {number} index
   */
  setupControllerGrip(index) {
    const grip = this.renderer.xr.getControllerGrip(index);
    grip.add(this.controllerModelFactory.createControllerModel(grip));
    this.scene.add(grip);
    this.controllerGrips.push(grip);
  }

  /**
   * ハンドメッシュを生成してシーンへ加える。
   * @param {number} index
   */
  setupHand(index) {
    const hand = this.renderer.xr.getHand(index);
    hand.add(this.handModelFactory.createHandModel(hand));
    hand.addEventListener("pinchstart", (event) => {
      if (!this.shouldHandlePinch(hand, event)) {
        return;
      }
      this.spawnCubeFromJoint(hand, "index-finger-tip");
    });
    hand.addEventListener("pinchend", (event) => {
      if (!this.shouldHandlePinchEnd(hand, event)) {
        return;
      }
    });
    this.scene.add(hand);
    this.hands.push(hand);
  }

  /**
   * 指定したハンドのジョイント位置からキューブを生成する。
   * @param {THREE.Object3D & { joints?: Record<string, THREE.Object3D> }} hand
   * @param {string} jointName
   */
  spawnCubeFromJoint(hand, jointName) {
    const joint = hand?.joints?.[jointName];
    if (!joint) {
      return;
    }
    this.spawnCubeFrom(joint);
  }

  /**
   * キューブ発射の有効/無効を設定する。
   * @param {boolean} enabled
   */
  setCubeSpawnEnabled(enabled) {
    this.cubeSpawnEnabled = !!enabled;
  }

  /**
   * キューブ発射が有効かどうかを返す。
   * @returns {boolean}
   */
  isCubeSpawnEnabled() {
    return this.cubeSpawnEnabled;
  }

  /**
   * コントローラーの targetRayMode に応じて目印となるビジュアルを差し込む。
   * @param {THREE.Object3D} controller
   * @param {XRInputSource} data
   */
  addControllerVisual(controller, data) {
    let geometry;
    let material;
    if (data.targetRayMode === "tracked-pointer") {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3)
      );
      geometry.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 0.3, 0.3, 0.3], 3));
      material = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending });
      controller.add(new THREE.Line(geometry, material));
    } else if (data.targetRayMode === "gaze") {
      geometry = new THREE.RingGeometry(0.02, 0.04, 32).translate(0, 0, -1);
      material = new THREE.MeshBasicMaterial({ opacity: 0.5, transparent: true });
      controller.add(new THREE.Mesh(geometry, material));
    }
  }

  /**
   * 指定オブジェクトの前方からランダムカラーのキューブを射出する。
   * @param {THREE.Object3D} sourceObject
   */
  spawnCubeFrom(sourceObject) {
    // キューブ発射が無効の場合は何もしない
    if (!this.cubeSpawnEnabled) {
      return;
    }
    const target = sourceObject ?? this.renderer.xr.getCamera();
    const parent = this.spawnParent || this.scene;
    if (typeof target.getWorldPosition === "function") {
      target.getWorldPosition(tempPosition);
    } else {
      tempPosition.setFromMatrixPosition(target.matrixWorld);
    }
    if (typeof target.getWorldQuaternion === "function") {
      target.getWorldQuaternion(tempQuaternion);
    } else {
      tempQuaternion.setFromRotationMatrix(target.matrixWorld);
    }
    tempDirection.set(0, 0, -1).applyQuaternion(tempQuaternion).normalize();

    if (parent && parent !== this.scene) {
      parent.updateWorldMatrix(true, false);
      // ハンド（scene 基準）→ world（spawnParent 基準）へ座標を変換し、
      // VR セッション中に world 全体へ加わる平行移動と矛盾しないようにする。
      parent.worldToLocal(tempPosition);
      parent.getWorldQuaternion(tempParentQuaternion);
      tempInverseParentQuaternion.copy(tempParentQuaternion).invert();
      tempQuaternion.premultiply(tempInverseParentQuaternion);
      tempDirection.applyQuaternion(tempInverseParentQuaternion);
    }

    const cubeMaterial = new THREE.MeshStandardMaterial({ color: this.getRandomColor(), roughness: 0.35, metalness: 0.15 });
    const cube = new THREE.Mesh(sharedCubeGeometry, cubeMaterial);
    cube.position.copy(tempPosition);
    cube.quaternion.copy(tempQuaternion);
    cube.userData.velocity = tempDirection.clone().multiplyScalar(INITIAL_THROW_SPEED);
    cube.userData.velocity.y += 0.6;
    cube.userData.life = CUBE_LIFETIME_SEC;
    cube.userData.radius = CUBE_RADIUS;
    parent.add(cube);
    this.spawnedCubes.push(cube);
  }

  /**
   * HSL 空間で適度に彩度を持つランダムカラーを返す。
   * @returns {THREE.Color}
   */
  getRandomColor() {
    const hue = Math.random();
    const saturation = 0.55 + Math.random() * 0.2;
    const lightness = 0.45 + Math.random() * 0.2;
    return new THREE.Color().setHSL(hue, saturation, lightness);
  }

  /**
   * 生成済みキューブの寿命と挙動を更新し、消滅したものをクリーンアップする。
   * @param {number} delta
   */
  update(delta) {
    if (!this.initialized) {
      return;
    }

    // ドラッグ可能なオブジェクトの更新
    this.updateDraggableObjects(delta);

    // キューブの物理演算更新
    if (this.spawnedCubes.length > 0) {
      const cubesToRemove = [];
      const characterBounds = this.obtainCharacterBounds();
      this.spawnedCubes.forEach((cube) => {
        cube.userData.velocity.y += GRAVITY * delta;
        cube.position.addScaledVector(cube.userData.velocity, delta);
        cube.userData.life -= delta;
        this.resolveFloorCollision(cube);
        if (characterBounds) {
          this.resolveCharacterCollision(cube, characterBounds);
        }
        if (cube.userData.life <= 0) {
          cubesToRemove.push(cube);
        }
      });
      this.resolveCubeCollisions();
      if (cubesToRemove.length > 0) {
        this.spawnedCubes = this.spawnedCubes.filter((cube) => !cubesToRemove.includes(cube));
        cubesToRemove.forEach((cube) => {
          cube.parent?.remove(cube);
          cube.material.dispose();
        });
      }
    }
  }

  /**
   * ドラッグ可能なオブジェクトを登録する。
   * @param {import('./vrui/draggable.js').Draggable} draggable
   */
  addDraggableObject(draggable) {
    if (!this.draggableObjects.includes(draggable)) {
      this.draggableObjects.push(draggable);
    }
  }

  /**
   * ドラッグ可能なオブジェクトを解除する。
   * @param {import('./vrui/draggable.js').Draggable} draggable
   */
  removeDraggableObject(draggable) {
    const index = this.draggableObjects.indexOf(draggable);
    if (index >= 0) {
      this.draggableObjects.splice(index, 1);
    }
  }

  /**
   * ドラッグ可能なオブジェクトの更新処理。
   * ホバー検出、ピンチでのアタッチ/デタッチを行う。
   * @param {number} delta
   */
  updateDraggableObjects(delta) {
    if (this.draggableObjects.length === 0) {
      return;
    }

    // 各ハンドについて処理
    this.hands.forEach((hand, index) => {
      this.updateHandDragging(hand, delta, index);
    });

    // Draggableの更新
    this.draggableObjects.forEach((draggable) => {
      draggable.update(delta);
    });
  }

  /**
   * 1つのハンドに対するドラッグ処理を更新する。
   * @param {THREE.Object3D & { joints?: Record<string, THREE.Object3D>, inputSource?: XRInputSource }} hand
   * @param {number} delta
   * @param {number} handIndex - ハンドのインデックス（デバッグ用）
   */
  updateHandDragging(hand, delta, handIndex = 0) {
    // ハンドが有効でない場合はスキップ
    if (!hand || !hand.joints) {
      return;
    }

    // 人差し指の先端位置を取得
    const indexTip = hand.joints["index-finger-tip"];
    if (!indexTip) {
      return;
    }

    // ピンチ中かどうかを判定
    const isPinching = this.isHandPinching(hand);

    // 現在ドラッグ中のオブジェクトを取得
    const currentDrag = this.currentDragTargets.get(hand);

    if (isPinching) {
      // ピンチ中の処理
      if (!currentDrag) {
        // 新しくドラッグを開始する可能性がある
        const draggable = this.findDraggableAtPosition(indexTip, handIndex);
        if (draggable) {
          // アタッチする
          draggable.attach(hand);
          this.currentDragTargets.set(hand, draggable);
          // ホバー状態をクリア
          const previousHover = this.currentHoverTargets.get(hand);
          if (previousHover && previousHover !== draggable) {
            previousHover.setHovered(false);
          }
          this.currentHoverTargets.set(hand, draggable);
        }
      }
      // すでにドラッグ中の場合は継続（親子関係で自動的に追従）
    } else {
      // ピンチしていない場合
      if (currentDrag) {
        // ドラッグ終了
        currentDrag.detach();
        this.currentDragTargets.delete(hand);
      }

      // ホバー検出
      const draggable = this.findDraggableAtPosition(indexTip, handIndex);
      const previousHover = this.currentHoverTargets.get(hand);

      if (draggable !== previousHover) {
        // ホバー状態が変化した
        if (previousHover) {
          previousHover.setHovered(false);
        }
        if (draggable) {
          draggable.setHovered(true);
        }
        this.currentHoverTargets.set(hand, draggable);
      }
    }
  }

  /**
   * 指定位置にあるドラッグ可能なオブジェクトを検出する。
   * 距離ベースの判定を使用する。
   * @param {THREE.Object3D} joint - ジョイント（人差し指の先端など）
   * @param {number} handIndex - ハンドのインデックス（デバッグ用）
   * @returns {import('./vrui/draggable.js').Draggable | null}
   */
  findDraggableAtPosition(joint, handIndex = 0) {
    if (!joint) {
      return null;
    }

    // ジョイントのワールド座標を取得
    joint.updateWorldMatrix(true, false);
    tempRayOrigin.setFromMatrixPosition(joint.matrixWorld);

    let closestDraggable = null;
    let closestDistance = Infinity;

    // 各Draggableのヒットターゲットとの距離を計算
    this.draggableObjects.forEach((draggable, index) => {
      const hitTarget = draggable.getHitTarget();
      if (!hitTarget) {
        return;
      }

      hitTarget.updateWorldMatrix(true, false);

      // ヒットターゲットの中心位置を取得
      tempRayDirection.setFromMatrixPosition(hitTarget.matrixWorld);

      // 人差し指の先端とヒットターゲットの距離を計算
      const distance = tempRayOrigin.distanceTo(tempRayDirection);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestDraggable = draggable;
      }
    });

    // 距離によるフィルタリング
    // 人差し指の先端から15cm以内のオブジェクトのみ対象とする
    if (closestDraggable && closestDistance < 0.15) {
      return closestDraggable;
    }

    return null;
  }

  /**
   * ハンドがピンチ中かどうかを判定する。
   * @param {THREE.Object3D & { inputSource?: XRInputSource }} hand
   * @returns {boolean}
   */
  isHandPinching(hand) {
    // XRHandからピンチ状態を取得する簡易実装
    // inputSourceのgamepadsからピンチ状態を取得できる場合がある
    if (hand?.inputSource?.gamepad) {
      const gamepad = hand.inputSource.gamepad;
      // ボタン0がピンチに対応していることが多い
      if (gamepad.buttons && gamepad.buttons.length > 0) {
        return gamepad.buttons[0].pressed;
      }
    }

    // フォールバック: 人差し指と親指の距離で判定
    const indexTip = hand?.joints?.["index-finger-tip"];
    const thumbTip = hand?.joints?.["thumb-tip"];

    if (!indexTip || !thumbTip) {
      return false;
    }

    indexTip.updateWorldMatrix(true, false);
    thumbTip.updateWorldMatrix(true, false);

    tempRayOrigin.setFromMatrixPosition(indexTip.matrixWorld);
    tempRayDirection.setFromMatrixPosition(thumbTip.matrixWorld);

    const distance = tempRayOrigin.distanceTo(tempRayDirection);

    // 3cm以下でピンチとみなす
    return distance < 0.03;
  }

  /**
   * VRM などキャラクターの境界ボックスを供給する関数を登録する。
   * @param {(target: THREE.Box3) => THREE.Box3 | null | undefined} provider
   */
  setCharacterColliderProvider(provider) {
    this.characterColliderProvider = provider;
  }

  /**
   * キャラクターの境界ボックスを取得する。
   * @returns {THREE.Box3 | null}
   */
  obtainCharacterBounds() {
    if (typeof this.characterColliderProvider !== "function") {
      return null;
    }
    const bounds = this.characterColliderProvider(this.internalCharacterBounds);
    if (!bounds) {
      return null;
    }
    tempBounds.copy(bounds);
    if (this.spawnParent && this.spawnParent !== this.scene) {
      this.spawnParent.updateWorldMatrix(true, false);
      tempParentMatrixInverse.copy(this.spawnParent.matrixWorld).invert();
      tempBounds.applyMatrix4(tempParentMatrixInverse);
    }
    return tempBounds;
  }

  /**
   * 床（Y=一定）との衝突を処理する。
   * @param {THREE.Mesh} cube
   */
  resolveFloorCollision(cube) {
    const radius = cube.userData.radius ?? CUBE_RADIUS;
    const velocity = cube.userData.velocity;
    if (!velocity) {
      return;
    }
    const bottom = cube.position.y - radius;
    if (bottom >= this.floorY) {
      return;
    }
    cube.position.y = this.floorY + radius;
    if (velocity.y < 0) {
      velocity.y = -velocity.y * FLOOR_RESTITUTION;
      velocity.x *= LATERAL_DAMPING;
      velocity.z *= LATERAL_DAMPING;
    }
  }

  /**
   * キャラクターの境界ボックスとキューブの衝突判定を行う。
   * @param {THREE.Mesh} cube
   * @param {THREE.Box3} bounds
   */
  resolveCharacterCollision(cube, bounds) {
    const radius = cube.userData.radius ?? CUBE_RADIUS;
    const velocity = cube.userData.velocity;
    if (!velocity) {
      return;
    }
    bounds.clampPoint(cube.position, tempClosestPoint);
    tempNormal.copy(cube.position).sub(tempClosestPoint);
    let distance = tempNormal.length();
    if (distance === 0) {
      tempNormal.copy(this.findEscapeNormal(cube.position, bounds));
      distance = tempNormal.length();
    }
    if (distance === 0 || distance >= radius) {
      return;
    }
    tempNormal.normalize();
    const penetration = radius - distance;
    cube.position.addScaledVector(tempNormal, penetration);
    this.reflectVelocity(velocity, tempNormal, CUBE_RESTITUTION);
  }

  /**
   * 境界ボックス内部に食い込んだ際の脱出法線を推定する。
   * @param {THREE.Vector3} position
   * @param {THREE.Box3} bounds
   * @returns {THREE.Vector3}
   */
  findEscapeNormal(position, bounds) {
    const distances = [
      { normal: new THREE.Vector3(1, 0, 0), depth: bounds.max.x - position.x },
      { normal: new THREE.Vector3(-1, 0, 0), depth: position.x - bounds.min.x },
      { normal: new THREE.Vector3(0, 1, 0), depth: bounds.max.y - position.y },
      { normal: new THREE.Vector3(0, -1, 0), depth: position.y - bounds.min.y },
      { normal: new THREE.Vector3(0, 0, 1), depth: bounds.max.z - position.z },
      { normal: new THREE.Vector3(0, 0, -1), depth: position.z - bounds.min.z },
    ];
    distances.sort((a, b) => a.depth - b.depth);
    return distances[0].normal.clone().multiplyScalar(distances[0].depth);
  }

  /**
   * 法線方向へ速度を反射させる。
   * @param {THREE.Vector3} velocity
   * @param {THREE.Vector3} normal
   * @param {number} restitution
   */
  reflectVelocity(velocity, normal, restitution) {
    const separatingSpeed = velocity.dot(normal);
    if (separatingSpeed >= 0) {
      return;
    }
    const impulse = -(1 + restitution) * separatingSpeed;
    velocity.addScaledVector(normal, impulse);
  }

  /**
   * キューブ同士の衝突をすべて評価する。
   */
  resolveCubeCollisions() {
    for (let i = 0; i < this.spawnedCubes.length; i += 1) {
      for (let j = i + 1; j < this.spawnedCubes.length; j += 1) {
        this.resolveCubePair(this.spawnedCubes[i], this.spawnedCubes[j]);
      }
    }
  }

  /**
   * 2 つのキューブを球近似で解決する。
   * @param {THREE.Mesh} cubeA
   * @param {THREE.Mesh} cubeB
   */
  resolveCubePair(cubeA, cubeB) {
    const radiusA = cubeA.userData.radius ?? CUBE_RADIUS;
    const radiusB = cubeB.userData.radius ?? CUBE_RADIUS;
    const velocityA = cubeA.userData.velocity;
    const velocityB = cubeB.userData.velocity;
    if (!velocityA || !velocityB) {
      return;
    }
    const minDistance = radiusA + radiusB;
    tempSeparation.copy(cubeB.position).sub(cubeA.position);
    let distance = tempSeparation.length();
    if (distance === 0) {
      tempSeparation.set(1, 0, 0);
      distance = 1;
    }
    if (distance >= minDistance) {
      return;
    }
    tempNormal.copy(tempSeparation).divideScalar(distance);
    const penetration = minDistance - distance;
    cubeA.position.addScaledVector(tempNormal, -penetration * 0.5);
    cubeB.position.addScaledVector(tempNormal, penetration * 0.5);

    tempRelativeVelocity.copy(velocityB).sub(velocityA);
    const separatingVelocity = tempRelativeVelocity.dot(tempNormal);
    if (separatingVelocity >= 0) {
      return;
    }
    const impulse = -(1 + CUBE_RESTITUTION) * separatingVelocity * 0.5;
    velocityA.addScaledVector(tempNormal, -impulse);
    velocityB.addScaledVector(tempNormal, impulse);
  }
}
