import { useEffect, useRef } from "react";

const MAX_RECTS = 32;
const MAX_RIPPLES = 6;
const GLASS_TARGET_SELECTOR = ".glass-panel, .liquid-glass-card, .liquid-glass-control, .glass-inset, .story-prose pre, .post-toc-link-active";
const WALLPAPER_IDS = [
  "07905b16e08767c9cc4719f0266b004b",
  "4bdca906a520689e14a45007951472b6",
  "7d47b283a1c99e02de58af14a5032f4f",
  "9eb477638edf0a072a3ff4bdf9734880",
  "d4fcc05bd8205c41fbe4f2645bf0c6b8",
];

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

const int MAX_RECTS = ${MAX_RECTS};
const int MAX_RIPPLES = ${MAX_RIPPLES};

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_imageResolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_mouse;
uniform float u_mouseStrength;
uniform vec3 u_effects;
uniform int u_rectCount;
uniform vec4 u_rects[MAX_RECTS];
uniform float u_radii[MAX_RECTS];
uniform int u_rippleCount;
uniform vec4 u_ripples[MAX_RIPPLES];
uniform vec3 u_tint;

varying vec2 v_uv;

float roundedBoxSdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.78, -0.62, 0.62, 0.78);

  for (int i = 0; i < 3; i++) {
    value += noise(p) * amp;
    p = rot * p * 2.02 + vec2(11.7, 3.4);
    amp *= 0.5;
  }

  return value;
}

vec3 rippleWave(vec2 frag) {
  vec2 offset = vec2(0.0);
  float strength = 0.0;

  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= u_rippleCount) {
      break;
    }

    vec4 ripple = u_ripples[i];
    float age = u_time - ripple.z;
    if (age < 0.0 || age > 1.45) {
      continue;
    }

    vec2 delta = frag - ripple.xy;
    float dist = length(delta);
    float maxReach = 210.0 * u_pixelRatio;
    float distanceGate = 1.0 - smoothstep(maxReach - 24.0 * u_pixelRatio, maxReach, dist);
    if (distanceGate <= 0.001) {
      continue;
    }

    vec2 dir = delta / max(dist, 1.0);
    float radius = age * 470.0 * u_pixelRatio;
    float band = 12.0 * u_pixelRatio;
    float ring = 1.0 - smoothstep(0.0, band, abs(dist - radius));
    float inner = 1.0 - smoothstep(0.0, band * 1.7, abs(dist - radius + band * 1.1));
    float outer = 1.0 - smoothstep(0.0, band * 1.9, abs(dist - radius - band * 1.2));
    float shoulder = exp(-abs(dist - radius) * 0.02 / u_pixelRatio);
    float fade = pow(1.0 - age / 1.45, 1.9) * ripple.w;
    float wave = (ring * 1.34 + outer * 0.34 - inner * 0.54 - shoulder * 0.18) * fade * distanceGate;

    offset += dir * wave * 0.018;
    strength += abs(wave);
  }

  return vec3(offset, strength);
}

vec2 coverUv(vec2 uv, vec2 canvas, vec2 imageSize) {
  float canvasRatio = canvas.x / canvas.y;
  float imageRatio = imageSize.x / imageSize.y;
  vec2 scale = vec2(1.0);

  if (imageRatio > canvasRatio) {
    scale.x = canvasRatio / imageRatio;
  } else {
    scale.y = imageRatio / canvasRatio;
  }

  return (uv - 0.5) * scale + 0.5;
}

vec3 sampleWallpaper(vec2 uv) {
  vec2 texUv = coverUv(uv, u_resolution, u_imageResolution);
  texUv = clamp(texUv, vec2(0.001), vec2(0.999));
  return texture2D(u_image, texUv).rgb;
}

vec3 samplePrism(vec2 uv, vec2 normal, float chroma, float softness) {
  vec2 dir = normalize(normal + vec2(0.0001, -0.0001));
  vec2 tangent = vec2(-dir.y, dir.x);
  vec3 spread;
  spread.r = sampleWallpaper(uv + dir * chroma + tangent * chroma * 0.28).r;
  spread.g = sampleWallpaper(uv - dir * chroma * 0.12).g;
  spread.b = sampleWallpaper(uv - dir * chroma - tangent * chroma * 0.2).b;

  vec3 softened =
    spread * 0.68 +
    sampleWallpaper(uv + tangent * softness) * 0.12 +
    sampleWallpaper(uv - tangent * softness) * 0.12 +
    sampleWallpaper(uv - dir * softness * 0.65) * 0.08;

  return softened;
}

void main() {
  vec2 frag = v_uv * u_resolution;
  vec3 finalColor = vec3(0.0);
  float finalAlpha = 0.0;
  vec3 ripple = rippleWave(frag) * u_effects.y;

  for (int i = 0; i < MAX_RECTS; i++) {
    if (i >= u_rectCount) {
      break;
    }

    vec4 rect = u_rects[i];
    vec2 center = rect.xy + rect.zw * 0.5;
    vec2 local = frag - center;
    float radius = u_radii[i];

    vec2 looseBounds = abs(local) - rect.zw * 0.5 - vec2(24.0 * u_pixelRatio);
    if (looseBounds.x > 0.0 || looseBounds.y > 0.0) {
      continue;
    }

    float dist = roundedBoxSdf(local, rect.zw * 0.5, radius);
    float mask = 1.0 - smoothstep(0.0, 1.25, dist);

    if (mask <= 0.001) {
      continue;
    }

    float edge = 1.0 - smoothstep(-7.0, 1.0, dist);
    float rim = smoothstep(-18.0, 0.0, dist) * mask;
    vec2 n = normalize(local / max(rect.zw * 0.5, vec2(1.0)));
    float curve = 1.0 - smoothstep(0.0, 0.95, length(local / max(rect.zw * 0.5, vec2(1.0))));

    vec2 localUv = local * 0.006 + vec2(u_time * 0.018, -u_time * 0.014);
    float liquidA = fbm(localUv + vec2(2.1, -1.3));
    float liquidB = fbm(localUv * 1.42 + vec2(8.1, -4.7));
    float waveA = sin((local.x + local.y) * 0.012 + u_time * 0.22 + liquidA * 1.2);
    float waveB = cos(local.y * 0.016 - u_time * 0.18 + liquidB * 1.1);
    vec2 microFlow = vec2(waveA, waveB) * 0.00085 + vec2(liquidA - 0.5, liquidB - 0.5) * 0.00165;

    vec2 mouseDelta = frag - u_mouse;
    float mouseDist = length(mouseDelta);
    vec2 mouseDir = mouseDelta / max(mouseDist, 1.0);
    float pressureRadius = 132.0 * u_pixelRatio;
    float hoverPressure = exp(-(mouseDist * mouseDist) / max(pressureRadius * pressureRadius, 1.0)) * u_mouseStrength * u_effects.x * mask;
    float pressureWell = (1.0 - smoothstep(0.0, pressureRadius, mouseDist)) * hoverPressure;
    float pressureDimple = pow(pressureWell, 1.45);
    vec2 lensNormal = normalize(n * (0.5 + rim * 1.2) + mouseDir * pressureDimple * 2.2 + normalize(ripple.xy + vec2(0.0001)) * ripple.z * 1.6);
    vec2 pressOffset = mouseDir * pressureDimple * (0.034 + curve * 0.032);
    vec2 refractOffset = n * (0.012 + rim * 0.022) + microFlow + ripple.xy * mask * 1.28 + pressOffset;

    vec2 uv = v_uv + refractOffset;
    vec3 base = sampleWallpaper(v_uv);
    float distortionEnergy = clamp(length(refractOffset) * 44.0 + hoverPressure * 0.95 + ripple.z * 0.8 + rim * 0.24, 0.0, 1.0);
    float chroma = 0.0026 + rim * 0.0065 + hoverPressure * 0.006 + ripple.z * 0.0042;
    float softness = (0.0012 + pressureDimple * 0.0026 + ripple.z * 0.0018) * u_effects.x;
    vec3 refracted = samplePrism(uv, lensNormal, chroma, softness);

    vec3 shifted = base + (refracted - base) * (3.25 + hoverPressure * 3.4 + ripple.z * 2.4);
    vec3 tint = mix(shifted, u_tint, 0.004 + rim * 0.018);
    float topLight = smoothstep(0.85, -0.4, local.y / max(rect.w, 1.0)) * smoothstep(0.75, -0.4, local.x / max(rect.z, 1.0));
    float bottomShade = smoothstep(-0.2, 0.95, local.y / max(rect.w, 1.0)) * smoothstep(-0.3, 0.95, local.x / max(rect.z, 1.0));
    float spec = pow(max(dot(normalize(vec2(-0.55, -0.85)), -n), 0.0), 18.0);
    float caustic = mix(
      sin(local.x * 0.045 + u_time * 0.7) * cos(local.y * 0.035 - u_time * 0.45) * 0.5 + 0.5,
      liquidA,
      0.58
    );
    float edgeDiffuse = (rim * 0.34 + edge * 0.12) * u_effects.z;
    float pressureSpec = pow(max(1.0 - mouseDist / max(pressureRadius, 1.0), 0.0), 3.0) * hoverPressure;
    float grazing = pow(1.0 - clamp(dot(lensNormal, normalize(vec2(-0.35, -0.94))), 0.0, 1.0), 2.0) * distortionEnergy;
    float brightRidge = smoothstep(0.16, 0.82, distortionEnergy) * (rim * 0.45 + pressureSpec * 0.65 + ripple.z * 0.18);
    float darkRidge = smoothstep(0.18, 0.9, distortionEnergy) * bottomShade * 0.22;

    vec3 glass = tint;
    glass += vec3(0.34) * topLight * 0.06;
    glass += vec3(1.0) * spec * 0.18;
    glass += vec3(1.0) * pressureSpec * 0.16;
    glass += vec3(0.92, 0.98, 1.0) * grazing * 0.07;
    glass += vec3(1.0, 0.97, 0.9) * brightRidge * 0.12;
    glass += u_tint * caustic * curve * 0.014;
    glass += mix(u_tint, vec3(1.0), 0.3) * edgeDiffuse;
    glass -= vec3(0.14, 0.16, 0.18) * (bottomShade * 0.052 + darkRidge);
    glass += vec3(1.0) * rim * 0.12;
    glass += vec3(0.75, 0.88, 1.0) * edge * 0.06;

    float centerAlpha = curve * 0.018;
    float edgeAlpha = rim * 0.12 + edge * 0.058 + edgeDiffuse * 0.2;
    float alpha = mask * (centerAlpha + edgeAlpha + spec * 0.06 + distortionEnergy * 0.18 + hoverPressure * 0.18 + ripple.z * 0.13);
    finalColor = mix(finalColor, glass, alpha);
    finalAlpha = max(finalAlpha, alpha);
  }

  gl_FragColor = vec4(finalColor, clamp(finalAlpha, 0.0, 0.48));
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function getWallpaperId() {
  const value = window.localStorage.getItem("wanderlust-glass-wallpaper")?.replace(/\.(jpg|jpeg|webp|png)$/i, "");
  return value && WALLPAPER_IDS.includes(value) ? value : WALLPAPER_IDS[0];
}

function readAmbientColor() {
  const colorMode = document.documentElement.dataset.glassColor;
  if (colorMode === "white") {
    return [1, 1, 1] as const;
  }

  const hue = Number(getComputedStyle(document.documentElement).getPropertyValue("--dopamine-hue").trim());
  const normalizedHue = Number.isFinite(hue) ? hue / 60 : 105 / 60;
  const chroma = 0.72;
  const x = chroma * (1 - Math.abs((normalizedHue % 2) - 1));
  const m = 0.22;
  let color: [number, number, number] = [0, 0, 0];

  if (normalizedHue < 1) {
    color = [chroma, x, 0];
  } else if (normalizedHue < 2) {
    color = [x, chroma, 0];
  } else if (normalizedHue < 3) {
    color = [0, chroma, x];
  } else if (normalizedHue < 4) {
    color = [0, x, chroma];
  } else if (normalizedHue < 5) {
    color = [x, 0, chroma];
  } else {
    color = [chroma, 0, x];
  }

  return [color[0] + m, color[1] + m, color[2] + m] as const;
}

function collectRects() {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(GLASS_TARGET_SELECTOR));
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return elements
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) {
        return null;
      }

      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || Math.min(rect.width, rect.height) * 0.12;
      return {
        x: rect.left,
        y: viewportHeight - rect.bottom,
        width: rect.width,
        height: rect.height,
        radius,
      };
    })
    .filter((rect): rect is NonNullable<typeof rect> => rect !== null)
    .sort((left, right) => right.width * right.height - left.width * left.height)
    .slice(0, MAX_RECTS);
}

export function LiquidGlassShaderLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    if (!canvas || !gl) {
      return;
    }

    const program = createProgram(gl);
    if (!program) {
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const imageResolutionLocation = gl.getUniformLocation(program, "u_imageResolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const pixelRatioLocation = gl.getUniformLocation(program, "u_pixelRatio");
    const mouseLocation = gl.getUniformLocation(program, "u_mouse");
    const mouseStrengthLocation = gl.getUniformLocation(program, "u_mouseStrength");
    const effectsLocation = gl.getUniformLocation(program, "u_effects");
    const rectCountLocation = gl.getUniformLocation(program, "u_rectCount");
    const rectsLocation = gl.getUniformLocation(program, "u_rects[0]");
    const radiiLocation = gl.getUniformLocation(program, "u_radii[0]");
    const rippleCountLocation = gl.getUniformLocation(program, "u_rippleCount");
    const ripplesLocation = gl.getUniformLocation(program, "u_ripples[0]");
    const tintLocation = gl.getUniformLocation(program, "u_tint");
    const imageLocation = gl.getUniformLocation(program, "u_image");

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

    let imageSize: [number, number] = [1, 1];
    let frame = 0;
    let lastWallpaper = "";
    let rectsDirty = true;
    let sizeDirty = true;
    let activeUntil = performance.now() + 700;
    let lastDrawTime = 0;
    let resizeTimer = 0;
    let rectCount = 0;
    let rippleCursor = 0;
    let rippleCount = 0;
    let hoveringGlass = false;
    const mouse = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      targetX: window.innerWidth * 0.5,
      targetY: window.innerHeight * 0.5,
      strength: 0,
      targetStrength: 0,
    };
    const rectData = new Float32Array(MAX_RECTS * 4);
    const radiusData = new Float32Array(MAX_RECTS);
    const rippleData = new Float32Array(MAX_RIPPLES * 4);

    const markActive = (duration = 280) => {
      rectsDirty = true;
      activeUntil = Math.max(activeUntil, performance.now() + duration);
    };

    const markResize = () => {
      sizeDirty = true;
      markActive(420);
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        sizeDirty = true;
        rectsDirty = true;
        activeUntil = Math.max(activeUntil, performance.now() + 240);
      }, 120);
    };

    const refreshRects = (dpr: number) => {
      rectData.fill(0);
      radiusData.fill(0);

      const rects = collectRects();
      rectCount = rects.length;
      rects.forEach((rect, index) => {
        rectData[index * 4] = rect.x * dpr;
        rectData[index * 4 + 1] = rect.y * dpr;
        rectData[index * 4 + 2] = rect.width * dpr;
        rectData[index * 4 + 3] = rect.height * dpr;
        radiusData[index] = rect.radius * dpr;
      });

      rectsDirty = false;
    };

    const addRipple = (clientX: number, clientY: number, strength = 1) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const index = rippleCursor * 4;
      rippleData[index] = clientX * dpr;
      rippleData[index + 1] = (window.innerHeight - clientY) * dpr;
      rippleData[index + 2] = performance.now() / 1000;
      rippleData[index + 3] = strength;
      rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
      rippleCount = Math.min(rippleCount + 1, MAX_RIPPLES);
      activeUntil = Math.max(activeUntil, performance.now() + 1900);
    };

    const loadTexture = () => {
      const wallpaper = getWallpaperId();
      if (wallpaper === lastWallpaper) {
        return;
      }

      lastWallpaper = wallpaper;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        imageSize = [image.naturalWidth || image.width, image.naturalHeight || image.height];
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      };
      image.src = `/wallpaper/optimized/${wallpaper}.webp`;
    };

    const render = (time: number) => {
      const isLiquid = document.documentElement.dataset.theme === "liquid-glass";
      const isShaderGlass = document.documentElement.dataset.glassRender === "shader";
      const cursorEnabled = document.documentElement.dataset.glassCursor !== "off";
      const edgeDiffuseEnabled = document.documentElement.dataset.glassFluid !== "off";
      const active = time < activeUntil || rectsDirty || sizeDirty;
      const idleFps = edgeDiffuseEnabled ? 10 : 6;
      const minFrameMs = isLiquid && isShaderGlass ? (active ? 0 : 1000 / idleFps) : 1000 / 2;

      if (document.hidden || time - lastDrawTime < minFrameMs) {
        frame = window.requestAnimationFrame(render);
        return;
      }

      lastDrawTime = time;
      loadTexture();

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(window.innerWidth * dpr));
      const height = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (sizeDirty || canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        sizeDirty = false;
        rectsDirty = true;
      }

      mouse.x += (mouse.targetX - mouse.x) * 0.16;
      mouse.y += (mouse.targetY - mouse.y) * 0.16;
      mouse.strength += (mouse.targetStrength - mouse.strength) * 0.12;
      if (!hoveringGlass || !cursorEnabled || !isShaderGlass) {
        mouse.targetStrength *= 0.92;
      }

      if (isLiquid && isShaderGlass && rectsDirty) {
        refreshRects(dpr);
      } else if (!isLiquid || !isShaderGlass) {
        rectCount = 0;
      }

      const [r, g, b] = readAmbientColor();

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(imageLocation, 0);
      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform2f(imageResolutionLocation, imageSize[0], imageSize[1]);
      gl.uniform1f(timeLocation, time / 1000);
      gl.uniform1f(pixelRatioLocation, dpr);
      gl.uniform2f(mouseLocation, mouse.x * dpr, (window.innerHeight - mouse.y) * dpr);
      gl.uniform1f(mouseStrengthLocation, mouse.strength);
      gl.uniform3f(
        effectsLocation,
        isShaderGlass && document.documentElement.dataset.glassCursor !== "off" ? 1 : 0,
        isShaderGlass && document.documentElement.dataset.glassRipple !== "off" ? 1 : 0,
        isShaderGlass && edgeDiffuseEnabled ? 1 : 0,
      );
      gl.uniform1i(rectCountLocation, rectCount);
      gl.uniform4fv(rectsLocation, rectData);
      gl.uniform1fv(radiiLocation, radiusData);
      gl.uniform1i(rippleCountLocation, rippleCount);
      gl.uniform4fv(ripplesLocation, rippleData);
      gl.uniform3f(tintLocation, r, g, b);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frame = window.requestAnimationFrame(render);
    };

    const handleScroll = () => markActive(220);
    const handleResize = () => markResize();
    const isInsideGlassTarget = (event: PointerEvent) => {
      const target = event.target;
      return target instanceof Element && target.closest(GLASS_TARGET_SELECTOR) !== null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (document.documentElement.dataset.glassRender !== "shader" || document.documentElement.dataset.glassCursor === "off" || !isInsideGlassTarget(event)) {
        hoveringGlass = false;
        mouse.targetStrength = 0;
        return;
      }

      hoveringGlass = true;
      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      mouse.targetStrength = 1;
      activeUntil = Math.max(activeUntil, performance.now() + 1400);
    };
    const handlePointerLeave = () => {
      hoveringGlass = false;
      mouse.targetStrength = 0;
      activeUntil = Math.max(activeUntil, performance.now() + 360);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (document.documentElement.dataset.glassRender !== "shader" || document.documentElement.dataset.glassRipple === "off" || !isInsideGlassTarget(event)) {
        return;
      }

      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      hoveringGlass = true;
      mouse.targetStrength = 1;
      addRipple(event.clientX, event.clientY, event.pointerType === "mouse" ? 1.18 : 1.32);
    };
    const handleVisibility = () => {
      if (!document.hidden) {
        markResize();
      }
    };
    const scrollOptions: AddEventListenerOptions = { passive: true, capture: true };
    const resizeOptions: AddEventListenerOptions = { passive: true };
    const mutationObserver = new MutationObserver(() => markActive(500));
    const resizeObserver = new ResizeObserver(() => markResize());

    window.addEventListener("scroll", handleScroll, scrollOptions);
    window.addEventListener("resize", handleResize, resizeOptions);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-glass-render", "data-glass-fluid", "data-glass-cursor", "data-glass-ripple", "data-glass-color"],
      childList: true,
      subtree: true,
    });
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);

    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("scroll", handleScroll, scrollOptions);
      window.removeEventListener("resize", handleResize, resizeOptions);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("visibilitychange", handleVisibility);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      gl.deleteTexture(texture);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="liquid-glass-shader-layer" aria-hidden="true" />;
}
