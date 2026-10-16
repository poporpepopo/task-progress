# task-progress

実行中のサブエージェントとバックグラウンドのシェルを、プロンプトの下に1行ずつ表示する Claude Code の mod です。

```
⏳ Build ███░░░░░░░ est 1:20 npm run build
⏳ 調査 █████░░░░░ est 2:05? Read: eta.ts
```

- **est**: 同じコマンドまたは同じエージェント種別の、過去の実行時間の中央値から出した残り時間。`?` は完全に一致する記録がなく、近い記録で代用したことを示します。
- **詳細**: シェルならそのコマンド、サブエージェントなら最後に呼んだツール。
- 10秒未満で終わった実行は記録しません。

## 読み込む

`~/.claude/settings.json` に次を追加します。

macOS:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Developer/task-progress" }
```

Windows:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\task-progress" }
```

複数のフォルダを指定するときは、macOS では `:`、Windows では `;` で区切ります。

1回のセッションだけで使うなら `claude --plugin-dir <パス>` で起動します。

## 確認する

```
claude plugin validate .
claude plugin test .
```
