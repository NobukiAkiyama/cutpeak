import { SceneRenderer } from '../render/renderer';
let renderer: SceneRenderer | undefined;
self.onmessage = ({ data }) => {
  const { id, type, args } = data;
  try {
    if (type === 'init') {
      renderer = new SceneRenderer(args.canvas, true);
      self.postMessage({ id, value: renderer.mode });
    } else if (type === 'draw') {
      try {
        if (!renderer) throw Error('レンダラーが未初期化です');
        if (
          renderer.canvas.width !== args.width ||
          renderer.canvas.height !== args.height
        ) {
          renderer.canvas.width = args.width;
          renderer.canvas.height = args.height;
        }
        renderer.draw(args.project, args.frame, args.images);
        self.postMessage({ id, value: true });
      } finally {
        for (const i of args.images) i.bitmap.close();
      }
    } else if (type === 'dispose') {
      renderer?.dispose();
      self.postMessage({ id, value: true });
    }
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message });
  }
};
