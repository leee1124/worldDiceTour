/**
 * 스파크라인 경로 생성. 인라인 SVG로 그릴 좌표만 만든다(DOM 없음).
 *
 * 깨지기 쉬운 곳이 셋이다 — 여기서 한 번에 막는다:
 * - 값이 **하나뿐**이면 폭을 나눌 구간이 없다(0으로 나누기).
 * - 값이 **모두 같으면** 높이를 나눌 폭이 없다(0으로 나누기 → NaN 경로 → 렌더 실패).
 * - 서버 필드가 비었거나 숫자가 아니면 아예 그리지 않는다.
 */

const DEFAULT_BOX = Object.freeze({ width: 100, height: 32 });

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {number[]|null|undefined} series 오래된 값 → 최신 값
 * @param {{width?: number, height?: number, padY?: number}} [box]
 * @returns {{path: string, area: string, points: Array<{x: number, y: number}>, min: number, max: number, flat: boolean, empty: boolean, width: number, height: number, first: number, last: number}}
 */
export function sparklinePath(series, box = {}) {
  const width = Number.isFinite(box.width) && box.width > 0 ? box.width : DEFAULT_BOX.width;
  const height = Number.isFinite(box.height) && box.height > 0 ? box.height : DEFAULT_BOX.height;
  // 선 두께가 상자 밖으로 잘리지 않도록 위아래를 조금 비운다.
  const padY = Number.isFinite(box.padY) && box.padY >= 0 ? box.padY : Math.min(3, height / 8);

  const values = Array.isArray(series) ? series.filter((value) => Number.isFinite(value)) : [];
  const empty = values.length === 0 || (Array.isArray(series) && values.length !== series.length);
  if (values.length === 0 || empty) {
    return {
      path: '',
      area: '',
      points: [],
      min: 0,
      max: 0,
      flat: true,
      empty: true,
      width,
      height,
      first: 0,
      last: 0,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min || values.length === 1;

  const top = padY;
  const bottom = height - padY;
  const span = bottom - top;

  /** 값 하나거나 전부 같으면 가운데 높이의 수평선(좌우 끝을 모두 채운다). */
  const yOf = (value) => (flat ? round(height / 2) : round(bottom - ((value - min) / (max - min)) * span));

  const points =
    values.length === 1
      ? [
          { x: 0, y: yOf(values[0]) },
          { x: round(width), y: yOf(values[0]) },
        ]
      : values.map((value, index) => ({
          x: round((index / (values.length - 1)) * width),
          y: yOf(value),
        }));

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const area = `${path} L${round(width)} ${round(height)} L0 ${round(height)} Z`;

  return {
    path,
    area,
    points,
    min,
    max,
    flat,
    empty: false,
    width,
    height,
    first: values[0],
    last: values[values.length - 1],
  };
}

/** 금액을 한국어 천 단위로(도메인 모듈이라 format.js를 끌어오지 않는다). */
function won(value) {
  return Number(value).toLocaleString('ko-KR');
}

/**
 * 스파크라인의 `aria-label`. 그림을 못 보는 사람도 "어디서 어디로 갔는지"를 알 수 있어야 한다.
 * @param {{name: string, series?: number[]|null}} input
 */
export function sparklineLabel({ name, series }) {
  const label = typeof name === 'string' && name.length > 0 ? name : '종목';
  const values = Array.isArray(series) ? series.filter((value) => Number.isFinite(value)) : [];
  if (values.length === 0) {
    return `${label} 시세 추이 — 아직 기록이 없습니다`;
  }
  const first = values[0];
  const last = values[values.length - 1];
  const direction = last > first ? '올랐습니다' : last < first ? '내렸습니다' : '그대로입니다';
  return `${label} 최근 ${values.length}라운드 시세 — ${won(first)}원에서 ${won(last)}원으로 ${direction}`;
}
