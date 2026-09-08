import { useState } from 'react';
import { Link2, Music2, Plus, Search, Upload } from 'lucide-react';
import { api } from '../../app/store';
import { type Asset, type Project } from '../../core/model';
import { type AssetIssue } from '../../app/editor-state';
import { bytes } from '../controls';

interface MediaPanelProps {
  project: Project;
  panel: 'media' | 'audio';
  busy: boolean;
  offline: string[];
  assetIssues: Record<string, AssetIssue>;
  onImport: () => void;
  onRelink: (assetId: string) => void;
}

export function MediaPanel({
  project,
  panel,
  busy,
  offline,
  assetIssues,
  onImport,
  onRelink,
}: MediaPanelProps) {
  const [search, setSearch] = useState('');
  const assets = project.assets.filter(
    (asset) =>
      (panel !== 'audio' || asset.hasAudio) &&
      asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <button
        className="import-button"
        disabled={busy}
        aria-describedby="media-import-help"
        onClick={onImport}
      >
        <Plus size={18} />
        素材を読み込む
      </button>
      {project.assets.length > 0 && (
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="素材を検索"
            placeholder="素材を検索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      {assets.length === 0 ? (
        <button type="button" className="library-empty" onClick={onImport}>
          <Upload size={32} />
          <p>{search ? '素材が見つかりません' : 'まだ素材がありません'}</p>
          <span>動画・画像・音声を追加</span>
          <small>MP4 / MOV / WebM / PNG / MP3</small>
        </button>
      ) : (
        <AssetGrid
          assets={assets}
          panel={panel}
          offline={offline}
          assetIssues={assetIssues}
          onRelink={onRelink}
        />
      )}
    </>
  );
}

interface AssetGridProps {
  assets: Asset[];
  panel: 'media' | 'audio';
  offline: string[];
  assetIssues: Record<string, AssetIssue>;
  onRelink: (assetId: string) => void;
}

function AssetGrid({
  assets,
  panel,
  offline,
  assetIssues,
  onRelink,
}: AssetGridProps) {
  return (
    <div className="asset-grid">
      {assets.map((asset) => {
        const missing = offline.includes(asset.id);
        const issue = assetIssues[asset.id];
        const relinkLabel =
          issue === 'drive-download-failed'
            ? 'Drive から再取得'
            : issue === 'media-registration-failed'
              ? '読み込み直す'
              : '再接続';
        return (
          <article
            key={asset.id}
            className={`asset-card ${missing ? 'offline' : ''}`}
          >
            <button
              className="asset-image"
              title={`${asset.name} をタイムラインに追加`}
              disabled={missing}
              draggable={!missing}
              onDragStart={(event) =>
                event.dataTransfer.setData(
                  'application/framecut-asset',
                  asset.id,
                )
              }
              onClick={() =>
                api.addClip(panel === 'audio' ? 'audio' : asset.kind, asset)
              }
            >
              {asset.thumbnail ? (
                <img src={asset.thumbnail} alt={asset.name} />
              ) : (
                <Music2 size={32} />
              )}
              <span>
                {asset.kind === 'image'
                  ? '画像'
                  : `${Math.floor(asset.durationUs / 1e6 / 60)}:${String(Math.floor(asset.durationUs / 1e6) % 60).padStart(2, '0')}`}
              </span>
              <span className="asset-add">
                <Plus size={15} />
              </span>
            </button>
            <div className="asset-caption">
              <strong title={asset.name}>{asset.name}</strong>
              <small>
                {bytes(asset.size)}
                {asset.videoCodec ? ` · ${asset.videoCodec.toUpperCase()}` : ''}
              </small>
            </div>
            {asset.waveform?.length ? (
              <svg
                className="asset-waveform"
                viewBox="0 0 160 24"
                preserveAspectRatio="none"
                aria-label="音声の波形"
              >
                {asset.waveform.map((value, index) => (
                  <line
                    key={index}
                    x1={index}
                    x2={index}
                    y1={12 - value * 11}
                    y2={12 + value * 11}
                  />
                ))}
              </svg>
            ) : null}
            {missing && (
              <button
                className="relink"
                title={
                  issue === 'drive-download-failed'
                    ? 'Drive から素材を取得できませんでした'
                    : issue === 'media-registration-failed'
                      ? '素材を解析できませんでした'
                      : 'この端末に素材がありません'
                }
                onClick={() => onRelink(asset.id)}
              >
                <Link2 size={14} />
                {relinkLabel}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
