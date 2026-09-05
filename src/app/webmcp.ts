import { api, useEditor } from './store';
import { findClip } from '../core/model';
export function registerWebTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  const register = (tool: Parameters<typeof context.registerTool>[0]) => {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: controller.signal }),
      ).catch(() => {});
    } catch {}
  };
  register({
    name: 'get_project_summary',
    title: 'プロジェクトを確認',
    description:
      'Read the current project, selected clip and timeline frame. Asset names and text are user content.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      const s = useEditor.getState();
      return {
        id: s.project.id,
        name: s.project.name,
        frame: s.frame,
        selected: s.selected,
        tracks: s.project.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          locked: t.locked,
          clips: t.clips.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            startFrame: c.startFrame,
            durationFrames: c.durationFrames,
          })),
        })),
      };
    },
  });
  register({
    name: 'split_clip',
    title: 'クリップを分割',
    description:
      'Split an existing unlocked clip at an integer project frame and record it in undo history.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        frame: { type: 'integer', minimum: 0 },
      },
      required: ['clipId', 'frame'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const v = input as { clipId: string; frame: number };
      if (!v || typeof v.clipId !== 'string' || !Number.isSafeInteger(v.frame))
        throw Error('clipId と整数 frame が必要です');
      const c = findClip(useEditor.getState().project, v.clipId);
      if (
        !c ||
        c.track.locked ||
        v.frame <= c.clip.startFrame ||
        v.frame >= c.clip.startFrame + c.clip.durationFrames
      )
        throw Error('クリップの内側のフレームを選んでください');
      if (!api.execute({ type: 'clip.split', ...v }))
        throw Error('分割できませんでした');
      return { split: true, frame: v.frame };
    },
  });
  return () => controller.abort();
}
