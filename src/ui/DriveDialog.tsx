import { useEffect, useState } from 'react';
import {
  Cloud,
  Link2,
  LogOut,
  Upload,
  FolderOpen,
  LoaderCircle,
} from 'lucide-react';
import { Modal, Field, Choice } from './controls';
import {
  connected,
  connect,
  disconnect,
  normalizeDriveSaveName,
  prepareGoogle,
  pickProject,
  pullDrive,
  type DriveConfig,
  type SyncRecord,
} from '../storage/drive';
import { readMeta, writeMeta } from '../storage/local';
import { useEditor, openProject, persistNow, notify } from '../app/store';
import { syncProject } from '../sync/controller';
export default function DriveDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { project } = useEditor();
  const config: DriveConfig = {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
    appId: import.meta.env.VITE_GOOGLE_APP_ID || '',
  };
  const available = !!(config.clientId && config.apiKey && config.appId);
  const [isConnected, setConnected] = useState(connected()),
    [mode, setMode] = useState<SyncRecord['mode']>('portable'),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saveName, setSaveName] = useState(''),
    [record, setRecord] = useState<SyncRecord | undefined>(undefined);
  const normalizedSaveName = normalizeDriveSaveName(saveName),
    validSaveName =
      !!normalizedSaveName && normalizedSaveName !== '無題のプロジェクト';
  useEffect(() => {
    if (!open) return;
    setConnected(connected());
    void readMeta<SyncRecord>(`drive-sync:${project.id}`).then((r) => {
      setRecord(r);
      if (r) setMode(r.mode);
      setSaveName(
        r?.saveName ||
          (project.name === '無題のプロジェクト' ? '' : project.name),
      );
    });
    if (available && navigator.onLine) void prepareGoogle().catch(() => {});
  }, [open, project.id, project.name, available]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setConnected(connected());
      setRecord(
        await readMeta<SyncRecord>(
          `drive-sync:${useEditor.getState().project.id}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus('');
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Google Drive"
      description="端末内の編集データを保存して、ほかの端末へ持ち運べます。"
    >
      <div className="drive-connection">
        <Cloud size={28} />
        <div>
          <strong>
            {isConnected ? 'Google Drive に接続済み' : 'Google Drive と連携'}
          </strong>
          <small>
            {isConnected
              ? '編集内容は引き続き端末内にも保存されます。'
              : 'Google アカウントを選ぶだけで接続できます。'}
          </small>
        </div>
      </div>
      {!available && (
        <p className="error-inline" role="alert">
          このアプリでは Google Drive
          連携がまだ有効になっていません。管理者にお問い合わせください。
        </p>
      )}
      {!isConnected ? (
        <button
          className="primary full"
          disabled={busy || !available}
          onClick={() =>
            void run(async () => {
              await connect(config);
              setConnected(true);
              await syncProject(undefined, setStatus);
            })
          }
        >
          <Link2 size={16} />
          {busy ? '接続中…' : 'Google Drive と連携'}
        </button>
      ) : (
        <>
          {!record?.folderId ? (
            <Field label="保存名">
              <input
                value={saveName}
                maxLength={100}
                placeholder="例：旅行動画"
                onChange={(e) => setSaveName(e.target.value)}
              />
              <small>Google Drive/Cutpeak/保存名.cutpeak にまとめます</small>
            </Field>
          ) : (
            <p className="capability-note">
              保存先: <strong>{record.saveName || project.name}.cutpeak</strong>
            </p>
          )}
          <Field label="保存する内容">
            <Choice
              label="Drive の素材保存モード"
              value={mode}
              onChange={(v) => setMode(v as typeof mode)}
              options={[
                { value: 'portable', label: '素材も保存（ほかの端末で編集）' },
                { value: 'local', label: '編集内容だけ保存（素材はこの端末）' },
                { value: 'cached', label: 'クラウド素材を端末に保存して編集' },
              ]}
            />
          </Field>
          {record?.pending && (
            <p className="capability-note">
              未同期の編集があります。再接続中は自動で再試行します。
            </p>
          )}
          <button
            className="primary full"
            disabled={busy || (!record?.folderId && !validSaveName)}
            onClick={() =>
              void run(() => syncProject(mode, setStatus, saveName))
            }
          >
            <Upload size={16} />
            Drive に保存
          </button>
          <button
            className="secondary full"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const id = await pickProject(config);
                if (!id) return;
                await persistNow();
                const saved = await pullDrive(id, setStatus);
                await openProject(saved);
                notify('Drive のプロジェクトを開きました');
                onClose();
              })
            }
          >
            <FolderOpen size={16} />
            Drive から開く
          </button>
          <button
            className="secondary full"
            disabled={busy || !record?.folderId}
            onClick={() =>
              void run(async () => {
                const previous = await readMeta<SyncRecord>(
                  `drive-sync:${project.id}`,
                );
                await writeMeta(
                  `drive-sync-backup:${project.id}:${Date.now()}`,
                  previous,
                );
                const next: SyncRecord = {
                  lastSyncedHead: null,
                  pending: false,
                  mode,
                  assetIds: {},
                };
                await writeMeta(`drive-sync:${project.id}`, next);
                setRecord(next);
                setSaveName(
                  project.name === '無題のプロジェクト' ? '' : project.name,
                );
              })
            }
          >
            別名で保存
          </button>
          <button
            className="text-button full"
            disabled={busy}
            onClick={() => {
              disconnect();
              setConnected(false);
            }}
          >
            <LogOut size={15} />
            接続を解除
          </button>
        </>
      )}
      {busy && (
        <div className="busy-inline">
          <LoaderCircle size={16} className="spin" />
          {status || '処理中…'}
        </div>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      <p className="panel-help">
        Cutpeak
        が作成したファイルと、あなたが選んだプロジェクトだけにアクセスします。接続しなくても編集と書き出しはできます。
      </p>
    </Modal>
  );
}
