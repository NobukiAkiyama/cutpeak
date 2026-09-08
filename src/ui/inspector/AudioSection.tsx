import { api } from '../../app/store';
import { fps, type Clip, type Project } from '../../core/model';
import { NumberField, Range } from '../controls';

export function AudioSection({
  project,
  clip,
  update,
}: {
  project: Project;
  clip: Clip;
  update: (patch: Partial<Clip>) => boolean;
}) {
  return (
    <>
      <section className="inspector-section">
        <div className="section-heading">音量</div>
        <NumberField
          label="音量"
          suffix="dB"
          value={clip.volumeDb}
          min={-60}
          max={12}
          onChange={(volumeDb) => update({ volumeDb })}
        />
        <Range
          label="音量を調整"
          value={clip.volumeDb}
          min={-60}
          max={12}
          onStart={() => api.begin('音量を変更')}
          onChange={(volumeDb) => update({ volumeDb })}
          onCommit={() => api.end()}
        />
        <button
          className={clip.muted ? 'secondary full active' : 'secondary full'}
          onClick={() => update({ muted: !clip.muted })}
        >
          {clip.muted ? 'ミュートを解除' : 'ミュート'}
        </button>
      </section>
      <section className="inspector-section">
        <div className="section-heading">フェード</div>
        <NumberField
          label="フェードイン"
          suffix="秒"
          value={clip.fadeInFrames / fps(project)}
          min={0}
          max={clip.durationFrames / fps(project)}
          step={0.1}
          onChange={(seconds) =>
            update({ fadeInFrames: Math.round(seconds * fps(project)) })
          }
        />
        <NumberField
          label="フェードアウト"
          suffix="秒"
          value={clip.fadeOutFrames / fps(project)}
          min={0}
          max={clip.durationFrames / fps(project)}
          step={0.1}
          onChange={(seconds) =>
            update({ fadeOutFrames: Math.round(seconds * fps(project)) })
          }
        />
      </section>
    </>
  );
}
