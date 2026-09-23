import { DomainError } from '../shared/DomainError.js';
import { PriceProcess } from './PriceProcess.js';
import { PriceSeries } from './PriceSeries.js';
import {
  CLASS_PARAMS,
  INSTRUMENT_STATES,
  SECTOR_LABELS,
  instrumentSpecById,
} from './data/instruments.js';

/**
 * 상품 엔티티(주식·코인·지수 공통).
 *
 * **자기 가격 규칙을 스스로 안다** — 틱 한 번에 얼마가 되는지, 상장폐지인지, 1주 배당이 얼마인지,
 * 보유 수량의 평가액이 얼마인지 모두 이 안에 있다. 종목 이름·섹터·기준가 같은 **불변 규격은
 * 스냅샷에 담지 않고** 데이터 표(`data/instruments.js`)에서 되살린다 — 방 파일이 작아지고,
 * 데이터 표를 고치면 진행 중인 방에도 자동으로 반영된다.
 */
export class Instrument {
  #spec;
  #params;
  #price;
  #state;
  /** @type {PriceSeries} */
  #series;

  constructor({ spec, price, state, series }) {
    this.#spec = spec;
    this.#params = CLASS_PARAMS[spec.klass];
    if (!this.#params) {
      throw DomainError.invalidArgument(`알 수 없는 상품 종류입니다: ${String(spec.klass)}`);
    }
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw DomainError.invalidArgument(`상품 가격이 올바르지 않습니다: ${describe(price)}`);
    }
    if (!Object.values(INSTRUMENT_STATES).includes(state)) {
      throw DomainError.invalidArgument(`알 수 없는 상장 상태입니다: ${String(state)}`);
    }
    this.#price = price;
    this.#state = state;
    this.#series = series;
  }

  /** 데이터 표의 규격으로 새로 상장한다(기준가에서 시작). */
  static fromSpec(spec) {
    if (!spec) {
      throw DomainError.invalidArgument('상품 규격이 없습니다');
    }
    return new Instrument({
      spec,
      price: spec.basePrice,
      state: INSTRUMENT_STATES.LISTED,
      series: new PriceSeries([spec.basePrice]),
    });
  }

  /** 스냅샷에서 복원한다. 규격은 데이터 표에서 찾는다. */
  static restore(raw) {
    const spec = instrumentSpecById(raw?.id);
    if (!spec) {
      throw DomainError.invalidArgument(`알 수 없는 종목입니다: ${String(raw?.id)}`);
    }
    const series = new PriceSeries(
      Array.isArray(raw.series) && raw.series.length > 0 ? raw.series : [raw.price],
    );
    return new Instrument({ spec, price: raw.price, state: raw.state, series });
  }

  get id() {
    return this.#spec.id;
  }

  get name() {
    return this.#spec.name;
  }

  get sector() {
    return this.#spec.sector;
  }

  get sectorLabel() {
    return SECTOR_LABELS[this.#spec.sector] ?? this.#spec.sector;
  }

  get klass() {
    return this.#spec.klass;
  }

  get state() {
    return this.#state;
  }

  get price() {
    return this.#price;
  }

  get basePrice() {
    return this.#spec.basePrice;
  }

  get baseVolBp() {
    return this.#spec.baseVolBp;
  }

  get dividendBp() {
    return this.#spec.dividendBp;
  }

  get tickUnit() {
    return this.#params.tickUnit;
  }

  /** 오래된 값 → 최신 값(사본). */
  get series() {
    return this.#series.values;
  }

  get prevPrice() {
    return this.#series.previous;
  }

  /** 직전 틱 대비 등락률(bp). */
  get changeBp() {
    return PriceProcess.changeBp(this.prevPrice, this.#price);
  }

  isListed() {
    return this.#state === INSTRUMENT_STATES.LISTED;
  }

  /**
   * 한 라운드 틱. **상장폐지된 종목은 아무 일도 하지 않고 `null`을 돌려준다.**
   * @returns {{from:number, to:number, changeBp:number, delisted:boolean}|null}
   */
  tick({ driftBp, newsBp, nudgeBp, volMulPct, random }) {
    if (!this.isListed()) {
      return null;
    }
    const shockBp = PriceProcess.shockBp({
      baseVolBp: this.#spec.baseVolBp,
      volMulPct,
      random,
    });
    const tickBp = PriceProcess.tickBp({ driftBp, newsBp, nudgeBp, shockBp });
    const from = this.#price;
    const to = PriceProcess.nextPrice({
      price: from,
      basePrice: this.#spec.basePrice,
      tickBp,
      ...this.#params,
    });

    this.#price = to;
    this.#series = this.#series.append(to);

    const delisted = PriceProcess.isDelisted({
      price: to,
      basePrice: this.#spec.basePrice,
      ...this.#params,
    });
    if (delisted) {
      this.#state = INSTRUMENT_STATES.DELISTED;
    }
    return { from, to, changeBp: PriceProcess.changeBp(from, to), delisted };
  }

  /** 1주 배당(내림). 상장폐지·무배당 종목은 0이다. */
  dividendPerShare() {
    if (!this.isListed() || this.#spec.dividendBp <= 0) {
      return 0;
    }
    return Math.floor((this.#price * this.#spec.dividendBp) / 10_000);
  }

  /** 보유 수량의 시가 평가액. 상장폐지 종목은 휴지조각이므로 0이다. */
  valueOf(quantity) {
    return this.isListed() ? this.#price * quantity : 0;
  }

  /** 공개 DTO(화면이 그대로 쓴다). */
  viewModel() {
    return {
      id: this.id,
      name: this.name,
      sector: this.sector,
      sectorLabel: this.sectorLabel,
      klass: this.klass,
      state: this.#state,
      price: this.#price,
      prevPrice: this.prevPrice,
      changeBp: this.changeBp,
      basePrice: this.basePrice,
      tickUnit: this.tickUnit,
      dividendBp: this.dividendBp,
      series: this.series,
    };
  }

  toSnapshot() {
    return {
      id: this.id,
      price: this.#price,
      state: this.#state,
      series: this.#series.toSnapshot(),
    };
  }
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
