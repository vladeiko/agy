// upstream.js
// -----------------------------------------------------------------------------
// Форвард запроса клиента на настоящий CloudCode-эндпоинт и возврат сырого
// ответа (статус + заголовки + тело-буфер). Подмену тут НЕ делаем — это забота
// interceptor.js; здесь только честная пересылка.
//
// Замечание про гео: если у пользователя настроен VPN/подмена DNS для
// googleapis-хостов, то исходящее соединение Node тоже пойдёт через них —
// стенд к этому прозрачен. Для чистого
// захвата протокола и проверки пиннинга это соединение вообще не обязано
// возвращать "eligible"; нам достаточно, что клиент ДОШЁЛ до нас.
// -----------------------------------------------------------------------------

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// Переслать один запрос на апстрим.
//   upstreamBase — базовый https://host, куда шлём (из config).
//   path         — путь+query исходного запроса (напр. /v1internal:loadCodeAssist).
//   method, headers, body — из входящего запроса.
//   insecure     — не проверять сертификат апстрима (для отладки через свой прокси).
//
// Возвращает Promise<{ status, headers, body: Buffer }>.
export function forward({ upstreamBase, path, method, headers, body, insecure = false }) {
  const target = new URL(path, upstreamBase);

  // Заголовки правим минимально: Host должен соответствовать апстриму, а не
  // "127.0.0.1:порт", иначе Google не поймёт, к какому сервису мы идём.
  const outHeaders = { ...headers };
  outHeaders.host = target.host;
  // content-length пересчитается ниже под фактическое тело.
  delete outHeaders['content-length'];
  // Соединение мы держим своё, keep-alive исходного клиента не тащим.
  delete outHeaders.connection;

  // Модуль по протоколу апстрима: обычно https (реальный эндпоинт), но
  // http:// тоже поддержан — удобно направлять форвард на локальный отладочный
  // сервер.
  const isHttps = target.protocol === 'https:';
  const agent = isHttps ? https : http;
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    method,
    headers: outHeaders,
  };
  if (isHttps) options.rejectUnauthorized = !insecure;

  return new Promise((resolve, reject) => {
    const req = agent.request(options, (res) => {
      const chunks = [];
      res.on('data', (ch) => chunks.push(ch));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}
