import { useState } from 'react';
import { Diamond, LockKeyhole, MousePointer2, RotateCcw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, useEditor } from '../app/store';
import {
  clipSpeed,
  findClip,
  fps,
  type Clip,
  type Easing,
  type TransformKey,
} from '../core/model';
import { evaluate, values } from '../core/timeline';
import { Choice, Field, NumberField } from './controls';
import { AudioSection } from './inspector/AudioSection';
import { TextStyleSection } from './inspector/TextStyleSection';
import { TimingSection } from './inspector/TimingSection';

const transformKeys: TransformKey[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
];

const isEasing = (value: string): value is Easing =>
  ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(value);

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

  const { clip, track } = found;
  const local = Math.max(0, frame - clip.startFrame);
  const currentValues = values(clip, frame);
  const hasVisual = clip.type !== 'audio';
  const asset = project.assets.find(
    (candidate) => candidate.id === clip.assetId,
  );
  const speed = clipSpeed(clip);
  const update = (patch: Partial<Clip>) =>
    api.execute({ type: 'clip.update', clipId: clip.id, patch });
  const transform = (key: TransformKey, value: number) =>
    api.execute({
      type: 'clip.transform',
      clipId: clip.id,
      key,
      value,
      ...(clip.transform[key].keyframes.length ? { frame: local, easing } : {}),
    });
  const setSpeed = (next: number) => {
    if (next !== speed)
      api.execute({
        type: 'clip.update',
        clipId: clip.id,
        patch: { speed: next },
      });
  };
  const toggleKeyframe = (key: TransformKey) => {
    if (
      clip.transform[key].keyframes.some((keyframe) => keyframe.frame === local)
    )
      api.execute({
        type: 'keyframe.delete',
        clipId: clip.id,
        key,
        frame: local,
      });
    else
      api.execute({
        type: 'clip.transform',
        clipId: clip.id,
        key,
        value: evaluate(clip.transform[key], local),
        frame: local,
        easing,
      });
  };
  const transformField = (
    key: TransformKey,
    label: string,
    min: number,
    max: number,
    multiplier = 1,
    suffix?: string,
  ) => {
    const active = clip.transform[key].keyframes.some(
      (keyframe) => keyframe.frame === local,
    );
    return (
      <div className="keyframe-field" key={key}>
        <NumberField
          label={label}
          value={currentValues[key] * multiplier}
          min={min}
          max={max}
          step={key.startsWith('scale') ? 0.1 : 1}
          suffix={suffix}
          onChange={(value) => transform(key, value / multiplier)}
        />
        <button
          title={`${label} キーフレームを追加・削除`}
          className={active ? 'key-active' : ''}
          onClick={() => toggleKeyframe(key)}
        >
          <Diamond size={13} fill={active ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };
  const resetTransform = () => {
    const defaults: Record<TransformKey, number> = {
      x: project.width / 2,
      y: project.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    };
    api.begin('変形をリセット');
    for (const key of transformKeys) transform(key, defaults[key]);
    api.end();
  };
  const updateEasing = (next: string) => {
    if (!isEasing(next)) return;
    setEasing(next);
    api.begin('キーフレームの補間を変更');
    for (const key of transformKeys) {
      const animation = clip.transform[key];
      if (animation.keyframes.some((keyframe) => keyframe.frame === local))
        api.execute({
          type: 'clip.transform',
          clipId: clip.id,
          key,
          value: evaluate(animation, local),
          frame: local,
          easing: next,
        });
    }
    api.end();
  };

  return (
    <>
      <div className="panel-heading">
        <span className="selected-name" title={clip.name}>
          {clip.name}
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
            {(clip.type === 'text' || clip.type === 'caption') && (
              <TextStyleSection clip={clip} track={track} update={update} />
            )}
            {clip.type === 'shape' && (
              <section className="inspector-section">
                <Field label="塗りつぶし">
                  <input
                    type="color"
                    aria-label="図形の色"
                    value={clip.color}
                    onChange={(event) => update({ color: event.target.value })}
                  />
                </Field>
              </section>
            )}
            {hasVisual && (
              <section className="inspector-section">
                <div className="section-heading">
                  変形
                  <button title="変形をリセット" onClick={resetTransform}>
                    <RotateCcw size={13} />
                  </button>
                </div>
                <div className="field-pair">
                  {transformField('x', '位置 X', -10000, 10000)}
                  {transformField('y', '位置 Y', -10000, 10000)}
                </div>
                <div className="field-pair">
                  {transformField('scaleX', '横倍率', 1, 1000, 100, '%')}
                  {transformField('scaleY', '縦倍率', 1, 1000, 100, '%')}
                </div>
                {transformField('rotation', '回転', -3600, 3600, 1, '°')}
                {transformField('opacity', '不透明度', 0, 100, 100, '%')}
                <div className="section-label">クロップ</div>
                <div className="field-pair">
                  {(['left', 'right', 'top', 'bottom'] as const).map(
                    (key, index) => (
                      <NumberField
                        key={key}
                        label={['左', '右', '上', '下'][index]}
                        value={clip.crop[key] * 100}
                        min={0}
                        max={49}
                        suffix="%"
                        onChange={(value) =>
                          update({
                            crop: { ...clip.crop, [key]: value / 100 },
                          })
                        }
                      />
                    ),
                  )}
                </div>
              </section>
            )}
            <TimingSection
              project={project}
              clip={clip}
              asset={asset}
              setSpeed={setSpeed}
            />
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
                  {transformField('x', '位置 X', -10000, 10000)}
                  {transformField('y', '位置 Y', -10000, 10000)}
                  {transformField('scaleX', '横倍率', 1, 1000, 100, '%')}
                  {transformField('scaleY', '縦倍率', 1, 1000, 100, '%')}
                  {transformField('rotation', '回転', -3600, 3600, 1, '°')}
                  {transformField('opacity', '不透明度', 0, 100, 100, '%')}
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
                  onChange={updateEasing}
                />
              </Field>
              <div className="keyframe-list">
                {Array.from(
                  new Set(
                    Object.values(clip.transform).flatMap((animation) =>
                      animation.keyframes.map((keyframe) => keyframe.frame),
                    ),
                  ),
                )
                  .filter(
                    (keyframe) =>
                      keyframe >= 0 && keyframe < clip.durationFrames,
                  )
                  .sort((left, right) => left - right)
                  .map((keyframe) => (
                    <button
                      className={keyframe === local ? 'active' : ''}
                      key={keyframe}
                      onClick={() => api.seek(clip.startFrame + keyframe)}
                    >
                      <Diamond size={11} />
                      {keyframe} f
                    </button>
                  ))}
              </div>
            </section>
            {hasVisual && (
              <section className="inspector-section">
                <div className="section-heading">トランジション</div>
                <Choice
                  label="トランジション"
                  value={clip.transition}
                  options={[
                    { value: 'none', label: 'なし' },
                    { value: 'fade', label: 'フェード' },
                    { value: 'dissolve', label: 'クロスディゾルブ' },
                  ]}
                  onChange={(transition) => {
                    if (
                      transition === 'none' ||
                      transition === 'fade' ||
                      transition === 'dissolve'
                    )
                      update({ transition });
                  }}
                />
                {clip.transition !== 'none' && (
                  <NumberField
                    label="長さ（フレーム）"
                    value={clip.transitionFrames}
                    min={1}
                    max={Math.floor(clip.durationFrames / 2)}
                    onChange={(value) =>
                      update({ transitionFrames: Math.round(value) })
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
            <AudioSection project={project} clip={clip} update={update} />
          </TabsContent>
        </Tabs>
      </fieldset>
      {track.locked && (
        <p className="panel-help">トラックのロックを解除すると編集できます。</p>
      )}
    </>
  );
}
