// logger.js
// -----------------------------------------------------------------------------
// Логирование — это, по сути, главный смысл стенда: мы хотим ВИДЕТЬ реальный
// протокол CloudCode (какие пути дёргает клиент, какие поля в ответах,
// срабатывает ли подмена). Пишем два потока сразу:
//   1) в консоль — кратко и с цветом, для живого наблюдения;
//   2) в logs/session-<timestamp>.jsonl — полностью, по одной JSON-записи на
//      строку, чтобы потом можно было грепать/анализировать.
// -----------------------------------------------------------------------------

import { createWriteStream, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'logs');

// Минимальные ANSI-цвета без внешних зависимостей.
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

export class Logger {
  constructor() {
    mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.file = join(LOG_DIR, `session-${stamp}.jsonl`);
    // append-поток; flush на каждой записи нам не критичен, ОС сама сбросит.
    this.stream = createWriteStream(this.file, { flags: 'a' });
    this.seq = 0;
  }

  // Внутреннее: одна строка JSONL.
  _write(record) {
    this.stream.write(JSON.stringify(record) + '\n');
  }

  // Служебные сообщения стенда (старт, ошибки, подсказки).
  info(msg) {
    console.log(c.dim(new Date().toLocaleTimeString()), msg);
    this._write({ t: Date.now(), kind: 'info', msg });
  }

  warn(msg) {
    console.log(c.dim(new Date().toLocaleTimeString()), c.yellow('WARN'), msg);
    this._write({ t: Date.now(), kind: 'warn', msg });
  }

  error(msg) {
    console.log(c.dim(new Date().toLocaleTimeString()), c.red('ERR '), msg);
    this._write({ t: Date.now(), kind: 'error', msg });
  }

  // Начало обработки запроса. Возвращает id, который надо передать в
  // responseDone(), чтобы связать запрос и ответ в логах.
  requestStart({ method, url, headers, body }) {
    const id = ++this.seq;
    console.log(
      c.cyan(`\n#${id} → ${method} ${url}`),
      c.dim(`(${headers['content-type'] || 'no content-type'})`),
    );
    if (body !== undefined) {
      console.log(c.dim(prettyPreview(body)));
    }
    this._write({
      t: Date.now(),
      kind: 'request',
      id,
      method,
      url,
      headers,
      body,
    });
    return id;
  }

  // Завершение обработки. `changed` — сработала ли подмена eligibility;
  // `changes` — список изменённых полей (для наглядности).
  responseDone({ id, status, changed, changes, body }) {
    const tag = changed ? c.green('REWRITTEN') : c.dim('as-is');
    console.log(c.bold(`#${id} ← ${status}`), tag);
    if (changed && changes?.length) {
      for (const ch of changes) console.log('   ', c.green('•'), ch);
    }
    if (body !== undefined) {
      console.log(c.dim(prettyPreview(body)));
    }
    this._write({
      t: Date.now(),
      kind: 'response',
      id,
      status,
      changed,
      changes,
      body,
    });
  }
}

// Аккуратный предпросмотр тела: если это объект — печатаем усечённый JSON,
// если строка/буфер — первые N символов. Полная версия всё равно уходит в файл.
function prettyPreview(body, limit = 800) {
  let text;
  if (typeof body === 'string') text = body;
  else {
    try {
      text = JSON.stringify(body, null, 2);
    } catch {
      text = String(body);
    }
  }
  if (text.length > limit) return text.slice(0, limit) + `\n… (+${text.length - limit} символов, полностью в .jsonl)`;
  return text;
}
