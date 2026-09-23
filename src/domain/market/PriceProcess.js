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

  /** 합산 변화율(bp). ±4000bp로 묶는다. */
  static tickBp({ driftBp, newsBp, nudgeBp, shockBp }) {
    return clamp(driftBp + newsBp + nudgeBp + shockBp, -MAX_TICK_BP, MAX_TICK_BP);
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
