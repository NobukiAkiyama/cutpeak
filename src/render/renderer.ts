import { type Clip, type Project } from '../core/model';
import { sceneAt } from '../core/timeline';
type Surface = OffscreenCanvas | HTMLCanvasElement;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type FrameImage = { clipId: string; bitmap: ImageBitmap };
export function canvasOf(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined')
    return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}
let measurement: Context2D | undefined;
function textMetrics(c: Clip, p: Project) {
  measurement ??= canvasOf(1, 1).getContext('2d') as Context2D;
  measurement.font = `${c.style.weight} ${c.style.size}px ${c.style.font}`;
  const lines = (c.text || ' ').split('\n'),
    pad = Math.max(20, c.style.strokeWidth * 2);
  const lineWidth = (line: string) =>
    c.style.letterSpacing === 0
      ? measurement!.measureText(line).width
      : Array.from(line).reduce(
          (sum, ch) => sum + measurement!.measureText(ch).width,
          0,
        ) +
        Math.max(0, Array.from(line).length - 1) * c.style.letterSpacing;
  return {
    width: Math.ceil(
      Math.min(
        p.width * 3,
        Math.max(c.style.size, ...lines.map(lineWidth)) + pad * 2,
      ),
    ),
    height: Math.ceil(
      lines.length * c.style.size * c.style.lineHeight + pad * 2,
    ),
    lines,
    pad,
    lineWidth,
  };
}
export function objectSize(
  c: Clip,
  p: Project,
): { width: number; height: number } {
  const a = p.assets.find((a) => a.id === c.assetId);
  if (a) {
    const ratio = Math.min(
      p.width / (a.width || p.width),
      p.height / (a.height || p.height),
    );
    return {
      width: (a.width || p.width) * ratio,
      height: (a.height || p.height) * ratio,
    };
  }
  if (c.type === 'shape')
    return { width: p.width * 0.3, height: p.height * 0.3 };
  const { width, height } = textMetrics(c, p);
  return { width, height };
}

function textSurface(c: Clip, p: Project): Surface {
  const s = canvasOf(1, 1),
    ctx = s.getContext('2d') as Context2D;
  ctx.font = `${c.style.weight} ${c.style.size}px ${c.style.font}`;
  const { width, height, lines, pad, lineWidth } = textMetrics(c, p);
  s.width = Math.ceil(width);
  s.height = Math.ceil(height);
  ctx.font = `${c.style.weight} ${c.style.size}px ${c.style.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = c.style.align;
  ctx.fillStyle = c.style.background;
  ctx.fillRect(0, 0, s.width, s.height);
  ctx.lineJoin = 'round';
  ctx.lineWidth = c.style.strokeWidth * 2;
  ctx.strokeStyle = c.style.stroke;
  ctx.fillStyle = c.style.color;

  const x =
    c.style.align === 'left'
      ? pad
      : c.style.align === 'right'
        ? s.width - pad
        : s.width / 2;
  lines.forEach((l, i) => {
    const y = pad + (i + 0.5) * c.style.size * c.style.lineHeight;
    if (c.style.letterSpacing === 0) {
      if (c.style.strokeWidth > 0) ctx.strokeText(l, x, y);
      ctx.fillText(l, x, y);
    } else {
      ctx.textAlign = 'left';
      let at =
        c.style.align === 'left'
          ? pad
          : c.style.align === 'right'
            ? s.width - pad - lineWidth(l)
            : (s.width - lineWidth(l)) / 2;
      for (const ch of Array.from(l)) {
        if (c.style.strokeWidth > 0) ctx.strokeText(ch, at, y);
        ctx.fillText(ch, at, y);
        at += ctx.measureText(ch).width + c.style.letterSpacing;
      }
    }
  });
  return s;
}
export class SceneRenderer {
  readonly mode: 'webgl2' | 'canvas2d';
  private gl: WebGL2RenderingContext | null = null;
  private ctx: Context2D | null = null;
  private program?: WebGLProgram;
  private texture?: WebGLTexture;
  private buffer?: WebGLBuffer;
  private staticTextures = new Map<string, { key: string; surface: Surface }>();
  constructor(
    readonly canvas: Surface,
    prefer2d = false,
  ) {
    if (!prefer2d) {
      try {
        this.gl = canvas.getContext('webgl2', {
          alpha: false,
          antialias: false,
          preserveDrawingBuffer: true,
          premultipliedAlpha: false,
        }) as WebGL2RenderingContext | null;
      } catch {}
    }
    if (this.gl) {
      this.mode = 'webgl2';
      const g = this.gl;
      const shader = (type: number, src: string) => {
        const s = g.createShader(type)!;
        g.shaderSource(s, src);
        g.compileShader(s);
        if (!g.getShaderParameter(s, g.COMPILE_STATUS))
          throw Error(g.getShaderInfoLog(s) || 'シェーダーを作成できません');
        return s;
      };
      const vs = shader(
        g.VERTEX_SHADER,
        `#version 300 es
in vec2 pos;uniform mat3 matrix;uniform vec4 crop;out vec2 uv;void main(){vec3 p=matrix*vec3(pos-.5,1.);gl_Position=vec4(p.xy,0,1);uv=mix(crop.xy,crop.zw,pos);}`,
      );
      const fs = shader(
        g.FRAGMENT_SHADER,
        `#version 300 es
precision mediump float;in vec2 uv;uniform sampler2D tex;uniform float opacity;out vec4 color;void main(){vec4 c=texture(tex,uv);color=c*opacity;}`,
      );
      const pr = g.createProgram()!;
      g.attachShader(pr, vs);
      g.attachShader(pr, fs);
      g.linkProgram(pr);
      g.deleteShader(vs);
      g.deleteShader(fs);
      if (!g.getProgramParameter(pr, g.LINK_STATUS))
        throw Error('レンダラーを初期化できません');
      this.program = pr;
      g.useProgram(pr);
      const buffer = g.createBuffer()!;
      this.buffer = buffer;
      g.bindBuffer(g.ARRAY_BUFFER, buffer);
      g.bufferData(
        g.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
        g.STATIC_DRAW,
      );
      const loc = g.getAttribLocation(pr, 'pos');
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      this.texture = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, this.texture);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    } else {
      this.mode = 'canvas2d';
      this.ctx = canvas.getContext('2d', { alpha: false }) as Context2D | null;
      if (!this.ctx) throw Error('プレビューを初期化できません');
    }
  }
  private source(
    c: Clip,
    p: Project,
    images: FrameImage[],
  ): { image: CanvasImageSource; width: number; height: number } | null {
    if (c.assetId) {
      const bitmap = images.find((i) => i.clipId === c.id)?.bitmap;
      if (!bitmap) return null;
      return { image: bitmap, ...objectSize(c, p) };
    }
    const key = JSON.stringify([
      c.type,
      c.style,
      c.text,
      c.shape,
      c.color,
      p.width,
      p.height,
    ]);
    let cached = this.staticTextures.get(c.id);
    if (!cached || cached.key !== key) {
      let surface: Surface;
      if (c.type === 'shape') {
        const size = objectSize(c, p);
        surface = canvasOf(Math.round(size.width), Math.round(size.height));
        const ctx = surface.getContext('2d') as Context2D;
        ctx.fillStyle = c.color;
        if (c.shape === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(
            surface.width / 2,
            surface.height / 2,
            surface.width / 2,
            surface.height / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else ctx.fillRect(0, 0, surface.width, surface.height);
      } else surface = textSurface(c, p);
      cached = { key, surface };
      this.staticTextures.set(c.id, cached);
    }
    return {
      image: cached.surface,
      width: cached.surface.width,
      height: cached.surface.height,
    };
  }
  draw(p: Project, frame: number, images: FrameImage[]) {
    const w = this.canvas.width,
      h = this.canvas.height,
      g = this.gl;
    const bg = /^#([a-f\d]{6})$/i.exec(p.background)?.[1] || '000000';
    if (g) {
      if (g.isContextLost()) throw Error('WebGL コンテキストが失われました');
      g.viewport(0, 0, w, h);
      g.clearColor(
        parseInt(bg.slice(0, 2), 16) / 255,
        parseInt(bg.slice(2, 4), 16) / 255,
        parseInt(bg.slice(4, 6), 16) / 255,
        1,
      );
      g.clear(g.COLOR_BUFFER_BIT);
      g.useProgram(this.program!);
    } else {
      this.ctx!.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx!.globalAlpha = 1;
      this.ctx!.fillStyle = p.background;
      this.ctx!.fillRect(0, 0, w, h);
    }
    const items = sceneAt(p, frame);
    for (const { clip: c, transform: t, alpha } of items) {
      const src = this.source(c, p, images);
      if (!src) continue;
      const crop = c.crop;
      const cw = 1 - crop.left - crop.right,
        ch = 1 - crop.top - crop.bottom;
      const sw = src.width * cw,
        sh = src.height * ch;
      const angle = (t.rotation * Math.PI) / 180,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      const opacity = Math.max(0, Math.min(1, t.opacity * alpha));
      if (g) {
        const matrix = new Float32Array([
          (2 * sw * t.scaleX * cos) / p.width,
          (-2 * sw * t.scaleX * sin) / p.height,
          0,
          (-2 * sh * t.scaleY * sin) / p.width,
          (-2 * sh * t.scaleY * cos) / p.height,
          0,
          (2 * t.x) / p.width - 1,
          1 - (2 * t.y) / p.height,
          1,
        ]);
        g.uniformMatrix3fv(
          g.getUniformLocation(this.program!, 'matrix'),
          false,
          matrix,
        );
        g.uniform4f(
          g.getUniformLocation(this.program!, 'crop'),
          crop.left,
          crop.top,
          1 - crop.right,
          1 - crop.bottom,
        );
        g.uniform1f(g.getUniformLocation(this.program!, 'opacity'), opacity);
        g.bindTexture(g.TEXTURE_2D, this.texture!);
        g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RGBA,
          g.RGBA,
          g.UNSIGNED_BYTE,
          src.image as TexImageSource,
        );
        g.drawArrays(g.TRIANGLES, 0, 6);
      } else {
        const ctx = this.ctx!;
        ctx.save();
        ctx.scale(w / p.width, h / p.height);
        ctx.translate(t.x, t.y);
        ctx.rotate(angle);
        ctx.scale(t.scaleX, t.scaleY);
        ctx.globalAlpha = opacity;
        const iw = (src.image as ImageBitmap).width,
          ih = (src.image as ImageBitmap).height;
        ctx.drawImage(
          src.image,
          iw * crop.left,
          ih * crop.top,
          iw * cw,
          ih * ch,
          -sw / 2,
          -sh / 2,
          sw,
          sh,
        );
        ctx.restore();
      }
    }
    for (const key of this.staticTextures.keys())
      if (!items.some((i) => i.clip.id === key))
        this.staticTextures.delete(key);
  }
  dispose() {
    this.staticTextures.clear();
    if (this.gl) {
      this.gl.deleteTexture(this.texture!);
      this.gl.deleteBuffer(this.buffer!);
      this.gl.deleteProgram(this.program!);
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
}
