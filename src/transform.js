// transform.js
// -----------------------------------------------------------------------------
// Подмена eligibility в JSON-ответе сервера. Нужна, чтобы продемонстрировать
// вторую часть находки: клиент принимает ответ эндпоинта БЕЗ проверки
// целостности. Мы правим известные gate-поля, а клиент верит результату.
//
// Почему это в принципе возможно: региональный гейт вычисляется клиентом по
// ПОЛЮ в JSON-ответе — значит правка ответа "на лету" меняет решение клиента.
//
// Обход рекурсивный и по именам полей: не привязываемся к форме конкретного
// ответа, ищем gate-поля где угодно в дереве.
// -----------------------------------------------------------------------------

import {
  BOOLEAN_ELIGIBLE_FIELDS,
  REASON_FIELDS_TO_DROP,
  INELIGIBLE_CASE,
  NEUTRALIZED_CASE,
  STANDARD_TIER,
  ALLOWED_TIERS,
} from './config.js';

// Правит объект НА МЕСТЕ, собирает список изменений (для логов).
// Возвращает { changed, changes }.
export function rewriteEligibility(node, changes = [], path = '$') {
  if (Array.isArray(node)) {
    node.forEach((item, i) => rewriteEligibility(item, changes, `${path}[${i}]`));
    return { changed: changes.length > 0, changes };
  }
  if (!node || typeof node !== 'object') {
    return { changed: changes.length > 0, changes };
  }

  for (const key of Object.keys(node)) {
    const childPath = `${path}.${key}`;
    const val = node[key];

    // 1) Булевы флаги eligibility: false -> true.
    if (BOOLEAN_ELIGIBLE_FIELDS.includes(key) && val === false) {
      node[key] = true;
      changes.push(`${childPath}: false -> true`);
      continue;
    }

    // 2) Поля-причины отказа: удаляем целиком.
    if (REASON_FIELDS_TO_DROP.includes(key) && val != null) {
      delete node[key];
      changes.push(`${childPath}: удалено поле-причина отказа`);
      continue;
    }

    // 3) failureDetails.case === "ineligible" -> нейтрализуем.
    if (key === 'case' && val === INELIGIBLE_CASE) {
      node[key] = NEUTRALIZED_CASE;
      changes.push(`${childPath}: "${INELIGIBLE_CASE}" -> "${NEUTRALIZED_CASE}"`);
      continue;
    }

    // 4) Спуск вглубь.
    if (val && typeof val === 'object') {
      rewriteEligibility(val, changes, childPath);
    }
  }

  return { changed: changes.length > 0, changes };
}

// Дозаполнение тарифов на ответе loadCodeAssist: если клиент не увидит текущий
// тариф, он считает, что тариф не выбран. Добавляем недостающие поля.
export function ensureTierFields(obj, changes = []) {
  if (!obj || typeof obj !== 'object') return { changed: false, changes };

  if (obj.currentTier == null) {
    obj.currentTier = { ...STANDARD_TIER };
    changes.push('$.currentTier: добавлен STANDARD');
  }
  if (obj.allowedTiers == null) {
    obj.allowedTiers = ALLOWED_TIERS.map((t) => ({ ...t }));
    changes.push('$.allowedTiers: добавлен список тарифов');
  }
  return { changed: changes.length > 0, changes };
}
