import { useEffect, useRef, useState } from "react";

const MAX_RECTS = 24;
const MAX_RIPPLES = 4;
const GLASS_TARGET_SELECTOR = ".glass-panel, .liquid-glass-card, .liquid-glass-control, .glass-inset, .story-prose pre, .post-toc-link-active";
const GLASS_SHADER_EXCLUDE_SELECTOR = ".glass-theme-popover, .solid-theme-popover";
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

varying vec2 v_uv;

float roundedBoxSdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec2 roundedBoxNormal(vec2 p, vec2 b, float r) {
  float e = max(0.8 * u_pixelRatio, 0.8);
  vec2 dx = vec2(e, 0.0);
  vec2 dy = vec2(0.0, e);
  return normalize(vec2(
    roundedBoxSdf(p + dx, b, r) - roundedBoxSdf(p - dx, b, r),
    roundedBoxSdf(p + dy, b, r) - roundedBoxSdf(p - dy, b, r)
  ) + vec2(0.0001));
}

float fastNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n00 = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
  float n10 = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
  float n01 = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  float n11 = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

float fastFbm2(vec2 p) {
  return fastNoise(p) * 0.65 + fastNoise(p * 2.1 + vec2(3.2, 1.7)) * 0.35;
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
    if (age < 0.0 || age > 1.35) {
      continue;
    }

    vec2 delta = frag - ripple.xy;
    float dist = length(delta);
    float maxReach = 240.0 * u_pixelRatio;
    float distanceGate = 1.0 - smoothstep(maxReach - 24.0 * u_pixelRatio, maxReach, dist);
    if (distanceGate <= 0.001) {
      continue;
    }

    vec2 dir = delta / max(dist, 1.0);
    float radius = age * 440.0 * u_pixelRatio;
    float band = 14.0 * u_pixelRatio;
    float ring = 1.0 - smoothstep(0.0, band, abs(dist - radius));
    float fade = pow(1.0 - age / 1.35, 1.8) * ripple.w;
    float wave = ring * 1.6 * fade * distanceGate;

    offset += dir * wave * 0.022;
    strength += wave * 1.1;
  }

  return vec3(offset, strength);
}

float rippleGlow(vec2 frag) {
  float glow = 0.0;

  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= u_rippleCount) {
      break;
    }

    vec4 ripple = u_ripples[i];
    float age = u_time - ripple.z;
    if (age < 0.0 || age > 1.1) {
      continue;
    }

    float dist = length(frag - ripple.xy);
    float progress = clamp(age / 1.1, 0.0, 1.0);
    float maxGlowReach = 210.0 * u_pixelRatio;
    float reachGate = 1.0 - smoothstep(maxGlowReach - 20.0 * u_pixelRatio, maxGlowReach, dist);
    float radius = progress * maxGlowReach;
    float band = mix(12.0, 4.0, progress) * u_pixelRatio;
    float ring = 1.0 - smoothstep(0.0, band, abs(dist - radius));
    float fade = pow(1.0 - progress, 1.2) * ripple.w * reachGate;

    glow += ring * 1.4 * fade;
  }

  return clamp(glow, 0.0, 1.0);
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
  spread.r = sampleWallpaper(uv + dir * chroma + tangent * chroma * 0.25).r;
  spread.g = sampleWallpaper(uv - dir * chroma * 0.1).g;
  spread.b = sampleWallpaper(uv - dir * chroma - tangent * chroma * 0.2).b;

  vec3 softened = spread * 0.76 + sampleWallpaper(uv + tangent * softness) * 0.24;
  return softened;
}

void main() {
  if (u_rectCount <= 0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 frag = v_uv * u_resolution;
  vec3 finalColor = vec3(0.0);
  float finalAlpha = 0.0;
  vec3 ripple = rippleWave(frag) * u_effects.y;
  float globalRippleGlow = rippleGlow(frag) * u_effects.y;

  for (int i = 0; i < MAX_RECTS; i++) {
    if (i >= u_rectCount) {
      break;
    }

    vec4 rect = u_rects[i];
    vec2 center = rect.xy + rect.zw * 0.5;
    vec2 local = frag - center;
    float radius = u_radii[i];
    float minDim = min(rect.z, rect.w);
    float largeSurface = smoothstep(56.0 * u_pixelRatio, 320.0 * u_pixelRatio, minDim);
    float glassWidth = mix(5.0, 22.0, largeSurface) * u_pixelRatio;

    vec2 looseBounds = abs(local) - rect.zw * 0.5 - vec2(glassWidth + 4.0 * u_pixelRatio);
    if (looseBounds.x > 0.0 || looseBounds.y > 0.0) {
      continue;
    }

    float dist = roundedBoxSdf(local, rect.zw * 0.5, radius);
    float aa = max(1.0 * u_pixelRatio, 0.001);
    float tubeHalf = glassWidth * mix(0.62, 0.78, largeSurface);
    float rimDist = dist + tubeHalf * 0.34;
    float tubeMask = 1.0 - smoothstep(tubeHalf - aa, tubeHalf + aa, abs(rimDist));
    float insideMask = 1.0 - smoothstep(0.0, aa, dist);
    float paneMask = smoothstep(tubeHalf * 0.95, tubeHalf * 1.8, -dist) * insideMask;
    float opticalMask = max(tubeMask, paneMask * 0.004);

    if (opticalMask <= 0.001) {
      continue;
    }

    vec2 boundaryNormal = roundedBoxNormal(local, rect.zw * 0.5, radius);
    vec2 tangentNormal = vec2(-boundaryNormal.y, boundaryNormal.x);
    float tubeSigned = clamp(rimDist / max(tubeHalf, 1.0), -1.0, 1.0);
    float tubeSection = sqrt(max(1.0 - tubeSigned * tubeSigned, 0.0)) * tubeMask;
    float tubeFace = pow(tubeSection, 0.38) * tubeMask;
    float tubeWall = pow(max(1.0 - tubeSection, 0.0), 0.22) * tubeMask;
    float outerLip = exp(-abs(rimDist - tubeHalf) / max(0.8 * u_pixelRatio, 0.001)) * tubeMask;
    float innerLip = exp(-abs(rimDist + tubeHalf) / max(0.9 * u_pixelRatio, 0.001)) * tubeMask * insideMask;
    float centerCaustic = exp(-abs(rimDist) / max(3.8 * u_pixelRatio, 0.001)) * tubeFace;
    float opticalThickness = clamp(tubeFace * 0.98 + tubeWall * 0.72 + outerLip * 0.4, 0.0, 1.0);
    float cornerEnergy = pow(clamp(abs(boundaryNormal.x * boundaryNormal.y) * 2.0, 0.0, 1.0), 0.58) * tubeMask;

    float interiorDepth = smoothstep(tubeHalf * 1.1, tubeHalf * 3.2, -dist) * insideMask;
    vec3 localRipple = vec3(ripple.xy, ripple.z) * interiorDepth;

    vec2 localUv = vec2(local.x * 0.0054 + u_time * 0.034, tubeSigned * 1.2 - u_time * 0.018);
    float highlightNoise = fastFbm2(localUv) * u_effects.z;
    float flowPhase = (local.x + local.y) * 0.038 + u_time * 1.42 + highlightNoise * 4.0;
    float flowCarrier = pow(clamp(0.5 + 0.5 * sin(flowPhase), 0.0, 1.0), 8.0);
    float flowThread = flowCarrier * tubeFace * u_effects.z;
    float flowCaustic = flowThread * (0.8 + cornerEnergy * 1.2);

    vec2 opticalNormal = normalize(
      boundaryNormal * (tubeSigned * 1.25 + 0.2) +
      tangentNormal * ((highlightNoise - 0.5) * 0.5 + flowThread * 0.8)
    );

    vec2 mouseDelta = frag - u_mouse;
    float mouseDist = length(mouseDelta);
    vec2 mouseDir = mouseDelta / max(mouseDist, 1.0);
    float pressureRadius = mix(84.0, 220.0, largeSurface) * u_pixelRatio;
    float hoverPressure = exp(-(mouseDist * mouseDist) / max(pressureRadius * pressureRadius, 1.0)) * u_mouseStrength * u_effects.x * insideMask;
    float pressureT = clamp(mouseDist / max(pressureRadius, 1.0), 0.0, 1.0);
    float pressureRefract = exp(-pressureT * pressureT * 3.6) * hoverPressure;

    float lightSide = clamp(dot(boundaryNormal, normalize(vec2(-0.62, 0.78))) * 0.5 + 0.5, 0.0, 1.0);
    float keyLight = pow(lightSide, 1.32);
    float outerSpec = outerLip * (0.02 + keyLight * 1.5);
    float innerSpec = innerLip * (0.01 + keyLight * 0.6);
    float cornerSpec = cornerEnergy * outerLip * (0.08 + keyLight * 0.6);

    float refractionPixels = tubeFace * (32.0 + largeSurface * 70.0) + flowCaustic * (14.0 + largeSurface * 28.0);
    vec2 refractOffset =
      -opticalNormal * (refractionPixels / u_resolution) +
      boundaryNormal * (tubeSigned * (10.0 + largeSurface * 24.0) * tubeMask / u_resolution) +
      -mouseDir * pressureRefract * (4.5 + largeSurface * 7.5) / u_resolution;

    vec2 uv = clamp(v_uv + refractOffset, vec2(0.002), vec2(0.998));
    vec3 base = sampleWallpaper(v_uv);
    float chroma = (outerSpec + cornerSpec) * 0.00032 + outerLip * 0.00008;
    float softness = 0.00018 + opticalThickness * 0.0003;
    vec3 refracted = samplePrism(uv, -opticalNormal, chroma, softness);
    float bendAmount = clamp(tubeFace * 1.1 + tubeWall * 0.68 + centerCaustic * 0.4 + flowCaustic * 0.6, 0.0, 0.98);
    vec3 backgroundBend = mix(base, refracted, bendAmount);

    vec3 whiteSpec =
      vec3(1.0) * outerSpec * 0.9 +
      vec3(0.96, 1.0, 1.0) * innerSpec * 0.6 +
      vec3(1.0) * cornerSpec * 0.65 +
      vec3(1.0, 0.98, 0.9) * flowThread * 0.8;

    vec3 adaptiveLight = vec3(1.0, 0.95, 0.9);
    vec3 mouseLight = adaptiveLight * pressureRefract * 0.08;
    float visibleRipple = max(localRipple.z * tubeFace, globalRippleGlow * insideMask * (0.5 + tubeFace * 0.8));
    vec3 rippleLight = adaptiveLight * visibleRipple * 0.4;

    vec3 glassComposite = max(vec3(0.0), backgroundBend + whiteSpec + mouseLight + rippleLight);
    float sourceAlpha = clamp(
      opticalThickness * 0.016 +
      tubeWall * 0.005 +
      outerSpec * 0.75 +
      innerSpec * 0.55 +
      flowCaustic * 0.32 +
      cornerSpec * 0.2 +
      pressureRefract * 0.02 +
      globalRippleGlow * insideMask * 0.1,
      0.0,
      0.92
    );

    vec3 premul = finalColor * finalAlpha;
    premul = glassComposite * sourceAlpha + premul * (1.0 - sourceAlpha);
    finalAlpha = sourceAlpha + finalAlpha * (1.0 - sourceAlpha);
    finalColor = premul / max(finalAlpha, 0.001);
  }

  gl_FragColor = vec4(finalColor, clamp(finalAlpha, 0.0, 0.94));
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

function isTouchEnvironment() {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.innerWidth <= 768 ||
    ("ontouchstart" in window && !window.matchMedia("(pointer: fine)").matches)
  );
}

function collectRects() {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(GLASS_TARGET_SELECTOR));
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return elements
    .map((element) => {
      if (element.closest(GLASS_SHADER_EXCLUDE_SELECTOR)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) {
        return null;
      }

      // Fast radius estimate without triggering layout reflow (getComputedStyle)
      const radius = element.classList.contains("liquid-glass-control")
        ? 999
        : Math.min(20, Math.min(rect.width, rect.height) * 0.12);

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
  const [isTouch, setIsTouch] = useState(isTouchEnvironment);

  useEffect(() => {
    const handleDeviceCheck = () => {
      const touch = isTouchEnvironment();
      setIsTouch(touch);
      if (touch) {
        document.documentElement.dataset.touchDevice = "true";
      } else {
        delete document.documentElement.dataset.touchDevice;
      }
    };

    handleDeviceCheck();
    window.addEventListener("resize", handleDeviceCheck, { passive: true });
    return () => window.removeEventListener("resize", handleDeviceCheck);
  }, []);

  useEffect(() => {
    if (isTouch) {
      return;
    }

    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
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
    let isRunning = false;
    let lastWallpaper = "";
    let rectsDirty = true;
    let sizeDirty = true;
    let activeUntil = performance.now() + 800;
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

    const scheduleRender = () => {
      if (!isRunning) {
        isRunning = true;
        frame = window.requestAnimationFrame(render);
      }
    };

    const markActive = (duration = 280) => {
      rectsDirty = true;
      activeUntil = Math.max(activeUntil, performance.now() + duration);
      scheduleRender();
    };

    const markResize = () => {
      sizeDirty = true;
      markActive(360);
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        sizeDirty = true;
        rectsDirty = true;
        activeUntil = Math.max(activeUntil, performance.now() + 200);
        scheduleRender();
      }, 100);
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
      // Clamped to 1.0 for high performance
      const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
      const index = rippleCursor * 4;
      rippleData[index] = clientX * dpr;
      rippleData[index + 1] = (window.innerHeight - clientY) * dpr;
      rippleData[index + 2] = performance.now() / 1000;
      rippleData[index + 3] = strength;
      rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
      rippleCount = Math.min(rippleCount + 1, MAX_RIPPLES);
      activeUntil = Math.max(activeUntil, performance.now() + 1400);
      scheduleRender();
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
        markActive(300);
      };
      image.src = `/wallpaper/optimized/${wallpaper}.webp`;
    };

    const render = (time: number) => {
      const isLiquid = document.documentElement.dataset.theme === "liquid-glass";
      const isShaderGlass = document.documentElement.dataset.glassRender === "shader";
      const cursorEnabled = document.documentElement.dataset.glassCursor !== "off";
      const edgeDiffuseEnabled = document.documentElement.dataset.glassFluid !== "off";

      // If inactive and no animation running, gracefully stop RAF loop (0 FPS idle)
      const isActivelyAnimating = time < activeUntil || rectsDirty || sizeDirty;
      const mouseActive = mouse.strength > 0.005 || mouse.targetStrength > 0.005;
      const ripplesActive = rippleCount > 0;

      if (!isLiquid || !isShaderGlass) {
        rectCount = 0;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        isRunning = false;
        return;
      }

      if (document.hidden) {
        isRunning = false;
        return;
      }

      // Throttle idle rendering to save battery
      const minFrameMs = isActivelyAnimating || mouseActive || ripplesActive ? 0 : 1000 / 8;
      if (time - lastDrawTime < minFrameMs) {
        frame = window.requestAnimationFrame(render);
        return;
      }

      lastDrawTime = time;
      loadTexture();

      // Clamp DPR to 1.0 for huge performance boost on Retina/4K screens
      const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
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

      mouse.x += (mouse.targetX - mouse.x) * 0.18;
      mouse.y += (mouse.targetY - mouse.y) * 0.18;
      mouse.strength += (mouse.targetStrength - mouse.strength) * 0.15;
      document.documentElement.style.setProperty("--glass-sun-x", `${mouse.x}px`);
      document.documentElement.style.setProperty("--glass-sun-y", `${mouse.y}px`);
      document.documentElement.style.setProperty("--glass-sun-strength", String(cursorEnabled ? Math.min(1, mouse.strength) : 0));

      if (!hoveringGlass || !cursorEnabled) {
        mouse.targetStrength *= 0.85;
      }

      if (rectsDirty) {
        refreshRects(dpr);
      }

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
        cursorEnabled ? 1 : 0,
        document.documentElement.dataset.glassRipple !== "off" ? 1 : 0,
        edgeDiffuseEnabled ? 1 : 0,
      );
      gl.uniform1i(rectCountLocation, rectCount);
      gl.uniform4fv(rectsLocation, rectData);
      gl.uniform1fv(radiiLocation, radiusData);
      gl.uniform1i(rippleCountLocation, rippleCount);
      gl.uniform4fv(ripplesLocation, rippleData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Clean up finished ripples
      if (rippleCount > 0 && time >= activeUntil) {
        rippleCount = 0;
      }

      // If state is completely calm, stop requestAnimationFrame (0 FPS idle sleep)
      if (!isActivelyAnimating && !mouseActive && !ripplesActive && !rectsDirty && !sizeDirty) {
        isRunning = false;
        return;
      }

      frame = window.requestAnimationFrame(render);
    };

    const handleScroll = () => markActive(200);
    const handleResize = () => markResize();
    const isInsideGlassTarget = (event: PointerEvent) => {
      const target = event.target;
      return target instanceof Element && target.closest(GLASS_TARGET_SELECTOR) !== null && target.closest(GLASS_SHADER_EXCLUDE_SELECTOR) === null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      if (document.documentElement.dataset.glassRender !== "shader" || document.documentElement.dataset.glassCursor === "off" || !isInsideGlassTarget(event)) {
        hoveringGlass = false;
        mouse.targetStrength = 0;
        return;
      }

      hoveringGlass = true;
      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      mouse.targetStrength = 1;
      activeUntil = Math.max(activeUntil, performance.now() + 1000);
      scheduleRender();
    };

    const handlePointerLeave = () => {
      hoveringGlass = false;
      mouse.targetStrength = 0;
      activeUntil = Math.max(activeUntil, performance.now() + 200);
      scheduleRender();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      if (document.documentElement.dataset.glassRender !== "shader" || document.documentElement.dataset.glassRipple === "off" || !isInsideGlassTarget(event)) {
        return;
      }

      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      hoveringGlass = true;
      mouse.targetStrength = 1;
      addRipple(event.clientX, event.clientY, 1.15);
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        markResize();
      }
    };

    const scrollOptions: AddEventListenerOptions = { passive: true, capture: true };
    const resizeOptions: AddEventListenerOptions = { passive: true };
    const mutationObserver = new MutationObserver(() => markActive(350));
    const resizeObserver = new ResizeObserver(() => markResize());

    window.addEventListener("scroll", handleScroll, scrollOptions);
    window.addEventListener("resize", handleResize, resizeOptions);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    // Only observe root theme attributes, NOT entire DOM tree childNodes
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-glass-render", "data-glass-fluid", "data-glass-cursor", "data-glass-ripple", "data-glass-color"],
      childList: false,
      subtree: false,
    });
    resizeObserver.observe(document.body);

    scheduleRender();

    return () => {
      window.cancelAnimationFrame(frame);
      isRunning = false;
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
  }, [isTouch]);

  if (isTouch) {
    return null;
  }

  return (
    <>
      <canvas ref={canvasRef} className="liquid-glass-shader-layer" aria-hidden="true" />
      <div className="liquid-glass-sunlight" aria-hidden="true" />
    </>
  );
}
