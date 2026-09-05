import { useState } from 'react';
import {
  GitBranch,
  Camera,
  RotateCcw,
  Check,
  GitCommitHorizontal,
} from 'lucide-react';
import { useEditor, api } from '../app/store';
import { timecode } from '../core/model';
import { Modal, Choice } from './controls';
export default function HistoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { repository: r, project } = useEditor();
  const [selected, setSelected] = useState<string | null>(null),
    [branchName, setBranchName] = useState('');
  const current = r.commits[selected || r.head] || r.commits[r.head];
  const commits = Object.values(r.commits).sort(
    (a, b) => b.timestamp - a.timestamp,
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
          onChange={(v) => api.checkout(v)}
        />
        <button
          className="secondary"
          onClick={() =>
            api.snapshot(
              `スナップショット ${new Date().toLocaleTimeString('ja-JP')}`,
            )
          }
        >
          <Camera size={15} />
          スナップショット
        </button>
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
        <div className="commit-list">
          {commits.map((c) => (
            <button
              className={`commit-item ${current.id === c.id ? 'selected' : ''}`}
              key={c.id}
              onClick={() => setSelected(c.id)}
            >
              <span className={`commit-dot ${c.snapshot ? 'snapshot' : ''}`}>
                {c.id === r.head ? (
                  <Check size={11} />
                ) : (
                  <GitCommitHorizontal size={15} />
                )}
              </span>
              <span>
                <strong>{c.message}</strong>
                <small>
                  {new Date(c.timestamp).toLocaleTimeString('ja-JP')}
                  {r.branches
                    .filter((b) => b.head === c.id)
                    .map((b) => ` · ${b.name}`)}
                  {c.id === r.head ? ' · 現在地' : ''}
                </small>
              </span>
            </button>
          ))}
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
              この時点のプロジェクト全体を保存しています。
            </p>
          )}
          <button
            className="secondary full"
            disabled={current.id === r.head}
            onClick={() => api.restore(current.id)}
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
