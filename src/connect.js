// connect.js
// -----------------------------------------------------------------------------
// CloudCode использует Connect-протокол (grpc-подобный поверх обычного HTTP).
// Тело может приехать в нескольких формах, и чтобы добраться до JSON (который
// правит transform.js), нужно уметь их разбирать и собирать обратно:
//
//   A) Унарный JSON            content-type: application/json
//                              тело — просто UTF-8 JSON.
//
//   B) Connect unary/stream    content-type: application/connect+json
//                              тело — один или несколько "кадров-конвертов":
//                              [1 байт флагов][4 байта длины BE][payload].
//                              Последний кадр с флагом 0x02 — трейлер
//                              (метаданные конца стрима, не бизнес-данные).
//
//   Плюс поверх любого из них — сжатие (content-encoding: gzip|br).
//
// Мы сознательно НЕ трогаем `application/connect+proto` и `application/grpc*`
// (бинарный protobuf): без .proto-дескрипторов переписать их поля нельзя.
// Такие тела просто логируем и пропускаем как есть — это тоже полезный
// результат исследования (значит, для них нужен другой подход).
// -----------------------------------------------------------------------------

import zlib from 'node:zlib';

// Можем ли мы в принципе разобрать это тело как JSON?
export function isJsonLike(contentType = '') {
  const ct = contentType.toLowerCase();
  return ct.includes('application/json') || ct.includes('connect+json');
}

// Это enveloped-форма (кадры-конверты), а не голый JSON?
export function isEnveloped(contentType = '') {
  return contentType.toLowerCase().includes('connect+json');
}

// Снять сжатие, если оно есть. Возвращает { buffer, encoding }, где encoding
// нужен, чтобы упаковать ответ обратно тем же способом.
export function decompress(buffer, contentEncoding = '') {
  const enc = contentEncoding.toLowerCase();
  if (enc.includes('gzip')) return { buffer: zlib.gunzipSync(buffer), encoding: 'gzip' };
  if (enc.includes('br')) return { buffer: zlib.brotliDecompressSync(buffer), encoding: 'br' };
  if (enc.includes('deflate')) return { buffer: zlib.inflateSync(buffer), encoding: 'deflate' };
  return { buffer, encoding: '' };
}

// Упаковать обратно тем же способом сжатия.
export function compress(buffer, encoding = '') {
  if (encoding === 'gzip') return zlib.gzipSync(buffer);
  if (encoding === 'br') return zlib.brotliCompressSync(buffer);
  if (encoding === 'deflate') return zlib.deflateSync(buffer);
  return buffer;
}

// Разобрать буфер в набор "сообщений". Для голого JSON это один элемент;
// для enveloped — по одному на каждый бизнес-кадр (трейлеры сохраняем отдельно,
// чтобы отдать их обратно без изменений).
//
// Возвращает { messages: [{json, flags}], trailers: [Buffer], enveloped }.
export function decodeMessages(buffer, contentType) {
  if (!isEnveloped(contentType)) {
    // Голый JSON. Пустое тело — не ошибка (бывают ответы без тела).
    const text = buffer.toString('utf8').trim();
    if (!text) return { messages: [], trailers: [], enveloped: false };
    return {
      messages: [{ json: JSON.parse(text), flags: 0 }],
      trailers: [],
      enveloped: false,
    };
  }

  // Enveloped: идём по кадрам.
  const messages = [];
  const trailers = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flags = buffer[offset];
    const len = buffer.readUInt32BE(offset + 1);
    const start = offset + 5;
    const end = start + len;
    const payload = buffer.subarray(start, end);
    offset = end;

    // Флаг 0x02 = трейлер стрима. Это не бизнес-данные — не парсим, сохраняем
    // байты как есть, чтобы вернуть без изменений.
    if (flags & 0x02) {
      trailers.push({ flags, payload });
      continue;
    }
    const text = payload.toString('utf8').trim();
    messages.push({ json: text ? JSON.parse(text) : {}, flags });
  }
  return { messages, trailers, enveloped: true };
}

// Собрать буфер обратно из (возможно изменённых) сообщений и нетронутых
// трейлеров, в исходной форме (enveloped или голый JSON).
export function encodeMessages({ messages, trailers, enveloped }) {
  if (!enveloped) {
    if (messages.length === 0) return Buffer.alloc(0);
    return Buffer.from(JSON.stringify(messages[0].json), 'utf8');
  }

  const parts = [];
  for (const msg of messages) {
    const payload = Buffer.from(JSON.stringify(msg.json), 'utf8');
    const header = Buffer.alloc(5);
    header[0] = msg.flags & ~0x02; // это точно не трейлер
    header.writeUInt32BE(payload.length, 1);
    parts.push(header, payload);
  }
  for (const tr of trailers) {
    const header = Buffer.alloc(5);
    header[0] = tr.flags;
    header.writeUInt32BE(tr.payload.length, 1);
    parts.push(header, tr.payload);
  }
  return Buffer.concat(parts);
}
