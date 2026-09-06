import { useEffect, useState } from 'react';
import {
  Film,
  Type,
  Music2,
  Shapes,
  Cloud,
  Download,
  Undo2,
  Redo2,
  History,
  ChevronDown,
  CheckCircle2,
  LoaderCircle,
  AlertCircle,
  Settings2,
  X,
  Keyboard,
  WifiOff,
  HardDrive,
  MonitorDown,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEditor, bootstrap, api, persistNow, notify } from '../app/store';
import { endFrame, fps } from '../core/model';
import { storageMode, requestPersistence } from '../storage/local';
import { startSyncLoop } from '../sync/controller';
import { registerWebTools } from '../app/webmcp';
import Workspace, { WorkspaceMenu } from './Workspace';
import { usePanelLayout } from './workspace-state';
import ProjectDialog from './ProjectDialog';
import HistoryDialog from './HistoryDialog';
import ExportDialog from './ExportDialog';
import DriveDialog from './DriveDialog';
import { completeDriveRedirect } from '../storage/drive';
import { Modal, bytes, Field } from './controls';
export default function App() {
  const state = useEditor();
  const {
    project,
    repository,
    ready,
    busy,
    notice,
    saveStatus,
    capabilities,
    panel,
  } = state;
  const [modal, setModal] = useState<
      | null
      | 'project'
      | 'history'
      | 'export'
      | 'drive'
      | 'settings'
      | 'shortcuts'
    >(null),
    [online, setOnline] = useState(navigator.onLine),
    [tablet, setTablet] = useState(window.innerWidth <= 850),
    [installPrompt, setInstallPrompt] =
      useState<BeforeInstallPromptEvent | null>(null),
    [installed, setInstalled] = useState(
      window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true,
    );
  useEffect(() => {
    void bootstrap();
    void completeDriveRedirect()
      .then((completed) => {
        if (completed) {
          notify('Google Drive に接続しました');
          setModal('drive');
        }
      })
      .catch((error) => notify((error as Error).message));
    const stop = startSyncLoop(),
      unregister = registerWebTools();
    const network = () => setOnline(navigator.onLine);
    const resize = () => setTablet(window.innerWidth <= 850);
    const offerInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
      notify('Cutpeak をアプリとしてインストールしました');
    };
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener('resize', resize);
    window.addEventListener('beforeinstallprompt', offerInstall);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      stop();
      unregister();
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener('resize', resize);
      window.removeEventListener('beforeinstallprompt', offerInstall);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);
  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') setInstalled(true);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable=true],[role=dialog],[role=combobox]',
        ) ||
        modal
      )
        return;
      const s = useEditor.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 's'
      ) {
        e.preventDefault();
        void persistNow();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (s.selected)
          api.execute({ type: 'clip.split', clipId: s.selected, frame: s.frame });
        else notify('分割するクリップを選択してください');
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (s.selected)
          api.execute({ type: 'clip.duplicate', clipId: s.selected });
      } else if (e.code === 'Space') {
        e.preventDefault();
        window.dispatchEvent(new Event('framecut:toggle-play'));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        api.seek(
          s.frame +
            (e.key === 'ArrowLeft' ? -1 : 1) *
              (e.shiftKey ? Math.round(fps(s.project)) : 1),
        );
      } else if (e.key === 'Home') {
        e.preventDefault();
        api.seek(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        api.seek(endFrame(s.project) - 1);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) {
        e.preventDefault();
        api.execute({ type: 'clip.delete', clipId: s.selected });
      } else if (e.key === 'Escape') {
        api.cancel();
        api.select(null);
      } else if (e.key === '?') {
        setModal('shortcuts');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modal]);
  const supported =
    !capabilities ||
    (capabilities.secureContext &&
      capabilities.webCodecs.videoDecoder &&
      typeof File !== 'undefined');
  const tools = [
    { key: 'media', label: 'メディア', icon: Film },
    { key: 'audio', label: 'オーディオ', icon: Music2 },
    { key: 'text', label: 'テキスト', icon: Type },
    { key: 'elements', label: '図形', icon: Shapes },
  ];
  return (
    <div className="editor-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setModal('project')}
          title="プロジェクトを開く"
        >
          <img className="brand-mark" src="/favicon-v4.jpg" alt="" />
          Cutpeak
        </button>
        <button
          className="project-title"
          onClick={() => setModal('project')}
          title="プロジェクト管理"
        >
          <span>{project.name}</span>
          <ChevronDown size={13} />
        </button>
        <div className="history-buttons">
          <button
            title="元に戻す（⌘ Z）"
            disabled={!repository.commits[repository.head].parentIds.length}
            onClick={() => api.undo()}
          >
            <Undo2 size={18} />
          </button>
          <button
            title="やり直す（⌘ Shift Z）"
            disabled={!repository.redo.length}
            onClick={() => api.redo()}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <button
          className="text-button"
          title="編集履歴と別案"
          onClick={() => setModal('history')}
        >
          <History size={17} />
          <span>履歴</span>
        </button>
        <div className="spacer" />
        <WorkspaceMenu />
        <button
          className={`save-status ${saveStatus === 'error' ? 'error' : ''}`}
          onClick={() => void persistNow()}
          title="今すぐ保存"
        >
          {saveStatus === 'saving' ? (
            <LoaderCircle size={13} className="spin" />
          ) : saveStatus === 'error' ? (
            <AlertCircle size={13} />
          ) : (
            <CheckCircle2 size={13} />
          )}
          <span>
            {saveStatus === 'saving'
              ? '保存中…'
              : saveStatus === 'error'
                ? '保存を確認'
                : 'この端末に保存済み'}
          </span>
        </button>
        <button
          className="text-button"
          title="Google Drive"
          onClick={() => setModal('drive')}
        >
          <Cloud size={18} />
          <span>Drive</span>
        </button>
        <button
          className="compact-settings"
          title="設定とブラウザ診断"
          onClick={() => setModal('settings')}
        >
          <Settings2 size={18} />
        </button>
        <button
          className="primary"
          disabled={!ready || !endFrame(project) || !!busy}
          onClick={() => setModal('export')}
        >
          <Download size={16} />
          <span>書き出す</span>
        </button>
      </header>
      {!supported && (
        <div className="unsupported">
          <AlertCircle size={25} />
          <strong>このブラウザでは動画編集エンジンを利用できません</strong>
          <p>
            HTTPS の Chrome、Edge、Safari 26+
            をご利用ください。保存済みプロジェクトの管理は引き続き利用できます。
          </p>
          <button className="secondary" onClick={() => setModal('project')}>
            プロジェクトを管理
          </button>
        </div>
      )}
      <Workspace tablet={tablet} />
      <Tabs
        className="tool-rail"
        orientation="horizontal"
        value={panel}
        onValueChange={(v) =>
          useEditor.setState({ panel: v as typeof panel, mobilePanel: true })
        }
      >
        <TabsList aria-label="素材ツール">
          {tools.map(({ key, label, icon: Icon }) => (
            <TabsTrigger
              key={key}
              value={key}
              className={panel === key ? 'active' : ''}
              onClick={() => {
                usePanelLayout.getState().show('library', true);
                useEditor.setState({ mobilePanel: true });
              }}
            >
              <Icon size={21} />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="spacer" />
        <button
          title="設定とブラウザ診断"
          className="rail-settings"
          onClick={() => setModal('settings')}
        >
          <Settings2 size={20} />
        </button>
      </Tabs>

      <footer className="statusbar">
        <span>CUTPEAK</span>
        <span className="storage-indicator">
          <HardDrive size={11} />
          {storageMode === 'opfs' ? '端末に自動保存' : '互換保存モード'}
        </span>
        {!online && (
          <span>
            <WifiOff size={11} />
            オフライン
          </span>
        )}
        <div className="spacer" />
        <span>{fps(project).toFixed(2).replace('.00', '')} fps</span>
        <span>
          {
            repository.branches.find((b) => b.id === repository.activeBranch)
              ?.name
          }
        </span>
        <button
          title="キーボードショートカット"
          onClick={() => setModal('shortcuts')}
        >
          <Keyboard size={13} />
          <span>ショートカット</span>
        </button>
      </footer>
      {notice && (
        <output className="toast">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button
            title="通知を閉じる"
            onClick={() => useEditor.setState({ notice: '' })}
          >
            <X size={14} />
          </button>
        </output>
      )}
      {!ready && (
        <div className="boot-overlay">
          <LoaderCircle size={28} className="spin" />
          <strong>{busy || '編集環境を準備しています…'}</strong>
        </div>
      )}
      <ProjectDialog
        open={modal === 'project'}
        onClose={() => setModal(null)}
      />
      <HistoryDialog
        open={modal === 'history'}
        onClose={() => setModal(null)}
      />
      <ExportDialog open={modal === 'export'} onClose={() => setModal(null)} />
      <DriveDialog open={modal === 'drive'} onClose={() => setModal(null)} />
      <Modal
        open={modal === 'settings'}
        onClose={() => setModal(null)}
        title="プロジェクトと保存設定"
      >
        <Field label="プロジェクト名">
          <input
            value={project.name}
            onFocus={() => api.begin('プロジェクト名を変更')}
            onChange={(e) =>
              api.execute({
                type: 'project.update',
                patch: { name: e.target.value },
              })
            }
            onBlur={() => api.end()}
          />
        </Field>
        <Field label="背景色">
          <input
            type="color"
            aria-label="キャンバス背景色"
            value={project.background}
            onChange={(e) =>
              api.execute({
                type: 'project.update',
                patch: { background: e.target.value },
              })
            }
          />
        </Field>
        <div className="export-detail">
          <span>ストレージ使用量</span>
          <strong>
            {bytes(capabilities?.usage || 0)} /{' '}
            {bytes(capabilities?.quota || 0)}
          </strong>
        </div>
        <button
          className="secondary full"
          onClick={async () =>
            notify(
              (await requestPersistence())
                ? '保存領域の保持が許可されました'
                : '保存領域の保持はブラウザが判断します。自動保存は引き続き利用できます。',
            )
          }
        >
          保存領域の保持を要求
        </button>
        <div className="section-label">アプリ</div>
        {installed ? (
          <div className="export-detail">
            <span>インストール状態</span>
            <strong>インストール済み</strong>
          </div>
        ) : installPrompt ? (
          <button className="secondary full" onClick={() => void installApp()}>
            <MonitorDown size={17} />
            この端末にインストール
          </button>
        ) : (
          <p className="panel-help">
            ブラウザの共有またはメニューから「ホーム画面に追加」か「アプリをインストール」を選べます。
          </p>
        )}
        <div className="section-label">このアプリについて</div>
        <div className="export-detail">
          <span>製作者</span>
          <strong>yazirushi</strong>
        </div>
        <div className="section-label">ブラウザ診断</div>
        <div className="diagnostics">
          {Object.entries({
            WebCodecs: capabilities?.webCodecs.videoDecoder,
            WebGL2: capabilities?.graphics.webgl2,
            OPFS: capabilities?.storage.opfs,
            AudioWorklet: capabilities?.audio.audioWorklet,
            'H.264 Encode': capabilities?.codecs.h264Encode,
            'AAC Encode': capabilities?.codecs.aacEncode,
            'VP9 Encode': capabilities?.codecs.vp9Encode,
            'Opus Encode': capabilities?.codecs.opusEncode,
          }).map(([key, ok]) => (
            <div key={key}>
              <span>{key}</span>
              <span className={ok ? 'ok' : 'muted'}>
                {ok ? '利用可能' : '非対応'}
              </span>
            </div>
          ))}
        </div>
        <p className="panel-help">
          このブラウザのデータを削除すると、ローカルの素材とプロジェクトも削除されます。大切な作品はファイルまたは
          Drive に保存してください。
        </p>
      </Modal>
      <Modal
        open={modal === 'shortcuts'}
        onClose={() => setModal(null)}
        title="キーボードショートカット"
      >
        <div className="shortcut-list">
          {[
            ['再生・停止', 'Space'],
            ['1フレーム移動', '← / →'],
            ['1秒移動', 'Shift + ← / →'],
            ['先頭・末尾へ', 'Home / End'],
            ['分割', '⌘ / Ctrl + S（選択中）'],
            ['削除', 'Delete'],
            ['複製', '⌘ / Ctrl + D'],
            ['元に戻す', '⌘ / Ctrl + Z'],
            ['やり直す', '⌘ / Ctrl + Shift + Z'],
            ['今すぐ保存', '⌘ / Ctrl + Shift + S'],
            ['スナップを一時解除', 'Alt + ドラッグ'],
          ].map(([label, key]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
