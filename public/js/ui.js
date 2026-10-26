/* ui.js — маленькие помощники для построения DOM без innerHTML (защита от XSS и совместимость с CSP). */
(function () {
  'use strict';

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') Object.keys(v).forEach(function (s) { el.style.setProperty(s, v[s]); });
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function num(x, digits) { return x === null || x === undefined ? '—' : Number(x).toLocaleString('ru-RU', { maximumFractionDigits: digits === undefined ? 1 : digits }); }

  window.UI = { h: h, clear: clear, cap: cap, fmtDate: fmtDate, num: num };
})();
