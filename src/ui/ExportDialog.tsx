import { useEffect, useRef, useState } from 'react';
import {
  Download,
  CheckCircle2,
  LoaderCircle,
  Film,
  AlertCircle,
} from 'lucide-react';
import { Modal, Choice, Field, NumberField, bytes } from './controls';
import { useEditor, projectFiles } from '../app/store';
import { endFrame, fps, audible } from '../core/model';
import { probeExport } from '../app/capabilities';
import type { ExportJob } from '../media/export';
import { saveDownload, supportsSaveLocation } from '../storage/local';
export default function ExportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { project, offline } = useEditor();
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4'),
    [scale, setScale] = useState('1'),
    [bitrate, setBitrate] = useState(12),
    [formats, setFormats] = useState({ mp4: false, webm: false }),
    [supported, setSupported] = useState<boolean | null>(null),
    [running, setRunning] = useState(false),
    [saving, setSaving] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const missingUsed = offline.filter((id) =>
    project.tracks.some((t) => t.clips.some((c) => c.assetId === id)),
  );
  const worker = useRef<Worker | undefined>(undefined),
    cancelled = useRef(false);
  const width = Math.max(
      2,
      Math.round((project.width * Number(scale)) / 2) * 2,
    ),
    height = Math.max(2, Math.round((project.height * Number(scale)) / 2) * 2),
    hasAudio = audible(project);
  const { mp4, webm } = formats;
  const rate = fps(project);
  useEffect(() => {
    if (open) {
      setResult(null);
      setProgress(0);
      setError('');
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setSupported(null);
    void Promise.all([
      probeExport('mp4', width, height, rate, bitrate * 1e6, hasAudio),
      probeExport('webm', width, height, rate, bitrate * 1e6, hasAudio),
    ]).then(([mp4, webm]) => {
      if (!active) return;
      setFormats({ mp4, webm });
      if (
        (format === 'mp4' && !mp4 && webm) ||
        (format === 'webm' && !webm && mp4)
      ) {
        setFormat(mp4 ? 'mp4' : 'webm');
      }
      setSupported(format === 'mp4' ? mp4 : webm);
    });
    return () => {
      active = false;
    };
  }, [open, format, width, height, rate, bitrate, hasAudio]);
  useEffect(() => () => worker.current?.terminate(), []);
  async function saveResult(value: { blob: Blob; name: string }) {
    setSaving(true);
    setError('');
    try {
      const outcome = await saveDownload(value.blob, value.name);
      if (outcome === 'cancelled')
        setError('保存先の選択をキャンセルしました。下のボタンから再度保存できます。');
    } catch (e) {
      setError(`保存できませんでした: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  async function start() {
    if (!supported || running) return;
    setRunning(true);
    setError('');
    setProgress(0);
    setResult(null);
    cancelled.current = false;
    try {
      const snapshot = structuredClone(project),
        files = await projectFiles(snapshot),
        jobId = crypto.randomUUID();
      const finish = async (data: { blob: Blob; path?: string }) => {
        setProgress(1);
        setRunning(false);
        const value = { blob: data.blob, name: `${snapshot.name}.${format}` };
        setResult(value);
        worker.current?.terminate();
        if (!supportsSaveLocation()) await saveResult(value);
        if (data.path)
          setTimeout(() => {
            void navigator.storage
              .getDirectory()
              .then((r) => r.getDirectoryHandle('framecut-exports'))
              .then((d) => d.removeEntry(data.path!))
              .catch(() => {});
          }, 120000);
      };
      const job: ExportJob = {
        project: snapshot,
        files,
        format,
        bitrate: bitrate * 1e6,
        jobId,
        outputWidth: width,
        outputHeight: height,
      };
      const runOnMainThread = async () => {
        const { runExport } = await import('../media/export');
        await finish(
          await runExport(job, setProgress, () => cancelled.current),
        );
      };
      if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined')
        await runOnMainThread();
      else {
        const w = new Worker(
          new URL('../workers/export.worker.ts', import.meta.url),
          { type: 'module' },
        );
        worker.current = w;
        w.onerror = () => {
          w.terminate();
          void runOnMainThread().catch((error) => {
            setError(`書き出しに失敗しました: ${(error as Error).message}`);
            setRunning(false);
          });
        };
        w.onmessage = ({ data }) => {
          if (data.type === 'progress') setProgress(data.value);
          if (data.type === 'error') {
            setError(data.error || '書き出しに失敗しました');
            setRunning(false);
            w.terminate();
          }
          if (data.type === 'done') void finish(data);
        };
        w.postMessage({ type: 'export', ...job });
      }
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!running && !saving) onClose();
      }}
      title="動画を書き出す"
      description="映像と音声は、端末内で処理されます。"
    >
      <div className="export-summary">
        <Film size={27} />
        <div>
          <strong>{project.name}</strong>
          <small>
            {(endFrame(project) / fps(project)).toFixed(2)} 秒 ·{' '}
            {project.tracks.length} トラック
          </small>
        </div>
      </div>
      <fieldset disabled={running}>
        <Field label="ファイル形式">
          <Choice
            label="書き出し形式"
            value={format}
            onChange={(v) => setFormat(v as 'mp4')}
            options={[
              {
                value: 'mp4',
                label: 'MP4 · H.264' + (hasAudio ? ' + AAC' : ''),
                disabled: !mp4,
              },
              {
                value: 'webm',
                label: 'WebM · VP9' + (hasAudio ? ' + Opus' : ''),
                disabled: !webm,
              },
            ]}
          />
        </Field>
        {!mp4 && hasAudio && (
          <p className="capability-note">
            この環境では音声付きMP4を書き出せません。WebMをご利用ください。
          </p>
        )}
        <Field label="解像度">
          <Choice
            label="書き出し解像度"
            value={scale}
            onChange={setScale}
            options={['1', '0.5', '0.25'].map((s) => ({
              value: s,
              label: `${Math.round((project.width * Number(s)) / 2) * 2} × ${Math.round((project.height * Number(s)) / 2) * 2}${s === '1' ? '（プロジェクトと同じ）' : ''}`,
            }))}
          />
        </Field>
        <div className="export-detail">
          <span>フレームレート</span>
          <strong>
            {fps(project)
              .toFixed(3)
              .replace(/\.?0+$/, '')}{' '}
            fps
          </strong>
        </div>
        <NumberField
          label="ビットレート"
          value={bitrate}
          min={1}
          max={80}
          suffix="Mbps"
          onChange={setBitrate}
        />
        <div className="export-detail">
          <span>推定ファイルサイズ</span>
          <strong>
            約{' '}
            {bytes(
              ((bitrate * 1e6 + (hasAudio ? 192000 : 0)) * endFrame(project)) /
                fps(project) /
                8,
            )}
          </strong>
        </div>
      </fieldset>
      {supported === false && (
        <p className="error-inline">
          <AlertCircle size={16} />
          この形式・解像度では書き出せません。形式か解像度を変更してください。
        </p>
      )}
      {missingUsed.length > 0 && (
        <p className="error-inline">
          未接続の素材があります。メディアから再接続してください。
        </p>
      )}
      {running && (
        <div className="export-progress">
          <div>
            <span>
              <LoaderCircle size={15} className="spin" />
              書き出し中…
            </span>
            <strong>{Math.round(progress * 100)}%</strong>
          </div>
          <progress max={1} value={progress} />
          <small>この画面を開いたままお待ちください。</small>
        </div>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="export-complete">
          <CheckCircle2 size={24} />
          <strong>書き出しが完了しました</strong>
          <small>{bytes(result.blob.size)}</small>
          <button
            className="secondary full"
            disabled={saving}
            onClick={() => void saveResult(result)}
          >
            <Download size={16} />
            {supportsSaveLocation()
              ? '保存先を選んでダウンロード'
              : 'もう一度ダウンロード'}
          </button>
        </div>
      )}
      {running ? (
        <button
          className="secondary full"
          onClick={() => {
            cancelled.current = true;
            worker.current?.postMessage({ type: 'cancel' });
          }}
        >
          書き出しを中止
        </button>
      ) : saving ? (
        <button className="secondary full" disabled>
          <LoaderCircle size={16} className="spin" />
          保存先を選択中…
        </button>
      ) : (
        <button
          className="primary full"
          disabled={!supported || !endFrame(project) || missingUsed.length > 0}
          onClick={() => void start()}
        >
          <Download size={17} />
          {supported === null
            ? '書き出し能力を確認中…'
            : result
              ? 'もう一度書き出す'
              : '書き出す'}
        </button>
      )}
    </Modal>
  );
}
