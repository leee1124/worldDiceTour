import { createHash } from 'node:crypto';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { GameService } from '../../src/application/GameService.js';
import { RoomService } from '../../src/application/RoomService.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeatAuthenticator } from '../../src/infrastructure/SeatAuthenticator.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { TokenFactory } from '../../src/infrastructure/TokenFactory.js';

/**
 * 골든 리플레이 하네스.
 *
 * 같은 시드로 컴퓨터 4인 자동 대전을 끝까지 돌리고, **행동이 바뀌면 반드시 달라지는 값**만
 * 뽑아 기록한다. 리팩터가 규칙을 건드렸는지 판단하는 유일한 증거이므로, 여기서 만드는 값은
 * 난수·게임 규칙에만 의존해야 한다(시각·토큰 등 비결정 요소를 섞지 않는다).
 *
 * 골든 파일 재생성(행동을 의도적으로 바꿀 때만!):
 *   node -e "import('./tests/support/goldenReplay.js').then(async(m)=>{
 *     const {writeFileSync}=await import('node:fs');
 *     writeFileSync('tests/e2e/fixtures/goldenReplay.json', JSON.stringify(await m.replayAll(), null, 2)+'\n');
 *   })"
 */

/** 한 판에서 허용하는 최대 커맨드 수(무한 루프 방지). */
const MAX_COMMANDS = 20_000;

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };
const noopPublisher = { publishRoom: () => {}, publishGame: () => {} };

/**
 * 투자 모드 STOCKS 골든 시나리오.
 *
 * OFF 목록과 **따로** 둔다 — 기존 골든 파일(`goldenReplay.json`)은 리팩터 전 코드로 만든
 * 회귀 안전망이므로 한 글자도 건드리지 않아야 한다. 증권거래소는 자기 골든 파일을 갖는다.
 */
export const STOCKS_GOLDEN_SCENARIOS = Object.freeze([
  { seed: 1, roundLimit: 30 },
  { seed: 7, roundLimit: 30 },
  { seed: 42, roundLimit: 30 },
  { seed: 99, roundLimit: 30 },
  { seed: 123, roundLimit: 30 },
  { seed: 2_024, roundLimit: 30 },
  { seed: 31_337, roundLimit: 30 },
  { seed: 65_535, roundLimit: 30 },
  { seed: 777_777, roundLimit: 30 },
  { seed: 1_000_003, roundLimit: 30 },
  { seed: 3, roundLimit: 20 },
  { seed: 11, roundLimit: 20 },
  { seed: 77, roundLimit: 20 },
  { seed: 512, roundLimit: 20 },
  { seed: 4_096, roundLimit: 20 },
  { seed: 20_260_921, roundLimit: null },
]);

/** 골든 대상 시나리오(시드 × 라운드 제한). 12개 이상을 유지한다. */
export const GOLDEN_SCENARIOS = Object.freeze([
  { seed: 1, roundLimit: 30 },
  { seed: 7, roundLimit: 30 },
  { seed: 42, roundLimit: 30 },
  { seed: 99, roundLimit: 30 },
  { seed: 123, roundLimit: 30 },
  { seed: 2_024, roundLimit: 30 },
  { seed: 31_337, roundLimit: 30 },
  { seed: 65_535, roundLimit: 30 },
  { seed: 777_777, roundLimit: 30 },
  { seed: 1_000_003, roundLimit: 30 },
  { seed: 3, roundLimit: 20 },
  { seed: 11, roundLimit: 20 },
  { seed: 77, roundLimit: 20 },
  { seed: 512, roundLimit: 20 },
  { seed: 4_096, roundLimit: 20 },
  { seed: 20_260_921, roundLimit: null },
]);

function createHeadlessApp(seed) {
  const random = new SeededRandomSource(seed);
  const repository = new InMemoryRoomRepository({ random, logger: silentLogger });
  const authenticator = new SeatAuthenticator();
  const clock = { now: () => 1_700_000_000_000 };
  const common = {
    repository,
    random,
    authenticator,
    publisher: noopPublisher,
    clock,
    logger: silentLogger,
  };

  return {
    repository,
    roomService: new RoomService({ ...common, tokenFactory: new TokenFactory() }),
    gameService: new GameService(common),
  };
}

async function startFourComputerGame(app, { roundLimit, investmentMode = 'OFF' }) {
  const host = await app.roomService.createRoom({ hostName: '자동1' });
  const code = host.room.code;
  const token = host.seatToken;

  for (const name of ['자동2', '자동3', '자동4']) {
    await app.roomService.hostAction({ code, token, action: { type: 'ADD_COMPUTER', name } });
  }
  await app.roomService.hostAction({
    code,
    token,
    action: { type: 'SET_OPTIONS', roundLimit, finance: { investmentMode } },
  });
  await app.roomService.hostAction({
    code,
    token,
    action: { type: 'SET_AUTOPILOT', seatId: host.seatId, enabled: true },
  });
  await app.roomService.hostAction({ code, token, action: { type: 'START' } });
  return code;
}

/**
 * 한 시나리오를 끝까지 돌리고 골든 기록을 만든다.
 * @returns {Promise<object>} 골든 파일 한 항목
 */
export async function replayScenario({ seed, roundLimit, investmentMode = 'OFF' }) {
  const app = createHeadlessApp(seed);
  const policy = new AutoPlayerPolicy();
  const code = await startFourComputerGame(app, { roundLimit, investmentMode });

  const eventTypes = [];
  const commandTypes = [];
  let commands = 0;

  while (commands < MAX_COMMANDS) {
    const turn = await app.gameService.autoTurn(code);
    if (!turn) {
      break;
    }
    const decision = policy.decide(turn.view);
    if (!decision) {
      throw new Error(`시드 ${seed}: 결정할 수 없는 페이즈 ${turn.view.phase}`);
    }
    const result = await app.gameService.executeAsServer({
      code,
      seatId: turn.seatId,
      type: decision.type,
      payload: decision.payload,
    });
    commands += 1;
    commandTypes.push(decision.type);
    for (const event of result.events) {
      eventTypes.push(event.type);
    }
  }

  const room = await app.repository.findByCode(code);
  const game = room.game;
  const report = game.moneyReport();

  return {
    seed,
    roundLimit,
    commands,
    finalRound: game.round,
    isOver: game.isOver(),
    jackpot: game.jackpot,
    initialTotal: report.initialTotal,
    netFromBank: report.netFromBank,
    totalCash: report.totalCash,
    eventCount: eventTypes.length,
    eventSequenceHash: sha256(eventTypes.join('\n')),
    commandSequenceHash: sha256(commandTypes.join('\n')),
    rankings: game.rankings().map((entry) => ({
      rank: entry.rank,
      playerId: entry.playerId,
      eliminated: entry.eliminated,
      cash: entry.cash,
      loanDebt: entry.loanDebt,
      totalAssets: entry.totalAssets,
    })),
    // 투자 모드가 꺼진 방에서는 null이라 기존 골든 파일의 모양이 달라지지 않는다.
    market: marketDigest(game),
  };
}

/** 최종 시장 상태의 지문. 시세·국면·금리·보유가 달라지면 반드시 드러난다. */
function marketDigest(game) {
  const view = game.marketView({ actingSeatId: null });
  if (!view) {
    return null;
  }
  return {
    cyclePhase: view.cycle.phase,
    baseRateBp: view.baseRateBp,
    prices: Object.fromEntries(
      view.instruments.map((instrument) => [instrument.id, instrument.price]),
    ),
    states: Object.fromEntries(
      view.instruments.map((instrument) => [instrument.id, instrument.state]),
    ),
    holdings: Object.fromEntries(
      Object.entries(view.holdings).map(([seatId, positions]) => [
        seatId,
        positions.map((position) => `${position.instrumentId}:${position.qty}`).join(','),
      ]),
    ),
    deposits: view.deposits,
  };
}

/** 모든 시나리오를 순서대로 돌린 골든 기록. */
export async function replayAll() {
  const scenarios = [];
  for (const scenario of GOLDEN_SCENARIOS) {
    scenarios.push(await replayScenario(scenario));
  }
  return { scenarios };
}

/**
 * 투자 모드 STOCKS 골든 기록.
 *
 * 재생성(행동을 의도적으로 바꿀 때만!):
 *   node -e "import('./tests/support/goldenReplay.js').then(async(m)=>{
 *     const {writeFileSync}=await import('node:fs');
 *     writeFileSync('tests/e2e/fixtures/goldenReplayStocks.json',
 *       JSON.stringify(await m.replayAllStocks(), null, 2)+'\n');
 *   })"
 */
export async function replayAllStocks() {
  const scenarios = [];
  for (const scenario of STOCKS_GOLDEN_SCENARIOS) {
    scenarios.push(await replayScenario({ ...scenario, investmentMode: 'STOCKS' }));
  }
  return { scenarios };
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
