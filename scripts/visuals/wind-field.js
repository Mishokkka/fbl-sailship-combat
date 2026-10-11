import { normalizeAngle, normalizeHeading } from "../board/board-geometry.js";
import { HEADING_LABELS, WIND_STRENGTH_LABELS } from "../utils/constants.js";

/** Uniform camera-space scale preserves world directions at every aspect ratio. */
export function windCameraTransform(camera) {
  const width = Math.max(1, Number(camera.viewWidth)), height = Math.max(1, Number(camera.viewHeight));
  return "translate(" + (Number(camera.x ?? 0) + width / 2) + " " +
    (Number(camera.y ?? 0) + height / 2) + ") scale(" + Math.max(width, height) / 1000 + ")";
}
/** SVG 'meet' can expose extra world space outside its nominal viewBox. */
export function visibleWindCamera(camera, viewport) {
  if (!(viewport?.width > 0 && viewport?.height > 0)) return camera;
  const scale = Math.min(viewport.width / camera.viewWidth, viewport.height / camera.viewHeight);
  const viewWidth = viewport.width / scale, viewHeight = viewport.height / scale;
  return { ...camera, x: camera.x + (camera.viewWidth - viewWidth) / 2,
    y: camera.y + (camera.viewHeight - viewHeight) / 2, viewWidth, viewHeight };
}
export function syncWindCamera(svg, camera) {
  const node = svg?.querySelector?.(".ssc-wind-camera");
  if (!node) return;
  const view = camera ?? (svg.viewBox?.baseVal && {
    x: svg.viewBox.baseVal.x, y: svg.viewBox.baseVal.y,
    viewWidth: svg.viewBox.baseVal.width, viewHeight: svg.viewBox.baseVal.height
  });
  if (!(view?.viewWidth > 0 && view?.viewHeight > 0)) return;
  const visible = visibleWindCamera(view, svg.getBoundingClientRect?.());
  node.setAttribute("transform", windCameraTransform(visible));
  const aspect = (visible.viewWidth / visible.viewHeight).toFixed(6);
  if (node.dataset.windAspect === aspect || !node.dataset.windStrength) return;
  node.dataset.windAspect = aspect;
  // Resize only: retarget the existing bounded strokes, never rebuild on pan/zoom.
  const lines = node.querySelectorAll("line");
  const field = describeWindField({ direction: node.dataset.windDirection, strength: node.dataset.windStrength }, visible, { enabled: lines.length > 0 });
  lines.forEach((line, i) => {
    const particle = field.windParticles[i];
    if (!particle) return;
    for (const [key, value] of Object.entries({ x1: particle.x1, x2: particle.x2, y1: particle.y, y2: particle.y })) line.setAttribute(key, value);
    const animation = line.querySelector("animateTransform");
    animation?.setAttribute("to", field.windParticleTravel + " 0");
    animation?.setAttribute("dur", particle.duration + "s");
    animation?.setAttribute("begin", particle.delay + "s");
  });
}
export function describeWindField(wind, camera, { enabled = true } = {}) {
  const direction = normalizeHeading(wind?.direction);
  const rating = ({ calm: 0, light: 1, moderate: 2, strong: 3, storm: 4 })[wind?.strength] ?? 2;
  const angle = normalizeAngle(direction - 90), rad = angle * Math.PI / 180;
  const scale = Math.max(camera.viewWidth, camera.viewHeight) / 1000;
  const width = camera.viewWidth / scale, height = camera.viewHeight / scale;
  const along = Math.abs(Math.cos(rad)) * width + Math.abs(Math.sin(rad)) * height;
  const across = Math.abs(Math.sin(rad)) * width + Math.abs(Math.cos(rad)) * height;
  const count = enabled ? [0, 10, 12, 14, 16][rating] : 0;
  const travel = along + 64;
  const duration = Number(([0, 18, 14, 10, 7][rating] * travel / 1000).toFixed(3));
  const particles = Array.from({ length: count }, (_, i) => ({
    x1: -along / 2 - 32, x2: -along / 2 - 10 - (i % 3) * 4,
    y: ((i + .5) / count - .5) * across,
    duration, delay: Number((-((i * .61803398875) % 1) * duration).toFixed(3)),
    width: 1 + (i % 2) * .25
  }));
  const from = HEADING_LABELS[(direction + 180) % 360], to = HEADING_LABELS[direction];
  return {
    windParticles: particles, windParticleAngle: angle, windParticleTravel: travel,
    windParticleOpacity: [0, .22, .27, .32, .38][rating],
    windCameraTransform: windCameraTransform(camera),
    windInfo: { calm: rating === 0, from, to,
      flow: rating === 0 ? "Штиль" : from + " → " + to,
      strength: WIND_STRENGTH_LABELS[wind?.strength] ?? "умеренный",
      title: rating === 0 ? "Штиль: ветрового потока нет." : "Дует из " + from + " в " + to + ". Стрелка показывает, куда несёт ветер." }
  };
}
