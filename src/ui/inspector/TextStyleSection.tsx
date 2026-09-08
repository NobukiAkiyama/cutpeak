import { api } from '../../app/store';
import { type Clip, type Track } from '../../core/model';
import { Choice, Field, NumberField } from '../controls';

export function TextStyleSection({
  clip,
  track,
  update,
}: {
  clip: Clip;
  track: Track;
  update: (patch: Partial<Clip>) => boolean;
}) {
  return (
    <section className="inspector-section">
      <Field label={clip.type === 'caption' ? '字幕' : 'テキスト'}>
        <textarea
          aria-label="テキスト内容"
          value={clip.text}
          rows={3}
          onFocus={() => api.begin('テキストを編集')}
          onChange={(event) => update({ text: event.target.value })}
          onBlur={() => api.end()}
        />
      </Field>
      <Choice
        label="フォント"
        value={clip.style.font}
        options={[
          { value: 'sans-serif', label: 'ゴシック' },
          { value: 'serif', label: '明朝' },
          { value: 'monospace', label: '等幅' },
        ]}
        onChange={(font) => update({ style: { ...clip.style, font } })}
      />
      <div className="field-pair">
        <NumberField
          label="サイズ"
          value={clip.style.size}
          min={8}
          max={600}
          onChange={(size) => update({ style: { ...clip.style, size } })}
        />
        <Field label="太さ">
          <Choice
            label="文字の太さ"
            value={String(clip.style.weight)}
            options={[
              { value: '400', label: '標準' },
              { value: '700', label: '太字' },
              { value: '900', label: '極太' },
            ]}
            onChange={(weight) =>
              update({ style: { ...clip.style, weight: Number(weight) } })
            }
          />
        </Field>
      </div>
      <div className="field-pair">
        <Field label="文字色">
          <input
            type="color"
            aria-label="文字色"
            value={clip.style.color}
            onChange={(event) =>
              update({ style: { ...clip.style, color: event.target.value } })
            }
          />
        </Field>
        <Field label="背景色">
          <div className="color-row">
            <input
              type="color"
              aria-label="文字の背景色"
              value={clip.style.background.slice(0, 7)}
              onChange={(event) =>
                update({
                  style: { ...clip.style, background: event.target.value },
                })
              }
            />
            <button
              title="背景を透明にする"
              onClick={() =>
                update({
                  style: { ...clip.style, background: '#00000000' },
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
        value={clip.style.align}
        options={[
          { value: 'left', label: '左揃え' },
          { value: 'center', label: '中央揃え' },
          { value: 'right', label: '右揃え' },
        ]}
        onChange={(align) => {
          if (align === 'left' || align === 'center' || align === 'right')
            update({ style: { ...clip.style, align } });
        }}
      />
      <div className="field-pair">
        <NumberField
          label="縁取り"
          min={0}
          max={30}
          value={clip.style.strokeWidth}
          onChange={(strokeWidth) =>
            update({ style: { ...clip.style, strokeWidth } })
          }
        />
        <Field label="縁取り色">
          <input
            type="color"
            aria-label="縁取りの色"
            value={clip.style.stroke}
            onChange={(event) =>
              update({ style: { ...clip.style, stroke: event.target.value } })
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
          value={clip.style.lineHeight}
          onChange={(lineHeight) =>
            update({ style: { ...clip.style, lineHeight } })
          }
        />
        <NumberField
          label="字間"
          min={-10}
          max={50}
          value={clip.style.letterSpacing}
          onChange={(letterSpacing) =>
            update({ style: { ...clip.style, letterSpacing } })
          }
        />
      </div>
      {clip.type === 'caption' && (
        <button
          className="secondary full"
          onClick={() =>
            api.execute({
              type: 'caption.style',
              trackId: track.id,
              style: clip.style,
            })
          }
        >
          全字幕にスタイルを適用
        </button>
      )}
    </section>
  );
}
