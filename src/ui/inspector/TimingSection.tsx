import { api } from '../../app/store';
import {
  clipSpeed,
  fps,
  type Asset,
  type Clip,
  type Project,
} from '../../core/model';
import { NumberField } from '../controls';

export function TimingSection({
  project,
  clip,
  asset,
  setSpeed,
}: {
  project: Project;
  clip: Clip;
  asset: Asset | undefined;
  setSpeed: (speed: number) => void;
}) {
  const speed = clipSpeed(clip);
  const canChangeSpeed =
    !!asset && (clip.type === 'video' || clip.type === 'audio');
  const durationLimit =
    asset && clip.type !== 'image' && asset.videoCodec !== 'gif'
      ? Math.floor(
          (((asset.durationUs - clip.sourceInUs) / 1e6) * fps(project)) / speed,
        )
      : 108000;
  return (
    <section className="inspector-section">
      <div className="section-heading">タイミング</div>
      <NumberField
        label="開始フレーム"
        value={clip.startFrame}
        min={0}
        onChange={(value) =>
          api.execute({
            type: 'clip.move',
            clipId: clip.id,
            startFrame: Math.round(value),
          })
        }
      />
      <NumberField
        label="長さ（フレーム）"
        value={clip.durationFrames}
        min={1}
        max={durationLimit}
        onChange={(value) =>
          api.execute({
            type: 'clip.trim',
            clipId: clip.id,
            startFrame: clip.startFrame,
            durationFrames: Math.round(value),
            sourceInUs: clip.sourceInUs,
          })
        }
      />
      <small className="muted">
        {(clip.durationFrames / fps(project)).toFixed(2)} 秒
      </small>
      {canChangeSpeed && (
        <>
          <div className="section-label speed-label">再生速度</div>
          <fieldset className="speed-presets">
            <legend className="sr-only">再生速度のプリセット</legend>
            {[0.25, 0.5, 1, 1.5, 2, 4].map((value) => (
              <button
                type="button"
                key={value}
                className={speed === value ? 'active' : ''}
                aria-pressed={speed === value}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </button>
            ))}
          </fieldset>
          <NumberField
            label="速度を指定"
            value={speed}
            min={0.25}
            max={4}
            step={0.05}
            suffix="×"
            onChange={setSpeed}
          />
          <p className="panel-help speed-help">
            速度に合わせてクリップの長さを調整します。音声の音程も変化します。
          </p>
        </>
      )}
    </section>
  );
}
