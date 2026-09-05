import { useEffect, useState } from 'react';
import {
  Cloud,
  Link2,
  LogOut,
  Upload,
  FolderOpen,
  LoaderCircle,
  ExternalLink,
} from 'lucide-react';
import { Modal, Field, Choice } from './controls';
import {
  connected,
  connect,
  disconnect,
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
  const [config, setConfig] = useState<DriveConfig>({
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
      apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
      appId: import.meta.env.VITE_GOOGLE_APP_ID || '',
    }),
    [isConnected, setConnected] = useState(connected()),
    [mode, setMode] = useState<SyncRecord['mode']>('portable'),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [configured, setConfigured] = useState(false),
    [record, setRecord] = useState<SyncRecord | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    setConnected(connected());
    void readMeta<DriveConfig>('drive-config').then((v) => {
      if (v) {
        setConfig(v);
        setConfigured(!!v.clientId);
      }
    });
    void readMeta<SyncRecord>(`drive-sync:${project.id}`).then((r) => {
      setRecord(r);
      if (r) setMode(r.mode);
    });
    if (navigator.onLine) void prepareGoogle().catch(() => {});
  }, [open, project.id]);
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
            {isConnected ? 'Google Drive に接続済み' : 'Google Drive に接続'}
          </strong>
          <small>
            {isConnected
              ? '編集内容は引き続き端末内にも保存されます。'
              : '接続しなくても、編集・書き出しができます。'}
          </small>
        </div>
      </div>
      {(!configured || !config.clientId) && (
        <div className="drive-setup">
          <p>初回は Google Cloud の設定が必要です。</p>
          <Field label="OAuth Client ID">
            <input
              aria-label="OAuth Client ID"
              value={config.clientId}
              placeholder="…apps.googleusercontent.com"
              onChange={(e) =>
                setConfig({ ...config, clientId: e.target.value.trim() })
              }
            />
          </Field>
          <Field label="API Key">
            <input
              aria-label="Google API Key"
              value={config.apiKey}
              onChange={(e) =>
                setConfig({ ...config, apiKey: e.target.value.trim() })
              }
            />
          </Field>
          <Field label="App ID（プロジェクト番号）">
            <input
              aria-label="Google App ID"
              value={config.appId}
              onChange={(e) =>
                setConfig({ ...config, appId: e.target.value.trim() })
              }
            />
          </Field>
          <p className="panel-help">
            Drive API と Google Picker API を有効にし、JavaScript の生成元に{' '}
            <code>{location.origin}</code> を追加してください。API Key
            はこの生成元と使用APIに制限してください。
          </p>
          <a
            className="inline-link"
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            Google Cloud の認証情報を開く <ExternalLink size={13} />
          </a>
          <button
            className="secondary full"
            disabled={!config.clientId || !config.apiKey || !config.appId}
            onClick={() => {
              void writeMeta('drive-config', config);
              setConfigured(true);
            }}
          >
            設定を保存
          </button>
        </div>
      )}
      {!isConnected ? (
        <button
          className="primary full"
          disabled={busy || !config.clientId || !config.apiKey || !config.appId}
          onClick={() =>
            void run(async () => {
              await writeMeta('drive-config', config);
              await connect(config);
              setConfigured(true);
              setConnected(true);
              await syncProject(undefined, setStatus);
            })
          }
        >
          <Link2 size={16} />
          {busy ? '接続中…' : 'Google アカウントで接続'}
        </button>
      ) : (
        <>
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
            disabled={busy}
            onClick={() => void run(() => syncProject(mode, setStatus))}
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
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const previous = await readMeta<SyncRecord>(
                  `drive-sync:${project.id}`,
                );
                await writeMeta(
                  `drive-sync-backup:${project.id}:${Date.now()}`,
                  previous,
                );
                await writeMeta(`drive-sync:${project.id}`, {
                  lastSyncedHead: null,
                  pending: true,
                  mode,
                  assetIds: {},
                });
                await syncProject(mode, setStatus);
              })
            }
          >
            別の保存先へ保存
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
      <button
        className="subtle-link"
        disabled={busy}
        onClick={() => setConfigured(false)}
      >
        接続設定を編集
      </button>
      <p className="panel-help">
        アクセストークンは保存しません。接続が切れても、端末内の編集と自動保存は続きます。
      </p>
    </Modal>
  );
}
