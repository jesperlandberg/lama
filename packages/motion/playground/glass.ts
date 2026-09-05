/*
 * A minimal DOM-synced WebGPU layer for the carousel demo, in the shape of
 * the domgl-sync-webgpu layer: one canvas over the page, no camera — css px
 * become NDC in the vertex shader off a shared viewport uniform — one uniform
 * buffer of 256-byte slices bound with a dynamic offset per plane, one
 * writeBuffer and one render pass per frame, premultiplied alpha so the page
 * shows through.
 *
 * The material is a real glass slab, not a shading trick: the fragment
 * raymarches a 3D SDF — the card's rounded rect extruded to a thickness and
 * rounded along every edge — from a per-plane perspective camera that matches
 * the CSS perspective() the HTML writer uses. The hit is refracted into the
 * glass at three refractive indices and carried to the back face where the
 * picture sits, so the rim bends and disperses the image the way thick glass
 * does; the surface takes diffuse, a Blinn specular and Fresnel from a fixed
 * key light. Stills upload once with mips; clips are the card's own <video>
 * imported as an external texture every frame. A parallax slides the crop
 * window with the card's place on screen.
 *
 * Tilt arrives in the slice from the model's tilt spring, so the slab turns
 * in 3D and you see its side wall — the same lean the HTML writer applies as
 * rotateY/rotateX. The one motion-driven distortion is a bulge that reads the
 * growth velocity off the spring: zero at rest, so a still carousel is still.
 */

export interface GlassPlane {
  /** centre, css px */
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  /** velocity of the centre, px/s */
  vx: number;
  vy: number;
  /** d(scale)/dt, 1/s */
  vs: number;
  /** 0..1 */
  focus: number;
  alpha: number;
  /** rotation about the vertical axis, radians (positive = right edge away) */
  tiltY: number;
  /** rotation about the horizontal axis, radians */
  tiltX: number;
  /** half thickness of the slab, css px */
  depth: number;
  /** horizontal slide of the crop window, as a fraction of the texture */
  parallax: number;
}

const STRIDE = 64; // floats per 256-byte slice

const WGSL = /* wgsl */ `
  struct VP { size: vec2f, dpr: f32, time: f32 }
  struct P {
    rect: vec4f,    /* left, top, width, height — css px, untilted footprint */
    tex: vec4f,     /* natural w, natural h, corner radius px, alpha */
    motion: vec4f,  /* vx px/s, vy px/s, d(scale)/dt, focus */
    pose: vec4f,    /* tiltY rad, tiltX rad, half depth px, parallax (texture fraction) */
  }

  @group(0) @binding(0) var<uniform> vp: VP;
  @group(0) @binding(1) var samp: sampler;
  @group(1) @binding(0) var<uniform> p: P;
  __TEXTURE__

  /* the picture at footprint uv: cover-fit, then the parallax slide — the
     crop window moves with the card's place on screen */
  fn look(res: vec2f, uv: vec2f) -> vec4f {
    let st = cover(res, p.tex.xy, uv) + vec2f(p.pose.w, 0.0);
    return __SAMPLE__;
  }

  struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

  /* camera distance — the same number as the CSS perspective() the HTML
     writer uses, so both modes foreshorten alike */
  const CAM: f32 = 1400.0;
  const IOR: f32 = 1.5;

  /* the quad overshoots the footprint: room for the tilted slab and shadow */
  fn pad() -> f32 { return max(72.0, p.rect.z * 0.28); }

  @vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
    let corner = vec2f(f32(i & 1u), f32(i >> 1u));
    let pd = pad();
    let px = p.rect.xy - vec2f(pd) + corner * (p.rect.zw + vec2f(pd * 2.0));
    let ndc = px / vp.size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
    var o: VOut;
    o.pos = vec4f(ndc, 0.0, 1.0);
    o.uv = corner;
    return o;
  }

  fn cover(res: vec2f, size: vec2f, uv: vec2f) -> vec2f {
    let rr = res.x / res.y;
    let ir = size.x / size.y;
    var s: vec2f;
    var o: vec2f;
    if (rr < ir) {
      s = vec2f(size.x * (res.y / size.y), res.y);
      o = vec2f((s.x - res.x) * 0.5, 0.0) / s;
    } else {
      s = vec2f(res.x, size.y * (res.x / size.x));
      o = vec2f(0.0, (s.y - res.y) * 0.5) / s;
    }
    return uv * res / s + o;
  }

  fn roundBox(pt: vec2f, b: vec2f, r: f32) -> f32 {
    return length(max(abs(pt) - b + vec2f(r), vec2f(0.0))) - r;
  }

  /*
   * The slab: the 2D rounded rect (corner radius r) extruded to ±hz and
   * rounded along every edge by rr — a real bevel, not a shading trick.
   */
  fn sdSlab(q: vec3f, hr: vec2f, r: f32, hz: f32, rr: f32) -> f32 {
    let d2 = roundBox(q.xy, hr - vec2f(rr), max(r - rr, 0.0));
    let dz = abs(q.z) - (hz - rr);
    let w = vec2f(d2, dz);
    return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0))) - rr;
  }

  fn slabNormal(q: vec3f, hr: vec2f, r: f32, hz: f32, rr: f32) -> vec3f {
    let e = 0.5;
    return normalize(vec3f(
      sdSlab(q + vec3f(e, 0.0, 0.0), hr, r, hz, rr) - sdSlab(q - vec3f(e, 0.0, 0.0), hr, r, hz, rr),
      sdSlab(q + vec3f(0.0, e, 0.0), hr, r, hz, rr) - sdSlab(q - vec3f(0.0, e, 0.0), hr, r, hz, rr),
      sdSlab(q + vec3f(0.0, 0.0, e), hr, r, hz, rr) - sdSlab(q - vec3f(0.0, 0.0, e), hr, r, hz, rr)));
  }

  /* where a ray entering at q with normal N lands on the back face (z = -hz),
     as image uv over the footprint */
  fn backUv(q: vec3f, rd: vec3f, N: vec3f, hz: f32, res: vec2f, ior: f32) -> vec2f {
    let t = refract(rd, N, 1.0 / ior);
    let tb = (-hz - q.z) / min(t.z, -1e-4);
    let back = q + t * tb;
    return back.xy / res + 0.5;
  }

  /* the grow bulge: reads d(scale)/dt off the spring, zero at rest */
  fn vsBulge(q: vec3f, hz: f32, res: vec2f, vs: f32) -> vec2f {
    return (q.xy / res) * vs * -0.10;
  }

  fn rotX(a: f32) -> mat3x3f {
    let c = cos(a); let s = sin(a);
    return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, c, s), vec3f(0.0, -s, c));
  }
  fn rotY(a: f32) -> mat3x3f {
    let c = cos(a); let s = sin(a);
    return mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
  }

  /* anti-aliasing: an AA×AA grid of sub-samples per pixel, each a full
     march. The silhouette, the bevel's refraction seam and the side wall are
     all shader-made edges, so hardware MSAA cannot touch them — only
     supersampling does. 2 = 4 marches per pixel. */
  const AA: i32 = 2;

  @fragment fn fs(in: VOut) -> @location(0) vec4f {
    let res = p.rect.zw;
    let hr = res * 0.5;
    let pd = pad();
    /* footprint-centred px, y down like the page */
    let pt = in.uv * (res + vec2f(pd * 2.0)) - hr - vec2f(pd);
    /* one device pixel in css px; sub-samples fan out inside it */
    let px = 1.0 / vp.dpr;
    var acc = vec4f(0.0);
    for (var sy = 0; sy < AA; sy++) {
      for (var sx = 0; sx < AA; sx++) {
        let o = (vec2f(f32(sx), f32(sy)) + 0.5) / f32(AA) - 0.5;
        acc += shade(pt + o * px, in.uv.y);
      }
    }
    return acc / f32(AA * AA);
  }

  /* one sample of the slab at footprint-centred px pt; premultiplied out */
  fn shade(pt: vec2f, gloss: f32) -> vec4f {
    let res = p.rect.zw;
    let hr = res * 0.5;
    let focus = p.motion.w;
    let r = min(p.tex.z, min(hr.x, hr.y));
    let hz = p.pose.z;
    let rr = min(hz * 0.92, r);

    /* per-plane perspective camera, straight over the footprint's centre —
       the same frame as CSS perspective() on the element */
    let ro = vec3f(0.0, 0.0, CAM);
    let rd = normalize(vec3f(pt, 0.0) - ro);

    /* into the slab's local frame (tilt around its own centre) */
    let R = rotX(p.pose.y) * rotY(p.pose.x);
    let Ri = transpose(R);
    let lro = Ri * ro;
    let lrd = Ri * rd;

    /* march from the front bounding plane */
    var t = (lro.z - (hz + rr + 1.0)) / max(-lrd.z, 1e-4);
    var hit = false;
    var dmin = 1e9;
    var q = lro + lrd * t;
    for (var i = 0; i < 48; i++) {
      q = lro + lrd * t;
      let d = sdSlab(q, hr, r, hz, rr);
      dmin = min(dmin, d);
      if (d < 0.02) { hit = true; break; }
      if (q.z < -hz - rr - 2.0) { break; }
      t += d * 0.9;
    }

    /* coverage: hard where hit, a pixel of AA off the silhouette */
    let cov = select(1.0 - smoothstep(0.0, 1.4, dmin), 1.0, hit);

    /* everything below runs for every fragment — textureSample needs uniform
       control flow — and the miss case is simply multiplied away by cov */
    let Nl = slabNormal(q, hr, r, hz, rr);
    let vs = clamp(p.motion.z / 3.0, -1.0, 1.0);

    /*
     * Refract into the glass and carry the ray to the back face, where the
     * picture sits. The bevel bends samples inward, the tilt shears them, and
     * dispersion is real: three rays at three refractive indices, so the rim
     * splits into colour the way the reference does.
     */
    let uvR = backUv(q, lrd, Nl, hz, res, IOR - 0.035) + vsBulge(q, hz, res, vs);
    let uvG = backUv(q, lrd, Nl, hz, res, IOR) + vsBulge(q, hz, res, vs);
    let uvB = backUv(q, lrd, Nl, hz, res, IOR + 0.045) + vsBulge(q, hz, res, vs);
    let cr = look(res, uvR).r;
    let cg = look(res, uvG).g;
    let cb = look(res, uvB).b;
    var rgb = vec3f(cr, cg, cb);

    /* light in world space: a fixed key up-left and in front, well off the
       view axis so the flat face never catches the specular and washes out */
    let Nw = R * Nl;
    let L = normalize(vec3f(-0.55, -0.7, 0.45));
    let V = -rd;
    let Hv = normalize(L + V);
    let diffuse = max(dot(Nw, L), 0.0);
    let spec = pow(max(dot(Nw, Hv), 0.0), 80.0);
    let fres = pow(1.0 - max(dot(Nw, V), 0.0), 3.0);
    let side = 1.0 - Nl.z;                          /* 0 on the face, 1 on the side wall */
    rgb = rgb * (0.92 + 0.12 * diffuse - side * 0.22);
    rgb += vec3f(spec * 0.7);
    rgb += vec3f(fres * 0.22);
    rgb = mix(rgb, rgb * 1.02, focus + 0.0 * gloss);

    let a = cov * p.tex.w;

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * a, a);
  }
`;

const BLIT = /* wgsl */ `
  @group(0) @binding(0) var src: texture_2d<f32>;
  @group(0) @binding(1) var samp: sampler;
  struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
  @vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    var o: VOut;
    o.pos = vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
    o.uv = uv;
    return o;
  }
  @fragment fn fs(in: VOut) -> @location(0) vec4f { return textureSample(src, samp, in.uv); }
`;

/* an uploaded still */
type Tex = { kind: 'image'; texture: GPUTexture; group: GPUBindGroup; w: number; h: number };
/* a playing <video>: imported as an external texture every frame, zero-copy —
   the SAME element the HTML writer shows, so the clip decodes once */
type Vid = { kind: 'video'; el: HTMLVideoElement; w: number; h: number };
type Source = Tex | Vid;

/** What a plane shows: the card's own <img> or <video>. */
export type Media = HTMLImageElement | HTMLVideoElement;

/* the shader comes in two builds that differ only in how the picture is read */
const imageWgsl = WGSL
  .replace('__TEXTURE__', '@group(2) @binding(0) var tex: texture_2d<f32>;')
  .replace('__SAMPLE__', 'textureSample(tex, samp, st)');
const videoWgsl = WGSL
  .replace('__TEXTURE__', '@group(2) @binding(0) var tex: texture_external;')
  .replace('__SAMPLE__', 'textureSampleBaseClampToEdge(tex, samp, clamp(st, vec2f(0.0), vec2f(1.0)))');

export class Glass {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private videoPipeline: GPURenderPipeline;
  private blit: GPURenderPipeline;
  private blitSampler: GPUSampler;
  private texLayout: GPUBindGroupLayout;
  private videoLayout: GPUBindGroupLayout;
  private globals: GPUBindGroup;
  private viewport: GPUBuffer;
  private slices: GPUBuffer;
  private sliceGroup: GPUBindGroup;
  private data: Float32Array<ArrayBuffer>;
  private tail: Float32Array<ArrayBuffer> = new Float32Array(1);
  private sources: (Source | null)[];
  private blank: Tex;
  private dpr = 1;
  /** resolves when every source has landed (or failed) */
  readonly ready: Promise<void>;

  static async create(canvas: HTMLCanvasElement, media: Media[]): Promise<Glass | null> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    if (!adapter) return null;
    const device = await adapter.requestDevice().catch(() => null);
    if (!device) return null;
    return new Glass(canvas, device, media);
  }

  /** True when any plane shows a video — the caller then redraws every frame. */
  get hasVideo(): boolean {
    return this.sources.some((s) => s?.kind === 'video');
  }

  private constructor(canvas: HTMLCanvasElement, device: GPUDevice, media: Media[]) {
    this.canvas = canvas;
    this.device = device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = canvas.getContext('webgpu')!;
    this.context.configure({ device, format: this.format, alphaMode: 'premultiplied' });
    // Validation failures kill a command buffer silently; surface them.
    device.addEventListener('uncapturederror', (e) => console.error('[glass]', (e as GPUUncapturedErrorEvent).error.message));

    const globalsLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const sliceLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } }],
    });
    this.texLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }],
    });
    this.videoLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} }],
    });

    // Explicit layouts on both pipelines: groups 0 and 1 are shared between
    // them, and a bind group built against one pipeline's auto layout is
    // invalid with the other — the failure is a silently dropped frame.
    const build = (label: string, code: string, texLayout: GPUBindGroupLayout) => {
      const module = device.createShaderModule({ label, code });
      return device.createRenderPipeline({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: [globalsLayout, sliceLayout, texLayout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module, entryPoint: 'fs',
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive: { topology: 'triangle-strip' },
      });
    };
    this.pipeline = build('glass', imageWgsl, this.texLayout);
    this.videoPipeline = build('glass/video', videoWgsl, this.videoLayout);

    const blitModule = device.createShaderModule({ label: 'mips', code: BLIT });
    this.blit = device.createRenderPipeline({
      label: 'mips', layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.blitSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });

    this.viewport = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const n = Math.max(1, media.length);
    this.data = new Float32Array(STRIDE * n);
    this.slices = device.createBuffer({ size: 256 * n, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sliceGroup = device.createBindGroup({ layout: sliceLayout, entries: [{ binding: 0, resource: { buffer: this.slices, size: 64 } }] });
    this.globals = device.createBindGroup({
      layout: globalsLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewport } },
        { binding: 1, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 }) },
      ],
    });

    // A transparent 1×1 so a plane whose image is still loading draws nothing.
    const blankTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: blankTex }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1]);
    this.blank = { kind: 'image', texture: blankTex, group: this.group(blankTex), w: 1, h: 1 };

    this.sources = media.map(() => null);
    this.ready = Promise.all(media.map((m, i) => this.load(m).then((s) => { this.sources[i] = s; }))).then(() => undefined);

    this.resize();
  }

  private group(texture: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({ layout: this.texLayout, entries: [{ binding: 0, resource: texture.createView() }] });
  }

  private async load(m: Media): Promise<Source | null> {
    try {
      if (m instanceof HTMLVideoElement) {
        if (m.readyState < 2) {
          await new Promise<void>((res, rej) => {
            m.addEventListener('loadeddata', () => res(), { once: true });
            m.addEventListener('error', () => rej(new Error('video failed')), { once: true });
          });
        }
        return { kind: 'video', el: m, w: m.videoWidth, h: m.videoHeight };
      }
      await m.decode();
      const bmp = await createImageBitmap(m);
      const { width: w, height: h } = bmp;
      const mips = Math.floor(Math.log2(Math.max(w, h))) + 1;
      const texture = this.device.createTexture({
        size: [w, h], format: 'rgba8unorm', mipLevelCount: mips,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture({ source: bmp }, { texture }, [w, h]);
      bmp.close();
      this.generateMips(texture);
      return { kind: 'image', texture, group: this.group(texture), w, h };
    } catch {
      return null;
    }
  }

  private generateMips(texture: GPUTexture): void {
    const encoder = this.device.createCommandEncoder({ label: 'mips' });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
      });
      pass.setPipeline(this.blit);
      pass.setBindGroup(0, this.device.createBindGroup({
        layout: this.blit.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: this.blitSampler },
        ],
      }));
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const ww = innerWidth, wh = innerHeight;
    this.canvas.width = Math.max(1, Math.round(ww * this.dpr));
    this.canvas.height = Math.max(1, Math.round(wh * this.dpr));
    this.device.queue.writeBuffer(this.viewport, 0, new Float32Array([ww, wh, this.dpr]));
  }

  /** Draw every plane (index-aligned with the media given at create). */
  draw(planes: GlassPlane[], time = 0): void {
    const d = this.data;
    const n = Math.min(planes.length, this.sources.length);
    for (let i = 0; i < n; i++) {
      const p = planes[i];
      const s = this.sources[i] ?? this.blank;
      const b = i * STRIDE;
      d[b] = p.x - p.w / 2; d[b + 1] = p.y - p.h / 2; d[b + 2] = p.w; d[b + 3] = p.h;
      d[b + 4] = s.w; d[b + 5] = s.h; d[b + 6] = p.radius; d[b + 7] = p.alpha;
      d[b + 8] = p.vx; d[b + 9] = p.vy; d[b + 10] = p.vs; d[b + 11] = p.focus;
      d[b + 12] = p.tiltY; d[b + 13] = p.tiltX; d[b + 14] = p.depth; d[b + 15] = p.parallax;
    }
    this.device.queue.writeBuffer(this.slices, 0, d, 0, n * STRIDE);
    this.tail[0] = time;
    this.device.queue.writeBuffer(this.viewport, 12, this.tail);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
    });
    pass.setBindGroup(0, this.globals);
    // Focused card last so it draws over its neighbours while it grows.
    const order = [...Array(n).keys()].sort((a, b) => planes[a].focus - planes[b].focus);
    let current: GPURenderPipeline | null = null;
    for (const i of order) {
      const s = this.sources[i] ?? this.blank;
      // A video that has no frame yet draws as the blank.
      const live = s.kind === 'video' && s.el.readyState >= 2;
      const pipe = live ? this.videoPipeline : this.pipeline;
      if (pipe !== current) { pass.setPipeline(pipe); current = pipe; }
      pass.setBindGroup(1, this.sliceGroup, [i * 256]);
      if (s.kind === 'video') {
        if (!live) { pass.setBindGroup(2, this.blank.group); }
        else {
          // External textures are per-frame objects by design: import inside the draw.
          const ext = this.device.importExternalTexture({ source: s.el });
          pass.setBindGroup(2, this.device.createBindGroup({ layout: this.videoLayout, entries: [{ binding: 0, resource: ext }] }));
        }
      } else {
        pass.setBindGroup(2, s.group);
      }
      pass.draw(4);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** Clear the canvas (leaving GL mode). */
  clear(): void {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
