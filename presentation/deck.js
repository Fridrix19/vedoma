// Подстановка служебных значений из private.js и масштаб под окно (на печать не влияет).
(function () {
  var P = Object.assign({}, window.PRIVATE_EXAMPLE || {}, window.PRIVATE || {});
  P.botLink = P.botLink || 'https://max.ru/t302_hakaton_bot';
  P.repoShort = (P.repoUrl || '').replace(/^https?:\/\//, '') || (P.commit ? 'commit ' + P.commit.slice(0, 7) + ' · ' + (P.tag || '') : '');
  document.querySelectorAll('[data-p]').forEach(function (el) {
    var v = P[el.getAttribute('data-p')];
    el.textContent = v && String(v).trim() ? v : '— впишите в private.js —';
    if (!(v && String(v).trim())) el.style.color = '#b42318';
  });
  function fit() {
    var w = document.documentElement.clientWidth - 40;
    document.documentElement.style.setProperty('--fit', Math.min(1, w / 1920));
  }
  fit();
  window.addEventListener('resize', fit);
})();
