-- B04-a S1 repair: the crosswalk name key now keeps every Unicode number, as
-- nameKey in lib/menus/import/matching.ts does. The S1 key kept only
-- [:alnum:], which dropped '½' (No) from '½ Pint', so '½ Pint' and 'Pint'
-- became one candidate key and made each other ambiguous.
--
-- Only private.menu_crosswalk_name_key(text) is replaced. CREATE OR REPLACE
-- keeps its signature, owner and ACL; it stays SQL, IMMUTABLE and with an
-- empty search_path. The key is transient (computed per proposal run, never
-- stored), so no row, receipt, locator, variant or content hash changes and no
-- earlier proposal is replayed or reclassified.
--
-- Steps in the TypeScript order:
--   1. NFC (no compatibility normalization).
--   2. Lower case of the whole string under root ICU ("und-x-icu"), which, as
--      String.prototype.toLowerCase, maps a final sigma to 'ς' and 'İ' to 'i'
--      plus U+0307.
--   3. Remove everything but letters, numbers and JavaScript whitespace
--      (/[^\p{L}\p{N}\s]/gu). Under an ICU collation [:alnum:] is ICU's
--      u_isalnum, letters (L) and decimal digits (Nd) only, so Nl and No are
--      listed explicitly.
--   4. Collapse JavaScript whitespace (\s: the same list as S1) to one space.
--   5. Trim.
--
-- Nl and No ranges: Unicode 17.0 general categories as reported by Node
-- 24.18.0 (process.versions.unicode = '17.0'), \p{Nl} 13 ranges / 239 code
-- points and \p{No} 72 ranges / 915 code points. Letters and Nd come from the
-- server's ICU, so a character newer than the server's ICU Unicode version,
-- or a NFC/case mapping that changed between versions, can still differ from
-- Node until both run the same Unicode version.
create or replace function private.menu_crosswalk_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      lower(normalize(coalesce(p_name, ''), nfc) collate pg_catalog."und-x-icu"),
      '[^[:alnum:]'
        -- Nl (Unicode 17.0)
        || 'ᛮ-ᛰⅠ-ↂↅ-ↈ〇〡-〩'
        || '〸-〺ꛦ-ꛯ\U00010140-\U00010174\U00010341'
        || '\U0001034A\U000103D1-\U000103D5\U00012400-\U0001246E'
        || '\U00016FF4-\U00016FF6'
        -- No (Unicode 17.0)
        || '²³¹¼-¾৴-৹୲-୷'
        || '௰-௲౸-౾൘-൞൰-൸༪-༳'
        || '፩-፼៰-៹᧚⁰⁴-⁹₀-₉'
        || '⅐-⅟↉①-⒛⓪-⓿❶-➓⳽'
        || '㆒-㆕㈠-㈩㉈-㉏㉑-㉟㊀-㊉'
        || '㊱-㊿꠰-꠵\U00010107-\U00010133'
        || '\U00010175-\U00010178\U0001018A\U0001018B\U000102E1-\U000102FB'
        || '\U00010320-\U00010323\U00010858-\U0001085F\U00010879-\U0001087F'
        || '\U000108A7-\U000108AF\U000108FB-\U000108FF\U00010916-\U0001091B'
        || '\U000109BC\U000109BD\U000109C0-\U000109CF\U000109D2-\U000109FF'
        || '\U00010A40-\U00010A48\U00010A7D\U00010A7E\U00010A9D-\U00010A9F'
        || '\U00010AEB-\U00010AEF\U00010B58-\U00010B5F\U00010B78-\U00010B7F'
        || '\U00010BA9-\U00010BAF\U00010CFA-\U00010CFF\U00010E60-\U00010E7E'
        || '\U00010F1D-\U00010F26\U00010F51-\U00010F54\U00010FC5-\U00010FCB'
        || '\U00011052-\U00011065\U000111E1-\U000111F4\U0001173A\U0001173B'
        || '\U000118EA-\U000118F2\U00011C5A-\U00011C6C\U00011FC0-\U00011FD4'
        || '\U00016B5B-\U00016B61\U00016E80-\U00016E96\U0001D2C0-\U0001D2D3'
        || '\U0001D2E0-\U0001D2F3\U0001D360-\U0001D378\U0001E8C7-\U0001E8CF'
        || '\U0001EC71-\U0001ECAB\U0001ECAD-\U0001ECAF\U0001ECB1-\U0001ECB4'
        || '\U0001ED01-\U0001ED2D\U0001ED2F-\U0001ED3D\U0001F100-\U0001F10C'
        -- JavaScript \s
        || '\t\n\v\f\r    -     　﻿]',
      '', 'g'),
    '[\t\n\v\f\r    -     　﻿]+',
    ' ', 'g'), ' ');
$$;
