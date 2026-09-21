import { AutoPlayerDriver } from './application/AutoPlayerDriver.js';
import { AutoPlayerPolicy } from './application/AutoPlayerPolicy.js';
import { GameService } from './application/GameService.js';
import { KeyedMutex } from './application/KeyedMutex.js';
import { RoomService } from './application/RoomService.js';
import { SeatAuthenticator } from './infrastructure/SeatAuthenticator.js';
import { RoomController } from './server/roomController.js';
import { SseHub } from './server/sseHub.js';
import { createHttpServer } from './server/httpServer.js';
import { serverInfo } from './server/networkInfo.js';

/**
 * 조립 루트(Composition Root).
 * 저장소/난수/토큰 발급기를 밖에서 주입받아 서비스·컨트롤러·HTTP 서버를 엮는다.
 */
export function createApp({
  repository,
  random,
  tokenFactory,
  publicDir,
  autoPlayDelayMs = 800,
  logger = console,
  clock = { now: () => Date.now() },
  heartbeatMs,
}) {
  const sseHub = new SseHub({ logger, ...(heartbeatMs ? { heartbeatMs } : {}) });
  const presence = { onlineSeatIds: (code) => sseHub.onlineSeatIds(code) };
  const authenticator = new SeatAuthenticator();
  // 방 단위 "불러오기 → 변경 → 저장"을 직렬화한다(두 서비스가 같은 잠금을 공유해야 한다).
  const mutex = new KeyedMutex();

  const gameService = new GameService({
    repository,
    random,
    authenticator,
    publisher: sseHub,
    clock,
    logger,
    presence,
    mutex,
  });

  const roomService = new RoomService({
    repository,
    random,
    authenticator,
    publisher: sseHub,
    clock,
    tokenFactory,
    logger,
    presence,
    mutex,
  });

  const driver = new AutoPlayerDriver({
    delayMs: autoPlayDelayMs,
    policy: new AutoPlayerPolicy(),
    gameService,
    logger,
  });
  gameService.attachAutoPlayerDriver(driver);
  roomService.attachAutoPlayerDriver(driver);

  const controller = new RoomController({
    roomService,
    gameService,
    sseHub,
    authenticator,
    repository,
    networkInfo: () => serverInfo(currentPort()),
    logger,
  });

  const server = createHttpServer({ controller, publicDir, logger });

  function currentPort() {
    const address = server.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  return {
    server,
    sseHub,
    driver,
    roomService,
    gameService,
    /** 테스트/종료용: 타이머와 열린 스트림을 모두 정리한 뒤 서버를 닫는다. */
    async close() {
      driver.stop();
      sseHub.closeAll();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
