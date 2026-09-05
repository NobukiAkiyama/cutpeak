import { create } from 'zustand';

export type PanelId = 'library' | 'preview' | 'inspector' | 'timeline';
export const panelNames: Record<PanelId, string> = {
  library: '素材',
  preview: 'プレビュー',
  inspector: '編集設定',
  timeline: 'タイムライン',
};
type Layout = Record<string, number>;
const defaults = {
  library: window.innerWidth > 850,
  preview: true,
  inspector: window.innerWidth > 850,
  timeline: true,
};
const storageKey = 'framecut-workspace-v1';
function readPreferences() {
  const visible = { ...defaults },
    layouts: Record<string, Layout> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const id of Object.keys(defaults) as PanelId[])
      if (typeof saved.visible?.[id] === 'boolean')
        visible[id] = saved.visible[id];
    for (const [key, value] of Object.entries(saved.layouts || {})) {
      if (
        value &&
        typeof value === 'object' &&
        Object.values(value).every(
          (n) =>
            typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100,
        )
      )
        layouts[key] = value as Layout;
    }
  } catch {
    /* Unavailable or invalid preferences use the default workspace. */
  }
  return { visible, layouts };
}
interface WorkspaceState {
  visible: Record<PanelId, boolean>;
  layouts: Record<string, Layout>;
  generation: number;
  show: (id: PanelId, open: boolean) => void;
  saveLayout: (key: string, layout: Layout) => void;
  reset: () => void;
}
export const usePanelLayout = create<WorkspaceState>((set) => ({
  ...readPreferences(),
  generation: 0,
  show: (id, open) => set((s) => ({ visible: { ...s.visible, [id]: open } })),
  saveLayout: (key, layout) =>
    set((s) =>
      JSON.stringify(s.layouts[key]) === JSON.stringify(layout)
        ? s
        : { layouts: { ...s.layouts, [key]: layout } },
    ),
  reset: () =>
    set((s) => ({
      visible: { ...defaults },
      layouts: {},
      generation: s.generation + 1,
    })),
}));
usePanelLayout.subscribe((s) => {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ visible: s.visible, layouts: s.layouts }),
    );
  } catch {
    /* Resizing stays available when preference storage is blocked. */
  }
});
