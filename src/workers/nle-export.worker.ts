import { runNleExport, type NleExportJob } from '../media/nle/export';

let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (data.type !== 'export') return;
  cancelled = false;
  try {
    const blob = await runNleExport(
      data as NleExportJob,
      (value) => self.postMessage({ type: 'progress', value }),
      () => cancelled,
    );
    self.postMessage({ type: 'done', blob });
  } catch (error) {
    self.postMessage({ type: 'error', error: (error as Error).message });
  }
};
