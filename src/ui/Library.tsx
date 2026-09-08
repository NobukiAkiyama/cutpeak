import { useEffect, useRef } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { api, importFiles, notify, useEditor } from '../app/store';
import { makeClip, makeTrack } from '../core/model';
import { parseSrt } from '../core/timeline';
import { CaptionPanel } from './library/CaptionPanel';
import { MediaPanel } from './library/MediaPanel';
import { ShapePanel } from './library/ShapePanel';
import { TextPanel } from './library/TextPanel';

const panelLabels = {
  media: 'メディア',
  audio: 'オーディオ',
  text: 'テキスト',
  captions: '字幕',
  elements: '図形',
};

export default function Library() {
  const { project, panel, busy, offline, assetIssues, mobilePanel } =
    useEditor();
  const input = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const relink = useRef<string | undefined>(undefined);
  const library = useRef<HTMLElement>(null);
  const isMedia = panel === 'media' || panel === 'audio';

  useEffect(() => {
    const target = library.current;
    if (!target) return;
    const allowDrop = (event: DragEvent) => event.preventDefault();
    const importDroppedFiles = (event: DragEvent) => {
      event.preventDefault();
      void importFiles(Array.from(event.dataTransfer?.files || []));
    };
    target.addEventListener('dragover', allowDrop);
    target.addEventListener('drop', importDroppedFiles);
    return () => {
      target.removeEventListener('dragover', allowDrop);
      target.removeEventListener('drop', importDroppedFiles);
    };
  }, []);

  async function importSrt(file: File) {
    try {
      const captions = parseSrt(await file.text(), project);
      if (!captions.length) throw Error('字幕がありません');
      const track = makeTrack('caption', file.name);
      api.begin('SRT 字幕を読み込み');
      api.execute({ type: 'track.add', track });
      for (const caption of captions) {
        const clip = makeClip(project, 'caption', caption.startFrame);
        Object.assign(clip, caption);
        clip.name = caption.text.slice(0, 24);
        clip.transform.y.defaultValue = project.height * 0.84;
        clip.style.size = 54;
        clip.style.strokeWidth = 3;
        api.execute({ type: 'clip.add', trackId: track.id, clip });
      }
      api.end();
      notify(`${captions.length} 件の字幕を追加しました`);
    } catch (error) {
      api.cancel();
      notify((error as Error).message);
    }
  }

  return (
    <aside
      ref={library}
      className={`library ${mobilePanel ? 'mobile-open' : ''}`}
      aria-label={`${panelLabels[panel]}パネル`}
    >
      <div className="panel-heading">
        {panelLabels[panel]}
        <span>{isMedia ? project.assets.length : ''}</span>
        <button
          className="mobile-close"
          title="素材パネルを閉じる"
          onClick={() => useEditor.setState({ mobilePanel: false })}
        >
          <X size={16} />
        </button>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        multiple
        accept="video/*,audio/*,image/png,image/jpeg,image/gif,image/webp,.mov,.mkv,.ogg,.aac,.opus"
        onChange={(event) => {
          void importFiles(Array.from(event.target.files || []), {
            relinkId: relink.current,
          });
          relink.current = undefined;
          event.target.value = '';
        }}
      />
      {isMedia && (
        <p id="media-import-help" className="sr-only">
          素材を読み込むボタンからファイルを選ぶか、このパネルへファイルをドロップできます。
        </p>
      )}
      <input
        hidden
        ref={srtInput}
        type="file"
        accept=".srt"
        onChange={(event) => {
          if (event.target.files?.[0]) void importSrt(event.target.files[0]);
          event.target.value = '';
        }}
      />
      {isMedia && (
        <MediaPanel
          project={project}
          panel={panel}
          busy={!!busy}
          offline={offline}
          assetIssues={assetIssues}
          onImport={() => {
            relink.current = undefined;
            input.current?.click();
          }}
          onRelink={(assetId) => {
            relink.current = assetId;
            input.current?.click();
          }}
        />
      )}
      {panel === 'text' && <TextPanel />}
      {panel === 'captions' && (
        <CaptionPanel project={project} srtInput={srtInput} />
      )}
      {panel === 'elements' && <ShapePanel />}
      {busy && (
        <output className="busy-inline" aria-live="polite">
          <LoaderCircle size={16} className="spin" />
          {busy}
        </output>
      )}
      <div className="local-note">
        <span className="status-dot" />
        素材はこの端末で処理されます
      </div>
    </aside>
  );
}
