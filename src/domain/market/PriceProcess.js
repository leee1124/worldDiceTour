/**
 * 가격 틱 규칙(설계서 §2.1). **정수 연산만 쓰는 순수 함수 묶음**이며 상품 종류를 모른다 —
 * 주식·코인·지수가 같은 함수를 쓰고 파라미터만 달라진다(설계서 §9.1 항목 2).
 *
 * ```
 * volBp   = floor(baseVolBp × volMulPct / 100)
 * shockBp = random.nextInt(-volBp, +volBp)          ← 난수는 여기 한 번뿐
 * nudgeBp = clamp(누적 보드 압력, ±600)
 * tickBp  = clamp(driftBp + newsBp + nudgeBp + shockBp, ±4000)
 * raw     = price × (10_000 + tickBp)
 * next    = round_half_up(raw / 10_000, tickUnit)
 * price'  = clamp(next, 하한, 상한)
 * ```
 *
 * 주문은 이 식에 **등장하지 않는다** — 거래소가 무한 유동성 상대방이므로 시세 조작이 불가능하다.
 */

/** 한 라운드에 누적 보드 압력이 낼 수 있는 최대 영향(bp). */
export const MAX_NUDGE_BP = 600;
/** 평균 회귀 강도(로그 거리 계수)와 라운드당 상한(bp). */
const REVERSION_K = 0.25;
const MAX_REVERSION_BP = 600;
/** 복원력이 작동하지 않는 정상 범위(기준가 배수). */
const REVERSION_BAND = Object.freeze({ lowerMul: 0.5, upperMul: 2.5 });

/** 한 라운드 최대 변화(bp) = ±40%. */
export const MAX_TICK_BP = 4_000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class PriceProcess {
  /** 그 라운드의 변동폭(bp). 국면 배수를 곱해 내림한다. */
  static volBp({ baseVolBp, volMulPct }) {
    return Math.floor((baseVolBp * volMulPct) / 100);
  }

  /** 무작위 충격(bp). `RandomSource.nextInt`를 **정확히 한 번** 쓴다. */
  static shockBp({ baseVolBp, volMulPct, random }) {
    const vol = PriceProcess.volBp({ baseVolBp, volMulPct });
    return random.nextInt(-vol, vol);
  }

  /** 누적 보드 압력을 ±600bp로 묶는다. */
  static nudgeBp(accumulatedBp) {
    return clamp(accumulatedBp, -MAX_NUDGE_BP, MAX_NUDGE_BP);
  }

  /**
   * 평균 회귀(bp) — **극단에서만** 작동하는 복원력.
   *
   * 기준가의 0.5배~2.5배(정상 범위) 안에서는 정확히 0이다. 고정 기준가로 되돌리는 힘을 항상 걸면
   * 25라운드에 1.3~1.5배로 끝나야 할 종목에 매 라운드 −2%의 역풍이 되어 설계된 상승 추세를
   * 무너뜨린다(실측: 분산 1바퀴 +6.9% → +2.7%). 그래서 밴드 밖에서만, 밴드 가장자리로부터의
   * 로그 거리에 비례해 되돌린다(가장자리에서 0부터 부드럽게 커진다).
   *
   *   `bp = −K × 10_000 × ln(price / edge)`, edge = 0.5·base(아래) 또는 2.5·base(위), ±600 상한. K = 0.25:
   *   기준가의 1/3 → +1,014 → 상한 +600(라운드당 +6%)  ·  0.4배 → +558  ·  3배 → −456  ·  0.5~2.5배 → 0
   *   K를 0.15로 두면 0.4배 근처에서 복원(+335)이 침체 역풍(−150 drift −500 악재 ≈ −400)과 비겨
   *   상장폐지 선 20% 위(2,400원)에 **눌러붙는다**(테스트로 실측). 밴드 안쪽 어디서든 침체를 이겨야 한다.
   *
   * 오너 피드백(2026-09-23): 라운드 제한 없는 43라운드 방에서 종목이 기준가 33%에 눌러붙음. 25라운드
   * 밸런스만 맞추고 긴 판을 안 본 것이 원인 — 이 항이 긴 판에서 바닥·천장 고착을 푼다(D45).
   */
  static reversionBp({ price, basePrice }) {
    if (!(price > 0) || !(basePrice > 0)) {
      return 0;
    }
    const lower = basePrice * REVERSION_BAND.lowerMul;
    const upper = basePrice * REVERSION_BAND.upperMul;
    let edge;
    if (price < lower) {
      edge = lower;
    } else if (price > upper) {
      edge = upper;
    } else {
      return 0;
    }
    // `Math.round(-0)`은 -0이라 Object.is 비교·JSON 왕복에서 헷갈린다 — 0으로 정규화한다.
    const raw = Math.round(-REVERSION_K * 10_000 * Math.log(price / edge)) || 0;
    return clamp(raw, -MAX_REVERSION_BP, MAX_REVERSION_BP);
  }

  /** 합산 변화율(bp). ±4000bp로 묶는다. `reversionBp`는 생략하면 0(하위호환). */
  static tickBp({ driftBp, newsBp, nudgeBp, shockBp, reversionBp = 0 }) {
    return clamp(driftBp + newsBp + nudgeBp + shockBp + reversionBp, -MAX_TICK_BP, MAX_TICK_BP);
  }

  /** 가격 하한(기준가의 `minPct`%, tickUnit 배수로 내림, 최소 1단위). */
  static minPrice({ basePrice, minPct, tickUnit }) {
    return Math.max(tickUnit, snapDown(Math.floor((basePrice * minPct) / 100), tickUnit));
  }

  /** 가격 상한(기준가의 `maxPct`%, tickUnit 배수로 내림). */
  static maxPrice({ basePrice, maxPct, tickUnit }) {
    return Math.max(tickUnit, snapDown(Math.floor((basePrice * maxPct) / 100), tickUnit));
  }

  /** 상장폐지 임계가(이 값 **이하**면 상장폐지). */
  static delistPrice({ basePrice, delistPct, tickUnit }) {
    return snapDown(Math.floor((basePrice * delistPct) / 100), tickUnit);
  }

  /** 지금 가격이 상장폐지 임계 이하인지. */
  static isDelisted({ price, basePrice, delistPct, tickUnit }) {
    return price <= PriceProcess.delistPrice({ basePrice, delistPct, tickUnit });
  }

  /**
   * 다음 가격. `tickUnit` 단위로 **반올림(half-up)** 한 뒤 하한·상한으로 묶는다.
   *
   * `price × (10_000 + tickBp)`는 최대 4e4 × 1.4e4 = 5.6e8로 안전 정수 범위 안이다.
   */
  static nextPrice({ price, basePrice, tickBp, tickUnit, minPct, maxPct }) {
    const raw = price * (10_000 + tickBp);
    const rounded = Math.floor((raw + 5_000 * tickUnit) / (10_000 * tickUnit)) * tickUnit;
    return clamp(
      rounded,
      PriceProcess.minPrice({ basePrice, minPct, tickUnit }),
      PriceProcess.maxPrice({ basePrice, maxPct, tickUnit }),
    );
  }

  /** 등락률(bp). 0 방향으로 자르므로 상승·하락이 대칭이다. */
  static changeBp(from, to) {
    if (!from) {
      return 0;
    }
    return Math.trunc(((to - from) * 10_000) / from);
  }
}

function snapDown(value, unit) {
  return Math.floor(value / unit) * unit;
}
