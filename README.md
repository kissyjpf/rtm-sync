# Obsidian Remember The Milk Sync (Cow Edition 🐮)

This is a plugin for [Obsidian](https://obsidian.md) that syncs tasks with [Remember The Milk](https://www.rememberthemilk.com/) (RTM).

It is designed to be **fully compatible with the [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin**. Task IDs are embedded as Markdown links with a cow icon `[🐮]`, ensuring they are visible in Source Mode, unobtrusive in Live Preview, and do not interfere with metadata parsing.

## Features

* **Download Tasks**: Fetch incomplete tasks from RTM.
    * Supports **Due Dates** (`📅 YYYY-MM-DD`) compatible with Obsidian Tasks.
    * Supports **Priorities** (`🔺`, `🔼`, `🔽`).
* **Add Tasks**: Create a new task in RTM from the current line in the editor.
* **Complete Tasks**: Mark a task as completed in RTM directly from Obsidian (updates checkbox to `[x]`).
* **Robust ID Linking**: Uses standard Markdown links `[🐮](rtm:...)` at the start of the task line. This ensures IDs are never stripped by Obsidian's parser.

## Prerequisite: RTM API Key

To use this plugin, **you must obtain your own API Key from Remember The Milk**.

1.  Go to the [Remember The Milk API Key Request page](https://www.rememberthemilk.com/services/api/keys.rtm).
2.  Apply for an API Key (Non-commercial use is sufficient for personal plugins).
3.  Once approved, note down your **API Key** and **Shared Secret**.

## Installation

1.  Create a folder named `rtm-sync` inside your vault's `.obsidian/plugins/` directory.
2.  Place `main.js` and `manifest.json` into that folder.
3.  Reload Obsidian and enable the plugin in **Community Plugins**.

## Setup

1.  Open Obsidian **Settings** > **Remember The Milk Settings**.
2.  Enter your **API Key** and **Shared Secret**.
3.  Click **"Start Auth"**.
4.  A browser window will open asking for permission. Click **"OK, I'll allow it"**.
5.  Go back to Obsidian and click **"Finish Auth"** in the dialog.
6.  If successful, the status will show "Success!".

## Usage

### 1. Download Tasks
* Open Command Palette (`Ctrl/Cmd + P`).
* Run `RTM Sync: Download and insert tasks`.
* Your tasks will be inserted like this:
    ```markdown
    - [ ] [🐮](rtm:123:456:789) Buy Milk 🔺 📅 2026-01-01
    ```

### 2. Add a Task
* Write a task: `- [ ] New Task`
* Place cursor on the line and run `RTM Sync: Add cursor line to RTM`.
* The task is sent to RTM, and the cow link `[🐮]` is appended to the line.

### 3. Complete a Task
* Place cursor on a synced task (one with the `[🐮]` link).
* Run `RTM Sync: Complete task at cursor`.
* The task is marked completed in RTM, and the line becomes `- [x] ...`.

---

# 日本語 (Japanese)

Remember The Milk (RTM) のタスクを Obsidian 上で同期・管理するためのプラグインです。
**Obsidian Tasks プラグイン** との互換性を重視しており、期限や優先度を Tasks 形式で出力します。

## 特徴
* **Tasksプラグイン互換**: 期限日 (`📅`) や優先度 (`🔺` `🔼` `🔽`) を標準的な形式で扱います。
* **堅牢なID管理**: タスクIDを `[🐮](rtm:...)` というMarkdownリンクとして行頭に配置します。これにより、Obsidianの表示モードに関わらずIDが消えることを防ぎ、他のプラグインの解析も邪魔しません。
* **双方向同期**:
    * RTM → Obsidian: 未完了タスクの取り込み
    * Obsidian → RTM: タスクの追加・完了

## 事前準備
このプラグインを使用するには、**ご自身で RTM の API Key を取得する必要があります**。

1.  [RTM API Key 申請ページ](https://www.rememberthemilk.com/services/api/keys.rtm) にアクセスします。
2.  APIキーを申請します（個人利用であれば Non-commercial で申請してください）。
3.  発行された **API Key** と **Shared Secret** を控えておきます。

## 設定方法
1.  Obsidianの設定画面から **Remember The Milk Settings** を開きます。
2.  取得した **API Key** と **Shared Secret** を入力します。
3.  **"Start Auth"** ボタンを押します。
4.  ブラウザが開くので、アクセスを許可します。
5.  Obsidianに戻り、ダイアログの **"Finish Auth"** を押します。

## 使い方

### 1. タスクのダウンロード
* コマンド `RTM Sync: Download and insert tasks` を実行します。
* カーソル位置にタスクが挿入されます。
    * 例: `- [ ] [🐮](rtm:...) 牛乳を買う 🔺 📅 2026-01-01`

### 2. タスクの追加
* エディタに行を書きます: `- [ ] 新しいタスク`
* その行でコマンド `RTM Sync: Add cursor line to RTM` を実行します。
* RTMに追加され、行頭に牛アイコン `[🐮]` が付与されます。

### 3. タスクの完了
* 同期済みのタスク（`[🐮]` がある行）でコマンド `RTM Sync: Complete task at cursor` を実行します。
* RTM側で完了になり、Obsidianのチェックボックスも `[x]` に変わります。

## Development

```bash
npm install
npm run build
