import { runExport, type ExportJob } from '../media/export';
let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (data.type !== 'export') return;
  cancelled = false;
  try {
    const result = await runExport(
      data as ExportJob,
      (value) => self.postMessage({ type: 'progress', value }),
      () => cancelled,
    );
    self.postMessage({ type: 'done', ...result });
  } catch (e) {
    self.postMessage({ type: 'error', error: (e as Error).message });
  }
};
