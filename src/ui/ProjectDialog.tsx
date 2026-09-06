import { useRef, useState } from 'react';
import {
  Plus,
  FolderOpen,
  Download,
  Film,
  Trash2,
  Cloud,
  ArrowRight,
  FileJson,
  Check,
  HardDrive,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Modal, Choice, Field } from './controls';
import {
  useEditor,
  newProject,
  openProject,
  deleteProject,
  persistNow,
  notify,
} from '../app/store';
import { download, loadLocal, type SavedProject } from '../storage/local';
import { validateProject } from '../core/model';
import { validateRepository } from '../core/history';

export default function ProjectDialog({
  open,
  onClose,
  onDrive,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  onDrive: () => void;
  onExport: () => void;
}) {
  const { project, repository, projects, busy, saveStatus } = useEditor();
  const [name, setName] = useState('新しいプロジェクト');
  const [size, setSize] = useState('1920x1080');
  const [rate, setRate] = useState('30');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const disabled = !!busy || working;
  const filename = `${project.name}.framecut.json`;

  async function run(action: () => Promise<void>) {
    if (disabled) return;
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function restore(f: File) {
    await run(async () => {
      const data = JSON.parse(await f.text()) as SavedProject;
      validateProject(data.project);
      validateRepository(data.repository);
      await persistNow();
      await openProject(data);
      onClose();
      notify(
        'プロジェクトを開きました。未接続の素材はメディアから再接続できます。',
      );
    });
  }
  async function remove(p: (typeof projects)[number]) {
    if (
      !window.confirm(
        `「${p.name}」の編集内容・履歴・保存済みの素材をこのブラウザから削除します。この操作は元に戻せません。Driveやダウンロード済みのファイルは削除されません。`,
      )
    )
      return;
    await run(async () => {
      await deleteProject(p.id);
      notify(`「${p.name}」をこの端末から削除しました`);
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!disabled) onClose();
      }}
      title="プロジェクト"
      description="編集を再開する、新しく作る、編集用ファイルを保存する。"
      wide
    >
      <div className="project-manager">
        <Tabs
          defaultValue="open"
          onValueChange={() => {
            setError('');
            setDownloaded(false);
          }}
        >
          <TabsList className="project-nav" aria-label="プロジェクトの操作">
            <TabsTrigger value="open">
              <FolderOpen size={17} />
              開く
            </TabsTrigger>
            <TabsTrigger value="new">
              <Plus size={17} />
              新しく作る
            </TabsTrigger>
            <TabsTrigger value="save">
              <Download size={17} />
              ファイルに保存
            </TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="project-page">
            <div className="project-page-title">
              <h3>どこから開きますか？</h3>
              <p>
                保存したファイルを読み込むか、このブラウザの編集を再開できます。
              </p>
            </div>
            <div className="project-entry-grid">
              <button
                className="project-entry"
                disabled={disabled}
                onClick={() => file.current?.click()}
              >
                <span className="project-entry-icon">
                  <FileJson size={23} />
                </span>
                <span>
                  <strong>プロジェクトファイルを読み込む</strong>
                  <small>Cutpeakから保存した .framecut.json</small>
                </span>
                <ArrowRight size={18} />
              </button>
              <button
                className="project-entry"
                disabled={disabled}
                onClick={onDrive}
              >
                <span className="project-entry-icon">
                  <Cloud size={23} />
                </span>
                <span>
                  <strong>Google Driveから開く</strong>
                  <small>別の端末や共有プロジェクトから再開</small>
                </span>
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="project-list-title">
              <h3>このブラウザに保存済み</h3>
              <span>{projects.length}件</span>
            </div>
            <div className="saved-projects">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className={`saved-project-row ${p.id === project.id ? 'is-current' : ''}`}
                >
                  <button
                    className="project-open"
                    disabled={disabled}
                    onClick={() => {
                      if (p.id === project.id) {
                        onClose();
                        return;
                      }
                      void run(async () => {
                        await persistNow();
                        const saved = await loadLocal(p.id);
                        if (!saved) throw Error('プロジェクトが見つかりません');
                        await openProject(saved);
                        onClose();
                      });
                    }}
                  >
                    <span className="project-icon">
                      <Film size={20} />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.width} × {p.height} ·{' '}
                        {new Date(p.updatedAt).toLocaleDateString('ja-JP')}
                      </small>
                    </span>
                    <span className="project-resume">
                      {p.id === project.id ? '編集中に戻る' : '開く'}
                      <ArrowRight size={15} />
                    </span>
                  </button>
                  <button
                    className="project-delete"
                    disabled={disabled}
                    title="このブラウザから削除"
                    aria-label={`${p.name}をこのブラウザから削除`}
                    onClick={() => void remove(p)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {!projects.length && (
                <p className="project-empty">
                  保存済みのプロジェクトはありません。「新しく作る」から始められます。
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="new" className="project-page">
            <div className="project-page-title">
              <h3>新しい編集を始める</h3>
              <p>名前と画面サイズを決めて作成します。</p>
            </div>
            <form
              className="project-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                void run(async () => {
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
                });
              }}
            >
              <Field label="プロジェクト名">
                <input
                  value={name}
                  disabled={disabled}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：夏の旅行"
                  required
                />
              </Field>
              <div className="project-form-options">
                <Field label="画面サイズ">
                  <Choice
                    label="画面サイズ"
                    value={size}
                    onChange={setSize}
                    disabled={disabled}
                    options={[
                      {
                        value: '1920x1080',
                        label: '横長 · 1920 × 1080 (16:9)',
                      },
                      {
                        value: '1080x1920',
                        label: '縦長 · 1080 × 1920 (9:16)',
                      },
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
                    disabled={disabled}
                    options={['24', '25', '29.97', '30', '59.94', '60'].map(
                      (n) => ({ value: n, label: `${n} fps` }),
                    )}
                  />
                </Field>
              </div>
              <button
                type="submit"
                className="primary"
                disabled={disabled || !name.trim()}
              >
                <Plus size={17} />
                作成して編集を始める
              </button>
            </form>
          </TabsContent>

          <TabsContent value="save" className="project-page">
            <div className="project-page-title">
              <h3>編集を再開できるファイルを保存</h3>
              <p>
                今開いているプロジェクトの編集内容と履歴をダウンロードします。
              </p>
            </div>
            <div className="project-save-card">
              <div className="project-save-target">
                <span className="project-entry-icon">
                  <FileJson size={26} />
                </span>
                <div>
                  <small>保存するプロジェクト</small>
                  <strong>{project.name}</strong>
                  <span>{filename}</span>
                </div>
              </div>
              <div className="project-save-contents">
                <span>
                  <Check size={16} />
                  編集内容・編集履歴を含む
                </span>
                <span>動画・画像・音声の素材は含みません</span>
              </div>
              <p>
                別の端末で開く場合は、元の素材ファイルを用意して再接続してください。
              </p>
              <button
                className="primary full"
                disabled={disabled}
                onClick={() => {
                  download(
                    new Blob([JSON.stringify({ project, repository })], {
                      type: 'application/json',
                    }),
                    filename,
                  );
                  setDownloaded(true);
                }}
              >
                <Download size={17} />
                プロジェクトファイルをダウンロード
              </button>
              {downloaded && (
                <output className="project-download-status">
                  ダウンロードを開始しました。再開するときは「開く」→「プロジェクトファイルを読み込む」を選んでください。
                </output>
              )}
            </div>
            <div className="project-save-alternatives">
              <button disabled={disabled} onClick={onDrive}>
                <Cloud size={19} />
                <span>
                  <strong>素材もまとめて保存したい</strong>
                  <small>Google Driveで「素材も保存」を選択</small>
                </span>
                <ArrowRight size={17} />
              </button>
              <button disabled={disabled} onClick={onExport}>
                <Film size={19} />
                <span>
                  <strong>完成した動画を保存したい</strong>
                  <small>動画の書き出しへ（MP4 / WebM）</small>
                </span>
                <ArrowRight size={17} />
              </button>
            </div>
          </TabsContent>
        </Tabs>
        {error && (
          <p className="error-inline" role="alert">
            {error}
          </p>
        )}
        <div className="project-autosave">
          <HardDrive size={15} />
          <span>
            {busy ||
              (working
                ? '処理中…'
                : saveStatus === 'saved'
                  ? '編集中の内容は、このブラウザに自動保存されています。'
                  : saveStatus === 'error'
                    ? '自動保存に失敗しました。ファイルに保存してください。'
                    : 'このブラウザに自動保存中…')}
          </span>
        </div>
        <input
          hidden
          type="file"
          accept=".json,application/json"
          ref={file}
          onChange={(e) => {
            if (e.target.files?.[0]) void restore(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
}
