import { useEffect, useRef } from "react";

const MAX_RECTS = 32;
const MAX_RIPPLES = 6;
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
  float light = 0.0;

  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= u_rippleCount) {
      break;
    }

    vec4 ripple = u_ripples[i];
    float age = u_time - ripple.z;
    if (age < 0.0 || age > 1.8) {
      continue;
    }

    vec2 delta = frag - ripple.xy;
    float dist = length(delta);
    float maxReach = 190.0 * u_pixelRatio;
    float distanceGate = 1.0 - smoothstep(maxReach - 34.0 * u_pixelRatio, maxReach, dist);
    if (distanceGate <= 0.001) {
      continue;
    }

    vec2 dir = delta / max(dist, 1.0);
    float radius = age * 520.0;
    float ring = 1.0 - smoothstep(0.0, 34.0, abs(dist - radius));
    float softTrail = exp(-abs(dist - radius) * 0.012);
    float fade = pow(1.0 - age / 1.8, 1.7) * ripple.w;
    float wave = (ring * 0.95 + softTrail * 0.16) * fade * distanceGate;

    offset += dir * wave * 0.0065;
    light += wave;
  }

  return vec3(offset, light);
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

void main() {
  vec2 frag = v_uv * u_resolution;
  vec3 finalColor = vec3(0.0);
  float finalAlpha = 0.0;
  vec2 fluidUv = vec2(v_uv.x * u_resolution.x / max(u_resolution.y, 1.0), v_uv.y);
  float globalFluid = mix(0.5, fbm(fluidUv * 2.8 + vec2(u_time * 0.075, -u_time * 0.052)), u_effects.x);
  float fluidDetail = fbm(fluidUv * 7.2 + vec2(-u_time * 0.08, u_time * 0.055));
  float ribbonPhase = sin((fluidUv.x * 4.2 + fluidUv.y * 6.1 + globalFluid * 5.4 + u_time * 0.32) * 3.14159);
  float fluidRibbon = smoothstep(0.7, 0.99, ribbonPhase) * (1.0 - smoothstep(0.86, 1.0, fluidDetail));
  float fluidMist = smoothstep(0.48, 0.9, fluidDetail);
  float globalVeil = (fluidRibbon * 0.42 + fluidMist * 0.1) * u_effects.x;
  float mouseDistance = length((frag - u_mouse) / max(u_resolution.y, 1.0));
  float mouseGlow = exp(-mouseDistance * mouseDistance * 22.0) * u_mouseStrength * u_effects.y;
  vec3 ripple = rippleWave(frag) * u_effects.z;

  for (int i = 0; i < MAX_RECTS; i++) {
    if (i >= u_rectCount) {
      break;
    }

    vec4 rect = u_rects[i];
    vec2 center = rect.xy + rect.zw * 0.5;
    vec2 local = frag - center;
    float radius = u_radii[i];

    vec2 looseBounds = abs(local) - rect.zw * 0.5 - vec2(22.0);
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

    vec2 localUv = local * 0.008 + vec2(u_time * 0.035, -u_time * 0.024);
    float liquidA = fbm(localUv + globalFluid * 0.25);
    float liquidB = fbm(localUv * 1.34 + vec2(8.1, -4.7) - globalFluid * 0.18);
    float waveA = sin((local.x + local.y) * 0.014 + u_time * 0.42 + liquidA * 2.1);
    float waveB = cos(local.y * 0.02 - u_time * 0.36 + liquidB * 2.0);
    vec2 flow = vec2(waveA, waveB) * 0.0016 + vec2(liquidA - 0.5, liquidB - 0.5) * 0.0038;
    vec2 mousePull = normalize(frag - u_mouse) * mouseGlow * 0.009;
    vec2 refractOffset = n * (0.012 + rim * 0.018) + flow + ripple.xy * mask + mousePull * mask;

    vec2 uv = v_uv + refractOffset;
    float chroma = 0.0024 + rim * 0.0035;
    vec3 refracted;
    refracted.r = sampleWallpaper(uv + vec2(chroma, -chroma * 0.4)).r;
    refracted.g = sampleWallpaper(uv).g;
    refracted.b = sampleWallpaper(uv - vec2(chroma, -chroma * 0.4)).b;

    vec3 tint = mix(refracted, u_tint, 0.008);
    float topLight = smoothstep(0.85, -0.4, local.y / max(rect.w, 1.0)) * smoothstep(0.75, -0.4, local.x / max(rect.z, 1.0));
    float bottomShade = smoothstep(-0.2, 0.95, local.y / max(rect.w, 1.0)) * smoothstep(-0.3, 0.95, local.x / max(rect.z, 1.0));
    float spec = pow(max(dot(normalize(vec2(-0.55, -0.85)), -n), 0.0), 18.0);
    float caustic = mix(
      sin(local.x * 0.045 + u_time * 0.7) * cos(local.y * 0.035 - u_time * 0.45) * 0.5 + 0.5,
      liquidA,
      0.58
    );

    vec3 glass = tint;
    glass += vec3(0.34) * topLight * 0.08;
    glass += vec3(1.0) * spec * 0.24;
    glass += u_tint * caustic * curve * 0.018;
    glass += vec3(1.0, 0.96, 0.88) * mouseGlow * mask * 0.42;
    glass += vec3(1.0, 0.98, 0.92) * ripple.z * mask * 0.13;
    glass -= vec3(0.14, 0.16, 0.18) * bottomShade * 0.05;
    glass += vec3(1.0) * rim * 0.2;
    glass += vec3(0.75, 0.88, 1.0) * edge * 0.12;

    float centerAlpha = curve * 0.018;
    float edgeAlpha = rim * 0.14 + edge * 0.08;
    float alpha = mask * (centerAlpha + edgeAlpha + spec * 0.08 + mouseGlow * 0.2 + ripple.z * 0.06);
    finalColor = mix(finalColor, glass, alpha);
    finalAlpha = max(finalAlpha, alpha);
  }

  vec3 fluidColor = mix(u_tint, vec3(1.0), 0.1 + fluidRibbon * 0.12);
  vec3 mouseColor = vec3(1.0, 0.96, 0.88);
  vec3 rippleColor = vec3(1.0, 0.98, 0.92);
  vec3 ambientGlow = fluidColor * globalVeil * 0.16 + mouseColor * mouseGlow * 0.44 + rippleColor * ripple.z * 0.06;
  finalColor += ambientGlow;
  finalAlpha = max(finalAlpha, globalVeil * 0.14 + mouseGlow * 0.34 + ripple.z * 0.07);

  gl_FragColor = vec4(finalColor, clamp(finalAlpha, 0.0, 0.42));
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
  const selectors = [
    ".glass-panel",
    ".liquid-glass-card",
    ".liquid-glass-control",
    ".glass-inset",
    ".story-prose pre",
    ".post-toc-link-active",
  ];
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")));
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
      const isShaderGlass = document.documentElement.dataset.glassRender !== "frosted";
      const fluidEnabled = document.documentElement.dataset.glassFluid !== "off";
      const active = time < activeUntil || rectsDirty || sizeDirty;
      const idleFps = fluidEnabled ? 24 : 10;
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
      mouse.targetStrength *= 0.985;

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
        isShaderGlass && fluidEnabled ? 1 : 0,
        isShaderGlass && document.documentElement.dataset.glassCursor !== "off" ? 1 : 0,
        isShaderGlass && document.documentElement.dataset.glassRipple !== "off" ? 1 : 0,
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
    const handlePointerMove = (event: PointerEvent) => {
      if (document.documentElement.dataset.glassRender === "frosted" || document.documentElement.dataset.glassCursor === "off") {
        return;
      }

      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      mouse.targetStrength = 1;
      activeUntil = Math.max(activeUntil, performance.now() + 900);
    };
    const handlePointerLeave = () => {
      mouse.targetStrength = 0;
      activeUntil = Math.max(activeUntil, performance.now() + 360);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (document.documentElement.dataset.glassRender === "frosted" || document.documentElement.dataset.glassRipple === "off") {
        return;
      }

      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      mouse.targetStrength = 1;
      addRipple(event.clientX, event.clientY, event.pointerType === "mouse" ? 1 : 1.18);
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
      attributeFilter: ["class", "style", "data-theme"],
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
