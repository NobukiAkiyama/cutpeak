import { useRef, useState } from 'react';
import { Plus, FolderOpen, Download, Film } from 'lucide-react';
import { Modal, Choice, Field } from './controls';
import {
  useEditor,
  newProject,
  openProject,
  persistNow,
  notify,
} from '../app/store';
import { download, loadLocal, type SavedProject } from '../storage/local';
import { validateProject } from '../core/model';
import { validateRepository } from '../core/history';
export default function ProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { project, repository, projects, busy } = useEditor();
  const [name, setName] = useState('新しいプロジェクト'),
    [size, setSize] = useState('1920x1080'),
    [rate, setRate] = useState('30');
  const file = useRef<HTMLInputElement>(null);
  async function restore(f: File) {
    try {
      const data = JSON.parse(await f.text()) as SavedProject;
      validateProject(data.project);
      validateRepository(data.repository);
      await persistNow();
      await openProject(data);
      onClose();
      notify(
        'プロジェクトを開きました。未接続の素材はメディアから再接続できます。',
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="プロジェクト"
      description="プロジェクトは、このブラウザに自動保存されます。"
      wide
    >
      <div className="project-dialog-grid">
        <div>
          <h3>新しくつくる</h3>
          <Field label="プロジェクト名">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="プロジェクト名"
            />
          </Field>
          <Field label="キャンバス">
            <Choice
              label="キャンバスのサイズ"
              value={size}
              onChange={setSize}
              options={[
                { value: '1920x1080', label: '横長 · 1920 × 1080 (16:9)' },
                { value: '1080x1920', label: '縦長 · 1080 × 1920 (9:16)' },
                { value: '1080x1080', label: '正方形 · 1080 × 1080' },
                { value: '1280x720', label: 'HD · 1280 × 720' },
                { value: '3840x2160', label: '4K · 3840 × 2160' },
              ]}
            />
          </Field>
          <Field label="フレームレート">
            <Choice
              label="フレームレート"
              value={rate}
              onChange={setRate}
              options={['24', '25', '29.97', '30', '59.94', '60'].map((n) => ({
                value: n,
                label: `${n} fps`,
              }))}
            />
          </Field>
          <button
            className="primary full"
            disabled={!!busy || !name.trim()}
            onClick={async () => {
              try {
                const [w, h] = size.split('x').map(Number);
                await newProject(
                  name.trim(),
                  w,
                  h,
                  rate === '29.97'
                    ? { numerator: 30000, denominator: 1001 }
                    : rate === '59.94'
                      ? { numerator: 60000, denominator: 1001 }
                      : { numerator: Number(rate), denominator: 1 },
                );
                onClose();
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Plus size={17} />
            プロジェクトを作成
          </button>
        </div>
        <div>
          <h3>この端末のプロジェクト</h3>
          <div className="saved-projects">
            {projects.map((p) => (
              <button
                key={p.id}
                disabled={p.id === project.id || !!busy}
                onClick={async () => {
                  try {
                    await persistNow();
                    const saved = await loadLocal(p.id);
                    if (!saved) throw Error('プロジェクトが見つかりません');
                    await openProject(saved);
                    onClose();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <span className="project-icon">
                  <Film size={22} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.width} × {p.height} ·{' '}
                    {new Date(p.updatedAt).toLocaleDateString('ja-JP')}
                  </small>
                </span>
                {p.id === project.id && <small>編集中</small>}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="dialog-bottom-actions">
        <button
          className="secondary"
          onClick={() =>
            download(
              new Blob([JSON.stringify({ project, repository })], {
                type: 'application/json',
              }),
              `${project.name}.framecut.json`,
            )
          }
        >
          <Download size={16} />
          プロジェクトを保存
        </button>
        <button className="secondary" onClick={() => file.current?.click()}>
          <FolderOpen size={16} />
          保存ファイルを開く
        </button>
        <input
          hidden
          type="file"
          accept=".json"
          ref={file}
          onChange={(e) => {
            if (e.target.files?.[0]) void restore(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>
      <p className="panel-help">
        保存ファイルには編集内容と履歴が含まれます。素材も別端末に移す場合は、Drive
        の「素材も保存」を使ってください。
      </p>
    </Modal>
  );
}
