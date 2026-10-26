// A ring of image cards on a tilted cylinder: it zooms in spinning hard with motion blur,
// settles on a card, then drifts and can be dragged. WebGL2, no dependencies.
//
//   const reel = createReelCarousel(canvas, { images: ['/a.jpg', '/b.jpg'] });
//   reel.setImages([...]); reel.replay(); reel.destroy();
//
// Images can be URLs, <img>, <canvas>, ImageBitmap or Blob/File. The canvas is transparent:
// give it (or its parent) the background colour.

const TAU = Math.PI * 2

const DEFAULTS = {
  images: [],
  minCards: 10, // fewer images repeat round the ring
  cardAspect: 1.1, // width / height
  gap: 0.14, // space between cards, as a share of a card's width
  autoSpeed: -0.09, // radians a second once settled; negative drifts left
  intro: true,
  introSpin: 1.5, // turns spun during the intro
  introDuration: 1.7, // seconds until the ring settles on a card
  shutter: 1 / 40, // seconds of motion smeared into each frame
  maxSamples: 32,
  pitch: -0.24, // top of the ring leans away
  roll: -0.07,
  maxPixelRatio: 2,
  maxImageSize: 1600,
}

const VERT = `#version 300 es
in vec2 aUV;
uniform mat4 uProj, uView, uModel;
uniform float uAngle, uArc, uRadius;
uniform vec3 uCamera;
out vec2 vUV;
out float vFacing;
void main() {
  float a = uAngle + (aUV.x - 0.5) * uArc;
  vec4 world = uModel * vec4(sin(a) * uRadius, aUV.y - 0.5, cos(a) * uRadius, 1.0);
  vec3 normal = normalize(mat3(uModel) * vec3(sin(a), 0.0, cos(a)));
  vFacing = dot(normal, normalize(uCamera - world.xyz));
  vUV = aUV;
  gl_Position = uProj * uView * world;
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vFacing;
uniform sampler2D uTex;
uniform vec2 uCover;
uniform float uLoaded, uWeight;
out vec4 outColor;
void main() {
  vec4 c = uLoaded > 0.5 ? texture(uTex, (vUV - 0.5) * uCover + 0.5) : vec4(vec3(0.16), 1.0);
  float shade = mix(0.28, 1.0, smoothstep(0.0, 0.75, vFacing));
  outColor = vec4(c.rgb * shade, c.a) * uWeight;
}`

const SEGMENTS = 40

export function createReelCarousel(canvas, options = {}) {
  const o = { ...DEFAULTS, ...options }
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    premultipliedAlpha: true,
    alpha: true,
  })
  if (!gl) throw new Error("WebGL2 is not available")

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches
  const program = link(gl, VERT, FRAG)
  const u = uniforms(gl, program, [
    "uProj",
    "uView",
    "uModel",
    "uAngle",
    "uArc",
    "uRadius",
    "uCamera",
    "uTex",
    "uCover",
    "uLoaded",
    "uWeight",
  ])

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, cardMesh(SEGMENTS), gl.STATIC_DRAW)
  const aUV = gl.getAttribLocation(program, "aUV")
  gl.enableVertexAttribArray(aUV)
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0)

  let slides = [] // { texture, aspect } per image, null until loaded
  let generation = 0
  let count = o.minCards

  // Motion: during the intro the angle follows a curve; after it, it is integrated.
  let mode = o.intro && !reduceMotion ? "intro" : "live"
  let start = performance.now()
  let last = start
  let angle = 0
  let velocity = 0
  let direction = Math.sign(o.autoSpeed) || -1
  let drag = null
  let visible = true
  let frame = 0

  const turn = () =>
    Math.round((o.introSpin * TAU) / step()) * step() * direction
  const step = () => TAU / count
  // The spin lands on a card at the end of the intro already moving at the drift speed.
  const drift = () => (reduceMotion ? 0 : Math.abs(o.autoSpeed) * direction)
  const introAngle = (t) =>
    -turn() * (1 - easeOutQuart(clamp01(t / o.introDuration))) +
    drift() * (t - o.introDuration)
  const introVelocity = (t) =>
    drift() +
    (t >= o.introDuration
      ? 0
      : (-turn() * 4 * (1 - t / o.introDuration) ** 3) / o.introDuration)

  // Everything but the spin eases in on the clock, whatever the mode.
  function pose(t) {
    if (reduceMotion || !o.intro) t = 10
    const z = easeOutCubic(clamp01(t / 0.36))
    const settle = easeOutCubic(clamp01(t / 0.95))
    return {
      scale: lerp(0.07, 1, z),
      y: lerp(0.55, -0.04, easeInOutCubic(clamp01((t - 0.12) / 0.5))),
      pitch: lerp(-0.42, o.pitch, settle),
      roll:
        lerp(0.34, o.roll, settle) +
        0.025 * Math.sin(t * 0.55) * clamp01(t - 1),
    }
  }

  function draw(now) {
    frame = requestAnimationFrame(draw)
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (visible) render((now - start) / 1000, dt)
  }

  function render(t, dt) {
    if (mode === "intro") {
      angle = introAngle(t)
      velocity = introVelocity(t)
      if (t >= o.introDuration) mode = "live"
    } else if (!drag) {
      velocity += (drift() - velocity) * (1 - Math.exp(-dt / 0.7))
      angle += velocity * dt
    }

    resize()
    const aspect = canvas.width / canvas.height
    const radius = o.cardAspect / (step() / (1 + o.gap))
    // Keep the camera close for the strong perspective, and widen the lens until the ring fits.
    const distance = radius * 2
    const fitX =
      radius / Math.sqrt(distance * distance - radius * radius) / 0.84
    const tanY = Math.max(fitX / aspect, 0.3)

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    gl.enable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.uniformMatrix4fv(u.uProj, false, perspective(tanY, aspect, 0.05, 50))
    gl.uniformMatrix4fv(u.uView, false, translate(0, 0, -distance))
    gl.uniform3f(u.uCamera, 0, 0, distance)
    gl.uniform1f(u.uRadius, radius)
    gl.uniform1f(u.uArc, step() / (1 + o.gap))
    gl.uniform1i(u.uTex, 0)
    gl.activeTexture(gl.TEXTURE0)

    // Motion blur: draw the ring at several moments across the shutter and add them up.
    const sweep = Math.abs(velocity) * o.shutter
    const samples = Math.max(
      1,
      Math.min(o.maxSamples, Math.ceil(sweep / 0.006)),
    )
    for (let k = 0; k < samples; k++) {
      const back = samples === 1 ? 0 : (o.shutter * k) / (samples - 1)
      const p = pose(t - back)
      const a =
        mode === "intro" ? introAngle(t - back) : angle - velocity * back
      gl.uniformMatrix4fv(u.uModel, false, model(p, radius))
      gl.uniform1f(u.uWeight, 1 / samples)
      for (let i = 0; i < count; i++) drawCard(i, a)
    }
  }

  function drawCard(i, a) {
    // Cards past the last image repeat from the middle of the list, so no image sits beside itself.
    const n = slides.length
    const slide = n ? slides[i < n ? i : (i - n + Math.floor(n / 2)) % n] : null
    if (slide) {
      gl.bindTexture(gl.TEXTURE_2D, slide.texture)
      const card = o.cardAspect
      gl.uniform2f(
        u.uCover,
        ...(slide.aspect > card
          ? [card / slide.aspect, 1]
          : [1, slide.aspect / card]),
      )
    }
    gl.uniform1f(u.uLoaded, slide ? 1 : 0)
    gl.uniform1f(u.uAngle, wrap(a + i * step()))
    gl.drawArrays(gl.TRIANGLES, 0, SEGMENTS * 6)
  }

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, o.maxPixelRatio)
    const w = Math.round(canvas.clientWidth * ratio)
    const h = Math.round(canvas.clientHeight * ratio)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  async function setImages(list) {
    const mine = ++generation
    const loaded = await Promise.all(
      list.map((src) => toSource(src, o.maxImageSize).catch(() => null)),
    )
    if (mine !== generation) return
    for (const s of slides) if (s) gl.deleteTexture(s.texture)
    slides = loaded.filter(Boolean).map((source) => ({
      texture: upload(gl, source),
      aspect: source.width / source.height,
    }))
    count = Math.max(o.minCards, slides.length)
  }

  // Drag to spin; a flick carries on and eases back into the drift.
  function onDown(e) {
    if (mode === "intro") mode = "live"
    drag = { x: e.clientX, time: e.timeStamp }
    velocity = 0
    canvas.setPointerCapture(e.pointerId)
  }
  function onMove(e) {
    if (!drag) return
    const d = ((e.clientX - drag.x) / canvas.clientWidth) * Math.PI * 0.9
    const dt = Math.max((e.timeStamp - drag.time) / 1000, 1 / 240)
    angle += d
    velocity = lerp(velocity, d / dt, 0.6)
    drag = { x: e.clientX, time: e.timeStamp }
  }
  function onUp(e) {
    if (!drag) return
    if (e.timeStamp - drag.time > 80) velocity = 0
    if (Math.abs(velocity) > 0.05) direction = Math.sign(velocity)
    drag = null
  }

  canvas.style.touchAction = "pan-y"
  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerup", onUp)
  canvas.addEventListener("pointercancel", onUp)
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
  })
  observer.observe(canvas)

  setImages(o.images)
  frame = requestAnimationFrame(draw)

  return {
    setImages,
    replay() {
      mode = o.intro && !reduceMotion ? "intro" : "live"
      start = last = performance.now()
      angle = velocity = 0
      direction = Math.sign(o.autoSpeed) || -1
    },
    destroy() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      generation++
      for (const s of slides) if (s) gl.deleteTexture(s.texture)
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    },
  }
}

// A card is a strip of quads from u = 0 to 1 across and v = 0 to 1 up, wound to face outwards.
function cardMesh(segments) {
  const out = []
  for (let i = 0; i < segments; i++) {
    const a = i / segments
    const b = (i + 1) / segments
    out.push(a, 0, b, 0, b, 1, a, 0, b, 1, a, 1)
  }
  return new Float32Array(out)
}

async function toSource(src, max) {
  let image = src
  if (typeof src === "string") {
    image = new Image()
    image.crossOrigin = "anonymous"
    image.src = src
    await image.decode()
  } else if (src instanceof Blob) {
    image = await createImageBitmap(src)
  } else if (src instanceof HTMLImageElement && !src.complete) {
    await src.decode()
  }
  const w = image.naturalWidth || image.width
  const h = image.naturalHeight || image.height
  const scale = Math.min(1, max / Math.max(w, h))
  // WebGL ignores UNPACK_FLIP_Y for an ImageBitmap, so those always go through a canvas.
  if (scale === 1 && !(image instanceof ImageBitmap)) return image
  const c = document.createElement("canvas")
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  c.getContext("2d").drawImage(image, 0, 0, c.width, c.height)
  return c
}

function upload(gl, source) {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic")
  if (aniso)
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8)
  return texture
}

function link(gl, vert, frag) {
  const program = gl.createProgram()
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vert],
    [gl.FRAGMENT_SHADER, frag],
  ]) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader))
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program))
  return program
}

function uniforms(gl, program, names) {
  return Object.fromEntries(
    names.map((n) => [n, gl.getUniformLocation(program, n)]),
  )
}

// Column-major 4x4 matrices.
function multiply(a, b) {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3]
  return out
}
function perspective(tanHalfY, aspect, near, far) {
  const f = 1 / tanHalfY
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ])
}
function translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
}
function rotateX(a) {
  const c = Math.cos(a),
    s = Math.sin(a)
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
}
function rotateZ(a) {
  const c = Math.cos(a),
    s = Math.sin(a)
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}
function scaleBy(s) {
  return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1])
}
// Leaning the ring back lifts its front, so it drops by as much to stay where p.y puts it.
function model(p, radius) {
  const y = p.y + radius * Math.sin(p.pitch) * p.scale
  return multiply(
    translate(0, y, 0),
    multiply(rotateZ(p.roll), multiply(rotateX(p.pitch), scaleBy(p.scale))),
  )
}

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, t) => a + (b - a) * t
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU)
const easeOutCubic = (t) => 1 - (1 - t) ** 3
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutQuart = (t) => 1 - (1 - t) ** 4
