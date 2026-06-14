import { useEffect, useRef } from "react";

const MAX_RECTS = 32;
const MAX_RIPPLES = 6;
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
  float e = max(0.72 * u_pixelRatio, 0.72);
  vec2 dx = vec2(e, 0.0);
  vec2 dy = vec2(0.0, e);
  return normalize(vec2(
    roundedBoxSdf(p + dx, b, r) - roundedBoxSdf(p - dx, b, r),
    roundedBoxSdf(p + dy, b, r) - roundedBoxSdf(p - dy, b, r)
  ) + vec2(0.0001));
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
    float maxReach = 260.0 * u_pixelRatio;
    float distanceGate = 1.0 - smoothstep(maxReach - 24.0 * u_pixelRatio, maxReach, dist);
    if (distanceGate <= 0.001) {
      continue;
    }

    vec2 dir = delta / max(dist, 1.0);
    float radius = age * 470.0 * u_pixelRatio;
    float band = 15.0 * u_pixelRatio;
    float ring = 1.0 - smoothstep(0.0, band, abs(dist - radius));
    float inner = 1.0 - smoothstep(0.0, band * 1.7, abs(dist - radius + band * 1.1));
    float outer = 1.0 - smoothstep(0.0, band * 1.9, abs(dist - radius - band * 1.2));
    float shoulder = exp(-abs(dist - radius) * 0.02 / u_pixelRatio);
    float fade = pow(1.0 - age / 1.45, 1.9) * ripple.w;
    float pressLife = 1.0 - smoothstep(0.0, 0.62, age);
    float pressRadius = (58.0 + age * 64.0) * u_pixelRatio;
    float pressBowl = exp(-(dist * dist) / max(pressRadius * pressRadius, 1.0)) * pressLife * ripple.w;
    float pressRim = exp(-abs(dist - pressRadius * 0.88) / max(12.0 * u_pixelRatio, 1.0)) * pressLife * ripple.w;
    float rebound = sin(clamp(age / 0.62, 0.0, 1.0) * 3.1415926536) * pressLife;
    float wave = (ring * 1.72 + outer * 0.52 - inner * 0.62 - shoulder * 0.12) * fade * distanceGate;
    float press = (pressBowl * 0.78 - pressRim * 0.16) * distanceGate;

    offset += dir * wave * 0.024 - dir * press * (0.026 + rebound * 0.018) + dir * pressRim * rebound * 0.009;
    strength += wave * 1.12 + pressBowl * (0.56 + rebound * 0.32) + pressRim * 0.18;
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
    if (age < 0.0 || age > 1.18) {
      continue;
    }

    float dist = length(frag - ripple.xy);
    float progress = clamp(age / 1.18, 0.0, 1.0);
    float maxGlowReach = 228.0 * u_pixelRatio;
    float reachGate = 1.0 - smoothstep(maxGlowReach - 22.0 * u_pixelRatio, maxGlowReach, dist);
    float radius = progress * maxGlowReach;
    float band = mix(14.0, 3.5, progress) * u_pixelRatio;
    float ring = 1.0 - smoothstep(0.0, band, abs(dist - radius));
    float innerRing = 1.0 - smoothstep(0.0, band * 1.24, abs(dist - radius + band * 0.92));
    float outerHalo = 1.0 - smoothstep(0.0, band * 1.36, abs(dist - radius - band * 0.7));
    float pressFlash = exp(-(dist * dist) / max(pow((42.0 + age * 20.0) * u_pixelRatio, 2.0), 1.0)) * (1.0 - smoothstep(0.0, 0.28, age));
    float fade = pow(1.0 - progress, 1.22) * ripple.w * reachGate;

    glow += (ring * 1.48 + innerRing * 0.26 + outerHalo * 0.1 + pressFlash * 0.5) * fade;
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

float roundedRectPathCoord(vec2 p, vec2 b, float r) {
  float safeRadius = min(r, min(b.x, b.y) - 0.001);
  vec2 straight = max(b - vec2(safeRadius), vec2(0.001));
  float topLen = straight.x * 2.0;
  float sideLen = straight.y * 2.0;
  float quarter = safeRadius * 1.5707963268;
  float pathLen = topLen * 2.0 + sideLen * 2.0 + quarter * 4.0;

  if (p.x >= straight.x && p.y >= straight.y) {
    vec2 d = normalize(p - vec2(straight.x, straight.y) + vec2(0.0001));
    float angle = atan(d.y, d.x);
    return mod(quarter + topLen + (1.5707963268 - angle) * safeRadius, pathLen);
  }

  if (p.x >= straight.x && p.y <= -straight.y) {
    vec2 d = normalize(p - vec2(straight.x, -straight.y) + vec2(0.0001));
    float angle = atan(d.y, d.x);
    return mod(quarter * 2.0 + topLen + sideLen + (0.0 - angle) * safeRadius, pathLen);
  }

  if (p.x <= -straight.x && p.y <= -straight.y) {
    vec2 d = normalize(p - vec2(-straight.x, -straight.y) + vec2(0.0001));
    float angle = atan(d.y, d.x);
    return mod(quarter * 3.0 + topLen * 2.0 + sideLen + (-1.5707963268 - angle) * safeRadius, pathLen);
  }

  if (p.x <= -straight.x && p.y >= straight.y) {
    vec2 d = normalize(p - vec2(-straight.x, straight.y) + vec2(0.0001));
    float angle = atan(d.y, d.x);
    return mod(quarter * 4.0 + topLen * 2.0 + sideLen * 2.0 + (3.1415926536 - angle) * safeRadius, pathLen);
  }

  if (p.y >= straight.y) {
    return mod(quarter + p.x + straight.x, pathLen);
  }

  if (p.x >= straight.x) {
    return mod(quarter * 2.0 + topLen + straight.y - p.y, pathLen);
  }

  if (p.y <= -straight.y) {
    return mod(quarter * 3.0 + topLen + sideLen + straight.x - p.x, pathLen);
  }

  return mod(quarter * 4.0 + topLen * 2.0 + sideLen + p.y + straight.y, pathLen);
}

void main() {
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
    float glassWidth = mix(5.0, 24.0, largeSurface) * u_pixelRatio;

    vec2 looseBounds = abs(local) - rect.zw * 0.5 - vec2(glassWidth + 6.0 * u_pixelRatio);
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
    float outerPinch = exp(-abs(rimDist - tubeHalf * 0.72) / max(1.8 * u_pixelRatio, 0.001)) * tubeMask;
    float innerPinch = exp(-abs(rimDist + tubeHalf * 0.72) / max(2.0 * u_pixelRatio, 0.001)) * tubeMask * insideMask;
    float outerShoulder = exp(-abs(rimDist - tubeHalf * 0.42) / max(4.2 * u_pixelRatio, 0.001)) * tubeMask;
    float innerShoulder = exp(-abs(rimDist + tubeHalf * 0.44) / max(4.6 * u_pixelRatio, 0.001)) * tubeMask * insideMask;
    float centerCaustic = exp(-abs(rimDist) / max(3.8 * u_pixelRatio, 0.001)) * tubeFace;
    float opticalThickness = clamp(tubeFace * 0.98 + tubeWall * 0.72 + outerPinch * 0.48 + innerPinch * 0.4, 0.0, 1.0);
    float cornerEnergy = pow(clamp(abs(boundaryNormal.x * boundaryNormal.y) * 2.0, 0.0, 1.0), 0.58) * tubeMask;
    float straightEnergy = pow(clamp(1.0 - abs(boundaryNormal.x * boundaryNormal.y) * 1.85, 0.0, 1.0), 1.25) * tubeMask;

    float interiorDepth = smoothstep(tubeHalf * 1.1, tubeHalf * 3.2, -dist) * insideMask;
    vec3 localRipple = vec3(ripple.xy, ripple.z) * interiorDepth;
    vec2 boxHalf = rect.zw * 0.5;
    vec2 halfSize = max(boxHalf, vec2(1.0));
    vec2 q = local / halfSize;
    float qLen = clamp(length(q), 0.0, 1.35);
    float paneLens = pow(clamp(1.0 - qLen * qLen * 0.76, 0.0, 1.0), 0.74) * paneMask * 0.22;
    float pathCoord = roundedRectPathCoord(local, boxHalf, radius);

    vec2 localUv = vec2(pathCoord * 0.0054 + u_time * 0.034, tubeSigned * 1.2 - u_time * 0.018);
    float liquidA = fbm(localUv + vec2(2.1, -1.3));
    float liquidB = fbm(localUv * 1.42 + vec2(8.1, -4.7));
    float liquidC = fbm(localUv * 0.72 + vec2(-u_time * 0.012, u_time * 0.016));
    float highlightNoise = liquidA * 0.52 + liquidB * 0.32 + liquidC * 0.16;
    float tangentCoord = pathCoord;
    float flowPhase = tangentCoord * 0.038 + u_time * 1.42 + highlightNoise * 6.2;
    float counterFlowPhase = tangentCoord * 0.069 - u_time * 1.05 + tubeSigned * 1.15 + liquidB * 1.4;
    float flowCarrier = pow(clamp(0.5 + 0.5 * sin(flowPhase), 0.0, 1.0), 8.5);
    float counterCarrier = pow(clamp(0.5 + 0.5 * sin(counterFlowPhase + sin(flowPhase * 0.37) * 1.4), 0.0, 1.0), 11.0);
    float movingThreadCenter = sin(flowPhase * 0.41 + counterFlowPhase * 0.18) * 0.38;
    float flowThread = exp(-abs(tubeSigned - movingThreadCenter) / 0.15) * flowCarrier * tubeFace * u_effects.z;
    float fineThread = exp(-abs(tubeSigned + movingThreadCenter * 0.72) / 0.064) * counterCarrier * tubeMask * u_effects.z;
    float liquidThread = exp(-abs(tubeSigned - sin(flowPhase * 0.21 - u_time * 0.46) * 0.62) / 0.22) * pow(highlightNoise, 1.65) * tubeFace * u_effects.z;
    float flowCaustic = (flowThread * 1.65 + fineThread * 1.05 + liquidThread * 0.86) * (0.5 + cornerEnergy * 1.35 + straightEnergy * 0.46);
    float shadowPhase = tangentCoord * 0.028 - u_time * 1.18 + highlightNoise * 5.1;
    float slowShadowPhase = tangentCoord * 0.014 + u_time * 0.54 + liquidB * 4.6;
    float shadowWave =
      pow(clamp(0.5 + 0.5 * sin(shadowPhase), 0.0, 1.0), 2.6) * 0.62 +
      pow(clamp(0.5 + 0.5 * cos(slowShadowPhase), 0.0, 1.0), 3.8) * 0.38;
    float shadowValley = pow(clamp(1.0 - shadowWave, 0.0, 1.0), 2.1) * tubeMask;
    float shadowCrest = pow(clamp(shadowWave, 0.0, 1.0), 2.35) * tubeFace;
    float edgePulse = (shadowCrest * 0.72 - shadowValley * 0.42) * u_effects.z;
    float cylinderSlope = tubeSigned / max(tubeSection, 0.18);
    vec2 opticalNormal = normalize(
      boundaryNormal * (cylinderSlope * (1.25 + edgePulse * 0.24) + tubeSigned * 0.5) +
      tangentNormal * ((highlightNoise - 0.5) * 0.62 + (flowThread - fineThread + liquidThread) * 1.15)
    );
    vec2 flowWarp = vec2(0.0);
    vec2 flowUv = frag / max(u_resolution, vec2(1.0));
    for (float wave = 1.0; wave < 5.0; wave += 1.0) {
      flowWarp += vec2(
        sin((flowUv.x + flowUv.y) * 5.2 * wave + u_time * (0.18 + wave * 0.035)),
        cos((flowUv.x - flowUv.y) * 4.8 * wave - u_time * (0.16 + wave * 0.028))
      ) / wave;
    }
    flowWarp *= (tubeMask * 0.9 + paneMask * 0.004) * u_effects.z;

    vec2 mouseDelta = frag - u_mouse;
    float mouseDist = length(mouseDelta);
    vec2 mouseDir = mouseDelta / max(mouseDist, 1.0);
    float pressureRadius = mix(84.0, 230.0, largeSurface) * u_pixelRatio;
    float hoverPressure = exp(-(mouseDist * mouseDist) / max(pressureRadius * pressureRadius, 1.0)) * u_mouseStrength * u_effects.x * insideMask;
    float pressureT = clamp(mouseDist / max(pressureRadius, 1.0), 0.0, 1.0);
    float pressureLip = smoothstep(0.12, 0.42, pressureT) * (1.0 - smoothstep(0.54, 1.0, pressureT)) * hoverPressure;
    float pressureBowl = exp(-pressureT * pressureT * 4.2) * hoverPressure;
    float pressureRefract = clamp(pressureLip * 0.62 + pressureBowl * 0.22, 0.0, 1.0);

    float lightSide = clamp(dot(boundaryNormal, normalize(vec2(-0.62, 0.78))) * 0.5 + 0.5, 0.0, 1.0);
    float keyLight = pow(lightSide, 1.32);
    float sideShade = pow(1.0 - keyLight, 1.28) * opticalThickness;
    float topRun = exp(-abs(boundaryNormal.y - 1.0) / 0.22) * tubeMask;
    float backRun = (
      exp(-abs(boundaryNormal.x - 1.0) / 0.32) +
      exp(-abs(boundaryNormal.y + 1.0) / 0.32)
    ) * tubeMask;
    float brokenBackRun = backRun * pow(highlightNoise, 2.8) * 0.12;
    float keyRun = clamp(topRun * 0.96 + cornerEnergy * 0.34 + shadowCrest * 0.18, 0.0, 1.0);
    float pathSweep = pow(clamp(0.5 + 0.5 * sin(tangentCoord * 0.034 - u_time * 1.26 + liquidA * 5.6), 0.0, 1.0), 8.0) * tubeFace;
    float innerGlowRail = pathSweep * (0.32 + shadowCrest * 0.4 + topRun * 0.18);
    float grazingSheet = clamp(pathSweep * 0.74 + innerGlowRail * 0.32 + flowCaustic * 0.22, 0.0, 1.0) * (0.3 + keyLight * 0.46);
    float cornerBloom = cornerEnergy * pow(clamp(outerLip + innerLip + outerShoulder + centerCaustic * 0.85, 0.0, 1.0), 0.52) * (0.26 + keyLight * 0.56);
    float lensRim = opticalThickness * (0.38 + flowCaustic * 0.32 + centerCaustic * 0.2);
    float specBreak = clamp(0.16 + flowCarrier * 0.34 + counterCarrier * 0.18 + pow(highlightNoise, 1.8) * 0.24 + cornerEnergy * 0.16, 0.0, 1.0);
    float outerSpec = outerLip * (0.018 + (keyLight * 1.7 + keyRun * 0.74) * specBreak);
    float outerBroadSpec = (outerShoulder + outerPinch * 0.92) * (0.012 + (keyLight * 0.58 + keyRun * 0.28) * specBreak);
    float innerSpec = innerLip * (0.012 + (keyLight * 0.72 + keyRun * 0.28) * specBreak);
    float innerBroadSpec = (innerShoulder + innerPinch * 0.86) * (0.008 + (keyLight * 0.22 + keyRun * 0.12) * specBreak);
    float rollingSpec = flowCaustic * (0.08 + keyLight * 0.28 + keyRun * 0.22 + cornerEnergy * 0.18);
    float straightSpec = straightEnergy * tubeFace * (0.016 + keyLight * 0.24 + keyRun * 0.16);
    float cornerSpec = cornerEnergy * (outerLip * 0.68 + outerShoulder * 0.36 + centerCaustic * 0.3 + innerLip * 0.32) * (0.08 + keyLight * 0.62 + keyRun * 0.26);
    float faceSheen = tubeFace * (0.008 + keyLight * 0.16 + keyRun * 0.1);
    float movingUmbra = shadowValley * (0.028 + brokenBackRun * 0.04 + cornerEnergy * 0.036 + straightEnergy * 0.012) * opticalThickness;
    float movingCrest = shadowCrest * (0.2 + keyRun * 0.3 + cornerEnergy * 0.2) * opticalThickness;
    float darkEdge = movingUmbra * 0.08 + (outerPinch + innerPinch) * shadowValley * 0.002;

    vec2 rippleDir = normalize(localRipple.xy + vec2(0.0001));
    float rippleSurface = localRipple.z * interiorDepth;
    float refractionPixels =
      tubeFace * (36.0 + largeSurface * 86.0) +
      tubeWall * (26.0 + largeSurface * 62.0) +
      flowCaustic * (16.0 + largeSurface * 34.0) +
      outerPinch * (13.0 + largeSurface * 26.0) +
      innerPinch * (9.0 + largeSurface * 18.0);
    vec2 refractOffset =
      -opticalNormal * (refractionPixels / u_resolution) +
      boundaryNormal * (tubeSigned * (12.0 + largeSurface * 28.0) * tubeMask / u_resolution) +
      tangentNormal * ((highlightNoise - 0.5) * opticalThickness * (1.6 + largeSurface * 3.4) / u_resolution) +
      tangentNormal * ((flowThread - fineThread + liquidThread * 0.6) * (6.0 + largeSurface * 13.0) / u_resolution) +
      boundaryNormal * ((movingCrest - movingUmbra) * (5.0 + largeSurface * 10.0) / u_resolution) +
      flowWarp * (0.00055 + largeSurface * 0.00105) +
      -mouseDir * pressureRefract * (4.8 + largeSurface * 8.5) / u_resolution +
      mouseDir * pressureLip * (0.8 + largeSurface * 1.6) / u_resolution +
      rippleDir * rippleSurface * (0.012 + largeSurface * 0.014) +
      q * paneLens * (0.00004 + largeSurface * 0.00008);

    vec2 uv = clamp(v_uv + refractOffset, vec2(0.002), vec2(0.998));
    vec3 base = sampleWallpaper(v_uv);
    float baseLuma = dot(base, vec3(0.299, 0.587, 0.114));
    float colorDensity = smoothstep(0.04, 0.36, length(base - vec3(baseLuma)));
    float shadowWarmth = pow(clamp(1.0 - baseLuma, 0.0, 1.0), 1.55);
    float midtoneWarmth = smoothstep(0.82, 0.28, baseLuma);
    float sunlightWarmth = clamp(0.012 + shadowWarmth * 0.86 + midtoneWarmth * colorDensity * 0.34, 0.012, 0.95);
    vec3 adaptiveLight = mix(vec3(1.0, 0.998, 0.99), vec3(1.0, 0.7, 0.2), sunlightWarmth);
    float chroma = (outerSpec + rollingSpec + cornerSpec) * 0.00036 + outerLip * 0.00008;
    float softness = 0.00016 + opticalThickness * 0.00034 + pressureLip * 0.00068 + rippleSurface * 0.00028;
    vec2 interactionNormal = normalize(opticalNormal + mouseDir * pressureRefract * 0.36 + rippleDir * rippleSurface * 0.1);
    vec3 refracted = samplePrism(uv, -interactionNormal, chroma + flowCaustic * 0.00022 + pressureRefract * tubeFace * 0.00018 + rippleSurface * 0.00008, softness);
    vec3 refractedNear = samplePrism(
      clamp(v_uv - opticalNormal * ((outerLip - innerLip) * 0.0018 + flowCaustic * 0.0012), vec2(0.002), vec2(0.998)),
      opticalNormal,
      chroma * 0.58,
      softness * 0.72
    );
    float bendAmount = clamp(tubeFace * 1.12 + tubeWall * 0.72 + centerCaustic * 0.42 + flowCaustic * 0.7 + paneLens * 0.004, 0.0, 0.98);
    vec3 backgroundBend = base + (refracted - base) * bendAmount * (1.36 + tubeFace * 0.62) + (refractedNear - base) * clamp(flowCaustic + centerCaustic * 0.22, 0.0, 0.54);

    float outerDispersion = outerSpec * (0.055 + keyLight * 0.085);
    float innerDispersion = innerSpec * 0.035;
    vec3 dispersion =
      vec3(1.0, 0.68, 0.3) * outerDispersion * 0.016 +
      vec3(0.34, 0.86, 1.0) * innerDispersion * 0.01;

    vec3 whiteSpec =
      vec3(1.0) * outerSpec * 0.92 +
      vec3(1.0) * outerBroadSpec * 0.52 +
      vec3(0.96, 1.0, 1.0) * innerSpec * 0.64 +
      vec3(0.9, 0.99, 1.0) * innerBroadSpec * 0.36 +
      vec3(1.0, 0.99, 0.94) * rollingSpec * 0.62 +
      vec3(1.0) * cornerSpec * 0.68 +
      vec3(1.0, 0.99, 0.92) * grazingSheet * 0.92 +
      vec3(1.0) * cornerBloom * 0.58 +
      vec3(0.95, 1.0, 1.0) * straightSpec * 0.72 +
      vec3(1.0) * faceSheen * 0.82 +
      vec3(1.0, 0.98, 0.9) * flowThread * 0.88 +
      vec3(0.82, 0.96, 1.0) * fineThread * 0.54 +
      vec3(1.0, 0.98, 0.86) * liquidThread * 0.48 +
      vec3(1.0, 0.98, 0.9) * movingCrest * 0.66;
    vec3 sideVolume =
      vec3(0.86, 1.0, 0.96) * lensRim * sideShade * 0.006 +
      vec3(0.74, 0.98, 0.95) * flowCaustic * opticalThickness * 0.01 +
      vec3(0.62, 0.86, 0.82) * darkEdge * 0.01;
    vec3 environmentGlint = vec3(0.86, 1.0, 0.96) * (flowCaustic + pathSweep * 0.28) * opticalThickness * 0.018;
    vec3 absorption = vec3(0.06, 0.09, 0.08) * (darkEdge * 0.045 + movingUmbra * 0.035);
    float pressureSun = exp(-pressureT * pressureT * 5.2) * hoverPressure;
    float adaptiveSunStrength = 1.0 + sunlightWarmth * 0.52;
    vec3 mouseLight =
      adaptiveLight * pressureSun * 0.064 * adaptiveSunStrength +
      mix(adaptiveLight, vec3(1.0), 0.24) * pressureLip * 0.06 * adaptiveSunStrength;
    float visibleRipple = max(max(localRipple.z, 0.0) * tubeFace, globalRippleGlow * insideMask * (0.5 + tubeFace * 0.86));
    vec3 rippleLight = mix(adaptiveLight, vec3(1.0), 0.02) * visibleRipple * (0.42 + sunlightWarmth * 0.2);
    vec3 glassComposite = max(vec3(0.0), backgroundBend + whiteSpec + sideVolume + dispersion + environmentGlint + mouseLight + rippleLight - absorption);
    float sourceAlpha = clamp(
      opticalThickness * 0.018 +
      paneLens * 0.00005 +
      tubeWall * 0.005 +
      lensRim * 0.018 +
      sideShade * 0.002 +
      outerSpec * 0.78 +
      outerBroadSpec * 0.46 +
      innerSpec * 0.58 +
      innerBroadSpec * 0.32 +
      rollingSpec * 0.42 +
      flowCaustic * 0.36 +
      movingUmbra * 0.035 +
      movingCrest * 0.18 +
      cornerSpec * 0.22 +
      grazingSheet * 0.38 +
      cornerBloom * 0.18 +
      straightSpec * 0.18 +
      pressureSun * 0.012,
      0.0,
      0.92
    );
    sourceAlpha = clamp(sourceAlpha + globalRippleGlow * insideMask * 0.11, 0.0, 0.92);
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
      document.documentElement.style.setProperty("--glass-sun-x", `${mouse.x}px`);
      document.documentElement.style.setProperty("--glass-sun-y", `${mouse.y}px`);
      document.documentElement.style.setProperty("--glass-sun-strength", String(isLiquid && isShaderGlass && cursorEnabled ? Math.min(1, mouse.strength) : 0));
      if (!hoveringGlass || !cursorEnabled || !isShaderGlass) {
        mouse.targetStrength *= 0.92;
      }

      if (isLiquid && isShaderGlass && rectsDirty) {
        refreshRects(dpr);
      } else if (!isLiquid || !isShaderGlass) {
        rectCount = 0;
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
        isShaderGlass && document.documentElement.dataset.glassCursor !== "off" ? 1 : 0,
        isShaderGlass && document.documentElement.dataset.glassRipple !== "off" ? 1 : 0,
        isShaderGlass && edgeDiffuseEnabled ? 1 : 0,
      );
      gl.uniform1i(rectCountLocation, rectCount);
      gl.uniform4fv(rectsLocation, rectData);
      gl.uniform1fv(radiiLocation, radiusData);
      gl.uniform1i(rippleCountLocation, rippleCount);
      gl.uniform4fv(ripplesLocation, rippleData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frame = window.requestAnimationFrame(render);
    };

    const handleScroll = () => markActive(220);
    const handleResize = () => markResize();
    const isInsideGlassTarget = (event: PointerEvent) => {
      const target = event.target;
      return target instanceof Element && target.closest(GLASS_TARGET_SELECTOR) !== null && target.closest(GLASS_SHADER_EXCLUDE_SELECTOR) === null;
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

  return (
    <>
      <canvas ref={canvasRef} className="liquid-glass-shader-layer" aria-hidden="true" />
      <div className="liquid-glass-sunlight" aria-hidden="true" />
    </>
  );
}
