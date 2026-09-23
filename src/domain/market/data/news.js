import { CYCLE_PHASES } from './cycle.js';
import { SECTORS } from './instruments.js';

/**
 * 경제 뉴스 24장(설계서 §3.3). **모든 문구는 창작이며 실제 기사·기업과 무관하다.**
 *
 * 국면별 6장씩 나뉘어 있고 `NewsDeck`이 국면의 덱에서만 뽑는다 — 그래서 뉴스는 독립 난수가 아니라
 * **국면의 함수**다. 각 카드는 "왜 그런지"를 한 줄로 설명한다(이 게임의 교육 목적).
 *
 * 효과는 bp 단위이며 `target`으로 겨누는 대상이 달라진다:
 * - `SECTOR`: 그 섹터 종목만
 * - `ALL`: 전 종목
 * - `RATE`: 기준금리(예금 이자율). **뉴스만이 금리를 움직인다**(단일 출처)
 */

/** 효과가 겨누는 대상. */
export const NEWS_EFFECT_TARGETS = Object.freeze({
  SECTOR: 'SECTOR',
  ALL: 'ALL',
  RATE: 'RATE',
});

const sector = (name, bp) =>
  Object.freeze({ target: NEWS_EFFECT_TARGETS.SECTOR, sector: name, bp });
const all = (bp) => Object.freeze({ target: NEWS_EFFECT_TARGETS.ALL, bp });
const rate = (bp) => Object.freeze({ target: NEWS_EFFECT_TARGETS.RATE, bp });

const card = (id, phase, headline, explanation, effects) =>
  Object.freeze({ id, phase, headline, explanation, effects: Object.freeze(effects) });

/** 24장 전체(국면 순서 → 카드 순서). */
export const NEWS_CARDS = Object.freeze([
  // ── 호황 EXPANSION ──────────────────────────────────────────────────────
  card('NE1', CYCLE_PHASES.EXPANSION, '국제선 좌석이 모자란다', '여행 수요가 늘어난 좌석 공급을 앞질렀습니다.', [
    sector(SECTORS.AIRLINE, 600),
    sector(SECTORS.HOTEL, 400),
  ]),
  card('NE2', CYCLE_PHASES.EXPANSION, '신도시 착공식이 줄줄이', '예산 집행이 빨라지자 삽부터 들어갑니다.', [
    sector(SECTORS.CONSTRUCTION, 700),
    sector(SECTORS.ENERGY, 200),
  ]),
  card('NE3', CYCLE_PHASES.EXPANSION, '연휴 특수, 객실 만실', '쉬는 날이 길어지면 숙박이 먼저 찹니다.', [
    sector(SECTORS.HOTEL, 600),
    sector(SECTORS.ENTERTAINMENT, 300),
  ]),
  card('NE4', CYCLE_PHASES.EXPANSION, '전력 수요 최고치 경신', '공장이 많이 돌면 전기도 더 씁니다.', [
    sector(SECTORS.ENERGY, 500),
    sector(SECTORS.CONSTRUCTION, 100),
  ]),
  card('NE5', CYCLE_PHASES.EXPANSION, '경기가 좋으면 금리도 오른다', '중앙은행이 과열을 미리 식히려 금리를 올렸습니다.', [
    rate(25),
    sector(SECTORS.CONSTRUCTION, -200),
    sector(SECTORS.AIRLINE, -100),
  ]),
  card('NE6', CYCLE_PHASES.EXPANSION, '관광 박람회 대성황', '예약 결제액이 사상 최대를 찍었습니다.', [
    sector(SECTORS.HOTEL, 500),
    sector(SECTORS.AIRLINE, 300),
    sector(SECTORS.ENTERTAINMENT, 200),
  ]),

  // ── 과열 OVERHEAT ───────────────────────────────────────────────────────
  card('NO1', CYCLE_PHASES.OVERHEAT, '빈 땅에도 웃돈이 붙는다', '실수요보다 기대가 먼저 뛰면 값이 부풀어 오릅니다.', [
    sector(SECTORS.CONSTRUCTION, 1_200),
    sector(SECTORS.ENERGY, 200),
  ]),
  card('NO2', CYCLE_PHASES.OVERHEAT, '금리 인상, 이번엔 폭이 크다', '물가를 잡으려면 돈값을 비싸게 만들어야 합니다.', [
    rate(50),
    sector(SECTORS.CONSTRUCTION, -600),
    sector(SECTORS.HOTEL, -400),
  ]),
  card('NO3', CYCLE_PHASES.OVERHEAT, '카지노 매출 사상 최대', '씀씀이가 커지면 오락 매출이 가장 먼저 뜁니다.', [
    sector(SECTORS.ENTERTAINMENT, 1_500),
  ]),
  card('NO4', CYCLE_PHASES.OVERHEAT, '연료비 급등에 항공사 비명', '기름값은 항공사에겐 원가, 에너지회사엔 매출입니다.', [
    sector(SECTORS.AIRLINE, -800),
    sector(SECTORS.ENERGY, 900),
  ]),
  card('NO5', CYCLE_PHASES.OVERHEAT, '분양 경쟁률 세 자릿수', '"오늘 안 사면 못 산다"는 마음이 값을 밉니다.', [
    sector(SECTORS.CONSTRUCTION, 1_000),
    sector(SECTORS.HOTEL, 300),
  ]),
  card('NO6', CYCLE_PHASES.OVERHEAT, '거품 경고 보고서 공개', '감독당국이 공개 경고를 내자 모두가 몸을 사립니다.', [
    all(-300),
    rate(25),
  ]),

  // ── 침체 RECESSION ──────────────────────────────────────────────────────
  card('NR1', CYCLE_PHASES.RECESSION, '여행 예약 취소 급증', '지갑이 닫히면 가장 먼저 줄이는 지출이 여행입니다.', [
    sector(SECTORS.AIRLINE, -1_000),
    sector(SECTORS.HOTEL, -800),
  ]),
  card('NR2', CYCLE_PHASES.RECESSION, '공사 중단 현장이 늘어난다', '자금이 마르면 삽부터 멈춥니다.', [
    sector(SECTORS.CONSTRUCTION, -1_200),
  ]),
  card('NR3', CYCLE_PHASES.RECESSION, '금리 인하, 급한 불 끄기', '돈값을 낮춰 경기를 떠받치려는 조치입니다.', [
    rate(-50),
    sector(SECTORS.CONSTRUCTION, 400),
    sector(SECTORS.HOTEL, 200),
  ]),
  card('NR4', CYCLE_PHASES.RECESSION, '전기 사용량 감소', '공장이 덜 돌면 전력 수요도 함께 줍니다.', [
    sector(SECTORS.ENERGY, -600),
  ]),
  card('NR5', CYCLE_PHASES.RECESSION, '지갑 닫힌 주말', '오락비는 가장 먼저 줄고 가장 늦게 돌아옵니다.', [
    sector(SECTORS.ENTERTAINMENT, -1_400),
    sector(SECTORS.HOTEL, -400),
  ]),
  card('NR6', CYCLE_PHASES.RECESSION, '구조조정 발표 잇따라', '기업이 비용을 깎으면 주가는 잠시 더 흔들립니다.', [
    all(-500),
    rate(-25),
  ]),

  // ── 회복 RECOVERY ───────────────────────────────────────────────────────
  card('NV1', CYCLE_PHASES.RECOVERY, '예약률이 바닥을 지났다', '취소보다 신규 예약이 많아진 첫 달입니다.', [
    sector(SECTORS.AIRLINE, 500),
    sector(SECTORS.HOTEL, 400),
  ]),
  card('NV2', CYCLE_PHASES.RECOVERY, '멈췄던 공사가 재개된다', '금리가 낮아지자 자금이 다시 돌기 시작했습니다.', [
    sector(SECTORS.CONSTRUCTION, 600),
  ]),
  card('NV3', CYCLE_PHASES.RECOVERY, '저금리, 돈이 위험자산으로', '예금 이자가 낮으면 돈은 다른 곳을 찾습니다.', [
    rate(-25),
    all(200),
  ]),
  card('NV4', CYCLE_PHASES.RECOVERY, '연료값 안정세', '원가 부담이 줄면 항공사 이익이 먼저 돌아옵니다.', [
    sector(SECTORS.AIRLINE, 600),
    sector(SECTORS.ENERGY, -300),
  ]),
  card('NV5', CYCLE_PHASES.RECOVERY, '주말 나들이 재개', '사람들이 다시 밖으로 나오기 시작했습니다.', [
    sector(SECTORS.ENTERTAINMENT, 700),
    sector(SECTORS.HOTEL, 300),
  ]),
  card('NV6', CYCLE_PHASES.RECOVERY, '금리 동결, 지켜보기', '회복이 확실해질 때까지 기다리기로 했습니다.', [all(0)]),
]);

const CARDS_BY_ID = new Map(NEWS_CARDS.map((entry) => [entry.id, entry]));

const CARDS_BY_PHASE = Object.freeze(
  Object.fromEntries(
    Object.values(CYCLE_PHASES).map((phase) => [
      phase,
      Object.freeze(NEWS_CARDS.filter((entry) => entry.phase === phase)),
    ]),
  ),
);

/** 그 국면의 뉴스 덱(6장). */
export function newsCardsOfPhase(phase) {
  return CARDS_BY_PHASE[phase] ?? [];
}

/** 뉴스 카드를 id로 찾는다(없으면 null — 손상 스냅샷 방어). */
export function newsCardById(id) {
  return CARDS_BY_ID.get(id) ?? null;
}
