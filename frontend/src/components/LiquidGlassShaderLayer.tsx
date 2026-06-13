import { useEffect, useRef } from "react";

const MAX_RECTS = 48;
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

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_imageResolution;
uniform float u_time;
uniform int u_rectCount;
uniform vec4 u_rects[MAX_RECTS];
uniform float u_radii[MAX_RECTS];
uniform vec3 u_tint;

varying vec2 v_uv;

float roundedBoxSdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
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

  for (int i = 0; i < MAX_RECTS; i++) {
    if (i >= u_rectCount) {
      break;
    }

    vec4 rect = u_rects[i];
    vec2 center = rect.xy + rect.zw * 0.5;
    vec2 local = frag - center;
    float radius = u_radii[i];
    float dist = roundedBoxSdf(local, rect.zw * 0.5, radius);
    float mask = 1.0 - smoothstep(0.0, 1.25, dist);

    if (mask <= 0.001) {
      continue;
    }

    float edge = 1.0 - smoothstep(-7.0, 1.0, dist);
    float rim = smoothstep(-18.0, 0.0, dist) * mask;
    vec2 n = normalize(local / max(rect.zw * 0.5, vec2(1.0)));
    float curve = 1.0 - smoothstep(0.0, 0.95, length(local / max(rect.zw * 0.5, vec2(1.0))));

    float waveA = sin((local.x + local.y) * 0.018 + u_time * 0.55);
    float waveB = cos(local.y * 0.026 - u_time * 0.42);
    vec2 flow = vec2(waveA, waveB) * 0.0022;
    vec2 refractOffset = n * (0.012 + rim * 0.018) + flow;

    vec2 uv = v_uv + refractOffset;
    float chroma = 0.0024 + rim * 0.0035;
    vec3 refracted;
    refracted.r = sampleWallpaper(uv + vec2(chroma, -chroma * 0.4)).r;
    refracted.g = sampleWallpaper(uv).g;
    refracted.b = sampleWallpaper(uv - vec2(chroma, -chroma * 0.4)).b;

    vec3 tint = mix(refracted, u_tint, 0.018);
    float topLight = smoothstep(0.85, -0.4, local.y / max(rect.w, 1.0)) * smoothstep(0.75, -0.4, local.x / max(rect.z, 1.0));
    float bottomShade = smoothstep(-0.2, 0.95, local.y / max(rect.w, 1.0)) * smoothstep(-0.3, 0.95, local.x / max(rect.z, 1.0));
    float spec = pow(max(dot(normalize(vec2(-0.55, -0.85)), -n), 0.0), 18.0);
    float caustic = sin(local.x * 0.045 + u_time * 0.7) * cos(local.y * 0.035 - u_time * 0.45) * 0.5 + 0.5;

    vec3 glass = tint;
    glass += vec3(0.34) * topLight * 0.12;
    glass += vec3(1.0) * spec * 0.34;
    glass += u_tint * caustic * curve * 0.035;
    glass -= vec3(0.14, 0.16, 0.18) * bottomShade * 0.08;
    glass += vec3(1.0) * rim * 0.3;
    glass += vec3(0.75, 0.88, 1.0) * edge * 0.18;

    float centerAlpha = curve * 0.045;
    float edgeAlpha = rim * 0.22 + edge * 0.12;
    float alpha = mask * (centerAlpha + edgeAlpha + spec * 0.12);
    finalColor = mix(finalColor, glass, alpha);
    finalAlpha = max(finalAlpha, alpha);
  }

  gl_FragColor = vec4(finalColor, clamp(finalAlpha, 0.0, 0.34));
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
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--glass-ambient-rgb").trim();
  const values = raw.split(/\s+/).map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    return [1, 1, 1] as const;
  }

  return [values[0] / 255, values[1] / 255, values[2] / 255] as const;
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
    const rectCountLocation = gl.getUniformLocation(program, "u_rectCount");
    const rectsLocation = gl.getUniformLocation(program, "u_rects[0]");
    const radiiLocation = gl.getUniformLocation(program, "u_radii[0]");
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
      loadTexture();

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(window.innerWidth * dpr));
      const height = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
      }

      const isLiquid = document.documentElement.dataset.theme === "liquid-glass";
      const rects = isLiquid ? collectRects() : [];
      const rectData = new Float32Array(MAX_RECTS * 4);
      const radiusData = new Float32Array(MAX_RECTS);

      rects.forEach((rect, index) => {
        rectData[index * 4] = rect.x * dpr;
        rectData[index * 4 + 1] = rect.y * dpr;
        rectData[index * 4 + 2] = rect.width * dpr;
        rectData[index * 4 + 3] = rect.height * dpr;
        radiusData[index] = rect.radius * dpr;
      });

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
      gl.uniform1i(rectCountLocation, rects.length);
      gl.uniform4fv(rectsLocation, rectData);
      gl.uniform1fv(radiiLocation, radiusData);
      gl.uniform3f(tintLocation, r, g, b);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      gl.deleteTexture(texture);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="liquid-glass-shader-layer" aria-hidden="true" />;
}
