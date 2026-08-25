// interceptor.js
// -----------------------------------------------------------------------------
// HTTP-сервер PoC. Принимает запросы клиента (который через override указал на
// наш адрес), форвардит их на настоящий эндпоинт, логирует запрос и ответ.
//
// Два поведения:
//   наблюдение (по умолчанию) — ничего не меняем. Достаточно, чтобы увидеть
//     главное: OAuth Bearer-токен и промпты уходят на наш http-адрес открытым
//     текстом.
//   rewrite (флаг --rewrite) — правим eligibility в ответе, чтобы показать, что
//     клиент принимает ответ без проверки целостности.
// -----------------------------------------------------------------------------

import http from 'node:http';

import { forward } from './upstream.js';
import { rewriteEligibility, ensureTierFields } from './transform.js';
import {
  decodeMessages,
  encodeMessages,
  decompress,
  compress,
  isJsonLike,
} from './connect.js';

// Прочитать тело запроса целиком в один буфер.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (ch) => chunks.push(ch));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Распарсить тело запроса как JSON — только чтобы красиво залогировать. На
// логику не влияет, ошибки глушим.
function previewRequestBody(buffer, contentType) {
  if (!buffer?.length || !isJsonLike(contentType)) {
    return buffer?.length ? `<${buffer.length} байт бинарного тела>` : undefined;
  }
  try {
    const { messages } = decodeMessages(buffer, contentType);
    return messages.map((m) => m.json);
  } catch {
    return buffer.toString('utf8').slice(0, 500);
  }
}

// Применить подмену eligibility к телу ОТВЕТА. Возвращает { body, changed,
// changes, preview }. Не-JSON тело отдаём как есть.
function rewriteResponseBody(buffer, headers, url, doRewrite) {
  const contentType = headers['content-type'] || '';
  const contentEncoding = headers['content-encoding'] || '';

  if (!isJsonLike(contentType) || !buffer?.length) {
    return { body: buffer, changed: false, changes: [], preview: undefined };
  }

  // Снимаем сжатие -> разбираем кадры -> (по желанию) правим -> собираем обратно.
  const { buffer: raw, encoding } = decompress(buffer, contentEncoding);
  const decoded = decodeMessages(raw, contentType);

  const allChanges = [];
  if (doRewrite) {
    for (const msg of decoded.messages) {
      allChanges.push(...rewriteEligibility(msg.json, []).changes);
      if (url.toLowerCase().includes('loadcodeassist')) {
        allChanges.push(...ensureTierFields(msg.json, []).changes);
      }
    }
  }

  const preview = decoded.messages.map((m) => m.json);
  if (!doRewrite || allChanges.length === 0) {
    // Тело не меняли (или менять было нечего) — вернём исходный буфер как есть.
    return { body: buffer, changed: false, changes: [], preview };
  }

  const rebuilt = compress(encodeMessages(decoded), encoding);
  return { body: rebuilt, changed: true, changes: allChanges, preview };
}

// Главный обработчик запроса.
async function handle(req, res, opts) {
  const { logger, upstreamBase, rewrite, insecure } = opts;
  const url = req.url || '/';
  const reqBuffer = await readBody(req);
  const reqContentType = req.headers['content-type'] || '';

  const id = logger.requestStart({
    method: req.method,
    url,
    headers: req.headers, // ВНИМАНИЕ: тут в т.ч. Authorization: Bearer <token> открытым текстом
    body: previewRequestBody(reqBuffer, reqContentType),
  });

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    logger.responseDone({ id, status: 204, changed: false, changes: [] });
    return;
  }

  try {
    const up = await forward({
      upstreamBase,
      path: url,
      method: req.method,
      headers: req.headers,
      body: reqBuffer,
      insecure,
    });

    const r = rewriteResponseBody(up.body, up.headers, url, rewrite);

    // Пересобранное тело почти наверняка другой длины — пересчитываем заголовки.
    const outHeaders = { ...up.headers };
    delete outHeaders['content-length'];
    delete outHeaders['transfer-encoding'];
    outHeaders['content-length'] = r.body.length;

    res.writeHead(up.status, outHeaders);
    res.end(r.body);
    logger.responseDone({
      id,
      status: up.status,
      changed: r.changed,
      changes: r.changes,
      body: r.preview,
    });
  } catch (err) {
    logger.error(`#${id} ошибка обработки: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`poc upstream error: ${err.message}`);
    logger.responseDone({ id, status: 502, changed: false, changes: [] });
  }
}

// Создать HTTP-сервер (ещё не слушающий).
export function createInterceptor(opts) {
  return http.createServer((req, res) => handle(req, res, opts));
}
