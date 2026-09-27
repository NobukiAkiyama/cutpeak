import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  Film,
  Layers3,
  LoaderCircle,
} from 'lucide-react';
import { Modal, bytes } from './controls';
import { projectFiles, useEditor } from '../app/store';
import { endFrame, fps } from '../core/model';
import {
  bakedClips,
  packageName,
  runNleExport,
  usedAssetIds,
  type NleExportJob,
} from '../media/nle/export';
import { download, saveDownload, supportsSaveLocation } from '../storage/local';

export default function NleExportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { project, offline } = useEditor();
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const worker = useRef<Worker | null>(null);
  const cancelled = useRef(false);
  const used = usedAssetIds(project);
  const missing = [...used].filter((id) => offline.includes(id));
  const baked = bakedClips(project);
  const tooManyBakedFrames = baked.reduce((sum, clip) => sum + clip.durationFrames, 0) > 60000;
  const staticCount = project.tracks.reduce((count, track) => count +
    (track.hidden ? 0 : track.clips.filter((clip) =>
      clip.type === 'text' || clip.type === 'caption' || clip.type === 'shape',
    ).length), 0);
  const mediaSize = project.assets
    .filter((asset) => used.has(asset.id))
    .reduce((sum, asset) => sum + asset.size, 0);
  useEffect(() => {
    if (open) {
      setResult(null);
      setError('');
      setProgress(0);
    }
  }, [open]);
  useEffect(() => () => worker.current?.terminate(), []);

  async function save(value: { blob: Blob; name: string }) {
    setSaving(true);
    setError('');
    try {
      const outcome = await saveDownload(value.blob, value.name);
      if (outcome === 'cancelled')
        setError('保存先の選択をキャンセルしました。もう一度保存できます。');
    } catch (caught) {
      setError(`保存できませんでした: ${(caught as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function start() {
    if (running || missing.length || !endFrame(project)) return;
    setRunning(true);
    setResult(null);
    setProgress(0);
    setError('');
    cancelled.current = false;
    try {
      const snapshot = structuredClone(project);
      const job: NleExportJob = {
        project: snapshot,
        files: await projectFiles(snapshot, usedAssetIds(snapshot)),
      };
      const finish = async (blob: Blob) => {
        worker.current?.terminate();
        worker.current = null;
        setProgress(1);
        setRunning(false);
        const value = { blob, name: packageName(snapshot.name) };
        setResult(value);
        if (!supportsSaveLocation()) await save(value);
      };
      const onFailure = (caught: unknown) => {
        worker.current?.terminate();
        worker.current = null;
        setRunning(false);
        setError((caught as Error).message || '書き出しに失敗しました');
      };
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
        await finish(await runNleExport(job, setProgress, () => cancelled.current));
      } else {
        const current = new Worker(
          new URL('../workers/nle-export.worker.ts', import.meta.url),
          { type: 'module' },
        );
        worker.current = current;
        current.onmessage = ({ data }) => {
          if (data.type === 'progress') setProgress(data.value);
          if (data.type === 'error') onFailure(Error(data.error));
          if (data.type === 'done') void finish(data.blob);
        };
        current.onerror = () => onFailure(Error('書き出し処理を開始できませんでした'));
        current.postMessage({ type: 'export', ...job });
      }
    } catch (caught) {
      setRunning(false);
      setError((caught as Error).message);
    }
  }

  const stage = progress < 0.05
    ? '素材を確認中'
    : progress < 0.72
      ? '動く効果を画像に変換中'
      : progress < 1
        ? 'ZIPにまとめています'
        : '完了';

  return (
    <Modal
      open={open}
      onClose={() => { if (!running && !saving) onClose(); }}
      title="編集ソフト用に書き出す"
      description="Final Cut Pro・DaVinci Resolveで続きを編集できるファイルを作ります。"
    >
      <div className="nle-intro">
        <span className="nle-intro-icon"><Layers3 size={25} /></span>
        <div>
          <strong>{project.name}</strong>
          <small>{(endFrame(project) / fps(project)).toFixed(2)} 秒 · {project.tracks.length} トラック</small>
        </div>
      </div>
      <div className="nle-package-card">
        <div className="nle-package-heading">
          <FileArchive size={22} />
          <div>
            <strong>{packageName(project.name)}</strong>
            <small>タイムラインと使用素材をまとめたZIP</small>
          </div>
        </div>
        <div className="nle-package-facts">
          <span><Film size={15} /> 使用素材 {used.size} 件</span>
          <span>元素材 約 {bytes(mediaSize)}</span>
        </div>
        {baked.length > 0 && (
          <p className="nle-bake-note">
            GIF・パペット変形を含む {baked.length} クリップは、動きを保つため画像に変換します。
          </p>
        )}
        {staticCount > 0 && (
          <p className="nle-bake-note">
            文字・図形の {staticCount} クリップは画像になります。編集ソフトでは位置と長さを変更できます。
          </p>
        )}
      </div>
      <div className="nle-apps">
        <div><strong>Final Cut Pro</strong><small>ZIPを展開してXMLを読み込みます。素材は自動でつながります。</small></div>
        <div><strong>DaVinci Resolve</strong><small>XMLを読み込み、必要に応じて同梱のmediaフォルダを指定します。</small></div>
      </div>
      <p className="nle-readme-note">詳しい読み込み手順はZIP内の README.txt に入ります。</p>
      {missing.length > 0 && (
        <p className="error-inline"><AlertCircle size={16} /> 未接続の素材があります。メディアから再接続してください。</p>
      )}
      {tooManyBakedFrames && (
        <p className="error-inline"><AlertCircle size={16} /> 動く効果の画像化が上限を超えます。対象クリップを短くしてください。</p>
      )}
      {running && (
        <div className="export-progress">
          <div><span><LoaderCircle size={15} className="spin" /> {stage}</span><strong>{Math.round(progress * 100)}%</strong></div>
          <progress max={1} value={progress} />
          <small>この画面を開いたままお待ちください。</small>
        </div>
      )}
      {error && <p className="error-inline" role="alert">{error}</p>}
      {result && (
        <div className="export-complete">
          <CheckCircle2 size={24} />
          <strong>書き出しが完了しました</strong>
          <small>{bytes(result.blob.size)}</small>
          <button className="secondary full" disabled={saving} onClick={() => void save(result)}>
            <Download size={16} />
            {supportsSaveLocation() ? '保存先を選んでダウンロード' : 'もう一度ダウンロード'}
          </button>
          {supportsSaveLocation() && (
            <button className="text-button nle-direct-download" onClick={() => download(result.blob, result.name)}>
              保存先を選ばずダウンロード
            </button>
          )}
        </div>
      )}
      {running ? (
        <button className="secondary full" onClick={() => {
          cancelled.current = true;
          worker.current?.postMessage({ type: 'cancel' });
        }}>書き出しを中止</button>
      ) : !result ? (
        <button className="primary full" disabled={saving || !!missing.length || tooManyBakedFrames || !endFrame(project)} onClick={() => void start()}>
          <Download size={17} />
          編集ソフト用ZIPを書き出す
        </button>
      ) : null}
    </Modal>
  );
}
