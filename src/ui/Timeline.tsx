/* eslint-disable jsx-a11y/prefer-tag-over-role -- Clip widgets contain independent trim handles; keyboard editing is provided by the inspector and shortcuts. */
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Scissors,
  Trash2,
  Copy,
  Magnet,
  Minus,
  Plus,
  LockKeyhole,
  LockKeyholeOpen,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  Type,
  Film,
  Music2,
  Image,
  Shapes,
  Captions,
} from 'lucide-react';
import { api, useEditor, importFiles } from '../app/store';
import {
  endFrame,
  fps,
  frameToUs,
  makeTrack,
  findClip,
  type Clip,
  type Track,
  type ClipKind,
} from '../core/model';
import { snapFrame } from '../core/timeline';
import { Choice, Range } from './controls';
const icons = {
  video: Film,
  audio: Music2,
  image: Image,
  text: Type,
  caption: Captions,
  shape: Shapes,
};
export default function Timeline() {
  const { project, frame, selected, zoom, snapping } = useEditor();
  const scroll = useRef<HTMLDivElement>(null);
  const [trackType, setTrackType] = useState<ClipKind>('video');
  const total = endFrame(project),
    timelineFrames = Math.max(
      Math.ceil(fps(project) * 30),
      total + Math.ceil(fps(project) * 5),
    );
  const width = Math.max(800, timelineFrames * zoom);
  const selectedInfo = selected ? findClip(project, selected) : undefined;
  const locked = selectedInfo?.track.locked;
  const rulerStep = Math.max(1, Math.ceil(75 / (zoom * fps(project))));
  function scrub(e: ReactPointerEvent) {
    e.preventDefault();
    const node = e.currentTarget as HTMLElement;
    node.setPointerCapture(e.pointerId);
    const update = (x: number) => {
      const rect = node.getBoundingClientRect();
      api.seek((x - rect.left) / zoom);
    };
    update(e.clientX);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const end = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end, { once: true });
    node.addEventListener('pointercancel', end, { once: true });
  }
  function drag(
    e: ReactPointerEvent,
    c: Clip,
    track: Track,
    kind: 'move' | 'left' | 'right',
  ) {
    e.stopPropagation();
    api.select(c.id);
    if (track.locked) return;
    e.preventDefault();
    api.begin(kind === 'move' ? 'クリップを移動' : 'クリップをトリミング');
    const node = e.currentTarget as HTMLElement;
    node.setPointerCapture(e.pointerId);
    const startX = e.clientX,
      startScroll = scroll.current?.scrollLeft || 0;
    const points = [
      0,
      frame,
      ...project.tracks.flatMap((t) =>
        t.clips
          .filter((x) => x.id !== c.id)
          .flatMap((x) => [x.startFrame, x.startFrame + x.durationFrames]),
      ),
    ];
    const asset = project.assets.find((a) => a.id === c.assetId);
    const move = (ev: PointerEvent) => {
      const scroller = scroll.current;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (ev.clientX > r.right - 32) scroller.scrollLeft += 16;
        else if (ev.clientX < r.left + 150) scroller.scrollLeft -= 16;
      }
      const delta = Math.round(
        (ev.clientX - startX + (scroller?.scrollLeft || 0) - startScroll) /
          zoom,
      );
      const snap = (f: number) =>
        snapping && !ev.altKey
          ? snapFrame(f, points, 8 / zoom)
          : Math.max(0, Math.round(f));
      if (kind === 'move') {
        let start = snap(c.startFrame + delta);
        const endSnap =
          snap(c.startFrame + delta + c.durationFrames) - c.durationFrames;
        if (
          Math.abs(endSnap - (c.startFrame + delta)) <
          Math.abs(start - (c.startFrame + delta))
        )
          start = Math.max(0, endSnap);
        const row = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest<HTMLElement>('[data-track-id]');
        const target = project.tracks.find(
          (t) =>
            t.id === row?.dataset.trackId && !t.locked && t.type === c.type,
        );
        api.preview([
          {
            type: 'clip.move',
            clipId: c.id,
            startFrame: start,
            trackId: target?.id || track.id,
          },
        ]);
      } else if (kind === 'left') {
        let start = Math.min(
          c.startFrame + c.durationFrames - 1,
          snap(c.startFrame + delta),
        );
        const min =
          asset && c.type !== 'image'
            ? c.startFrame - Math.floor((c.sourceInUs / 1e6) * fps(project))
            : 0;
        start = Math.max(min, start);
        const shift = start - c.startFrame;
        api.preview([
          {
            type: 'clip.trim',
            clipId: c.id,
            startFrame: start,
            durationFrames: c.durationFrames - shift,
            sourceInUs: Math.max(0, c.sourceInUs + frameToUs(shift, project)),
          },
        ]);
      } else {
        let end = Math.max(
          c.startFrame + 1,
          snap(c.startFrame + c.durationFrames + delta),
        );
        if (asset && c.type !== 'image')
          end = Math.min(
            end,
            c.startFrame +
              Math.floor(
                ((asset.durationUs - c.sourceInUs) / 1e6) * fps(project),
              ),
          );
        api.preview([
          {
            type: 'clip.trim',
            clipId: c.id,
            startFrame: c.startFrame,
            durationFrames: end - c.startFrame,
            sourceInUs: c.sourceInUs,
          },
        ]);
      }
    };
    const clean = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
    };
    const up = () => {
      clean();
      api.end();
    };
    const cancel = () => {
      clean();
      api.cancel();
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up, { once: true });
    node.addEventListener('pointercancel', cancel, { once: true });
  }
  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <button
          title="再生位置で分割（S）"
          disabled={
            !selected ||
            locked ||
            frame <= selectedInfo!.clip.startFrame ||
            frame >=
              selectedInfo!.clip.startFrame + selectedInfo!.clip.durationFrames
          }
          onClick={() =>
            selected &&
            api.execute({ type: 'clip.split', clipId: selected, frame })
          }
        >
          <Scissors size={17} />
          <span>分割</span>
        </button>
        <button
          title="削除（Delete）"
          disabled={!selected || locked}
          onClick={() =>
            selected && api.execute({ type: 'clip.delete', clipId: selected })
          }
        >
          <Trash2 size={16} />
          <span>削除</span>
        </button>
        <button
          title="複製（⌘ D）"
          disabled={!selected || locked}
          onClick={() =>
            selected &&
            api.execute({ type: 'clip.duplicate', clipId: selected })
          }
        >
          <Copy size={16} />
          <span>複製</span>
        </button>
        <div className="toolbar-divider" />
        <button
          title="スナップ（Alt で一時解除）"
          className={snapping ? 'active' : ''}
          aria-pressed={snapping}
          onClick={() => useEditor.setState({ snapping: !snapping })}
        >
          <Magnet size={17} />
          <span>スナップ</span>
        </button>
        <div className="track-add">
          <Choice
            label="追加するトラック"
            value={trackType}
            options={[
              { value: 'video', label: '映像' },
              { value: 'audio', label: '音声' },
              { value: 'image', label: '画像' },
              { value: 'text', label: 'テキスト' },
              { value: 'caption', label: '字幕' },
              { value: 'shape', label: '図形' },
            ]}
            onChange={(t) => setTrackType(t as ClipKind)}
          />
          <button
            title="トラックを追加"
            onClick={() =>
              api.execute({ type: 'track.add', track: makeTrack(trackType) })
            }
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="spacer" />
        <button
          title="タイムラインを縮小"
          onClick={() =>
            useEditor.setState({ zoom: Math.max(0.15, zoom / 1.25) })
          }
        >
          <Minus size={15} />
        </button>
        <Range
          label="タイムラインのズーム"
          value={zoom}
          min={0.15}
          max={10}
          step={0.05}
          onChange={(z) => useEditor.setState({ zoom: z })}
        />
        <button
          title="タイムラインを拡大"
          onClick={() =>
            useEditor.setState({ zoom: Math.min(10, zoom * 1.25) })
          }
        >
          <Plus size={15} />
        </button>
        <span className="zoom-label">{Math.round((zoom / 1.8) * 100)}%</span>
      </div>
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-content" style={{ width: width + 136 }}>
          <div className="ruler-row">
            <div className="ruler-label">トラック</div>
            <div className="ruler" style={{ width }} onPointerDown={scrub}>
              {Array.from(
                {
                  length:
                    Math.ceil(timelineFrames / fps(project) / rulerStep) + 1,
                },
                (_, i) => {
                  const sec = i * rulerStep;
                  return (
                    <span key={i} style={{ left: sec * fps(project) * zoom }}>
                      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}
                    </span>
                  );
                },
              )}
            </div>
          </div>
          {project.tracks.map((t, index) => {
            const Icon = icons[t.type];
            return (
              <div
                key={t.id}
                className={`track-row ${t.hidden ? 'track-hidden' : ''} ${t.locked ? 'track-locked' : ''}`}
                data-track-id={t.id}
              >
                <div className="track-header">
                  <div className="track-title">
                    <Icon size={14} />
                    <span title={t.name}>{t.name}</span>
                    <div className="track-order">
                      <button
                        title="トラックを上へ"
                        disabled={index === 0 || t.locked}
                        onClick={() =>
                          api.execute({
                            type: 'track.move',
                            trackId: t.id,
                            index: index - 1,
                          })
                        }
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        title="トラックを下へ"
                        disabled={
                          index === project.tracks.length - 1 || t.locked
                        }
                        onClick={() =>
                          api.execute({
                            type: 'track.move',
                            trackId: t.id,
                            index: index + 1,
                          })
                        }
                      >
                        <ChevronDown size={11} />
                      </button>
                    </div>
                  </div>
                  <div className="track-controls">
                    <button
                      title={t.locked ? 'ロック解除' : 'トラックをロック'}
                      onClick={() =>
                        api.execute({
                          type: 'track.update',
                          trackId: t.id,
                          patch: { locked: !t.locked },
                        })
                      }
                    >
                      {t.locked ? (
                        <LockKeyhole size={13} />
                      ) : (
                        <LockKeyholeOpen size={13} />
                      )}
                    </button>
                    <button
                      title={t.hidden ? 'トラックを表示' : 'トラックを非表示'}
                      onClick={() =>
                        api.execute({
                          type: 'track.update',
                          trackId: t.id,
                          patch: { hidden: !t.hidden },
                        })
                      }
                    >
                      {t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      title={
                        t.muted ? 'トラックの消音を解除' : 'トラックを消音'
                      }
                      onClick={() =>
                        api.execute({
                          type: 'track.update',
                          trackId: t.id,
                          patch: { muted: !t.muted },
                        })
                      }
                    >
                      {t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </button>
                  </div>
                </div>
                <div
                  className="track-lane"
                  style={{ width }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      api.select(null);
                      scrub(e);
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const at = Math.max(
                      0,
                      Math.round(
                        (e.clientX -
                          e.currentTarget.getBoundingClientRect().left) /
                          zoom,
                      ),
                    );
                    const a = project.assets.find(
                      (a) =>
                        a.id ===
                        e.dataTransfer.getData('application/framecut-asset'),
                    );
                    if (a) {
                      api.addClip(
                        a.kind,
                        a,
                        at,
                        t.type === a.kind ? t.id : undefined,
                      );
                    } else
                      void importFiles(Array.from(e.dataTransfer.files), {
                        addToTimeline: true,
                        frame: at,
                      });
                  }}
                >
                  {t.clips.length === 0 && index === 1 && (
                    <span className="lane-hint">
                      素材をここにドラッグ、または素材の ＋ から追加
                    </span>
                  )}
                  {t.clips.map((c) => {
                    const a = project.assets.find((a) => a.id === c.assetId);
                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${c.name}、開始 ${c.startFrame} フレーム、長さ ${c.durationFrames} フレーム`}
                        className={`timeline-clip clip-${c.type} ${selected === c.id ? 'selected' : ''} ${c.muted ? 'clip-muted' : ''}`}
                        style={{
                          left: c.startFrame * zoom,
                          width: Math.max(4, c.durationFrames * zoom),
                        }}
                        onPointerDown={(e) => drag(e, c, t, 'move')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            api.select(c.id);
                            api.seek(c.startFrame);
                          }
                        }}
                      >
                        <div
                          className="clip-thumbnails"
                          style={
                            a?.thumbnail
                              ? { backgroundImage: `url(${a.thumbnail})` }
                              : undefined
                          }
                        />
                        <div className="clip-title">
                          <Icon size={11} />
                          <span>{c.text || c.name}</span>
                        </div>
                        {a?.waveform?.length ? (
                          <svg
                            className="clip-waveform"
                            width="100%"
                            height="28"
                            viewBox={`${(c.sourceInUs / a.durationUs) * a.waveform.length} 0 ${Math.max(1, (((c.durationFrames / fps(project)) * 1e6) / a.durationUs) * a.waveform.length)} 30`}
                            preserveAspectRatio="none"
                          >
                            {a.waveform.map((n, i) => (
                              <line
                                key={i}
                                x1={i}
                                x2={i}
                                y1={15 - n * 14}
                                y2={15 + n * 14}
                              />
                            ))}
                          </svg>
                        ) : null}
                        {c.transition !== 'none' && (
                          <>
                            <div
                              className="transition-mark in"
                              style={{
                                width:
                                  Math.min(
                                    c.transitionFrames,
                                    c.durationFrames / 2,
                                  ) * zoom,
                              }}
                            />
                            <div
                              className="transition-mark out"
                              style={{
                                width:
                                  Math.min(
                                    c.transitionFrames,
                                    c.durationFrames / 2,
                                  ) * zoom,
                              }}
                            />
                          </>
                        )}
                        {Object.values(c.transform)
                          .flatMap((a) => a.keyframes)
                          .filter(
                            (k, i, all) =>
                              k.frame >= 0 &&
                              k.frame < c.durationFrames &&
                              all.findIndex((x) => x.frame === k.frame) === i,
                          )
                          .map((k) => (
                            <span
                              className="clip-key"
                              key={k.frame}
                              style={{ left: k.frame * zoom }}
                            >
                              ◆
                            </span>
                          ))}
                        <div
                          className="trim-handle left"
                          title="先頭をトリミング"
                          onPointerDown={(e) => drag(e, c, t, 'left')}
                        />
                        <div
                          className="trim-handle right"
                          title="末尾をトリミング"
                          onPointerDown={(e) => drag(e, c, t, 'right')}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div
            className="playhead"
            style={{
              left: 136 + frame * zoom,
              height: 32 + project.tracks.length * 66,
            }}
          >
            <div className="playhead-head" />
          </div>
        </div>
      </div>
    </section>
  );
}
