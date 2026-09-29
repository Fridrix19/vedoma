import type { verifyDocument } from './documents';

// Страница проверки подлинности документа — открывается по QR-коду из справки.
// Можно выбрать полученный PDF: браузер посчитает его SHA-256 и сравнит с подписанным.

type Result = ReturnType<typeof verifyDocument>;

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const msk = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

export function verifyPage(docId: string, v: Result): string {
  const ok = Boolean(v?.valid);
  const title = !v ? 'Документ не найден' : ok ? 'Подпись действительна' : 'Подпись недействительна';
  const lead = !v
    ? `Документа с номером ${esc(docId)} нет в реестре UniFlow. Проверьте номер или отсканируйте QR-код ещё раз.`
    : ok
      ? 'Документ выдан вузом через UniFlow, подписан электронной подписью и с момента подписания не изменялся.'
      : 'Файл документа изменён или подпись не совпадает с ключом вуза. Не принимайте этот документ.';
  const rows = v
    ? [
        ['Документ', v.document],
        ['Номер', v.docId],
        ['Кому выдан', v.issuedTo],
        ['Кем подписан', v.issuer],
        ['Дата подписи', `${msk(v.signedAt)} (МСК)`],
        ['Алгоритм', v.alg],
        ['Ключ вуза', v.keyId],
        ['SHA-256 файла', v.sha256],
      ]
    : [];
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Проверка документа ${esc(docId)} · UniFlow</title>
<style>
  :root { --ink:#19283b; --muted:#5b6b7b; --line:#dfe6e8; --bg:#f3f6f7; --ok:#1b7f4b; --bad:#b3261e; --brand:#0b5361; }
  * { box-sizing:border-box } body { margin:0; font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg) }
  main { max-width:560px; margin:0 auto; padding:24px 16px 40px }
  .brand { font-weight:700; color:var(--brand); letter-spacing:.02em; margin-bottom:16px }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:14px }
  .status { display:flex; gap:12px; align-items:flex-start }
  .icon { flex:none; width:40px; height:40px; border-radius:50%; display:grid; place-items:center; color:#fff; font-size:22px; font-weight:700; background:${v ? (ok ? 'var(--ok)' : 'var(--bad)') : 'var(--muted)'} }
  h1 { font-size:20px; margin:4px 0 4px } p { margin:0; color:var(--muted) }
  dl { display:grid; grid-template-columns:auto 1fr; gap:8px 14px; margin:0 } dt { color:var(--muted) } dd { margin:0; overflow-wrap:anywhere }
  label.btn { display:block; text-align:center; background:var(--brand); color:#fff; border-radius:10px; padding:12px; font-weight:600; cursor:pointer }
  input[type=file] { display:none } #fileres { margin-top:10px; font-weight:600 }
  .demo { font-size:13px; color:var(--muted) }
</style></head><body><main>
  <div class="brand">UniFlow · проверка подлинности</div>
  <div class="card status"><div class="icon">${v ? (ok ? '✓' : '!') : '?'}</div>
    <div><h1>${title}</h1><p>${lead}</p></div></div>
  ${v ? `<div class="card"><dl>${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl></div>
  <div class="card">
    <p style="margin-bottom:12px">Сверьте файл, который вам прислали: он должен совпасть с подписанным до байта.</p>
    <label class="btn">Выбрать PDF для сверки<input type="file" id="file" accept="application/pdf,.pdf"></label>
    <div id="fileres" aria-live="polite"></div>
  </div>` : ''}
  <p class="demo">Демонстрационная версия для хакатона MAX: подпись Ed25519 ключом сервера вуза.
  В реальном вузе здесь проверяется усиленная квалифицированная ЭП (ГОСТ Р 34.10-2012).</p>
</main>
${v ? `<script>
  const expected = ${JSON.stringify(v.sha256)};
  document.getElementById('file').addEventListener('change', async (e) => {
    const out = document.getElementById('fileres');
    const f = e.target.files[0]; if (!f) return;
    out.style.color = ''; out.textContent = 'Проверяю…';
    try {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const same = hash === expected;
      out.style.color = same ? 'var(--ok)' : 'var(--bad)';
      out.textContent = same ? '✓ Файл совпадает с подписанным документом' : '✗ Файл отличается от подписанного — он был изменён';
    } catch { out.textContent = 'Не удалось прочитать файл. Откройте страницу по https.'; }
  });
</script>` : ''}
</body></html>`;
}
