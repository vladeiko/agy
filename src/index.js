#!/usr/bin/env node
// index.js
// -----------------------------------------------------------------------------
// CLI-точка входа PoC. Поднимает HTTP-перехватчик и печатает инструкцию: куда
// указать адрес PoC, чтобы клиент (CLI/IDE) на него пошёл.
//
// Флаги:
//   --port <n>        порт PoC (по умолчанию 8788)
//   --upstream <url>  настоящий эндпоинт для форварда (по умолчанию daily-хост)
//   --rewrite         править eligibility в ответе (демонстрация доверия к ответу).
//                     Без флага PoC только наблюдает и логирует.
//   --insecure        не проверять сертификат апстрима
// -----------------------------------------------------------------------------

import { Logger } from './logger.js';
import { createInterceptor } from './interceptor.js';
import { DEFAULT_PORT, UPSTREAM_DEFAULT, CLI_ENV_VAR, IDE_SETTING } from './config.js';

// Крохотный парсер аргументов, без внешних зависимостей.
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rewrite') args.rewrite = true;
    else if (a === '--insecure') args.insecure = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--upstream') args.upstream = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Antigravity / CloudCode transport PoC

Использование:
  node src/index.js [флаги]

Флаги:
  --port <n>        порт PoC (по умолчанию ${DEFAULT_PORT})
  --upstream <url>  настоящий эндпоинт (по умолчанию ${UPSTREAM_DEFAULT})
  --rewrite         править eligibility в ответе (иначе только наблюдение)
  --insecure        не проверять сертификат апстрима

Примеры:
  node src/index.js                 # наблюдение: видно токен и промпты в логе
  node src/index.js --rewrite       # плюс подмена ответа (доверие к ответу)
`);
}

function printWiring(port) {
  const base = `http://127.0.0.1:${port}`;
  console.log(`\n  Адрес PoC: ${base}\n`);
  console.log('  Направить клиента на PoC:');
  console.log(`    • CLI:  export ${CLI_ENV_VAR}="${base}"   (затем запустить CLI в том же шелле)`);
  console.log(`    • IDE:  "${IDE_SETTING}": "${base}"   в settings.json`);
  console.log('');
  console.log('  Смотри в лог: входящие POST /v1internal:... с заголовком');
  console.log('  Authorization: Bearer ya29... — это OAuth-токен открытым текстом по HTTP.');
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const port = args.port || DEFAULT_PORT;
  const upstreamBase = args.upstream || UPSTREAM_DEFAULT;
  const logger = new Logger();

  const server = createInterceptor({
    logger,
    upstreamBase,
    rewrite: !!args.rewrite,
    insecure: !!args.insecure,
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(
      `PoC запущен: апстрим=${upstreamBase} подмена=${args.rewrite ? 'да (--rewrite)' : 'нет (наблюдение)'}`,
    );
    logger.info(`Лог сессии: ${logger.file}`);
    printWiring(port);
    logger.info('Жду запросов от клиента… (Ctrl+C для остановки)');
  });
}

main();
