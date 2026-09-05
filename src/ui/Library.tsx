/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- Drop regions have equivalent keyboard-accessible import/add buttons. */
import { useRef, useState } from 'react';
import {
  Plus,
  Upload,
  Music2,
  Type,
  Captions,
  Search,
  Link2,
  RectangleHorizontal,
  Circle,
  LoaderCircle,
  X,
} from 'lucide-react';
import { useEditor, api, importFiles, notify } from '../app/store';
import { parseSrt } from '../core/timeline';
import { makeClip, makeTrack, fps } from '../core/model';
import { bytes } from './controls';
export default function Library() {
  const { project, panel, busy, offline, mobilePanel } = useEditor();
  const input = useRef<HTMLInputElement>(null),
    srtInput = useRef<HTMLInputElement>(null),
    relink = useRef<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const assets = project.assets.filter(
    (a) =>
      (panel !== 'audio' || a.hasAudio) &&
      a.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function srt(file: File) {
    try {
      const list = parseSrt(await file.text(), project);
      if (!list.length) throw Error('字幕がありません');
      const track = makeTrack('caption', file.name);
      api.begin('SRT 字幕を読み込み');
      api.execute({ type: 'track.add', track });
      for (const item of list) {
        const c = makeClip(project, 'caption', item.startFrame);
        Object.assign(c, item);
        c.name = item.text.slice(0, 24);
        c.transform.y.defaultValue = project.height * 0.84;
        c.style.size = 54;
        c.style.strokeWidth = 3;
        api.execute({ type: 'clip.add', trackId: track.id, clip: c });
      }
      api.end();
      notify(`${list.length} 件の字幕を追加しました`);
    } catch (e) {
      api.cancel();
      notify((e as Error).message);
    }
  }
  const isMedia = panel === 'media' || panel === 'audio';
  return (
    <aside
      className={`library ${mobilePanel ? 'mobile-open' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="panel-heading">
        {
          {
            media: 'メディア',
            audio: 'オーディオ',
            text: 'テキスト',
            captions: '字幕',
            elements: '図形',
          }[panel]
        }
        <span>{isMedia ? assets.length : ''}</span>
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
        accept="video/*,audio/*,image/png,image/jpeg,image/webp,.mov,.mkv,.ogg,.aac,.opus"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []), {
            relinkId: relink.current,
          });
          relink.current = undefined;
          e.target.value = '';
        }}
      />
      <input
        hidden
        ref={srtInput}
        type="file"
        accept=".srt"
        onChange={(e) => {
          if (e.target.files?.[0]) void srt(e.target.files[0]);
          e.target.value = '';
        }}
      />
      {isMedia && (
        <>
          <button
            className="import-button"
            disabled={!!busy}
            onClick={() => {
              relink.current = undefined;
              input.current?.click();
            }}
          >
            <Plus size={18} />
            素材を読み込む
          </button>
          {project.assets.length > 0 && (
            <label className="search-field">
              <Search size={15} />
              <input
                aria-label="素材を検索"
                placeholder="素材を検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
          {assets.length === 0 ? (
            <button
              type="button"
              className="library-empty"
              onClick={() => input.current?.click()}
            >
              <Upload size={32} />
              <p>{search ? '素材が見つかりません' : 'まだ素材がありません'}</p>
              <span>動画・画像・音声を追加</span>
              <small>MP4 / MOV / WebM / PNG / MP3</small>
            </button>
          ) : (
            <div className="asset-grid">
              {assets.map((a) => (
                <article
                  key={a.id}
                  className={`asset-card ${offline.includes(a.id) ? 'offline' : ''}`}
                  draggable={!offline.includes(a.id)}
                  onDragStart={(e) =>
                    e.dataTransfer.setData('application/framecut-asset', a.id)
                  }
                >
                  <button
                    className="asset-image"
                    title={`${a.name} をタイムラインに追加`}
                    disabled={offline.includes(a.id)}
                    onClick={() =>
                      api.addClip(panel === 'audio' ? 'audio' : a.kind, a)
                    }
                  >
                    {a.thumbnail ? (
                      <img src={a.thumbnail} alt={a.name} />
                    ) : (
                      <Music2 size={32} />
                    )}
                    <span>
                      {a.kind === 'image'
                        ? '画像'
                        : `${Math.floor(a.durationUs / 1e6 / 60)}:${String(Math.floor(a.durationUs / 1e6) % 60).padStart(2, '0')}`}
                    </span>
                    <span className="asset-add">
                      <Plus size={15} />
                    </span>
                  </button>
                  <div className="asset-caption">
                    <strong title={a.name}>{a.name}</strong>
                    <small>
                      {bytes(a.size)}
                      {a.videoCodec ? ` · ${a.videoCodec.toUpperCase()}` : ''}
                    </small>
                  </div>
                  {a.waveform?.length ? (
                    <svg
                      className="asset-waveform"
                      viewBox="0 0 160 24"
                      preserveAspectRatio="none"
                      aria-label="音声の波形"
                    >
                      {a.waveform.map((n, i) => (
                        <line
                          key={i}
                          x1={i}
                          x2={i}
                          y1={12 - n * 11}
                          y2={12 + n * 11}
                        />
                      ))}
                    </svg>
                  ) : null}
                  {offline.includes(a.id) && (
                    <button
                      className="relink"
                      onClick={() => {
                        relink.current = a.id;
                        input.current?.click();
                      }}
                    >
                      <Link2 size={14} />
                      再接続
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {panel === 'text' && (
        <>
          <p className="panel-help">
            テキストを追加して、編集パネルで文字やスタイルを調整します。
          </p>
          <button className="text-template" onClick={() => api.addClip('text')}>
            <Type size={24} />
            <strong>テキストを追加</strong>
            <Plus size={18} />
          </button>
          <div className="section-label">スタイル</div>
          {[
            {
              name: '大きな見出し',
              size: 110,
              weight: 800,
              bg: '#00000000',
              color: '#ffffff',
            },
            {
              name: 'ハイライト',
              size: 64,
              weight: 700,
              bg: '#bbef69',
              color: '#15210c',
            },
            {
              name: 'シンプル',
              size: 56,
              weight: 400,
              bg: '#00000000',
              color: '#ffffff',
            },
          ].map((s) => (
            <button
              className="text-preset"
              key={s.name}
              onClick={() => {
                const cid = api.addClip('text');
                const c = useEditor
                  .getState()
                  .project.tracks.flatMap((t) => t.clips)
                  .find((c) => c.id === cid)!;
                api.execute({
                  type: 'clip.update',
                  clipId: cid,
                  patch: {
                    text: s.name,
                    style: {
                      ...c.style,
                      size: s.size,
                      weight: s.weight,
                      background: s.bg,
                      color: s.color,
                    },
                  },
                });
              }}
            >
              <span
                style={{
                  fontWeight: s.weight,
                  background: s.bg,
                  color: s.color,
                }}
              >
                {s.name}
              </span>
            </button>
          ))}
        </>
      )}
      {panel === 'captions' && (
        <>
          <p className="panel-help">台詞や説明を、時間に合わせて。</p>
          <button
            className="import-button"
            onClick={() => api.addClip('caption')}
          >
            <Captions size={18} />
            字幕を追加
          </button>
          <button
            className="secondary full"
            onClick={() => srtInput.current?.click()}
          >
            <Upload size={16} />
            SRT を読み込む
          </button>
          <div className="caption-list">
            {project.tracks
              .filter((t) => t.type === 'caption')
              .flatMap((t) => t.clips)
              .sort((a, b) => a.startFrame - b.startFrame)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    api.select(c.id);
                    api.seek(c.startFrame);
                  }}
                >
                  <small>{(c.startFrame / fps(project)).toFixed(2)}s</small>
                  <span>{c.text}</span>
                </button>
              ))}
          </div>
          <p className="panel-help">
            字幕を選択すると、表示時間とスタイルを調整できます。
          </p>
        </>
      )}
      {panel === 'elements' && (
        <>
          <p className="panel-help">背景やアクセントになる図形を追加。</p>
          <div className="shape-options">
            <button onClick={() => api.addClip('shape')}>
              <RectangleHorizontal size={40} />
              <span>四角形</span>
            </button>
            <button
              onClick={() => {
                const cid = api.addClip('shape');
                api.execute({
                  type: 'clip.update',
                  clipId: cid,
                  patch: { shape: 'ellipse' },
                });
              }}
            >
              <Circle size={38} />
              <span>円</span>
            </button>
          </div>
        </>
      )}
      {busy && (
        <output className="busy-inline">
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
