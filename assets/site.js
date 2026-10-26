// 親の学習塾 HP 共通スクリプト
//
// LINE 友だち追加ボタンは <a data-line="入口名" href="https://lin.ee/Ph97ydn"> と書く。
// LINE公式アカウントの「流入経路分析」で入口ごとの URL を作ったら、下の LINE_URLS に足すだけで
// その入口のボタンが計測用 URL に切り替わる（未設定の入口は基本 URL のまま）。
(function () {
  var LINE_URLS = {
    // 'top': 'https://lin.ee/xxxxxxx',
    // 'column': 'https://lin.ee/xxxxxxx',
    // 'analysis': 'https://lin.ee/xxxxxxx',
    // 'about': 'https://lin.ee/xxxxxxx',
    // 'events': 'https://lin.ee/xxxxxxx',
    // 'line': 'https://lin.ee/xxxxxxx',
  };
  var links = document.querySelectorAll('a[data-line]');
  for (var i = 0; i < links.length; i++) {
    var url = LINE_URLS[links[i].getAttribute('data-line')];
    if (url) links[i].href = url;
    links[i].target = '_blank';
    links[i].rel = 'noopener';
  }
})();
