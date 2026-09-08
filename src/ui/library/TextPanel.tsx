import { Plus, Type } from 'lucide-react';
import { api, useEditor } from '../../app/store';

const presets = [
  {
    name: '大きな見出し',
    size: 110,
    weight: 800,
    background: '#00000000',
    color: '#ffffff',
  },
  {
    name: 'ハイライト',
    size: 64,
    weight: 700,
    background: '#bbef69',
    color: '#15210c',
  },
  {
    name: 'シンプル',
    size: 56,
    weight: 400,
    background: '#00000000',
    color: '#ffffff',
  },
];

export function TextPanel() {
  return (
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
      {presets.map((preset) => (
        <button
          className="text-preset"
          key={preset.name}
          onClick={() => {
            const clipId = api.addClip('text');
            const clip = useEditor
              .getState()
              .project.tracks.flatMap((track) => track.clips)
              .find((candidate) => candidate.id === clipId)!;
            api.execute({
              type: 'clip.update',
              clipId,
              patch: {
                text: preset.name,
                style: {
                  ...clip.style,
                  size: preset.size,
                  weight: preset.weight,
                  background: preset.background,
                  color: preset.color,
                },
              },
            });
          }}
        >
          <span
            style={{
              fontWeight: preset.weight,
              background: preset.background,
              color: preset.color,
            }}
          >
            {preset.name}
          </span>
        </button>
      ))}
    </>
  );
}
