/* Filmez provider - Nuvio plugin
 * Films only, MaxStream only (uprot.net msf behind the image captcha, vision worker).
 * Same WordPress database as OnlineSerieTV: same posts, same uprot links.
 */

var SITE = {
  name: 'Filmez',
  icon: '\uD83C\uDFA5',
  base: 'https://filmez.club',
  filmType: 'movie',
  seriesType: null
};

var ZW_PREFIX = ["\u200B", "\u200C", "\u200D", "\u2060", "\u2061", "\u2062", "\u2063", "\u2064"];

function sortPrefix(qualityKey, syncLevel) {
  var qNum = Number(String(qualityKey || "").replace(/[^0-9]/g, "")) || 0;
  var r = 3;
  if (qNum >= 2160) r = 0;
  else if (qNum >= 1080) r = 1;
  else if (qNum >= 720) r = 2;

  var s = 2;
  if (syncLevel === "green" || syncLevel === 0) s = 0;
  else if (syncLevel === "yellow" || syncLevel === 1) s = 1;
  else if (syncLevel === "red" || syncLevel === 3) s = 3;

  return ZW_PREFIX[r] + ZW_PREFIX[s];
}

var SITE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';

function _customFetch(url, options) {
  var fetchFn = (typeof fetch !== 'undefined') ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (!fetchFn) return Promise.reject(new Error('fetch is not defined in runtime'));
  return fetchFn(url, options || {});
}

function _getJson(url, headers) {
  return _customFetch(url, { headers: headers || {} })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function _siteGet(url) {
  return _customFetch(url, { headers: { 'User-Agent': SITE_UA, 'Referer': SITE.base + '/' } })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .catch(function () { return ''; });
}

function _decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// Same shape as WordPress slugs: "Süss l'ebreo" -> "suss-l-ebreo", "Dexter: Resurrection" -> "dexter-resurrection".
function slugify(s) {
  var t = _decodeEntities(s);
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { }
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// =========================================================================
// TMDB
// =========================================================================
function tmdbMeta(rawId, isMovie) {
  var kind = isMovie ? 'movie' : 'tv';
  function pick(d) {
    if (!d) return null;
    var title = d.title || d.name;
    var original = d.original_title || d.original_name;
    if (!title && !original) return null;
    return { title: title, original: original, year: Number(String(d.release_date || d.first_air_date || '').substring(0, 4)) || 0 };
  }
  if (/^\d+$/.test(rawId)) {
    return _getJson('https://api.themoviedb.org/3/' + kind + '/' + rawId + '?api_key=' + TMDB_API_KEY + '&language=it-IT').then(pick);
  }
  if (/^tt\d+$/i.test(rawId)) {
    return _getJson('https://api.themoviedb.org/3/find/' + rawId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id&language=it-IT')
      .then(function (d) {
        var list = d ? (isMovie ? d.movie_results : d.tv_results) : null;
        return pick(list && list[0]);
      });
  }
  return Promise.resolve(null);
}

// =========================================================================
// SEARCH (WordPress REST)
// =========================================================================
// Rendered titles look like "Oppenheimer 2023" or "Suss l ebreo 1940 – SUB ITA"; series have no year.
function parsePost(post) {
  var raw = _decodeEntities(post && post.title && post.title.rendered);
  var isSub = /SUB[\s-]*ITA\s*$/i.test(raw) || /-sub-ita(?:-\d+)?$/.test(post.slug || '');
  var t = raw.replace(/\s*[\u2013\u2014-]?\s*SUB[\s-]*ITA\s*$/i, '').trim();
  var ym = t.match(/\s\(?((?:19|20)\d{2})\)?$/);
  if (ym) t = t.substring(0, ym.index);
  var tail = t.split(/\s*(?::|\s[\u2013\u2014-]\s)\s*/).pop();
  return { link: post.link, key: slugify(t), tail: tail !== t ? slugify(tail) : '', year: ym ? Number(ym[1]) : 0, isSub: isSub };
}

// Similar titles (Dexter / Dexter: New Blood, remakes) only pass with the same title and year.
// "Game Of Thrones: House of the Dragon" matches "House of the Dragon" only as a last resort and with a known year.
function rankPosts(posts, keys, year, isMovie) {
  var section = isMovie ? '/film/' : '/serietv/';
  var seen = {};
  var out = [];
  (posts || []).forEach(function (p) {
    if (!p || !p.link || seen[p.link] || String(p.link).indexOf(section) < 0) return;
    seen[p.link] = true;
    var c = parsePost(p);
    c.weak = keys.indexOf(c.key) < 0;
    if (c.weak && (!year || !c.tail || keys.indexOf(c.tail) < 0)) return;
    if (year && (isMovie || c.year) && (!c.year || Math.abs(c.year - year) > 1)) return;
    c.yearDiff = (year && c.year) ? Math.abs(c.year - year) : 0;
    out.push(c);
  });
  out.sort(function (a, b) { return (a.weak - b.weak) || (a.isSub - b.isSub) || (a.yearDiff - b.yearDiff); });
  return out;
}

function findPosts(meta, isMovie) {
  var api = SITE.base + '/wp-json/wp/v2/' + (isMovie ? SITE.filmType : SITE.seriesType);
  var fields = '&per_page=20&_fields=slug,link,title';
  var keys = [];
  var a = slugify(meta.title);
  var b = slugify(meta.original);
  // Some posts carry both titles: "Game of thrones – Il Trono di Spade".
  var both = a && b && a !== b;
  [a, b, both && b + '-' + a, both && a + '-' + b].forEach(function (k) {
    if (k && keys.indexOf(k) < 0) keys.push(k);
  });
  var y = meta.year;
  var slugs = [];
  keys.forEach(function (k) {
    if (isMovie) {
      if (y) [y, y - 1, y + 1].forEach(function (yy) { slugs.push(k + '-' + yy, k + '-' + yy + '-sub-ita'); });
    } else {
      slugs.push(k);
      if (y) slugs.push(k + '-' + y);
    }
  });
  var titles = [meta.title, meta.original].filter(function (t, i, a) { return t && a.indexOf(t) === i; });

  function search(i, acc) {
    if (i >= titles.length) return Promise.resolve(rankPosts(acc, keys, y, isMovie));
    return _getJson(api + '?search=' + encodeURIComponent(_decodeEntities(titles[i])) + fields, { 'User-Agent': SITE_UA })
      .then(function (list) {
        var all = acc.concat(list || []);
        var ranked = rankPosts(all, keys, y, isMovie);
        return (ranked.length && !ranked[0].weak) ? ranked : search(i + 1, all);
      });
  }

  var exact = slugs.length
    ? _getJson(api + '?slug=' + encodeURIComponent(slugs.join(',')) + fields, { 'User-Agent': SITE_UA })
    : Promise.resolve([]);
  return exact.then(function (list) {
    var ranked = rankPosts(list, keys, y, isMovie);
    return ranked.length ? ranked : search(0, []);
  });
}

// =========================================================================
// PAGE PARSING
// =========================================================================
function pageYear(html) {
  var m = html.match(/Anno:\s*<i>\s*((?:19|20)\d{2})/i);
  return m ? Number(m[1]) : 0;
}

function filmLink(html) {
  var m = html.replace(/<!--[\s\S]*?-->/g, '').match(/https?:\/\/uprot\.net\/msf\/[A-Za-z0-9]+/i);
  return m ? m[0] : null;
}

// Rows: <td>Dexter 01x02 </td><td><a href='https://uprot.net/msf/...'>MaxStream</a>, grouped under "Stagione N".
function episodeLink(html, season, episode) {
  var clean = html.replace(/<!--[\s\S]*?-->/g, '');
  var re = /<td>([^<]*?)(\d{1,2})x(\d{1,3})(?!\d)([^<]*)<\/td>\s*<td>\s*<a[^>]+href=["'](https?:\/\/uprot\.net\/msf\/[A-Za-z0-9]+)/gi;
  var best = null;
  var m;
  while ((m = re.exec(clean)) !== null) {
    if (Number(m[2]) !== season || Number(m[3]) !== episode) continue;
    var header = clean.substring(Math.max(0, clean.lastIndexOf('Stagione', m.index)), m.index).split('</b>')[0];
    var isSub = /SUB/i.test(m[1] + m[4]) || /SUB/i.test(header);
    if (!isSub) return { url: m[5], isSub: false };
    if (!best) best = { url: m[5], isSub: true };
  }
  return best;
}

function findLink(meta, isMovie, season, episode) {
  return findPosts(meta, isMovie).then(function (cands) {
    function next(i) {
      if (i >= cands.length || i >= 3) return null;
      return _siteGet(cands[i].link).then(function (html) {
        if (!html) return next(i + 1);
        if (!isMovie) {
          var py = pageYear(html);
          if (meta.year && py ? Math.abs(py - meta.year) > 1 : cands[i].weak) return next(i + 1);
          var ep = episodeLink(html, season, episode);
          return ep || next(i + 1);
        }
        var url = filmLink(html);
        return url ? { url: url, isSub: cands[i].isSub } : next(i + 1);
      });
    }
    return next(0);
  });
}

// =========================================================================
// MAXSTREAM (uprot.net msf) - same pipeline as the CB01 / Eurostreaming plugins
// =========================================================================
// Endpoints and key are masked (reversed, XOR, hex): obfuscation against code searches, not a secret.
// UC_URLS solve captchas (add more to spread the Workers AI quota); UC_PEERS are only read for cached players.
var UC_MASK = 'q7Lx2Vd';
var UC_URLS = [
  '075228564124011a45230f1c670b1f5e2014573a0a14472356573350471a220f53324915523e1d5a220d06186342412610055f',
  '075228564124011a45230f1c640b1f5e2014573a0a144723565d3f120459611946260519543c0d1d795e0247380c5a',
  '075228564124011a45230f1c6455405022115f3b0d034361491f2505185b2d565d3f12045961195a351001562f0847794b4b443c0c463e',
  '075228564124011a45230f1c62560956211b1c390d07422255533e0705472d1b42234b5e0d3f0846220c',
  '075228564124011a45230f1c6353461a7448006752414224105c37011d19231144230a5c56241b462605124739571d6c1701433810',
  '075228564124011a45230f1c390a185b201d5e3801015862175b20111f1a2d1051221410543c0d1d795e0247380c5a'
];
var UC_PEERS = [
  '075228564124011a45230f1c670b1f5e2014573a0a14472356573350471a220f53324915523e1d5a220d06186342412610055f',
  '075228564124011a45230f1c640b1f5e2014573a0a144723565d3f120459611946260519543c0d1d795e0247380c5a',
  '075228564124011a45230f1c6455405022115f3b0d034361491f2505185b2d565d3f12045961195a351001562f0847794b4b443c0c463e',
  '075228564124011a45230f1c62560956211b1c390d07422255533e0705472d1b42234b5e0d3f0846220c',
  '075228564124011a45230f1c6353461a7448006752414224105c37011d19231144230a5c56241b462605124739571d6c1701433810',
  '075228564124011a45230f1c390a185b201d5e3801015862175b20111f1a2d1051221410543c0d1d795e0247380c5a'
];
var UC_KEY = '0959350b5b2414';
var UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36'
];

function getRandomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

var UP_UA = getRandomUA();
// Uprot sets these after the first solved captcha; without them some links ask for a second one.
var UP_COOKIE2 = 'ccd14f7d7ee32ff386eefcfda920a476';

function _hexToText(hex) {
  var out = '';
  for (var i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return out;
}

function _unmask(hex) {
  var s = _hexToText(hex);
  var out = '';
  for (var i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ UC_MASK.charCodeAt(i % UC_MASK.length));
  return out.split('').reverse().join('');
}

function unpackPackedJs(packed) {
  var m = packed.match(/\}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\s*\.split\(['"]\|['"]\)/);
  if (!m) return null;
  var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  var a = m[2] === "[]" ? 62 : parseInt(m[2], 10);
  var c = parseInt(m[3], 10);
  var k = m[4].split("|");
  var ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function toBaseN(n) {
    if (n < a) return ALPHA[n];
    return toBaseN(Math.floor(n / a)) + ALPHA[n % a];
  }
  var dict = {};
  for (var i = 0; i < c; i++) {
    var key = toBaseN(i);
    dict[key] = (k[i] && k[i].length) ? k[i] : key;
  }
  return p.replace(/\b(\w+)\b/g, function (_, w) { return dict[w] !== undefined ? dict[w] : w; });
}

function parseUpCaptcha(html) {
  var field = (html.match(/name=["'](upcapt_[A-Za-z0-9]+)["']/) || [])[1];
  var first = html.search(/<[^>]+class=["'][^"']*upcaptcha-cell[^"']*["'][^>]*data-idx=/);
  if (!field || first < 0) return null;
  // The object to look for is the last <strong> before the grid.
  var before = html.substring(Math.max(0, first - 4000), first);
  var strongRe = /<strong>([^<]{1,40})<\/strong>/g;
  var m;
  var target = null;
  while ((m = strongRe.exec(before)) !== null) target = m[1].trim();
  var cellRe = /<[^>]+class=["'][^"']*upcaptcha-cell[^"']*["'][^>]*data-idx=["'](\d+)["'][^>]*>[\s\S]*?<img[^>]+src=["'](data:image\/(?:jpeg|png);base64,[A-Za-z0-9+\/=]+)["']/g;
  var cells = [];
  while ((m = cellRe.exec(html)) !== null) cells.push({ idx: Number(m[1]), src: m[2] });
  if (!target || cells.length < 2) return null;
  return { field: field, target: target, cells: cells };
}

// A random worker goes first so the quotas drain evenly; the next one takes over when it fails.
// The worker answers with grid positions; Uprot wants the cells' data-idx values.
function solveUpCaptcha(cap) {
  var urls = UC_URLS.map(_unmask);
  if (urls.length > 1) {
    var start = Math.floor(Math.random() * urls.length);
    urls = urls.slice(start).concat(urls.slice(0, start));
  }
  var body = JSON.stringify({ target: cap.target, images: cap.cells.map(function (c) { return c.src; }) });
  function ask(i) {
    if (i >= urls.length) return Promise.resolve(null);
    return _customFetch(urls[i], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-auth': _unmask(UC_KEY) },
      body: body
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.indices)) return ask(i + 1);
        var picked = [];
        data.indices.forEach(function (n) {
          var c = cap.cells[n];
          if (c && picked.indexOf(c.idx) < 0) picked.push(c.idx);
        });
        picked.sort(function (a, b) { return a - b; });
        return picked.length ? picked.join(',') : null;
      });
  }
  return ask(0);
}

// Runtimes join several Set-Cookie with ",".
function upPost(link, body, jar, ua) {
  var activeUa = ua || UP_UA;
  var headers = {
    'User-Agent': activeUa,
    'Origin': 'https://uprot.net',
    'Referer': 'https://uprot.net/',
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  var cookie = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
  if (cookie) headers.Cookie = cookie;
  return _customFetch(link, { method: 'POST', headers: headers, body: body, redirect: 'manual' })
    .then(function (r) {
      var setCookie = (r.headers && typeof r.headers.get === 'function' && r.headers.get('set-cookie')) || '';
      var re = /(?:^|,)\s*([A-Za-z0-9_\-]+)=([^;,]*)/g;
      var m;
      while ((m = re.exec(setCookie)) !== null) jar[m[1]] = m[2];
      return r.text().then(function (html) { return html || ''; });
    });
}

function _atob(b64) {
  if (typeof atob === 'function') return atob(b64);
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('binary');
  return null;
}

function _sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// The real link is the base64 /uprots/ URL behind the unlocked button; decoys sit in comments/hidden blocks.
// Format-agnostic: try known shapes, then any atob(...) of string vars/literals, then any base64 literal.
var UPROT_URL = /^https?:\/\/[^\s"'<>\/]+\/uprot[a-z]{0,4}\/[^\s"'<>]+$/i;

function _tryUprot(b64) {
  if (!b64 || b64.length < 16) return null;
  var dec = null;
  try { dec = _atob(b64.replace(/\s+/g, '')); } catch (e) { return null; }
  return dec && UPROT_URL.test(dec) ? dec : null;
}

function findButtok(html) {
  var clean = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<div[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  var r, m;
  m = clean.match(/id=["']buttok["'][^>]*onclick=["'][^"']*atob\(["']([A-Za-z0-9+/=]+)["']\)/i) ||
      clean.match(/onclick=["'][^"']*atob\(["']([A-Za-z0-9+/=]+)["']\)[^"']*["'][^>]*id=["']buttok["']/i);
  if (m && (r = _tryUprot(m[1]))) return r;
  var vars = {};
  var vre = /(?:\b(?:let|var|const)\s+|[;{\s])([A-Za-z_$][\w$]*)\s*=\s*(["'`])([A-Za-z0-9+\/=\s]*)\2/g;
  while ((m = vre.exec(clean)) !== null) vars[m[1]] = m[3];
  var are = /atob\(\s*([^()]{1,2000}?)\s*\)/g;
  while ((m = are.exec(clean)) !== null) {
    var parts = m[1].split('+'), b64 = '', ok = true;
    for (var i = 0; i < parts.length && ok; i++) {
      var t = parts[i].trim(), lit = t.match(/^(["'`])([A-Za-z0-9+\/=\s]*)\1$/);
      if (lit) b64 += lit[2];
      else if (Object.prototype.hasOwnProperty.call(vars, t)) b64 += vars[t];
      else ok = false;
    }
    if (ok && (r = _tryUprot(b64))) return r;
  }
  m = clean.match(/href=["'](https?:\/\/[^"'\/]+\/uprot[a-z]{0,4}\/[^\/"']+\/[^\/"']+\/?)["'][^>]*>\s*<button/i);
  if (m) return m[1];
  var lre = /["'`]([A-Za-z0-9+\/]{24,}={0,2})["'`]/g;
  while ((m = lre.exec(clean)) !== null) if ((r = _tryUprot(m[1]))) return r;
  return null;
}

// A wrong answer, or a changed cookie2, comes back with a new captcha: up to 3 answers.
function unlockUprot(link, ua) {
  var activeUa = ua || UP_UA;
  var jar = { uprot_session_pxx: '1' };
  var getHeaders = {
    'User-Agent': activeUa,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
  };
  function attempt(html, left) {
    var direct = findButtok(html);
    if (direct) return Promise.resolve(direct);
    var cap = parseUpCaptcha(html);
    if (!cap || !jar.PHPSESSID || left <= 0) {
      if (!cap) console.log('[uprot] no button and no captcha: page format changed? ' + link);
      return Promise.resolve(null);
    }
    return solveUpCaptcha(cap).then(function (answer) {
      return _sleep(1500).then(function () {
        return upPost(link, answer ? cap.field + '=' + encodeURIComponent(answer) : '', jar, activeUa).then(function (next) {
          return attempt(next, left - 1);
        });
      });
    });
  }
  return _customFetch(link, { headers: getHeaders, redirect: 'manual' })
    .then(function (r) {
      var setCookie = (r.headers && typeof r.headers.get === 'function' && r.headers.get('set-cookie')) || '';
      var re = /(?:^|,)\s*([A-Za-z0-9_\-]+)=([^;,]*)/g;
      var m;
      while ((m = re.exec(setCookie)) !== null) jar[m[1]] = m[2];
      return r.text().then(function (html) { return attempt(html || '', 3); });
    })
    .catch(function () {
      return upPost(link, '', jar, activeUa).then(function (html) { return attempt(html, 3); });
    });
}

function _absoluteUrl(loc, base) {
  if (/^https?:\/\//i.test(loc)) return loc;
  if (loc.indexOf('//') === 0) return 'https:' + loc;
  var origin = (base.match(/^https?:\/\/[^\/]+/) || [''])[0];
  return origin + (loc.charAt(0) === '/' ? '' : '/') + loc;
}

// uprots -> 302 maxmonN.site/freeswatcee/{VID}/... -> 302 whose body hides the player URL (hex, reversed).
// Runtimes that always follow redirects lose the body, so the player URL is rebuilt from the VID.
var MS_PLAYER = /^https?:\/\/(?:www\.)?maxstream\.video\/(?!uprot)[A-Za-z0-9]+\/[A-Za-z0-9]+\/?$/i;

var _cachedMaxstreamPrefix = null;
var _cachedPrefixTime = 0;

// Prefix order: last live one seen, remote list (editable on GitHub without a release), hardcoded fallback.
var MAXSTREAM_PREFIX_URL = 'https://raw.githubusercontent.com/qwertyuiop8899/PriSynx/main/maxstream.json';
var MAXSTREAM_PREFIXES = ['emiyiuc5', 'emiatgfr', 'emisghyy'];
var _remotePrefixes = null;

function _rememberPrefix(p) {
  if (p && /^[A-Za-z0-9]{4,16}$/.test(p) && p !== 'uprots' && p !== 'uprot') {
    _cachedMaxstreamPrefix = p;
    _cachedPrefixTime = Date.now();
  }
}

function getMaxstreamPrefixes() {
  var head = _cachedMaxstreamPrefix ? [_cachedMaxstreamPrefix] : [];
  function merge(list) {
    var out = [];
    head.concat(list || [], MAXSTREAM_PREFIXES).forEach(function (p) {
      if (p && /^[A-Za-z0-9]{4,16}$/.test(p) && out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }
  if (_remotePrefixes) return Promise.resolve(merge(_remotePrefixes));
  return _customFetch(MAXSTREAM_PREFIX_URL, { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r && r.ok ? r.text() : ''; })
    .then(function (t) {
      var j = null;
      try { j = JSON.parse(t || 'null'); } catch (e) {}
      _remotePrefixes = j && Array.isArray(j.prefixes) ? j.prefixes : [];
      return merge(_remotePrefixes);
    })
    .catch(function () { _remotePrefixes = []; return merge([]); });
}

function getActiveMaxstreamPrefix() {
  return getMaxstreamPrefixes().then(function (list) { return list[0]; });
}

function normalizeMaxstreamPlayer(url) {
  if (!url) return Promise.resolve(null);
  var m = String(url).match(/^https?:\/\/(?:www\.)?maxstream\.video\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?$/i);
  // A real player URL carries the live prefix: keep it and remember it.
  if (m) _rememberPrefix(m[1]);
  return Promise.resolve(url);
}

function maxstreamPlayerUrl(uprotsUrl, ua) {
  var activeUa = ua || UP_UA;
  var vid = null;
  function vidFrom(u) {
    var m = String(u || '').match(/\/freeswatc[A-Za-z0-9]*\/([A-Za-z0-9]+)/) || String(u || '').match(/\/videostreax\/[A-Za-z0-9]+\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }
  function guess() {
    if (!vid) return Promise.resolve(null);
    return getMaxstreamPrefixes().then(function (list) {
      list = list.slice(0, 3);
      function tryAt(i) {
        if (i >= list.length) {
          console.log('[maxstream] no working prefix for ' + vid + ' (tried ' + list.join(',') + ')');
          return null;
        }
        var cand = 'https://maxstream.video/' + list[i] + '/' + vid;
        return _customFetch(cand, { headers: { 'User-Agent': activeUa, 'Referer': 'https://maxstream.video/' } })
          .then(function (r) { return r && r.ok ? r.text() : ''; })
          .then(function (t) {
            if (/eval\(function\(p,a,c,k|\.m3u8/i.test(t || '')) { _rememberPrefix(list[i]); return cand; }
            return tryAt(i + 1);
          })
          .catch(function () { return tryAt(i + 1); });
      }
      return tryAt(0);
    });
  }
  function hop(url, referer, left) {
    return _customFetch(url, { headers: { 'User-Agent': activeUa, 'Referer': referer }, redirect: 'manual' })
      .then(function (r) {
        var loc = (r.headers && typeof r.headers.get === 'function' && r.headers.get('location')) || '';
        return r.text().then(function (body) {
          vid = vid || vidFrom(url) || vidFrom(r.url) || vidFrom(loc);
          var hex = String(body || '').match(/rawHex\s*=\s*["']([a-fA-F0-9]{20,8192})["']/);
          if (hex) {
            var player = _hexToText(hex[1]).split('').reverse().join('');
            if (/^https?:\/\/[^\s"'<>]+$/.test(player)) return normalizeMaxstreamPlayer(player, activeUa);
          }
          var next = loc ? _absoluteUrl(loc, url) : '';
          if (!vid && MS_PLAYER.test(next)) return normalizeMaxstreamPlayer(next, activeUa);
          if (!vid && r.url && r.url !== url && MS_PLAYER.test(r.url)) return normalizeMaxstreamPlayer(r.url, activeUa);
          if (next && left > 0) return hop(next, url, left - 1);
          return guess();
        });
      });
  }
  return hop(uprotsUrl, 'https://maxstream.video/', 1).then(function (p) {
    return p ? normalizeMaxstreamPlayer(p, activeUa) : guess();
  }).catch(guess);
}

function maxstreamM3u8(playerUrl, ua) {
  var activeUa = ua || UP_UA;
  return _customFetch(playerUrl, { headers: { 'User-Agent': activeUa, 'Referer': 'https://maxstream.video/' } })
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var text = html || '';
      var packed = text.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\([\s\S]*?\.split\(['"]\|['"]\)[\s\S]*?\)\s*\)/g) || [];
      packed.forEach(function (p) {
        var unpacked = unpackPackedJs(p);
        if (unpacked) text += '\n' + unpacked;
      });
      var m = text.match(/src\s*:\s*["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i) ||
        text.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i);
      return m ? m[1] : null;
    });
}

function hlsQuality(url, headers) {
  return _customFetch(url, { headers: headers })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (txt) {
      var w = 0;
      var h = 0;
      var re = /RESOLUTION=(\d+)x(\d+)/g;
      var m;
      while ((m = re.exec(txt || '')) !== null) {
        if (Number(m[2]) > h) { w = Number(m[1]); h = Number(m[2]); }
      }
      if (!h) return null;
      if (w >= 1800 || h >= 900) return '1080p';
      if (w >= 1200 || h >= 600) return '720p';
      return '480p';
    })
    .catch(function () { return null; });
}

// The workers keep uprot link -> player page for every user: one captcha per link, not per view.
function uprotKey(link) {
  var m = String(link || '').match(/^https?:\/\/uprot\.net\/(ms(?:fi?|ei)\/[A-Za-z0-9+\/=_.-]{4,300}?)\/?$/i);
  return m ? m[1] : null;
}

function cachedPlayer(key) {
  var urls = UC_URLS.concat(UC_PEERS);
  if (!key) return Promise.resolve(null);
  function read(i) {
    if (i >= urls.length) return Promise.resolve(null);
    return _customFetch(_unmask(urls[i]) + '/player?k=' + encodeURIComponent(key), { headers: { 'x-worker-auth': _unmask(UC_KEY) } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && /^https:\/\/maxstream\.video\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(d.player || '') ? d.player : null; })
      .catch(function () { return null; })
      .then(function (player) { return player || read(i + 1); });
  }
  return read(0);
}

function storePlayer(key, player) {
  var m = String(player || '').match(/^https?:\/\/(?:www\.)?maxstream\.video\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?$/i);
  if (!key || !m) return Promise.resolve();
  var body = JSON.stringify({ k: key, player: 'https://maxstream.video/' + m[1] + '/' + m[2] });
  function write(i) {
    if (i >= UC_URLS.length) return Promise.resolve();
    return _customFetch(_unmask(UC_URLS[i]) + '/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-auth': _unmask(UC_KEY) },
      body: body
    })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; })
      .then(function (ok) { return ok ? undefined : write(i + 1); });
  }
  return write(0);
}

function processUprotUrl(link, ua) {
  var activeUa = ua || getRandomUA();
  var key = uprotKey(link);
  function solve() {
    return unlockUprot(link, activeUa)
      .then(function (uprots) { return uprots ? maxstreamPlayerUrl(uprots, activeUa) : null; })
      .then(function (player) {
        if (!player) return null;
        return maxstreamM3u8(player, activeUa).then(function (m3u8) {
          return m3u8 ? storePlayer(key, player).then(function () { return m3u8; }) : null;
        });
      });
  }
  // A cached page without a playlist (file removed or dead prefix) is normalized and retried; if failed, solved again.
  return cachedPlayer(key)
    .then(function (player) {
      if (!player) return null;
      return normalizeMaxstreamPlayer(player, activeUa)
        .then(function (norm) {
          return maxstreamM3u8(norm, activeUa).then(function (m3u8) {
            if (m3u8 && norm !== player) storePlayer(key, norm);
            return m3u8;
          });
        })
        .catch(function () { return null; });
    })
    .then(function (m3u8) { return m3u8 || solve(); })
    .then(function (m3u8) {
      if (!m3u8) return null;
      var headers = { 'User-Agent': activeUa, 'Referer': 'https://maxstream.video/' };
      return hlsQuality(m3u8, headers).then(function (q) {
        return { url: m3u8, quality: q || '720p', behaviorHints: { notWebReady: true }, headers: headers };
      });
    })
    .catch(function () { return null; });
}

// =========================================================================
// ENTRY POINT
// =========================================================================
// Nuvio Mobile shows name + quality + size, NuvioTV name + size: the details go in size, one per line.
function formatStream(s, isMovie, season, episode, isSub) {
  var q = s.quality || '720p';
  var lines = [];
  if (!isMovie) lines.push('\uD83D\uDCFA Stagione ' + season + ' \u00B7 Episodio ' + episode);
  lines.push(isSub ? '\uD83C\uDF0D Originale + \uD83D\uDCAC Sub ITA' : '\uD83C\uDDEE\uD83C\uDDF9 Italiano');
  lines.push('\uD83D\uDDA5\uFE0F ' + q);
  lines.push('\u25B6\uFE0F MaxStream');
  s.name = sortPrefix(q, isSub ? 3 : 2) + SITE.icon + ' ' + SITE.name + ' ' + q + ' \uD83C\uDDEE\uD83C\uDDF9 \u00B7 MaxStream' + (isSub ? ' SUB' : '');
  s.size = lines.join('\n');
  s.title = s.name + '\n' + s.size;
  return s;
}

function getStreams(id, type, season, episode) {
  return new Promise(function (resolve) {
    var parts = String(id || '').replace(/^tmdb:/i, '').trim().split(':');
    var rawId = parts[0];
    var isMovie = String(type || 'movie').toLowerCase() === 'movie';
    if (!isMovie && !SITE.seriesType) return resolve([]);
    var s = Number(season) || Number(parts[1]) || 1;
    var e = Number(episode) || Number(parts[2]) || 1;
    tmdbMeta(rawId, isMovie)
      .then(function (meta) { return meta ? findLink(meta, isMovie, s, e) : null; })
      .then(function (found) {
        if (!found) return null;
        return processUprotUrl(found.url).then(function (st) {
          return st ? formatStream(st, isMovie, s, e, found.isSub) : null;
        });
      })
      .then(function (st) { resolve(st ? [st] : []); })
      .catch(function () { resolve([]); });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
}
if (typeof global !== 'undefined') {
  global.getStreams = getStreams;
}
if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
}
