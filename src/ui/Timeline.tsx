/* eslint-disable jsx-a11y/prefer-tag-over-role -- Clip widgets contain independent trim handles; keyboard editing is provided by the inspector and shortcuts. */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Move,
  SlidersHorizontal,
  X,
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
  Layers3,
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
} from '../core/model';
import { snapFrame } from '../core/timeline';
import type { Command } from '../core/commands';
import { Range } from './controls';
import { usePanelLayout } from './workspace-state';
import { watchPress } from './touch-press';
const icons = {
  video: Film,
  audio: Music2,
  image: Image,
  text: Type,
  caption: Captions,
  shape: Shapes,
};

export function TimelineControls() {
  const { zoom, snapping } = useEditor();
  const changeZoom = (next: number) => {
    const previous = useEditor.getState().zoom;
    const frame = useEditor.getState().frame;
    const scroller = document.querySelector<HTMLDivElement>('.timeline-scroll');
    if (scroller) {
      const nextScroll = scroller.scrollLeft + frame * (next - previous);
      useEditor.setState({ zoom: next });
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(
          0,
          Math.min(nextScroll, scroller.scrollWidth - scroller.clientWidth),
        );
      });
      return;
    }
    useEditor.setState({ zoom: next });
  };
  return (
    <div className="timeline-inline-controls">
      <button
        title="スナップ（Alt で一時解除）"
        className={snapping ? 'active' : ''}
        aria-pressed={snapping}
        onClick={() => useEditor.setState({ snapping: !snapping })}
      >
        <Magnet size={16} />
        <span>スナップ</span>
      </button>
      <div className="timeline-control-divider" />
      <button
        title="タイムラインを縮小"
        aria-label="タイムラインを縮小"
        onClick={() => changeZoom(Math.max(0.15, zoom / 1.25))}
      >
        <Minus size={14} />
      </button>
      <Range
        label="タイムラインのズーム"
        value={zoom}
        min={0.15}
        max={10}
        step={0.05}
        onChange={changeZoom}
      />
      <button
        title="タイムラインを拡大"
        aria-label="タイムラインを拡大"
        onClick={() => changeZoom(Math.min(10, zoom * 1.25))}
      >
        <Plus size={14} />
      </button>
      <span className="zoom-label">{Math.round((zoom / 1.8) * 100)}%</span>
    </div>
  );
}

export default function Timeline() {
  const { project, frame, selected, zoom, snapping } = useEditor();
  const scroll = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<{
    id: string;
    frame: number;
    x: number;
    y: number;
  } | null>(null);
  const [touchMove, setTouchMove] = useState<string | null>(null);
  const pressCleanup = useRef<(() => void) | null>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  useEffect(() => () => pressCleanup.current?.(), []);
  useEffect(() => {
    if (!actions) return;
    requestAnimationFrame(() =>
      actionMenu.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus(),
    );
  }, [actions]);
  const actionInfo = actions ? findClip(project, actions.id) : undefined;
  const canSplit =
    !!actionInfo &&
    !actionInfo.track.locked &&
    actions!.frame > actionInfo.clip.startFrame &&
    actions!.frame <
      actionInfo.clip.startFrame + actionInfo.clip.durationFrames;
  function openActions(
    c: Clip,
    at: number,
    point: { x: number; y: number } = {
      x: window.innerWidth / 2 - 136,
      y: window.innerHeight / 2 - 150,
    },
  ) {
    pressCleanup.current?.();
    setTouchMove(null);
    api.select(c.id);
    const target = Math.max(
      c.startFrame,
      Math.min(c.startFrame + c.durationFrames - 1, Math.round(at)),
    );
    setActions({
      id: c.id,
      frame: target,
      x: Math.max(12, Math.min(point.x, window.innerWidth - 292)),
      y: Math.max(12, Math.min(point.y, window.innerHeight - 326)),
    });
  }
  function pressClip(e: ReactPointerEvent, c: Clip, t: Track) {
    if (e.button !== 0 || !e.isPrimary) return;
    if (e.pointerType === 'mouse' || touchMove === c.id) {
      drag(e, c, t, 'move');
      return;
    }
    e.stopPropagation();
    pressCleanup.current?.();
    const at =
      c.startFrame +
      (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom;
    pressCleanup.current = watchPress(
      window,
      e.nativeEvent,
      () => {
        api.select(c.id);
      },
      () => openActions(c, at, { x: e.clientX, y: e.clientY }),
    );
  }
  const total = endFrame(project),
    timelineFrames = Math.max(
      Math.ceil(fps(project) * 30),
      total + Math.ceil(fps(project) * 5),
    );
  const width = Math.max(800, timelineFrames * zoom);
  const rulerStep = Math.max(1, Math.ceil(75 / (zoom * fps(project))));
  function drag(
    e: ReactPointerEvent,
    c: Clip,
    track: Track,
    kind: 'move' | 'left' | 'right',
  ) {
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    pressCleanup.current?.();
    api.select(c.id);
    if (track.locked) return;
    e.preventDefault();
    api.begin(kind === 'move' ? 'クリップを移動' : 'クリップをトリミング');
    const node = e.currentTarget as HTMLElement;
    node.setPointerCapture(e.pointerId);
    const startX = e.clientX,
      startY = e.clientY,
      startScroll = scroll.current?.scrollLeft || 0;
    let dragging = false;
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
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4)
        return;
      dragging = true;
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
          (t) => t.id === row?.dataset.trackId && !t.locked,
        );
        const destination = target || track;
        const commands: Command[] = [
          {
            type: 'clip.move' as const,
            clipId: c.id,
            startFrame: start,
            trackId: destination.id,
          },
        ];
        api.preview(commands);
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
      setTouchMove(null);
    };
    const cancel = () => {
      clean();
      api.cancel();
      setTouchMove(null);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up, { once: true });
    node.addEventListener('pointercancel', cancel, { once: true });
  }
  return (
    <section className={`timeline ${touchMove ? 'touch-move-mode' : ''}`}>
      {touchMove && (
        <div className="touch-move-hint">
          <Move size={17} />
          <span>選択したクリップをドラッグして移動</span>
          <button
            aria-label="移動モードを終了"
            onClick={() => setTouchMove(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-content" style={{ width: width + 136 }}>
          <div className="ruler-row">
            <div className="ruler-label">
              <span>トラック</span>
              <button
                className="timeline-add-track"
                title="種類を問わないトラックを追加"
                aria-label="トラックを追加"
                onClick={() =>
                  api.execute({
                    type: 'track.add',
                    track: makeTrack(
                      'video',
                      `トラック ${project.tracks.length + 1}`,
                    ),
                  })
                }
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="ruler" style={{ width }}>
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
            const displayName = `トラック ${index + 1}`;
            return (
              <div
                key={t.id}
                className={`track-row ${t.hidden ? 'track-hidden' : ''} ${t.locked ? 'track-locked' : ''}`}
                data-track-id={t.id}
              >
                <div className="track-header">
                  <div className="track-title">
                    <Layers3 size={14} />
                    <span title={displayName}>{displayName}</span>
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
                    if (
                      e.target === e.currentTarget &&
                      e.pointerType === 'mouse'
                    ) {
                      // Clicking an empty lane should only clear the selection.
                      // Moving the playhead is reserved for the ruler so a
                      // normal left click does not unexpectedly change time.
                      api.select(null);
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
                    if (a) api.addClip(a.kind, a, at, t.id);
                    else
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
                    const ClipIcon = icons[c.type];
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
                        onPointerDown={(e) => pressClip(e, c, t)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openActions(
                            c,
                            c.startFrame +
                              (e.clientX -
                                e.currentTarget.getBoundingClientRect().left) /
                                zoom,
                            { x: e.clientX, y: e.clientY },
                          );
                        }}
                        aria-haspopup="menu"
                        onKeyDown={(e) => {
                          if (
                            e.key === 'ContextMenu' ||
                            (e.shiftKey && e.key === 'F10')
                          ) {
                            e.preventDefault();
                            openActions(c, frame);
                          } else if (e.key === 'Enter') {
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
                          <ClipIcon size={11} />
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
      {actions && actionInfo && (
        <div
          className="clip-context-layer"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setActions(null);
          }}
        >
          <div
            ref={actionMenu}
            className="clip-context-menu"
            role="menu"
            tabIndex={-1}
            aria-label={`${actionInfo.clip.name}の操作`}
            style={{ left: actions.x, top: actions.y }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setActions(null);
                return;
              }
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ),
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const direction = e.key === 'ArrowDown' ? 1 : -1;
              items[
                (current + direction + items.length) % items.length
              ]?.focus();
            }}
          >
            <div className="clip-context-heading">
              <strong>{actionInfo.clip.name}</strong>
              <span>{actions.frame} フレーム</span>
            </div>
            {actionInfo.track.locked && (
              <p className="clip-context-warning">トラックはロック中です</p>
            )}
            <button
              role="menuitem"
              disabled={!canSplit}
              onClick={() => {
                if (actions && canSplit)
                  api.execute({
                    type: 'clip.split',
                    clipId: actions.id,
                    frame: actions.frame,
                  });
                setActions(null);
              }}
            >
              <Scissors size={17} />
              <span>分割</span>
              <kbd>S</kbd>
            </button>
            <button
              role="menuitem"
              className="destructive-action"
              disabled={!actionInfo || actionInfo.track.locked}
              onClick={() => {
                if (actions)
                  api.execute({ type: 'clip.delete', clipId: actions.id });
                setActions(null);
              }}
            >
              <Trash2 size={17} />
              <span>削除</span>
              <kbd>⌫</kbd>
            </button>
            <button
              role="menuitem"
              disabled={!actionInfo || actionInfo.track.locked}
              onClick={() => {
                if (actions)
                  api.execute({ type: 'clip.duplicate', clipId: actions.id });
                setActions(null);
              }}
            >
              <Copy size={17} />
              <span>複製</span>
              <kbd>⌘D</kbd>
            </button>
            <div className="clip-context-separator" />
            <button
              role="menuitem"
              disabled={!actionInfo || actionInfo.track.locked}
              onClick={() => {
                setTouchMove(actions?.id || null);
                setActions(null);
              }}
            >
              <Move size={17} />
              <span>移動モード</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                usePanelLayout.getState().show('inspector', true);
                setActions(null);
              }}
            >
              <SlidersHorizontal size={17} />
              <span>詳細を編集</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
