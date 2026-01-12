# VRM Chat Space

VRMモデルとVR空間で会話できるWebアプリケーション。
WebXR対応でVRヘッドセット、PC、スマートフォンから利用可能です。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Three.js](https://img.shields.io/badge/Three.js-0.164.1-blue)

## 特徴

- **マルチデバイス対応**: VRヘッドセット、PC、スマートフォンから利用可能
- **VRMモデル対応**: VRM 1.0モデルの表示とアニメーション再生
- **AI会話機能**: OpenAI APIを使用した音声認識と会話
- **音声合成**: TTS（Text-to-Speech）によるキャラクターの発話
- **カスタマイズ**: 独自のVRMモデルをアップロード可能
- **WebXR対応**: 没入感のあるVR体験

## デモ

[VRM Chat Space](https://carlox.net/webxr_app/vrm-chat/index.html)

## セットアップ

### 必要な環境

- Node.js (v16以上推奨)
- モダンブラウザ（Chrome、Firefox、Edge等）
- （オプション）WebXR対応のVRヘッドセット

### インストール

#### 1. リポジトリのクローン

```bash
git clone https://github.com/carl0967/vrm-chat-space.git
cd vrm-chat-space
```

#### 2. 歩きアニメーションのダウンロード

このプロジェクトでは歩きアニメーションを使用しています。
自分で用意するか、[帝国妖異対策局様のFanbox](https://tyt.fanbox.cc/posts/10123777)よりダウンロードして`vrma/` フォルダに配置してください。

`vrma/manifest.json`に使用するvrmaファイルを定義しています。


なお、vrmは[VRoid Studio](https://vroid.com/studio)で作成しています。
その他のvrmaファイルは、Unityで生成しています。
[テキストからVRMAファイルを作ろう！｜TK256](https://note.com/tk256ailab/n/nc165d8f212d5)

#### 3. HTTPサーバーの起動

このアプリケーションはローカルHTTPサーバーで動作します。

```bash
# npxを使用してhttp-serverを起動
npx http-server . -p 8080
```

または、グローバルにインストールして使用することもできます。

```bash
# グローバルインストール（初回のみ）
npm install -g http-server

# サーバー起動
http-server . -p 8080
```

#### 4. ブラウザでアクセス

ブラウザで以下のURLにアクセスします。

```
http://localhost:8080
```

## 使い方

### 初期設定

#### APIキーの設定（チャット機能を使う場合）

1. 画面右上の「設定」ボタンをクリック
2. **OpenAI APIキー**を入力（必須）
   - [OpenAI APIキーの取得はこちら](https://openai.com/ja-JP/index/openai-api/)
3. **Aivis Cloud APIキー**を入力（推奨・オプション）
   - [Aivis Cloud APIキーの取得はこちら](https://api.aivis-project.com/v1/demo/realtime-streaming)
   - 未設定の場合はOpenAI TTSで代用されます

**注意**: APIキーはsessionStorageに保存されます。タブを閉じると削除され、サーバーには送信されません。

### 基本操作

#### Web画面での操作

**カメラ移動（キーボード）**
- `W` / `S`: 前後移動
- `A` / `D`: 左右移動
- `R` / `F`: 上下移動
- マウスドラッグでも視点操作可能

**アクション実行**
1. 「アクション」ドロップダウンからアクションを選択
2. 「実行」ボタンをクリック

**チャット機能**
- **テキスト入力**: 画面下部の入力欄にメッセージを入力して「送信」
- **音声入力**: マイクボタンをクリックして話す（もう一度クリックで停止）

#### VRモードでの操作

1. 画面下部の「ENTER VR」ボタンをクリック
2. VRヘッドセットを装着
3. コントローラーを使って操作

**トラブルシューティング**: VR使用中に動作がおかしい場合は、一度VRモードを終了して入り直してください。

### カスタマイズ

#### VRMモデルの変更

1. 「設定」→「キャラクターモデルを変更」をクリック
2. VRM 1.0形式のファイルを選択

**注意**: モデルは保存されないため、ページをリロードすると元に戻ります。

#### キャラクター設定

「設定」→「キャラクター設定を変更」から以下を設定可能:
- AIキャラクター名
- システムプロンプト
- TTS音声設定（OpenAI / AIVIS）

## 技術スタック

### フロントエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| [Three.js](https://threejs.org/) | 0.164.1 | 3Dグラフィックスエンジン |
| [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) | - | VRMモデルの読み込み・制御 |
| [Font Awesome](https://fontawesome.com/) | 6.5.1 | UIアイコン |
| [WebXR Device API](https://www.w3.org/TR/webxr/) | - | VR対応 |

### API

- **OpenAI API**: 音声認識（Whisper）、会話生成（GPT）、音声合成（TTS）
- **Aivis Cloud API**: 高品質な音声合成（オプション）

### アニメーション

- **VRMA (VRM Animation)**: VRMモデル用のアニメーションフォーマット
- アニメーションファイルは `vrma/` ディレクトリで管理

## プロジェクト構成

```
vrm-chat-space/
├── index.html              # エントリーポイント
├── config.json             # ログレベル設定
├── version.json            # バージョン情報
├── AvatarSample_A.vrm      # デフォルトVRMモデル
├── styles/
│   └── main.css            # スタイルシート
├── src/
│   ├── main.js             # アプリケーションエントリーポイント
│   ├── config.js           # 設定値管理
│   ├── stage.js            # Three.jsシーンセットアップ
│   ├── vrmManager.js       # VRM管理
│   ├── idleAnimations.js   # アイドルアニメーション
│   ├── handInteractions.js # VRコントローラー処理
│   ├── audio/              # 音声関連
│   ├── menus/              # UI制御
│   ├── utils/              # ユーティリティ
│   ├── vrma/               # VRMAアニメーション処理
│   └── vrui/               # VR UI要素
└── vrma/                   # VRMAアニメーションファイル
    ├── manifest.json       # アニメーション一覧
    ├── *.vrma              # アニメーションファイル
    └── *.vrmapack          # パック形式アニメーション(基本的に不要)
```

## 開発者向け情報

### デバッグモード

設定画面で「デバッグ表示」をONにすると、キャラクターとカメラの位置が画面上部に表示されます。

### ログレベルの変更

`config.json` でログレベルを変更できます。

```json
{
  "logging": {
    "level": "Error",
    "levels": ["Verbose", "Info", "Warn", "Error"]
  }
}
```

## ライセンス

MIT License
