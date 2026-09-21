import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createApp } from './src/app.js';
import { CryptoRandomSource } from './src/infrastructure/CryptoRandomSource.js';
import { FileRoomRepository } from './src/infrastructure/FileRoomRepository.js';
import { TokenFactory } from './src/infrastructure/TokenFactory.js';
import { lanUrls } from './src/server/networkInfo.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT ?? '5173', 10);
const HOST = '0.0.0.0';

const random = new CryptoRandomSource();
const repository = new FileRoomRepository({
  directory: path.join(rootDir, 'data', 'rooms'),
  random,
});
await repository.init();

const app = createApp({
  repository,
  random,
  tokenFactory: new TokenFactory(),
  publicDir: path.join(rootDir, 'public'),
  autoPlayDelayMs: Number.parseInt(process.env.AUTO_PLAY_DELAY_MS ?? '800', 10),
});

// 시작할 때 24시간 넘게 방치된(또는 끝난) 방을 정리한다.
const removed = await app.roomService.cleanupStaleRooms();
if (removed.length > 0) {
  console.info(`오래된 방 ${removed.length}개를 정리했습니다: ${removed.join(', ')}`);
}

app.server.listen(PORT, HOST, () => {
  const urls = lanUrls(PORT);
  console.info('🎲 월드 다이스 투어 서버가 시작되었습니다.');
  console.info(`   이 기기:      http://localhost:${PORT}`);
  for (const url of urls) {
    console.info(`   같은 와이파이: ${url}`);
  }
  if (urls.length === 0) {
    console.info('   (LAN 주소를 찾지 못했습니다. 네트워크 연결을 확인하세요.)');
  }
});

/** 종료 시 타이머와 SSE 스트림을 정리한다. */
async function shutdown(signal) {
  console.info(`\n${signal} 수신 — 서버를 정리합니다.`);
  try {
    await app.close();
  } catch (error) {
    console.error(`서버 종료 중 오류: ${error.message}`);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
