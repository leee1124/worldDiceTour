/**
 * 자산군 포트(AssetProvider). 부동산·주식·코인·예금·파생처럼 "팔 수 있고 값이 있는 것"을
 * 한 가지 모양으로 다루기 위한 인터페이스 정의다(JSDoc typedef — 런타임 코드 없음).
 *
 * `AssetRegistry.register(new CryptoAssets(market))` **한 줄**이면 새 자산군이
 * 총자산·정리 매각 목록·자동매각 순서·파산 청산에 동시에 반영된다. `Game.js`는 바뀌지 않는다.
 *
 * 구현체는 **돈을 직접 만지지 않는다.** `liquidate`/`releaseAllOf`는 `MoneyIntent` 목록을
 * 돌려주고, 적용은 `Treasury`가 한다(돈 흐름 단일 경로).
 *
 * @typedef {object} SellableAsset 정리 페이즈에서 팔 수 있는 자산 한 건
 * @property {string} kind 자산군 종류(제공자의 `kind`)
 * @property {string} assetId 그 자산군 안에서 유일한 식별자
 * @property {string} label 사람이 읽는 이름
 * @property {number} refund 지금 팔면 받는 금액(원)
 * @property {number} quantity 수량(부동산은 1)
 * @property {object} view DTO에 그대로 실릴 공개 정보(자산군마다 모양이 다르다)
 *
 * @typedef {object} LiquidationResult
 * @property {number} refund 실제 환급액
 * @property {import('./MoneyIntent.js').MoneyIntent[]} intents 돈 이동 의사
 * @property {Array<{type:string, payload:object}>} events 도메인 이벤트
 *
 * @typedef {object} AssetProvider
 * @property {string} kind 자산군 종류(레지스트리 안에서 유일)
 * @property {number} liquidationPriority 자동매각·파산 청산 순서. **작을수록 먼저 팔린다**
 *   (설계: 파생 → 코인 → 주식 → 예금 → 부동산)
 * @property {(playerId: string) => SellableAsset[]} listOf 매각 가능 목록(자산군 내부 순서)
 * @property {(playerId: string) => number} valueOf 순자산 평가액
 * @property {(params: {playerId: string, assetId: string, quantity?: number}) => LiquidationResult} liquidate
 * @property {(playerId: string) => LiquidationResult & {releasedIndexes?: number[]}} releaseAllOf
 *   파산 청산. 그 좌석의 자산을 전부 비운다
 * @property {((params: {playerId: string, assetId: string, owed: number}) => number)} [quantityCovering]
 *   부족액 `owed`를 덮는 **최소 수량**. 정리 매각은 수수료가 면제되고 창구 한도를 보지 않으므로,
 *   "강제 지불을 메운다"는 전제를 넘어서는 대량 매각을 막기 위해 `Liquidator`가 이 값으로 상한을 둔다.
 *   나눌 수 없는 자산(부동산 한 칸)은 구현하지 않아도 된다 — 그러면 상한을 두지 않는다.
 */
export {};
