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

// GA4 に送る行動（本番ドメインでだけ gtag がある）
//   oya_line_click      LINEボタン（cta_id: どのページのどのボタンか）
//   oya_instagram_click Instagram へのリンク
//   oya_analysis_click  個別診断ページへのリンク／直接お支払い
//   oya_analysis_view   個別診断ページを見た
(function () {
  function send(name, params) {
    if (typeof window.gtag !== 'function') return;
    params.page_path = location.pathname; params.transport_type = 'beacon';
    window.gtag('event', name, params);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    if (a.hasAttribute('data-line')) send('oya_line_click', { cta_id: a.getAttribute('data-cta') || a.getAttribute('data-line') });
    else if (/instagram\.com/.test(a.href)) send('oya_instagram_click', {});
    else if (/\/analysis\/|api\/analysis\/apply/.test(a.getAttribute('href') || '')) send('oya_analysis_click', { to: /apply/.test(a.href) ? 'direct_pay' : 'page' });
  });
  if (/\/analysis\/$/.test(location.pathname)) {
    var tries = 0;
    (function wait() { if (typeof window.gtag === 'function') send('oya_analysis_view', {}); else if (tries++ < 20) setTimeout(wait, 250); })();
  }
})();
