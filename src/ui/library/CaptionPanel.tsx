import { type RefObject } from 'react';
import { Captions, Upload } from 'lucide-react';
import { api } from '../../app/store';
import { fps, type Project } from '../../core/model';

export function CaptionPanel({
  project,
  srtInput,
}: {
  project: Project;
  srtInput: RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <p className="panel-help">台詞や説明を、時間に合わせて。</p>
      <button className="import-button" onClick={() => api.addClip('caption')}>
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
          .filter((track) => track.type === 'caption')
          .flatMap((track) => track.clips)
          .sort((left, right) => left.startFrame - right.startFrame)
          .map((clip) => (
            <button
              key={clip.id}
              onClick={() => {
                api.select(clip.id);
                api.seek(clip.startFrame);
              }}
            >
              <small>{(clip.startFrame / fps(project)).toFixed(2)}s</small>
              <span>{clip.text}</span>
            </button>
          ))}
      </div>
      <p className="panel-help">
        字幕を選択すると、表示時間とスタイルを調整できます。
      </p>
    </>
  );
}
