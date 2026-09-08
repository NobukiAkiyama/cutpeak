import { Circle, RectangleHorizontal } from 'lucide-react';
import { api } from '../../app/store';

export function ShapePanel() {
  return (
    <>
      <p className="panel-help">背景やアクセントになる図形を追加。</p>
      <div className="shape-options">
        <button onClick={() => api.addClip('shape')}>
          <RectangleHorizontal size={40} />
          <span>四角形</span>
        </button>
        <button
          onClick={() => {
            const clipId = api.addClip('shape');
            api.execute({
              type: 'clip.update',
              clipId,
              patch: { shape: 'ellipse' },
            });
          }}
        >
          <Circle size={38} />
          <span>円</span>
        </button>
      </div>
    </>
  );
}
