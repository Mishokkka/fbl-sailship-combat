import { normalizeAngle, normalizeHeading } from "../board/board-geometry.js";
import { HEADING_LABELS, WIND_STRENGTH_LABELS } from "../utils/constants.js";

/** Uniform camera-space scale preserves world directions at every aspect ratio. */
export function windCameraTransform(camera) {
  const width = Math.max(1, Number(camera.viewWidth)), height = Math.max(1, Number(camera.viewHeight));
  return "translate(" + (Number(camera.x ?? 0) + width / 2) + " " +
    (Number(camera.y ?? 0) + height / 2) + ") scale(" + Math.max(width, height) / 1000 + ")";
}
export function syncWindCamera(svg, camera) {
  svg?.querySelector?.(".ssc-wind-camera")?.setAttribute("transform", windCameraTransform(camera));
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
