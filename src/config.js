// config.js
// -----------------------------------------------------------------------------
// Единственное место со всеми константами PoC. Каждая снабжена ссылкой на то,
// откуда она известна из клиента/исходников оригинального инструмента, чтобы
// демонстрация была воспроизводимой.
// -----------------------------------------------------------------------------

// Настоящий CloudCode-эндпоинт, на который PoC форвардит трафик клиента.
// daily-хост — та же служба, что и продовый cloudcode-pa (его 401 сам называет
// service: cloudcode-pa.googleapis.com).
export const UPSTREAM_DEFAULT = 'https://daily-cloudcode-pa.googleapis.com';

// Поддерживаемые клиентом механизмы override адреса эндпоинта. Нужны только для
// печати инструкции пользователю — куда указать адрес PoC:
//   CLI  читает переменную окружения CLOUD_CODE_URL
//   IDE  читает настройку jetski.cloudCodeUrl в settings.json
export const CLI_ENV_VAR = 'CLOUD_CODE_URL';
export const IDE_SETTING = 'jetski.cloudCodeUrl';

// Порт PoC по умолчанию (произвольный свободный).
export const DEFAULT_PORT = 8788;

// -----------------------------------------------------------------------------
// Имена полей, образующих региональный гейт eligibility. Используются в
// --rewrite-режиме, чтобы показать: клиент принимает ответ без проверки
// целостности (мы правим эти поля, и клиент верит результату).
// -----------------------------------------------------------------------------

// Булевы флаги: где значение false — делаем true.
export const BOOLEAN_ELIGIBLE_FIELDS = ['isEligible', 'eligible'];

// Поля-причины отказа: удаляем целиком.
export const REASON_FIELDS_TO_DROP = ['ineligibleReason', 'ineligibleTiers', 'ineligible'];

// failureDetails.case: "ineligible" -> заведомо несуществующий кейс, чтобы
// ветка обработки отказа не сработала.
export const INELIGIBLE_CASE = 'ineligible';
export const NEUTRALIZED_CASE = 'NEVER_MATCH';

// Значения "нормального тарифа" для дозаполнения ответа loadCodeAssist.
export const STANDARD_TIER = { id: 'STANDARD', hasOnboardedPreviously: true };
export const ALLOWED_TIERS = [{ id: 'STANDARD', name: 'Standard', isDefault: true }];
