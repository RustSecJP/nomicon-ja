// RustSecJP: 各ページの本文の先頭に「非公式の日本語訳」の帯を出す
(function () {
  var main = document.querySelector('#mdbook-content main, #content main, main');
  if (!main) return;
  var cfg = window.RUSTSECJP || {};
  var page = location.pathname.split('/').slice(cfg.depth || 2).join('/') || 'index.html';
  var d = document.createElement('div');
  d.className = 'rustsecjp-notice';
  d.innerHTML = 'これは <a href="' + cfg.originalUrl + '">' + cfg.originalTitle + '</a> の非公式な日本語訳です（' + cfg.version + '）。' +
    '<a href="' + cfg.originalBase + page + '">このページの原文</a>・' +
    '<a href="https://rustsecjp.github.io/">RustSecJP</a>';
  main.insertBefore(d, main.firstChild);
})();
