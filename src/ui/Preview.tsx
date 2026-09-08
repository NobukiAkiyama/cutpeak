import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Film,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize,
  Minimize,
  RotateCw,
  Upload,
  Check,
  Trash2,
} from 'lucide-react';
import {
  useEditor,
  api,
  media,
  setStopPlayback,
  notify,
  importFiles,
} from '../app/store';
import {
  endFrame,
  findClip,
  id,
  makePuppetWarp,
  timecode,
  type PuppetWarp,
  type Project,
  type TransformKey,
} from '../core/model';
import { sceneAt, values } from '../core/timeline';
import { SceneRenderer, objectSize, type FrameImage } from '../render/renderer';
import { WorkerRpc } from '../media/client';
import { Playback } from '../audio/playback';
import { Choice } from './controls';
import type { Command } from '../core/commands';
export default function Preview() {
  const { project, frame, revision, selected, quality, ready, playing } =
    useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null),
    areaRef = useRef<HTMLDivElement>(null),
    stageRef = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const renderer = useRef<{ rpc?: WorkerRpc; main?: SceneRenderer }>({});
  const playback = useRef<Playback | undefined>(undefined);
  const [fallback, setFallback] = useState(0),
    [size, setSize] = useState({ width: 640, height: 360 }),
    [mode, setMode] = useState(''),
    [viewScale, setViewScale] = useState(1),
    [viewOffset, setViewOffset] = useState({ x: 0, y: 0 }),
    [panning, setPanning] = useState(false),
    [puppetEditing, setPuppetEditing] = useState(false),
    [showMesh, setShowMesh] = useState(true),
    [selectedPin, setSelectedPin] = useState<string | null>(null);
  const viewScaleRef = useRef(viewScale),
    viewOffsetRef = useRef(viewOffset);
  viewScaleRef.current = viewScale;
  viewOffsetRef.current = viewOffset;
  const pending = useRef<{
      project: Project;
      frame: number;
      width: number;
      height: number;
    } | null>(null),
    drawing = useRef(false);
  const lastError = useRef('');
  const latency = useRef(0);
  const puppetDraft = useRef<PuppetWarp | null>(null);
  const total = endFrame(project);
  useEffect(() => {
    if (!ready) return;
    const pb = new Playback(
      media,
      (f) => useEditor.setState({ frame: f }),
      () => useEditor.setState({ playing: false }),
      (e) => notify(e.message),
    );
    playback.current = pb;
    setStopPlayback(() => {
      if (pb.active) {
        pb.pause();
      }
    });
    return () => {
      pb.dispose();
      useEditor.setState({ playing: false });
      setStopPlayback(() => {});
    };
  }, [ready, project.id]);
  const toggle = async () => {
    const pb = playback.current;
    if (!pb || !total) return;
    if (pb.active) {
      pb.pause();
      return;
    }
    try {
      useEditor.setState({ playing: true });
      await pb.play(project, frame >= total - 1 ? 0 : frame);
    } catch (e) {
      pb.pause();
      notify((e as Error).message);
    }
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const fn = () => void toggleRef.current();
    window.addEventListener('framecut:toggle-play', fn);
    return () => window.removeEventListener('framecut:toggle-play', fn);
  }, []);
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const resize = () => {
      const r = area.getBoundingClientRect(),
        ratio = project.width / project.height;
      const w = Math.max(
        80,
        Math.min(r.width, Math.max(80, r.height - 24) * ratio),
      );
      setSize({ width: w, height: w / ratio });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    resize();
    return () => observer.disconnect();
  }, [project.width, project.height]);
  useEffect(() => {
    if (!ready || !canvasRef.current) return;
    let active = true;
    const canvas = canvasRef.current;
    const r: { rpc?: WorkerRpc; main?: SceneRenderer } = {};
    renderer.current = r;
    async function init() {
      try {
        if (
          fallback === 0 &&
          'transferControlToOffscreen' in canvas &&
          typeof OffscreenCanvas !== 'undefined'
        ) {
          r.rpc = new WorkerRpc(
            new Worker(
              new URL('../workers/render.worker.ts', import.meta.url),
              { type: 'module' },
            ),
          );
          const off = canvas.transferControlToOffscreen();
          const mode = await r.rpc.call<string>('init', { canvas: off }, [off]);
          if (active && mode !== 'webgl2') {
            setFallback(1);
            return;
          }
          if (active) setMode(`Worker ${mode}`);
        } else {
          r.main = new SceneRenderer(canvas, fallback >= 2);
          setMode(r.main.mode);
        }
        if (active) {
          pending.current = {
            project: useEditor.getState().project,
            frame: useEditor.getState().frame,
            width: Math.max(2, canvas.clientWidth),
            height: Math.max(2, canvas.clientHeight),
          };
          void pump();
        }
      } catch (e) {
        if (active) {
          if (fallback < 2) setFallback(fallback + 1);
          else notify((e as Error).message);
        }
      }
    }
    void init();
    return () => {
      active = false;
      r.rpc?.dispose();
      r.main?.dispose();
      renderer.current = {};
    };
  }, [ready, fallback]);
  async function pump() {
    if (drawing.current) return;
    const r = renderer.current;
    if (!r.rpc && !r.main) return;
    drawing.current = true;
    try {
      while (pending.current) {
        const request = pending.current;
        pending.current = null;
        const start = performance.now();
        let images: FrameImage[] = [];
        try {
          images = await media.frames(
            request.project,
            request.frame,
            request.width,
          );
          if (renderer.current !== r) {
            images.forEach((i) => i.bitmap.close());
            continue;
          }
          if (r.rpc)
            await r.rpc.call(
              'draw',
              { ...request, images },
              images.map((i) => i.bitmap),
            );
          else {
            const main = r.main!;
            if (main.canvas.width !== request.width)
              main.canvas.width = request.width;
            if (main.canvas.height !== request.height)
              main.canvas.height = request.height;
            main.draw(request.project, request.frame, images);
            images.forEach((i) => i.bitmap.close());
          }
          latency.current = performance.now() - start;
        } catch (e) {
          if (renderer.current !== r) continue;
          images.forEach((i) => {
            try {
              i.bitmap.close();
            } catch {}
          });
          const message = (e as Error).message;
          if (message !== lastError.current) {
            lastError.current = message;
            notify(message);
          }
          if (message.includes('WebGL') || message.includes('Worker'))
            setFallback((f) => Math.min(2, f + 1));
        }
      }
    } finally {
      drawing.current = false;
    }
  }
  useEffect(() => {
    if (!ready) return;
    let factor =
      quality === 'full'
        ? 1
        : quality === 'half'
          ? 0.5
          : quality === 'quarter'
            ? 0.25
            : Math.min(1, Math.max(0.25, size.width / project.width));
    if (quality === 'auto' && playing && latency.current > 80)
      factor = Math.min(factor, 0.25);
    pending.current = {
      project,
      frame,
      width: Math.max(2, Math.round(project.width * factor)),
      height: Math.max(2, Math.round(project.height * factor)),
    };
    void pump();
  }, [project, frame, revision, quality, size, ready, mode, playing]);
  const found = selected ? findClip(project, selected) : null,
    c = found?.clip;
  const visible =
    c &&
    c.type !== 'audio' &&
    !found?.track.hidden &&
    frame >= c.startFrame &&
    frame < c.startFrame + c.durationFrames;
  const transform = c ? values(c, frame) : null;
  const dimensions = c ? objectSize(c, project) : null;
  const visualEditable = !!c && c.type !== 'audio' && !found?.track.locked;
  const activePuppet = puppetDraft.current || c?.puppet;
  const pinned = activePuppet?.pins || [];
  const updatePuppet = (next: PuppetWarp) => {
    if (!c || !puppetEditing) return;
    puppetDraft.current = next;
    api.preview([{ type: 'clip.update', clipId: c.id, patch: { puppet: next } }]);
  };
  const beginPuppet = () => {
    if (!c || !visualEditable || puppetEditing) return;
    api.begin('パペット変形');
    puppetDraft.current = structuredClone(c.puppet || makePuppetWarp());
    setSelectedPin(null);
    setShowMesh(true);
    setPuppetEditing(true);
  };
  const finishPuppet = (apply: boolean) => {
    if (!puppetEditing) return;
    if (apply) api.end();
    else api.cancel();
    puppetDraft.current = null;
    setSelectedPin(null);
    setPuppetEditing(false);
  };
  useEffect(() => {
    const start = () => beginPuppet();
    window.addEventListener('framecut:puppet-edit', start);
    return () => window.removeEventListener('framecut:puppet-edit', start);
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!puppetEditing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        finishPuppet(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        finishPuppet(true);
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && selectedPin) {
        event.preventDefault();
        updatePuppet({
          ...(puppetDraft.current || makePuppetWarp()),
          pins: pinned.filter((pin) => pin.id !== selectedPin),
        });
        setSelectedPin(null);
      } else if (event.key.toLowerCase() === 'h') setShowMesh((value) => !value);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (puppetEditing && (!c || c.id !== selected)) finishPuppet(false);
  });
  function addPuppetPin(event: ReactPointerEvent<HTMLDivElement>) {
    if (!puppetEditing || !c || event.button !== 0) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const pin = { id: id(), sourceX: x, sourceY: y, x, y, locked: false };
    updatePuppet({ ...(puppetDraft.current || makePuppetWarp()), pins: [...pinned, pin] });
    setSelectedPin(pin.id);
  }
  function movePuppetPin(event: ReactPointerEvent<HTMLButtonElement>, pinId: string) {
    if (!puppetEditing) return;
    event.stopPropagation();
    event.preventDefault();
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      const host = node.parentElement?.getBoundingClientRect();
      if (!host) return;
      const x = Math.max(-0.4, Math.min(1.4, (pointer.clientX - host.left) / host.width));
      const y = Math.max(-0.4, Math.min(1.4, (pointer.clientY - host.top) / host.height));
      updatePuppet({
        ...(puppetDraft.current || makePuppetWarp()),
        pins: (puppetDraft.current?.pins || []).map((pin) =>
          pin.id === pinId && !pin.locked ? { ...pin, x, y } : pin,
        ),
      });
    };
    const end = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end, { once: true });
    node.addEventListener('pointercancel', end, { once: true });
  }
  function manipulate(e: ReactPointerEvent, kind: 'move' | 'scale' | 'rotate') {
    if (!c || !transform || found?.track.locked || !stageRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    api.begin(
      kind === 'move'
        ? 'プレビューで位置を変更'
        : kind === 'scale'
          ? 'プレビューでサイズを変更'
          : 'プレビューで回転',
    );
    const node = e.currentTarget as HTMLElement;
    node.setPointerCapture(e.pointerId);
    const rect = stageRef.current.getBoundingClientRect(),
      sx = e.clientX,
      sy = e.clientY,
      base = transform,
      clip = c,
      scale = project.width / rect.width,
      cx = rect.left + base.x / scale,
      cy = rect.top + base.y / scale,
      baseDistance = Math.max(1, Math.hypot(sx - cx, sy - cy)),
      baseAngle = Math.atan2(sy - cy, sx - cx);
    const command = (key: TransformKey, value: number): Command => ({
      type: 'clip.transform',
      clipId: clip.id,
      key,
      value,
      ...(clip.transform[key].keyframes.length
        ? { frame: Math.max(0, frame - clip.startFrame) }
        : {}),
    });
    const move = (event: PointerEvent) => {
      let commands: Command[] = [];
      if (kind === 'move') {
        commands = [
          command('x', base.x + (event.clientX - sx) * scale),
          command('y', base.y + (event.clientY - sy) * scale),
        ];
      } else if (kind === 'scale') {
        const ratio = Math.max(
          0.01,
          Math.hypot(event.clientX - cx, event.clientY - cy) / baseDistance,
        );
        commands = [
          command('scaleX', Math.min(10, base.scaleX * ratio)),
          command('scaleY', Math.min(10, base.scaleY * ratio)),
        ];
      } else {
        const angle =
          ((Math.atan2(event.clientY - cy, event.clientX - cx) - baseAngle) *
            180) /
          Math.PI;
        commands = [
          command(
            'rotation',
            event.shiftKey
              ? Math.round((base.rotation + angle) / 15) * 15
              : base.rotation + angle,
          ),
        ];
      }
      api.preview(commands);
    };
    const cleanup = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', cancel);
    };
    const end = () => {
      cleanup();
      api.end();
    };
    const cancel = () => {
      cleanup();
      api.cancel();
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end, { once: true });
    node.addEventListener('pointercancel', cancel, { once: true });
  }
  function hitAt(clientX: number, clientY: number) {
    if (!stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect(),
      x = ((clientX - r.left) / r.width) * project.width,
      y = ((clientY - r.top) / r.height) * project.height;
    const item = sceneAt(project, frame)
      .reverse()
      .find(({ clip: c, transform: t }) => {
        const d = objectSize(c, project),
          a = (-t.rotation * Math.PI) / 180,
          dx = x - t.x,
          dy = y - t.y;
        return (
          Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <=
            (d.width * t.scaleX) / 2 &&
          Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <=
            (d.height * t.scaleY) / 2
        );
      });
    api.select(item?.clip.id || null);
  }
  function navigatePreview(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const stage = e.currentTarget,
      startX = e.clientX,
      startY = e.clientY,
      base = viewOffsetRef.current;
    let moved = false;
    stage.setPointerCapture(e.pointerId);
    setPanning(true);
    const move = (event: PointerEvent) => {
      const dx = event.clientX - startX,
        dy = event.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const next = { x: base.x + dx, y: base.y + dy };
      viewOffsetRef.current = next;
      setViewOffset(next);
    };
    const cleanup = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', end);
      stage.removeEventListener('pointercancel', cancel);
      setPanning(false);
    };
    const end = (event: PointerEvent) => {
      cleanup();
      if (!moved) hitAt(event.clientX, event.clientY);
    };
    const cancel = () => cleanup();
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', end, { once: true });
    stage.addEventListener('pointercancel', cancel, { once: true });
  }
  function zoomPreview(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!areaRef.current) return;
    const current = viewScaleRef.current,
      next = Math.min(4, Math.max(0.5, current * Math.exp(-e.deltaY * 0.002)));
    if (Math.abs(next - current) < 0.001) return;
    const r = areaRef.current.getBoundingClientRect(),
      point = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) },
      offset = viewOffsetRef.current,
      ratio = next / current,
      nextOffset = {
        x: point.x - (point.x - offset.x) * ratio,
        y: point.y - (point.y - offset.y) * ratio,
      };
    viewScaleRef.current = next;
    viewOffsetRef.current = nextOffset;
    setViewScale(next);
    setViewOffset(nextOffset);
  }
  function resetPreviewView() {
    viewScaleRef.current = 1;
    viewOffsetRef.current = { x: 0, y: 0 };
    setViewScale(1);
    setViewOffset({ x: 0, y: 0 });
  }
  return (
    <main className="preview-panel">
      <div className="panel-heading">
        プレビュー
        <div className="preview-options">
          <span>
            {project.width} × {project.height}
          </span>
          <Choice
            label="プレビュー画質"
            value={quality}
            options={[
              { value: 'auto', label: '自動' },
              { value: 'full', label: 'フル' },
              { value: 'half', label: '1/2' },
              { value: 'quarter', label: '1/4' },
            ]}
            onChange={(q) =>
              useEditor.setState({ quality: q as typeof quality })
            }
          />
          {visualEditable && !puppetEditing && (
            <button className="puppet-start" onClick={beginPuppet}>
              パペット変形
            </button>
          )}
        </div>
      </div>
      {puppetEditing && (
        <div className="puppet-toolbar" aria-label="パペット変形の操作">
          <strong>パペット変形</strong>
          <span>クリックでピンを追加、ドラッグで変形</span>
          <Choice
            label="メッシュ密度"
            value={(puppetDraft.current || makePuppetWarp()).density}
            options={[
              { value: 'low', label: '粗い' },
              { value: 'standard', label: '標準' },
              { value: 'high', label: '細かい' },
            ]}
            onChange={(density) =>
              updatePuppet({
                ...(puppetDraft.current || makePuppetWarp()),
                density: density as PuppetWarp['density'],
              })
            }
          />
          <button className={showMesh ? 'active' : ''} onClick={() => setShowMesh((value) => !value)}>
            メッシュ
          </button>
          <span className="puppet-toolbar-spacer" />
          <button onClick={() => finishPuppet(false)}>キャンセル</button>
          <button className="primary" onClick={() => finishPuppet(true)}><Check size={15} />適用</button>
        </div>
      )}
      <div className="preview-area preview-navigation" ref={areaRef}>
        <div
          className={`preview-stage ${panning ? 'panning' : ''}`}
          aria-label="動画プレビュー。ドラッグで移動、ホイールで拡大縮小"
          title="ドラッグで移動・ホイールで拡大縮小・ダブルクリックでリセット"
          ref={stageRef}
          style={{
            width: size.width,
            height: size.height,
            aspectRatio: 'auto',
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`,
          }}
          onPointerDown={navigatePreview}
          onWheel={zoomPreview}
          onDoubleClick={resetPreviewView}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('application/framecut-asset'),
              a = project.assets.find((a) => a.id === id);
            if (a) api.addClip(a.kind, a);
            else
              void importFiles(Array.from(e.dataTransfer.files), {
                addToTimeline: true,
              });
          }}
        >
          <canvas
            key={fallback}
            ref={canvasRef}
            className="preview-canvas"
            width={640}
            height={360}
          />
          {!total && (
            <div className="stage-placeholder">
              <Film size={42} />
              <p>動画を追加して編集を始める</p>
              <button
                className="primary"
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                素材を読み込む
              </button>
            </div>
          )}
          {visible && transform && dimensions && (
            <div
              className={`selection-box ${found?.track.locked ? 'locked' : ''} ${puppetEditing ? 'puppet-selection' : ''}`}
              style={{
                left: `${(transform.x / project.width) * 100}%`,
                top: `${(transform.y / project.height) * 100}%`,
                width: `${((dimensions.width * (1 - c!.crop.left - c!.crop.right) * transform.scaleX) / project.width) * 100}%`,
                height: `${((dimensions.height * (1 - c!.crop.top - c!.crop.bottom) * transform.scaleY) / project.height) * 100}%`,
                transform: `translate(-50%,-50%) rotate(${transform.rotation}deg)`,
              }}
              onPointerDown={(e) => {
                if (!puppetEditing) manipulate(e, 'move');
              }}
            >
              <div className="selection-label">{c!.name}</div>
              {puppetEditing ? (
                <div className={`puppet-overlay ${showMesh ? `density-${activePuppet?.density || 'standard'}` : ''}`} onPointerDown={addPuppetPin}>
                  {pinned.map((pin) => (
                    <button
                      key={pin.id}
                      className={`puppet-pin ${pin.locked ? 'locked' : ''} ${selectedPin === pin.id ? 'selected' : ''}`}
                      style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                      aria-label={pin.locked ? '固定ピン' : 'パペットピン'}
                      title={pin.locked ? '固定ピン' : 'ドラッグして変形'}
                      onClick={(event) => { event.stopPropagation(); setSelectedPin(pin.id); }}
                      onPointerDown={(event) => movePuppetPin(event, pin.id)}
                    />
                  ))}
                  {selectedPin && (
                    <div className="puppet-pin-actions" onPointerDown={(event) => event.stopPropagation()}>
                      <button onClick={() => updatePuppet({ ...(puppetDraft.current || makePuppetWarp()), pins: pinned.map((pin) => pin.id === selectedPin ? { ...pin, locked: !pin.locked } : pin) })}>
                        {pinned.find((pin) => pin.id === selectedPin)?.locked ? '固定を解除' : '固定'}
                      </button>
                      <button title="選択したピンを削除" onClick={() => { updatePuppet({ ...(puppetDraft.current || makePuppetWarp()), pins: pinned.filter((pin) => pin.id !== selectedPin) }); setSelectedPin(null); }}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              ) : !found?.track.locked && (
                <>
                  {['nw', 'ne', 'sw', 'se'].map((pos) => (
                    <button
                      key={pos}
                      className={`scale-handle ${pos}`}
                      title="サイズを変更"
                      aria-label="プレビュー上でサイズを変更"
                      onPointerDown={(e) => manipulate(e, 'scale')}
                    />
                  ))}
                  <button
                    className="rotate-handle"
                    title="回転"
                    onPointerDown={(e) => manipulate(e, 'rotate')}
                  >
                    <RotateCw size={12} />
                  </button>
                </>
              )}
            </div>
          )}
          <div
            className="fullscreen-transport"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className="timecode">
              {timecode(frame, project)} <em>/ {timecode(total, project)}</em>
            </span>
            <div className="transport-buttons">
              <button
                title="1フレーム戻る（←）"
                onClick={() => api.seek(frame - 1)}
                disabled={!total}
              >
                <SkipBack size={18} />
              </button>
              <button
                title="再生・停止（Space）"
                className="play-button"
                disabled={!total || !ready}
                onClick={() => void toggle()}
              >
                {playing ? (
                  <Pause size={22} fill="currentColor" />
                ) : (
                  <Play size={22} fill="currentColor" />
                )}
              </button>
              <button
                title="1フレーム進む（→）"
                onClick={() => api.seek(frame + 1)}
                disabled={!total}
              >
                <SkipForward size={18} />
              </button>
            </div>
            <button
              title="全画面表示を終了"
              aria-label="全画面表示を終了"
              onClick={() => void document.exitFullscreen()}
            >
              <Minimize size={18} />
            </button>
          </div>
        </div>
      </div>
      <input
        hidden
        type="file"
        ref={input}
        multiple
        accept="video/*,image/*,audio/*"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []), {
            addToTimeline: true,
          });
          e.target.value = '';
        }}
      />
      <div className="transport">
        <span className="timecode">
          {timecode(frame, project)} <em>/ {timecode(total, project)}</em>
        </span>
        <div className="transport-buttons">
          <button
            title="1フレーム戻る（←）"
            onClick={() => api.seek(frame - 1)}
            disabled={!total}
          >
            <SkipBack size={16} />
          </button>
          <button
            title="再生・停止（Space）"
            className="play-button"
            disabled={!total || !ready}
            onClick={() => void toggle()}
          >
            {playing ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          <button
            title="1フレーム進む（→）"
            onClick={() => api.seek(frame + 1)}
            disabled={!total}
          >
            <SkipForward size={16} />
          </button>
        </div>
        <button
          title="プレビューを全画面表示"
          onClick={() => {
            void stageRef.current
              ?.requestFullscreen()
              .catch((e) => notify(e.message));
          }}
        >
          <Maximize size={15} />
        </button>
      </div>
    </main>
  );
}
