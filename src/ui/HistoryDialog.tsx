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
                        aria-label={`${edit.message} ${time(edit)}`}
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
