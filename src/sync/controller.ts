import { useEditor, api, openProject, persistNow, notify } from '../app/store';
import {
  connected,
  pushDrive,
  pullDrive,
  type SyncRecord,
} from '../storage/drive';
import { readMeta, writeMeta } from '../storage/local';
let syncing = false;
export async function syncProject(
  mode?: SyncRecord['mode'],
  onProgress?: (m: string) => void,
  saveName?: string,
) {
  if (syncing) return;
  const state = useEditor.getState();
  const record = await readMeta<SyncRecord>(`drive-sync:${state.project.id}`);
  if (!mode && !record?.pending) return;
  if (!connected() || !navigator.onLine) return;
  syncing = true;
  try {
    await persistNow();
    const current = useEditor.getState();
    const result = await pushDrive(
      { project: current.project, repository: current.repository },
      mode || record!.mode,
      onProgress || (() => {}),
      saveName,
    );
    if (result.fastForward) {
      if (result.record.fileId) {
        const pulled = await pullDrive(result.record.fileId, onProgress || (() => {}));
        if (useEditor.getState().project.id === current.project.id)
          await openProject(pulled);
      }
      notify('Drive の更新を取得しました');
      return;
    }
    if (result.conflict) {
      let cachedAssetIds: SyncRecord['assetIds'] = {};
      if (result.record.fileId) {
        try {
          await pullDrive(result.record.fileId, onProgress || (() => {}));
          cachedAssetIds =
            (await readMeta<SyncRecord>(`drive-sync:${current.project.id}`))
              ?.assetIds || {};
        } catch {
          /* The immutable remote branch remains available even if asset caching fails. */
        }
      }
      if (useEditor.getState().project.id === current.project.id) {
        api.importBranch(
          result.conflict,
          `Drive の別案 ${new Date().toLocaleString('ja-JP')}`,
        );
        await persistNow();
      }
      await writeMeta(`drive-sync:${current.project.id}`, {
        ...result.record,
        assetIds: { ...result.record.assetIds, ...cachedAssetIds },
        pending: false,
        conflictHead: result.conflict.head,
      });
      notify(
        'Drive 側にも変更がありました。上書きせず、履歴に「Drive の別案」を追加しました。案を確認してから保存してください。',
      );
    } else {
      notify('Google Drive に保存しました');
    }
  } catch (e) {
    notify((e as Error).message);
    throw e;
  } finally {
    syncing = false;
  }
}
export function startSyncLoop() {
  const tick = () => {
    if (!useEditor.getState().busy) void syncProject().catch(() => {});
  };
  const timer = setInterval(tick, 30000);
  window.addEventListener('online', tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', tick);
  };
}
