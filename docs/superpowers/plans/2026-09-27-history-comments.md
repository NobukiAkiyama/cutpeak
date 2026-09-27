# 編集履歴のコメント機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 編集履歴ダイアログを VSCode のソース管理風（変更・メッセージ欄・記録ボタン・グラフ）に作り直し、コメント付きの記録を残せるようにする。

**Architecture:** 履歴 DAG（`src/core/history.ts`）と保存形式は変えない。現在地から起点までの鎖を「未記録の変更」と「記録＋含まれる編集」に振り分ける純粋関数を `src/core/history-log.ts` に置き、`HistoryDialog.tsx` はその結果を描くだけにする。記録は既存の `api.snapshot(message)`（空コミット）で作る。

**Tech Stack:** React 19 / TypeScript (strict) / zustand / lucide-react / Vitest / Playwright

## Global Constraints

- 保存形式（`Repository` / `Commit`）は変更しない。既存のスナップショットは記録として表示される。
- 記録の判定: `!c.parentIds.length || (!!c.snapshot && !c.operations.length)`。
- UI の文言は日本語。プレースホルダーは `メッセージ (⌘Enter で "<案の名前>" に記録)`（Mac 以外は `Ctrl+Enter`）。
- ⌘Enter / Ctrl+Enter で記録。`isComposing` 中は無視。空メッセージ（trim 後）では記録できない。
- 色は `editor.css` に基本色、`occamus.css` にテーマ色を置く既存の書き方に従う。
- 検証コマンド: `npm test`、`npm run lint`、`npx tsc --noEmit`、`npx playwright test tests/browser/editor-workflow.spec.ts`。

---

### Task 1: 履歴の振り分け関数 `historyLog`

**Files:**
- Create: `src/core/history-log.ts`
- Test: `tests/history-log.test.ts`

**Interfaces:**
- Consumes: `Commit`, `Branch`, `Repository`, `Editor`（`src/core/history.ts`）
- Produces:
  - `isCheckpoint(c: Commit): boolean`
  - `interface LogEntry { commit: Commit; edits: Commit[]; branches: Branch[] }`
  - `interface HistoryLog { changes: Commit[]; entries: LogEntry[] }`
  - `historyLog(r: Repository): HistoryLog`

- [ ] **Step 1: 失敗するテストを書く** — `tests/history-log.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeProject, makeClip, type Asset } from '../src/core/model';
import { Editor } from '../src/core/history';
import { historyLog, isCheckpoint } from '../src/core/history-log';

function fixture() {
  const p = makeProject();
  const asset: Asset = {
    id: crypto.randomUUID(),
    name: 'sample.mp4',
    kind: 'video',
    mime: 'video/mp4',
    size: 1000,
    durationUs: 10e6,
    firstTimestampUs: 0,
    width: 1920,
    height: 1080,
    hasAudio: true,
  };
  p.assets.push(asset);
  const c = makeClip(p, 'video', 0, asset);
  p.tracks[1].clips.push(c);
  const e = new Editor(p);
  const move = (startFrame: number) => {
    e.execute({ type: 'clip.move', clipId: c.id, startFrame });
    return e.repository.head;
  };
  return { e, c, move };
}
const ids = (commits: { id: string }[]) => commits.map((c) => c.id);

describe('historyLog', () => {
  it('puts every edit in changes when nothing has been recorded', () => {
    const { e, move } = fixture();
    const root = e.repository.head;
    const a = move(10);
    const b = move(20);
    const log = historyLog(e.repository);
    expect(ids(log.changes)).toEqual([b, a]);
    expect(ids(log.entries.map((x) => x.commit))).toEqual([root]);
    expect(log.entries[0].edits).toEqual([]);
  });

  it('groups edits under the record that follows them', () => {
    const { e, move } = fixture();
    const root = e.repository.head;
    const a = move(10);
    e.snapshot('ラフ完成');
    const record = e.repository.head;
    const b = move(20);
    const log = historyLog(e.repository);
    expect(ids(log.changes)).toEqual([b]);
    expect(ids(log.entries.map((x) => x.commit))).toEqual([record, root]);
    expect(ids(log.entries[0].edits)).toEqual([a]);
    expect(log.entries[0].commit.message).toBe('ラフ完成');
  });

  it('does not treat automatic snapshots or restores as records', () => {
    const { e, c, move } = fixture();
    for (let i = 1; i <= 25; i++) move(i);
    const auto = Object.values(e.repository.commits).find(
      (x) => x.snapshot && x.operations.length,
    );
    expect(auto).toBeTruthy();
    expect(isCheckpoint(auto!)).toBe(false);
    e.snapshot('保存点');
    const saved = e.repository.head;
    e.execute({ type: 'clip.delete', clipId: c.id });
    e.restore(saved);
    const log = historyLog(e.repository);
    expect(log.changes).toHaveLength(2);
    expect(log.entries[0].commit.id).toBe(saved);
    expect(log.entries[0].edits).toHaveLength(25);
  });

  it('shows only the active branch and badges branch heads', () => {
    const { e, move } = fixture();
    const main = e.repository.activeBranch;
    move(10);
    e.snapshot('main の記録');
    const mainRecord = e.repository.head;
    const alt = e.branch('別案');
    move(20);
    e.snapshot('別案の記録');
    const altRecord = e.repository.head;

    let log = historyLog(e.repository);
    expect(ids(log.entries.map((x) => x.commit)).slice(0, 2)).toEqual([
      altRecord,
      mainRecord,
    ]);
    expect(log.entries[0].branches.map((b) => b.id)).toEqual([alt.id]);
    expect(log.entries[1].branches.map((b) => b.id)).toEqual([main]);

    e.checkout(main);
    log = historyLog(e.repository);
    expect(log.entries[0].commit.id).toBe(mainRecord);
    expect(log.entries.some((x) => x.commit.id === altRecord)).toBe(false);
  });

  it('hides undone edits ahead of the current position', () => {
    const { e, move } = fixture();
    const a = move(10);
    move(20);
    e.undo();
    expect(ids(historyLog(e.repository).changes)).toEqual([a]);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/history-log.test.ts`
Expected: FAIL（`../src/core/history-log` が見つからない）

- [ ] **Step 3: 実装する** — `src/core/history-log.ts`

```ts
import type { Branch, Commit, Repository } from './history';

export const isCheckpoint = (c: Commit) =>
  !c.parentIds.length || (!!c.snapshot && !c.operations.length);

export interface LogEntry {
  commit: Commit;
  edits: Commit[];
  branches: Branch[];
}
export interface HistoryLog {
  changes: Commit[];
  entries: LogEntry[];
}
export function historyLog(r: Repository): HistoryLog {
  const log: HistoryLog = { changes: [], entries: [] };
  const seen = new Set<string>();
  let edits = log.changes;
  let c: Commit | undefined = r.commits[r.head];
  while (c && !seen.has(c.id)) {
    seen.add(c.id);
    if (isCheckpoint(c)) {
      const entry: LogEntry = { commit: c, edits: [], branches: [] };
      log.entries.push(entry);
      edits = entry.edits;
    } else edits.push(c);
    const parent: string | undefined = c.parentIds[0];
    c = parent ? r.commits[parent] : undefined;
  }
  for (const entry of log.entries) {
    const members = new Set([entry.commit.id, ...entry.edits.map((e) => e.id)]);
    entry.branches = r.branches.filter((b) => members.has(b.head));
  }
  return log;
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run tests/history-log.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add src/core/history-log.ts tests/history-log.test.ts
git commit -m "feat: group edit history into changes and records"
```

### Task 2: 履歴ダイアログを VSCode 風に作り直す

**Files:**
- Modify: `src/ui/HistoryDialog.tsx`（全体を置き換え）
- Modify: `src/ui/editor.css`（`.commit-details > strong` の後と、`@media` 内の `.commit-list` の後）
- Modify: `src/ui/occamus.css`（`.commit-item:after` の後）
- Test: `tests/browser/editor-workflow.spec.ts:52-62`

**Interfaces:**
- Consumes: `historyLog`, `isCheckpoint`（Task 1）、`api.snapshot(message?: string)`、`api.checkout`、`api.restore`、`api.branch`
- Produces: なし（UI のみ）

- [ ] **Step 1: ブラウザテストを先に書き換える** — `tests/browser/editor-workflow.spec.ts` の `loads the history dialog only when it is opened` を置き換え、記録のテストを追加

```ts
test('loads the history dialog only when it is opened', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay')).toBeHidden();

  await page.getByRole('button', { name: '履歴' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('編集履歴');
  await expect(
    dialog.getByRole('button', { name: '記録', exact: true }),
  ).toBeVisible();
});

test('records a history comment with the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay')).toBeHidden();

  await page.getByRole('button', { name: '履歴' }).click();
  const dialog = page.getByRole('dialog');
  const record = dialog.getByRole('button', { name: '記録', exact: true });
  const message = dialog.getByRole('textbox', { name: 'メッセージ' });
  await expect(record).toBeDisabled();
  await message.fill('冒頭のカットを詰めた');
  await expect(record).toBeEnabled();
  await message.press('ControlOrMeta+Enter');
  await expect(message).toHaveValue('');
  await expect(dialog.locator('.graph-list')).toContainText(
    '冒頭のカットを詰めた',
  );
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx playwright test tests/browser/editor-workflow.spec.ts -g "history"`
Expected: FAIL（「記録」ボタンがない）

- [ ] **Step 3: `src/ui/HistoryDialog.tsx` を置き換える**

```tsx
import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
} from 'lucide-react';
import { useEditor, api } from '../app/store';
import { timecode } from '../core/model';
import type { Commit } from '../core/history';
import { historyLog } from '../core/history-log';
import { Modal, Choice } from './controls';

const submitKey = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? '⌘Enter'
  : 'Ctrl+Enter';
let draft = '';
const time = (c: Commit) => new Date(c.timestamp).toLocaleTimeString('ja-JP');

export default function HistoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { repository: r, project } = useEditor();
  const log = useMemo(() => historyLog(r), [r]);
  const [selected, setSelected] = useState<string | null>(null),
    [expanded, setExpanded] = useState<string[]>([]),
    [changesOpen, setChangesOpen] = useState(true),
    [branchName, setBranchName] = useState(''),
    [message, setMessageState] = useState(draft);
  const current = r.commits[selected || r.head] || r.commits[r.head];
  const currentEntry = log.entries.find((x) => x.commit.id === current.id);
  const branch = r.branches.find((b) => b.id === r.activeBranch);
  const setMessage = (value: string) => {
    draft = value;
    setMessageState(value);
  };
  const record = () => {
    const text = message.trim();
    if (!text) return;
    api.snapshot(text);
    setMessage('');
    setSelected(null);
  };
  const onMessageKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'Enter' &&
      (e.metaKey || e.ctrlKey) &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      record();
    }
  };
  const toggle = (id: string) =>
    setExpanded((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="編集履歴"
      description="過去の編集に戻ったり、素材を共有したまま別の案を試せます。"
      wide
    >
      <div className="history-toolbar">
        <GitBranch size={17} />
        <Choice
          label="編集する案"
          value={r.activeBranch}
          options={r.branches.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(v) => {
            api.checkout(v);
            setSelected(null);
          }}
        />
      </div>
      <div className="branch-form">
        <input
          aria-label="別案の名前"
          placeholder="別案の名前"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
        />
        <button
          className="secondary"
          onClick={() => {
            api.branch(branchName);
            setBranchName('');
          }}
        >
          <GitBranch size={15} />
          別案を作る
        </button>
      </div>
      <div className="history-grid">
        <div className="history-source">
          <button
            className="history-section"
            aria-expanded={changesOpen}
            onClick={() => setChangesOpen((v) => !v)}
          >
            {changesOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
            変更
            <span className="history-count">{log.changes.length}</span>
          </button>
          {changesOpen &&
            (log.changes.length ? (
              <div className="change-list">
                {log.changes.map((c) => (
                  <button
                    className={`change-item ${current.id === c.id ? 'selected' : ''}`}
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                  >
                    <span>{c.message}</span>
                    <small>{c.id === r.head ? '現在地' : time(c)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="panel-help">前回の記録から変更はありません。</p>
            ))}
          <textarea
            className="commit-message"
            aria-label="メッセージ"
            placeholder={`メッセージ (${submitKey} で "${branch?.name ?? ''}" に記録)`}
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onMessageKey}
          />
          <button
            className="primary full"
            disabled={!message.trim()}
            onClick={record}
          >
            <Check size={15} />
            記録
          </button>
          <div className="history-section">グラフ</div>
          <div className="commit-list graph-list">
            {log.entries.map(({ commit: c, edits, branches }) => {
              const isOpen = expanded.includes(c.id);
              return (
                <div className="graph-entry" key={c.id}>
                  <button
                    className={`commit-item ${current.id === c.id ? 'selected' : ''}`}
                    aria-expanded={edits.length ? isOpen : undefined}
                    onClick={() => {
                      setSelected(c.id);
                      if (edits.length) toggle(c.id);
                    }}
                  >
                    <span className="commit-dot snapshot">
                      {c.id === r.head ? (
                        <Check size={11} />
                      ) : (
                        <GitCommitHorizontal size={15} />
                      )}
                    </span>
                    <span>
                      <strong>{c.message.split('\n')[0]}</strong>
                      <small>
                        {time(c)}
                        {edits.length ? ` · ${edits.length}件の編集` : ''}
                        {c.id === r.head ? ' · 現在地' : ''}
                      </small>
                      {branches.length > 0 && (
                        <span className="branch-badges">
                          {branches.map((b) => (
                            <span className="branch-badge" key={b.id}>
                              {b.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                  {isOpen &&
                    edits.map((edit) => (
                      <button
                        className={`commit-item graph-edit ${current.id === edit.id ? 'selected' : ''}`}
                        key={edit.id}
                        onClick={() => setSelected(edit.id)}
                      >
                        <span className="commit-dot" />
                        <span>
                          <strong>{edit.message}</strong>
                          <small>{time(edit)}</small>
                        </span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="commit-details">
          <div className="section-heading">変更内容</div>
          <strong>{current.message}</strong>
          <small className="muted">
            {new Date(current.timestamp).toLocaleString('ja-JP')}
          </small>
          {current.operations.length ? (
            current.operations.map((op, i) => (
              <div className="semantic-change" key={i}>
                {op.frame !== undefined && (
                  <small className="timecode">
                    {timecode(op.frame, project)}
                  </small>
                )}
                <strong>{op.target}</strong>
                <p>{op.description}</p>
              </div>
            ))
          ) : (
            <p className="panel-help">
              {currentEntry?.edits.length
                ? `${currentEntry.edits.length}件の編集を含む記録です。`
                : ''}
              この時点のプロジェクト全体を保存しています。
            </p>
          )}
          <button
            className="secondary full"
            disabled={current.id === r.head}
            onClick={() => {
              api.restore(current.id);
              setSelected(null);
            }}
          >
            <RotateCcw size={15} />
            この時点へ復元
          </button>
          <small className="muted">復元前の編集も履歴に残ります。</small>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: スタイルを追加する** — `src/ui/editor.css` の `.commit-details > small { ... }` の直後に追加

```css
.commit-details > strong {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.history-source {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-right: 18px;
}
.history-section {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 28px;
  padding: 4px 2px;
  background: none;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.6px;
  color: #aeb8c6;
}
div.history-section {
  margin-top: 14px;
  padding-left: 4px;
}
.history-count {
  margin-left: auto;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #30363e;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.change-list {
  max-height: 140px;
  overflow: auto;
  margin-bottom: 8px;
}
.change-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 6px 8px 6px 24px;
  border-radius: 6px;
  text-align: left;
  font-size: 12px;
}
.change-item > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.change-item small {
  color: #90a0b4;
  flex-shrink: 0;
}
.change-item.selected {
  background: #344331;
}
.commit-message {
  width: 100%;
  min-height: 60px;
  max-height: 160px;
  resize: none;
  field-sizing: content;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
}
.graph-list {
  max-height: 300px;
  padding-right: 0;
}
.graph-list .commit-item:last-child:after {
  display: block;
}
.graph-list > .graph-entry:last-child > .commit-item:last-child:after {
  display: none;
}
.graph-edit {
  padding-top: 6px;
  padding-bottom: 6px;
}
.graph-edit:after {
  top: 0;
}
.graph-edit .commit-dot {
  position: relative;
  z-index: 1;
  background: transparent;
  border: 0;
  height: 16px;
}
.graph-edit .commit-dot:before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.graph-edit strong {
  font-size: 11px;
  color: #c4ceda;
}
.graph-edit small {
  margin-top: 0;
}
.branch-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.branch-badge {
  padding: 0 8px;
  border: 1px solid #657853;
  border-radius: 999px;
  background: #34402c;
  color: #ddf5bd;
  font-size: 11px;
  line-height: 18px;
}
```

`@media` 内の `.commit-list { max-height: 240px; }` の直後に追加:

```css
  .history-source {
    padding-right: 0;
  }
```

`src/ui/occamus.css` の `.commit-item:after { background: #59416d; }` の直後に追加:

```css
.change-item.selected {
  background: #31233f;
}
.history-count {
  background: #33263f;
}
.graph-edit .commit-dot {
  background: transparent;
}
.branch-badge {
  background: #382a47;
  border-color: #a67bef;
  color: #d6b6ff;
}
```

- [ ] **Step 5: 検証する**

Run: `npx tsc --noEmit && npm run lint && npm test && npx playwright test tests/browser/editor-workflow.spec.ts`
Expected: すべて PASS。続けてブラウザで履歴ダイアログを開き、編集→記録→グラフの開閉→編集の選択→復元が動くこと、スマホ幅で 1 列に積まれることを確認する。

- [ ] **Step 6: コミット**

```bash
git add src/ui/HistoryDialog.tsx src/ui/editor.css src/ui/occamus.css tests/browser/editor-workflow.spec.ts
git commit -m "feat: add commit-style comments to edit history"
```
