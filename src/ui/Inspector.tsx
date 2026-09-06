import { useState } from 'react';
import { MousePointer2, Diamond, RotateCcw, LockKeyhole } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api, useEditor } from '../app/store';
import { findClip, fps, type TransformKey, type Easing } from '../core/model';
import { evaluate, values } from '../core/timeline';
import { Choice, Field, NumberField, Range } from './controls';
export default function Inspector() {
  const { project, selected, frame } = useEditor();
  const found = selected ? findClip(project, selected) : null;
  const [easing, setEasing] = useState<Easing>('linear');
  if (!found)
    return (
      <>
        <div className="panel-heading">インスペクター</div>
        <div className="inspector-empty">
          <MousePointer2 size={29} />
          <p>クリップを選択</p>
          <span>
            位置、サイズ、音量などを
            <br />
            ここで調整できます。
          </span>
        </div>
        <div className="project-summary">
          <span>プロジェクト</span>
          <strong>
            {project.width} × {project.height}
          </strong>
          <small>
            {fps(project).toFixed(2).replace('.00', '')} fps ·{' '}
            {project.tracks.length} トラック
          </small>
        </div>
      </>
    );
  const { clip: c, track } = found,
    local = Math.max(0, frame - c.startFrame),
    v = values(c, frame),
    hasVisual = c.type !== 'audio',
    asset = project.assets.find((a) => a.id === c.assetId);
  const update = (
    patch: Parameters<typeof api.execute>[0] extends never
      ? never
      : Partial<typeof c>,
  ) => api.execute({ type: 'clip.update', clipId: c.id, patch });
  const transform = (key: TransformKey, value: number) =>
    api.execute({
      type: 'clip.transform',
      clipId: c.id,
      key,
      value,
      ...(c.transform[key].keyframes.length ? { frame: local, easing } : {}),
    });
  const keyframe = (key: TransformKey) => {
    if (c.transform[key].keyframes.some((k) => k.frame === local))
      api.execute({ type: 'keyframe.delete', clipId: c.id, key, frame: local });
    else
      api.execute({
        type: 'clip.transform',
        clipId: c.id,
        key,
        value: evaluate(c.transform[key], local),
        frame: local,
        easing,
      });
  };
  const tf = (
    key: TransformKey,
    label: string,
    min: number,
    max: number,
    mult = 1,
    suffix?: string,
  ) => (
    <div className="keyframe-field" key={key}>
      <NumberField
        label={label}
        value={v[key] * mult}
        min={min}
        max={max}
        step={key.startsWith('scale') ? 0.1 : 1}
        suffix={suffix}
        onChange={(n) => transform(key, n / mult)}
      />
      <button
        title={`${label} キーフレームを追加・削除`}
        className={
          c.transform[key].keyframes.some((k) => k.frame === local)
            ? 'key-active'
            : ''
        }
        onClick={() => keyframe(key)}
      >
        <Diamond
          size={13}
          fill={
            c.transform[key].keyframes.some((k) => k.frame === local)
              ? 'currentColor'
              : 'none'
          }
        />
      </button>
    </div>
  );
  return (
    <>
      <div className="panel-heading">
        <span className="selected-name" title={c.name}>
          {c.name}
        </span>
        {track.locked && <LockKeyhole size={15} />}
      </div>
      <fieldset disabled={track.locked} className="inspector-fields">
        <Tabs defaultValue="basic">
          <TabsList className="inspector-tabs" variant="line">
            <TabsTrigger value="basic">基本</TabsTrigger>
            <TabsTrigger value="animation">アニメーション</TabsTrigger>
            <TabsTrigger value="audio" disabled={!asset?.hasAudio}>
              音声
            </TabsTrigger>
          </TabsList>
          <TabsContent value="basic">
            {(c.type === 'text' || c.type === 'caption') && (
              <section className="inspector-section">
                <Field label={c.type === 'caption' ? '字幕' : 'テキスト'}>
                  <textarea
                    aria-label="テキスト内容"
                    value={c.text}
                    rows={3}
                    onFocus={() => api.begin('テキストを編集')}
                    onChange={(e) => update({ text: e.target.value })}
                    onBlur={() => api.end()}
                  />
                </Field>
                <Choice
                  label="フォント"
                  value={c.style.font}
                  options={[
                    { value: 'sans-serif', label: 'ゴシック' },
                    { value: 'serif', label: '明朝' },
                    { value: 'monospace', label: '等幅' },
                  ]}
                  onChange={(font) => update({ style: { ...c.style, font } })}
                />
                <div className="field-pair">
                  <NumberField
                    label="サイズ"
                    value={c.style.size}
                    min={8}
                    max={600}
                    onChange={(size) => update({ style: { ...c.style, size } })}
                  />
                  <Field label="太さ">
                    <Choice
                      label="文字の太さ"
                      value={String(c.style.weight)}
                      options={[
                        { value: '400', label: '標準' },
                        { value: '700', label: '太字' },
                        { value: '900', label: '極太' },
                      ]}
                      onChange={(weight) =>
                        update({
                          style: { ...c.style, weight: Number(weight) },
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="field-pair">
                  <Field label="文字色">
                    <input
                      type="color"
                      aria-label="文字色"
                      value={c.style.color}
                      onChange={(e) =>
                        update({ style: { ...c.style, color: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="背景色">
                    <div className="color-row">
                      <input
                        type="color"
                        aria-label="文字の背景色"
                        value={c.style.background.slice(0, 7)}
                        onChange={(e) =>
                          update({
                            style: { ...c.style, background: e.target.value },
                          })
                        }
                      />
                      <button
                        title="背景を透明にする"
                        onClick={() =>
                          update({
                            style: { ...c.style, background: '#00000000' },
                          })
                        }
                      >
                        なし
                      </button>
                    </div>
                  </Field>
                </div>
                <Choice
                  label="文字揃え"
                  value={c.style.align}
                  options={[
                    { value: 'left', label: '左揃え' },
                    { value: 'center', label: '中央揃え' },
                    { value: 'right', label: '右揃え' },
                  ]}
                  onChange={(align) =>
                    update({ style: { ...c.style, align: align as 'left' } })
                  }
                />
                <div className="field-pair">
                  <NumberField
                    label="縁取り"
                    min={0}
                    max={30}
                    value={c.style.strokeWidth}
                    onChange={(strokeWidth) =>
                      update({ style: { ...c.style, strokeWidth } })
                    }
                  />
                  <Field label="縁取り色">
                    <input
                      type="color"
                      aria-label="縁取りの色"
                      value={c.style.stroke}
                      onChange={(e) =>
                        update({
                          style: { ...c.style, stroke: e.target.value },
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="field-pair">
                  <NumberField
                    label="行間"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={c.style.lineHeight}
                    onChange={(lineHeight) =>
                      update({ style: { ...c.style, lineHeight } })
                    }
                  />
                  <NumberField
                    label="字間"
                    min={-10}
                    max={50}
                    value={c.style.letterSpacing}
                    onChange={(letterSpacing) =>
                      update({ style: { ...c.style, letterSpacing } })
                    }
                  />
                </div>
                {c.type === 'caption' && (
                  <button
                    className="secondary full"
                    onClick={() =>
                      api.execute({
                        type: 'caption.style',
                        trackId: track.id,
                        style: c.style,
                      })
                    }
                  >
                    全字幕にスタイルを適用
                  </button>
                )}
              </section>
            )}
            {c.type === 'shape' && (
              <section className="inspector-section">
                <Field label="塗りつぶし">
                  <input
                    type="color"
                    aria-label="図形の色"
                    value={c.color}
                    onChange={(e) => update({ color: e.target.value })}
                  />
                </Field>
              </section>
            )}
            {hasVisual && (
              <section className="inspector-section">
                <div className="section-heading">
                  変形
                  <button
                    title="変形をリセット"
                    onClick={() => {
                      api.begin('変形をリセット');
                      for (const [key, value] of Object.entries({
                        x: project.width / 2,
                        y: project.height / 2,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        opacity: 1,
                      }))
                        transform(key as TransformKey, value);
                      api.end();
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
                <div className="field-pair">
                  {tf('x', '位置 X', -10000, 10000)}
                  {tf('y', '位置 Y', -10000, 10000)}
                </div>
                <div className="field-pair">
                  {tf('scaleX', '横倍率', 1, 1000, 100, '%')}
                  {tf('scaleY', '縦倍率', 1, 1000, 100, '%')}
                </div>
                {tf('rotation', '回転', -3600, 3600, 1, '°')}
                {tf('opacity', '不透明度', 0, 100, 100, '%')}
                <div className="section-label">クロップ</div>
                <div className="field-pair">
                  {(['left', 'right', 'top', 'bottom'] as const).map(
                    (key, i) => (
                      <NumberField
                        key={key}
                        label={['左', '右', '上', '下'][i]}
                        value={c.crop[key] * 100}
                        min={0}
                        max={49}
                        suffix="%"
                        onChange={(n) =>
                          update({ crop: { ...c.crop, [key]: n / 100 } })
                        }
                      />
                    ),
                  )}
                </div>
              </section>
            )}
            <section className="inspector-section">
              <div className="section-heading">タイミング</div>
              <NumberField
                label="開始フレーム"
                value={c.startFrame}
                min={0}
                onChange={(n) =>
                  api.execute({
                    type: 'clip.move',
                    clipId: c.id,
                    startFrame: Math.round(n),
                  })
                }
              />
              <NumberField
                label="長さ（フレーム）"
                value={c.durationFrames}
                min={1}
                max={
                  asset && c.type !== 'image' && asset.videoCodec !== 'gif'
                    ? Math.floor(
                        ((asset.durationUs - c.sourceInUs) / 1e6) *
                          fps(project),
                      )
                    : 108000
                }
                onChange={(n) =>
                  api.execute({
                    type: 'clip.trim',
                    clipId: c.id,
                    startFrame: c.startFrame,
                    durationFrames: Math.round(n),
                    sourceInUs: c.sourceInUs,
                  })
                }
              />
              <small className="muted">
                {(c.durationFrames / fps(project)).toFixed(2)} 秒
              </small>
            </section>
          </TabsContent>
          <TabsContent value="animation">
            <section className="inspector-section">
              <div className="section-heading">
                キーフレーム<span className="muted">{local} f</span>
              </div>
              <p className="panel-help">
                再生位置を変えて ◇ を押すと、その位置の値を記録できます。
              </p>
              {hasVisual && (
                <>
                  {tf('x', '位置 X', -10000, 10000)}
                  {tf('y', '位置 Y', -10000, 10000)}
                  {tf('scaleX', '横倍率', 1, 1000, 100, '%')}
                  {tf('scaleY', '縦倍率', 1, 1000, 100, '%')}
                  {tf('rotation', '回転', -3600, 3600, 1, '°')}
                  {tf('opacity', '不透明度', 0, 100, 100, '%')}
                </>
              )}
              <Field label="補間">
                <Choice
                  label="キーフレームの補間"
                  value={easing}
                  options={[
                    { value: 'linear', label: 'リニア' },
                    { value: 'ease-in', label: 'イーズイン' },
                    { value: 'ease-out', label: 'イーズアウト' },
                    { value: 'ease-in-out', label: 'イーズイン・アウト' },
                  ]}
                  onChange={(v) => {
                    setEasing(v as Easing);
                    api.begin('キーフレームの補間を変更');
                    for (const [key, a] of Object.entries(c.transform)) {
                      if (a.keyframes.some((k) => k.frame === local))
                        api.execute({
                          type: 'clip.transform',
                          clipId: c.id,
                          key: key as TransformKey,
                          value: evaluate(a, local),
                          frame: local,
                          easing: v as Easing,
                        });
                    }
                    api.end();
                  }}
                />
              </Field>
              <div className="keyframe-list">
                {Array.from(
                  new Set(
                    Object.values(c.transform).flatMap((a) =>
                      a.keyframes.map((k) => k.frame),
                    ),
                  ),
                )
                  .filter((f) => f >= 0 && f < c.durationFrames)
                  .sort((a, b) => a - b)
                  .map((f) => (
                    <button
                      className={f === local ? 'active' : ''}
                      key={f}
                      onClick={() => api.seek(c.startFrame + f)}
                    >
                      <Diamond size={11} />
                      {f} f
                    </button>
                  ))}
              </div>
            </section>
            {hasVisual && (
              <section className="inspector-section">
                <div className="section-heading">トランジション</div>
                <Choice
                  label="トランジション"
                  value={c.transition}
                  options={[
                    { value: 'none', label: 'なし' },
                    { value: 'fade', label: 'フェード' },
                    { value: 'dissolve', label: 'クロスディゾルブ' },
                  ]}
                  onChange={(v) => update({ transition: v as 'fade' })}
                />
                {c.transition !== 'none' && (
                  <NumberField
                    label="長さ（フレーム）"
                    value={c.transitionFrames}
                    min={1}
                    max={Math.floor(c.durationFrames / 2)}
                    onChange={(n) =>
                      update({ transitionFrames: Math.round(n) })
                    }
                  />
                )}
                <p className="panel-help">
                  クロスディゾルブは、同じ映像トラック上でクリップを重ねて使います。
                </p>
              </section>
            )}
          </TabsContent>
          <TabsContent value="audio">
            <section className="inspector-section">
              <div className="section-heading">音量</div>
              <NumberField
                label="音量"
                suffix="dB"
                value={c.volumeDb}
                min={-60}
                max={12}
                onChange={(n) => update({ volumeDb: n })}
              />
              <Range
                label="音量を調整"
                value={c.volumeDb}
                min={-60}
                max={12}
                onStart={() => api.begin('音量を変更')}
                onChange={(n) => update({ volumeDb: n })}
                onCommit={() => api.end()}
              />
              <button
                className={c.muted ? 'secondary full active' : 'secondary full'}
                onClick={() => update({ muted: !c.muted })}
              >
                {c.muted ? 'ミュートを解除' : 'ミュート'}
              </button>
            </section>
            <section className="inspector-section">
              <div className="section-heading">フェード</div>
              <NumberField
                label="フェードイン"
                suffix="秒"
                value={c.fadeInFrames / fps(project)}
                min={0}
                max={c.durationFrames / fps(project)}
                step={0.1}
                onChange={(n) =>
                  update({ fadeInFrames: Math.round(n * fps(project)) })
                }
              />
              <NumberField
                label="フェードアウト"
                suffix="秒"
                value={c.fadeOutFrames / fps(project)}
                min={0}
                max={c.durationFrames / fps(project)}
                step={0.1}
                onChange={(n) =>
                  update({ fadeOutFrames: Math.round(n * fps(project)) })
                }
              />
            </section>
          </TabsContent>
        </Tabs>
      </fieldset>
      {track.locked && (
        <p className="panel-help">トラックのロックを解除すると編集できます。</p>
      )}
    </>
  );
}
