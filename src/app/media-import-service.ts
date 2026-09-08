import { type Asset, type Project } from '../core/model';
import { MediaClient } from '../media/client';
import {
  availableBytes,
  getAsset,
  putAsset,
  readMeta,
  requestPersistence,
} from '../storage/local';
import {
  api,
  createAssetId,
  setHistoryRestoredHandler,
} from './editor-actions';
import { type AssetIssue, useEditor } from './editor-state';
import { notify } from './notifications';
import { persistNow } from './persistence-controller';

export let media = new MediaClient();
let mediaGeneration = 0;

function applyRuntimeAssetMetadata(
  updates: Map<string, Pick<Asset, 'thumbnail' | 'thumbnails'>>,
) {
  if (!updates.size) return false;
  const state = useEditor.getState();
  const project = structuredClone(state.editor.project);
  for (const asset of project.assets) {
    const update = updates.get(asset.id);
    if (update) Object.assign(asset, update);
  }
  state.editor.project = project;
  useEditor.setState({ project, revision: state.revision + 1 });
  return true;
}

export async function hydrateMedia() {
  const state = useEditor.getState();
  const projectId = state.project.id;
  const generation = ++mediaGeneration;
  const previous = media;
  const client = new MediaClient();
  media = client;
  previous.dispose();
  const offline: string[] = [];
  const assetIssues: Record<string, AssetIssue> = {};
  const metadataUpdates = new Map<
    string,
    Pick<Asset, 'thumbnail' | 'thumbnails'>
  >();
  let drive: typeof import('../storage/drive') | null | undefined;
  let sync: import('../storage/drive').SyncRecord | undefined;
  const resolveDrive = async () => {
    if (drive !== undefined) return;
    try {
      drive = await import('../storage/drive');
      sync = await readMeta<import('../storage/drive').SyncRecord>(
        `drive-sync:${projectId}`,
      );
    } catch {
      // A Drive lookup is optional; each asset is still checked locally below.
      drive = null;
    }
  };
  for (const asset of state.project.assets) {
    let file = await getAsset(projectId, asset.id);
    if (!file) {
      await resolveDrive();
      if (drive?.connected() && sync?.assetIds[asset.id]) {
        try {
          await drive.cacheRemoteAsset(
            projectId,
            asset,
            sync.assetIds[asset.id],
          );
          file = await getAsset(projectId, asset.id);
        } catch {
          assetIssues[asset.id] = 'drive-download-failed';
        }
      }
    }
    if (!file) {
      offline.push(asset.id);
      assetIssues[asset.id] ||= 'missing-local-file';
      continue;
    }
    try {
      const metadata = await client.register(
        asset.id,
        new File([file], asset.name, { type: asset.mime || file.type }),
      );
      if (
        metadata.thumbnail !== asset.thumbnail ||
        JSON.stringify(metadata.thumbnails) !== JSON.stringify(asset.thumbnails)
      ) {
        metadataUpdates.set(asset.id, {
          thumbnail: metadata.thumbnail,
          thumbnails: metadata.thumbnails,
        });
      }
    } catch {
      offline.push(asset.id);
      assetIssues[asset.id] = 'media-registration-failed';
    }
  }
  if (
    generation === mediaGeneration &&
    useEditor.getState().project.id === projectId
  )
    useEditor.setState({
      offline,
      assetIssues,
    });
  applyRuntimeAssetMetadata(metadataUpdates);
  if (offline.length)
    notify(
      `${offline.length} 件の素材を利用できません。素材一覧から原因を確認して再接続してください。`,
    );
}

setHistoryRestoredHandler(() => void hydrateMedia());

export async function importFiles(
  files: File[],
  options?: { addToTimeline?: boolean; frame?: number; relinkId?: string },
) {
  if (useEditor.getState().busy) return;
  if (options?.relinkId) files = files.slice(0, 1);
  await requestPersistence();
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > (await availableBytes())) {
    notify('端末の保存容量が不足しています。空き容量を確保してください。');
    return;
  }
  const projectId = useEditor.getState().project.id;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    useEditor.setState({
      busy: `${file.name} を解析中 (${index + 1}/${files.length})`,
    });
    const assetId = options?.relinkId || createAssetId();
    try {
      if (options?.relinkId) {
        const original = useEditor
          .getState()
          .project.assets.find((asset) => asset.id === assetId);
        if (
          original &&
          (original.name !== file.name || original.size !== file.size)
        )
          throw Error(
            '元の素材と同じファイルを選択してください（名前・サイズが一致しません）',
          );
      }
      const asset = await media.register(assetId, file);
      if (asset.hasAudio) {
        useEditor.setState({ busy: `${file.name} の波形を生成中…` });
        asset.waveform = await media.waveform(assetId);
      }
      const storage = await putAsset(projectId, assetId, file);
      if (options?.relinkId) {
        api.execute({ type: 'asset.relink', assetId, asset });
        useEditor.setState({
          offline: useEditor.getState().offline.filter((id) => id !== assetId),
          assetIssues: Object.fromEntries(
            Object.entries(useEditor.getState().assetIssues).filter(
              ([id]) => id !== assetId,
            ),
          ),
        });
      } else {
        api.execute({ type: 'asset.add', asset });
        if (options?.addToTimeline)
          api.addClip(asset.kind, asset, options.frame);
      }
      notify(
        storage === 'opfs'
          ? `${file.name} を読み込みました`
          : `${file.name} を読み込みました。素材はこのセッション中のみ利用できます。`,
      );
    } catch (error) {
      notify(`${file.name}: ${(error as Error).message}`);
    }
  }
  useEditor.setState({ busy: '' });
  await persistNow();
}

export async function projectFiles(project: Project) {
  const result: { id: string; file: File }[] = [];
  for (const asset of project.assets) {
    const file = await getAsset(project.id, asset.id);
    if (file)
      result.push({
        id: asset.id,
        file: new File([file], asset.name, { type: asset.mime || file.type }),
      });
  }
  return result;
}
