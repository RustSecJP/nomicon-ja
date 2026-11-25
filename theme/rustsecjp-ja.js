// RustSecJP: 各ページの本文の先頭に「非公式の日本語訳」の帯を出す
(function () {
  var main = document.querySelector('#mdbook-content main, #content main, main');
  if (!main) return;
  var cfg = window.RUSTSECJP || {};
  var page = location.pathname.split('/').slice(cfg.depth || 2).join('/') || 'index.html';
  var root = typeof path_to_root === 'string' ? path_to_root : '';
  var title = (document.title || '').split(' - ')[0].trim();
  var report = 'https://github.com/RustSecJP/nomicon-ja/issues/new?template=mistranslation.md' +
    '&title=' + encodeURIComponent('誤訳: ' + title) +
    '&body=' + encodeURIComponent('## どのページの、どこ\n\n' + location.href.split('#')[0] + '\n\n## 今の訳\n\n\n## 直す案\n\n\n## 理由（原文の該当箇所など）\n\n');
  var d = document.createElement('div');
  d.className = 'rustsecjp-notice';
  d.innerHTML = '<img class="rustsecjp-mark" src="' + root + 'rustsecjp-mark.png" alt="" width="20" height="20"> ' +
    'これは <a href="' + cfg.originalUrl + '">' + cfg.originalTitle + '</a> の非公式な日本語訳です（' + cfg.version + '）。' +
    '<a href="' + cfg.originalBase + page + '">このページの原文</a>・' +
    '<a href="' + report + '">誤訳を知らせる</a>・' +
    '<a href="https://rustsecjp.github.io/">RustSecJP</a>';
  main.insertBefore(d, main.firstChild);
})();
