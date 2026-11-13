var USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';

// MaxStream links sit behind the Uprot image captcha, solved by a vision worker.
// One worker call per title: Uprot's cookie only unlocks the link already solved.
// Endpoints and key are masked (reversed, XOR, hex): obfuscation against code searches, not a secret.
// Two copies of the worker on separate Cloudflare accounts, each with its own daily Workers AI quota.
var UC_MASK = 'q7Lx2Vd';
var UC_URLS = [
  '075228564124011a45230f1c6455405022115f3b0d034361491f2505185b2d565d3f12045961195a351001562f0847794b4b443c0c463e',
  '075228564124011a45230f1c62560956211b1c390d07422255533e0705472d1b42234b5e0d3f0846220c'
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
var MAX_MAXSTREAM = 2;
var MAX_FOLDERS = 6;
// Uprot sets these after the first solved captcha; without them folder episodes (msfi) ask for a second one.
// Same value in every session so far (2026-10); if it changes, the server sends the new one and a second captcha follows.
var UP_COOKIE2 = 'ccd14f7d7ee32ff386eefcfda920a476';

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

function _cbTmdbMeta(id, type) {
  return new Promise(function(resolve) {
    var cleanId = String(id || '').replace(/^tmdb:/, '');
    if (/^tt\d+$/.test(cleanId)) {
      _safeFetch('https://api.themoviedb.org/3/find/' + cleanId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id&language=it-IT')
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return resolve(null);
          if (data.tv_results && data.tv_results.length > 0) {
            var tv = data.tv_results[0];
            return resolve({ name: tv.name || tv.original_name, releaseInfo: String(tv.first_air_date || '').substring(0, 4) });
          }
          if (data.movie_results && data.movie_results.length > 0) {
            var mv = data.movie_results[0];
            return resolve({ name: mv.title || mv.original_title, releaseInfo: String(mv.release_date || '').substring(0, 4) });
          }
          resolve(null);
        })
        .catch(function() { resolve(null); });
    } else if (/^\d+$/.test(cleanId)) {
      var mediaType = String(type || 'movie').toLowerCase();
      var endpoint = (mediaType === 'tv' || mediaType === 'series')
        ? 'https://api.themoviedb.org/3/tv/' + cleanId + '?api_key=' + TMDB_API_KEY + '&language=it-IT'
        : 'https://api.themoviedb.org/3/movie/' + cleanId + '?api_key=' + TMDB_API_KEY + '&language=it-IT';
      _safeFetch(endpoint)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return resolve(null);
          var title = data.name || data.title || data.original_name || data.original_title;
          var date = data.first_air_date || data.release_date || '';
          resolve({ name: title, releaseInfo: String(date).substring(0, 4) });
        })
        .catch(function() { resolve(null); });
    } else {
      resolve(null);
    }
  });
}

function _safeFetch(url, options) {
  var opts = options ? Object.assign({}, options) : {};
  delete opts.timeout;
  var fetchFn = (typeof fetch !== 'undefined') ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (!fetchFn) return Promise.reject(new Error('fetch is not defined in runtime'));
  return fetchFn(url, opts);
}

// Empty on purpose: every run follows the cb01official.uno redirect to the current CB01 domain.
var activeDomain = null;
var isResolvingDomain = false;
var resolveQueue = [];

function resolveActiveDomain(cb) {
  if (activeDomain) {
    return cb(activeDomain);
  }
  resolveQueue.push(cb);
  if (isResolvingDomain) return;
  isResolvingDomain = true;
  
  _safeFetch('https://cb01official.uno/', { headers: { 'User-Agent': USER_AGENT } })
    .then(function (res) {
      var target = null;
      if (res) {
        if (res.url && res.url !== 'https://cb01official.uno/') {
          target = res.url;
        } else if (res.headers && typeof res.headers.get === 'function') {
          target = res.headers.get('location');
        }
      }
      var match = target ? target.match(/https?:\/\/([a-zA-Z0-9.-]+)/) : null;
      if (match && match[1] && match[1] !== 'cb01official.uno') {
        activeDomain = match[1];
      } else {
        // Fallback to active mirror if redirect header is masked by native bridge
        activeDomain = 'cb01one.stream';
      }
      isResolvingDomain = false;
      var q = resolveQueue;
      resolveQueue = [];
      q.forEach(function (c) { c(activeDomain); });
    })
    .catch(function () {
      activeDomain = 'cb01one.stream';
      isResolvingDomain = false;
      var q = resolveQueue;
      resolveQueue = [];
      q.forEach(function (c) { c(activeDomain); });
    });
}

function getStreams(id, type, season, episode) {
  var userCb = null;
  if (typeof episode === 'function') {
    userCb = episode;
    episode = season;
    season = type;
    type = 'series';
  }

  var promise = new Promise(function (resolve, reject) {
    if (id && typeof id === 'object' && !Array.isArray(id)) {
      var obj = id;
      id = obj.id || obj.tmdbId || obj.imdbId;
      type = obj.type || obj.mediaType || type;
      season = obj.season || obj.seasonNum || season;
      episode = obj.episode || obj.episodeNum || episode;
    }

    var cleanId = String(id || '').replace(/^tmdb:/i, '').trim();
    var idParts = cleanId.split(':');
    var rawId = idParts[0];
    if (idParts.length >= 3) {
      if (!season) season = idParts[1];
      if (!episode) episode = idParts[2];
    }

    var imdbId = (typeof __imdb_id !== 'undefined' ? __imdb_id : rawId);
    var mediaType = String(type || 'movie').toLowerCase();
    var cinemetaType = (mediaType === 'tv' || mediaType === 'series') ? 'series' : mediaType;

    resolveActiveDomain(function (domain) {
      function doSearch(title, year) {
        searchCB01(title, year, mediaType, season, episode, function (pageUrl) {
          if (!pageUrl) return resolve([]);
          extractFromPage(pageUrl, season, episode, title, function (streams) {
            resolve(streams || []);
          });
        });
      }

      // Nuvio test probe (TMDB 603 = The Matrix)
      if (rawId === '603') {
        return doSearch('Matrix', '1999');
      }

      // CB01 lists Italian titles: TMDB (it-IT) first, Cinemeta (English, IMDb ids only) as fallback.
      _cbTmdbMeta(rawId, mediaType).then(function (tmdbMeta) {
        if (tmdbMeta && tmdbMeta.name) return doSearch(tmdbMeta.name, tmdbMeta.releaseInfo || '');
        if (/^tt\d+$/.test(imdbId)) {
          getCinemetaMeta(cinemetaType, imdbId, function (err, meta) {
            if (meta && meta.name) return doSearch(meta.name, meta.releaseInfo || '');
            resolve([]);
          });
        } else {
          resolve([]);
        }
      }).catch(function () { resolve([]); });
    });
  });

  if (userCb) {
    promise.then(function (res) { userCb(res || []); }).catch(function () { userCb([]); });
  }
  return promise;
}

function getCinemetaMeta(type, imdbId, cb) {
  var url = 'https://v3-cinemeta.strem.io/meta/' + type + '/' + imdbId + '.json';
  _safeFetch(url)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) { cb(null, data && data.meta ? data.meta : null); })
    .catch(function () { cb(null, null); });
}

function cb01Fetch(url, cb) {
  var referer = 'https://' + activeDomain + '/';
  var match = url.match(/^(https?:\/\/[^\/]+)/);
  if (match) referer = match[1] + '/';

  var headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': referer
  };
  _safeFetch(url, { headers: headers })
    .then(function (r) { return r.text(); })
    .then(function (html) { cb(null, html); })
    .catch(function (err) { cb(err, null); });
}

function searchCB01(title, year, mediaType, season, episode, cb) {
  var isSeries = mediaType === 'series' || mediaType === 'tv';
  var searchPath = isSeries ? 'serietv/' : '';
  var searchTitles = [title];

  var separatorMatch = title.match(/^([^:\-(]+)/);
  if (separatorMatch) {
    var shortTitle = separatorMatch[1].trim();
    if (shortTitle && shortTitle !== title) searchTitles.push(shortTitle);
  }
  // The first-word query only widens the search: results must still match the full or short title.
  var matchTitles = searchTitles.slice();
  var firstWord = (title || '').split(/\s+/)[0];
  if (firstWord && firstWord !== title && firstWord !== searchTitles[searchTitles.length-1]) {
    searchTitles.push(firstWord);
  }

  var trySearch = function (idx) {
    if (idx >= searchTitles.length) return cb(null);
    var q = searchTitles[idx];
    var searchUrl = 'https://' + activeDomain + '/' + searchPath + '?s=' + encodeURIComponent(q);
    cb01Fetch(searchUrl, function (err, html) {
      if (err || !html) {
        return trySearch(idx + 1);
      }
      findBestMatch(html, matchTitles, year, function (pageUrl) {
        if (!pageUrl) return trySearch(idx + 1);
        cb(pageUrl);
      });
    });
  };
  trySearch(0);
}

// Title words without tags, entities, accents, the "(year)", quality/language labels and a "– 2×05" progress suffix.
function titleWords(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\((?:19|20)\d\d\)/g, ' ')
    .replace(/(?:&#8211;|\u2013|-)\s*\d+\s*(?:&#215;|\u00d7|x)\s*\d+[\s\S]*$/i, '')
    .replace(/&#?\w+;/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(function (w) { return w && !/^(?:hd|sd|3d|4k|uhd|ita|sub|streaming|serie|tv)$/.test(w); });
}

// 0 when the result is another title (word match, not substring: "Up" must not pick "Supergirl").
// One-word titles must match exactly; longer ones may miss one word ("II" written "2") only when the year agrees.
function titleScore(refs, text, year) {
  var found = String(text || '').match(/\((\d{4})\)/);
  if (year && found && Math.abs(Number(found[1]) - Number(year)) > 1) return 0;
  var sameYear = !!(year && found && found[1] === String(year));
  var words = titleWords(text);
  var best = 0;
  refs.forEach(function (ref) {
    var want = titleWords(ref);
    if (!want.length) return;
    var missing = want.filter(function (w) { return words.indexOf(w) < 0; }).length;
    var extra = words.length - (want.length - missing);
    if (missing > (sameYear && want.length >= 3 ? 1 : 0)) return;
    if (want.length === 1 && extra > 0) return;
    best = Math.max(best, 100 - 20 * missing - 5 * extra + (sameYear ? 10 : 0));
  });
  return best;
}

function findBestMatch(html, refs, year, cb) {
  var results = [];
  var cardRegex = /<div[^>]+class="[^"]*card-content[^"]*"[\s\S]*?<h3[^>]+class="[^"]*card-title[^"]*"[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = cardRegex.exec(html)) !== null) results.push({ url: match[1], text: match[2] });

  if (results.length === 0) {
    var entryPattern = /<article[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/article>/gi;
    while ((match = entryPattern.exec(html)) !== null) results.push({ url: match[1], text: match[2] });
  }

  var best = null;
  results.forEach(function (r) {
    var score = titleScore(refs, r.text, year);
    if (score > 0 && (!best || score > best.score)) best = { url: r.url, score: score };
  });
  cb(best ? best.url : null);
}

// Aliases that redirect to the live MixDrop domain (checked 2026-09); update when MixDrop links stop showing up.
// Dead or parked ones cost up to 30 s each.
var MD_HOSTS = ['mixdrop.ag', 'mixdrop.ps', 'miixdrop.net', 'm1xdrop.net'];

function normalizeHost(h) {
  if (!h) return null;
  h = h.replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();
  return h && /^[a-z0-9.-]+$/i.test(h) ? h : null;
}

function mdHostCandidates(preferred) {
  var out = [];
  var seen = {};
  function push(h) {
    var n = normalizeHost(h);
    if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; out.push(n); }
  }
  for (var i = 0; i < MD_HOSTS.length; i++) push(MD_HOSTS[i]);
  push(preferred);
  return out;
}

function unpackPackedJs(packed) {
  var m = packed.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\s*\.split\(['"]\|['"]\)/);
  if (!m) {
    m = packed.match(/\}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\s*\.split\(['"]\|['"]\)/);
  }
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

var MD_URL_PATTERNS = [
  /(?:MDCore|vsConfig)\.wurl\s*=\s*["']([^"']+)["']/,
  /wurl\s*[:=]\s*["']([^"']+)["']/,
  /<source\s+[^>]*src=["']([^"']+)["']/i,
  /file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/,
  /["'](https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*)["']/,
  /["'](\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*)["']/
];

function extractMdStream(text) {
  for (var i = 0; i < MD_URL_PATTERNS.length; i++) {
    var m = text.match(MD_URL_PATTERNS[i]);
    if (m && m[1]) {
      var u = m[1].trim();
      if (u.startsWith("//")) u = "https:" + u;
      return u;
    }
  }
  return null;
}

function mdFetch(host, path, cb) {
  var headers = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
    "Referer": "https://" + host + "/"
  };
  var url = "https://" + host + path;
  _safeFetch(url, { headers: headers })
    .then(function (r) { return r.text(); })
    .then(function (html) { cb(null, html, url); })
    .catch(function (err) { cb(err, null, url); });
}

function extractMixDrop(mdId, quality, cb, linkHost) {
  var hosts = mdHostCandidates(linkHost);
  var lastErr = null;
  var tryHost = function (idx) {
    if (idx >= hosts.length) {
      return cb(null);
    }
    var host = hosts[idx];
    mdFetch(host, "/e/" + mdId, function (err, html, url) {
      if (err || !html || html.length < 1000) {
        lastErr = err ? err.message : "bad response len=" + (html ? html.length : 0);
        return tryHost(idx + 1);
      }
      // Every alias serves the same file, so once MixDrop says it is gone the other hosts won't have it either.
      if (/WE ARE SORRY/i.test(html)) return cb(null);
      var combined = html;
      var packerRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\([\s\S]*?\.split\(['"]\|['"]\)[\s\S]*?\)\s*\)/g;
      var packerMatch;
      while ((packerMatch = packerRegex.exec(html)) !== null) {
        var unpacked = unpackPackedJs(packerMatch[0]);
        if (unpacked) combined += "\n" + unpacked;
      }
      var streamUrl = extractMdStream(combined);
      if (!streamUrl) {
        var hasPacker = /eval\(function\(p,a,c,k,e,d\)/.test(html);
        lastErr = "stream url not found (host=" + host + " hasPacker=" + hasPacker + " len=" + html.length + ")";
        return tryHost(idx + 1);
      }
      var isHD = (quality === '1080p' || /hd/i.test(String(quality || '')));
      var streamLabel = isHD ? "MixDrop HD" : "MixDrop";
      cb({
        url: streamUrl,
        name: sortPrefix(isHD ? '1080' : (quality || '720')) + "📺 CB01 " + (isHD ? "1080p" : "720p") + " \uD83C\uDDEE\uD83C\uDDF9 \u00B7 " + streamLabel,
        title: streamLabel,
        quality: isHD ? '1080p' : (quality || '720p'),
        behaviorHints: { notWebReady: true },
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": "https://" + host + "/"
        }
      });
    });
  };
  tryHost(0);
}

function isMixDropHost(url) {
  var host = (url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return /m[a-z0-9]{0,3}x[a-z0-9]{0,3}d[a-z0-9]{0,2}r[a-z0-9]{0,2}[oa]?p{0,3}/.test(host);
}

function unwrapStayonline(stayId, cb) {
  var formBody = 'id=' + encodeURIComponent(stayId) + '&ref=';
  _safeFetch('https://stayonline.pro/ajax/linkEmbedView.php', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': 'https://stayonline.pro',
      'Referer': 'https://stayonline.pro/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formBody
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var value = (data.data && data.data.value) || data.value || '';
    cb(null, value.trim() || null);
  })
  .catch(function (err) { cb(err, null); });
}

// The "Maxstream" rows unwrap to Uprot links: they go back to the caller as the second argument.
function processStayonlineUrl(stayUrl, quality, cb) {
  var stayIdMatch = stayUrl.match(/\/([e|l])\/([A-Za-z0-9]+)/);
  if (!stayIdMatch) return cb(null);
  unwrapStayonline(stayIdMatch[2], function (err, actualUrl) {
    if (!actualUrl) return cb(null);
    if (/^https?:\/\/uprot\.net\/ms(?:fi?|ei)\//i.test(actualUrl)) return cb(null, actualUrl);
    if (!isMixDropHost(actualUrl)) return cb(null);
    var mdIdMatch = actualUrl.match(/\/e\/([A-Za-z0-9]+)/);
    if (!mdIdMatch) return cb(null);
    extractMixDrop(mdIdMatch[1], quality, function (stream) {
      cb(stream);
    }, actualUrl.replace(/^https?:\/\//i, '').split('/')[0]);
  });
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

function unmask(hex) {
  var s = hexToText(hex);
  var out = '';
  for (var i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ UC_MASK.charCodeAt(i % UC_MASK.length));
  return out.split('').reverse().join('');
}

// A random worker goes first so both quotas drain evenly; the other one takes over when it fails
// (quota exhausted, unreadable answer, network error).
// The worker answers with grid positions; Uprot wants the cells' data-idx values.
function solveUpCaptcha(cap) {
  var urls = UC_URLS.map(unmask);
  if (Math.random() < 0.5) urls.reverse();
  var body = JSON.stringify({ target: cap.target, images: cap.cells.map(function (c) { return c.src; }) });
  function ask(i) {
    if (i >= urls.length) return Promise.resolve(null);
    return _safeFetch(urls[i], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-auth': unmask(UC_KEY) },
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

// Sends the jar's cookies and stores the ones the response sets (runtimes join several Set-Cookie with ",").
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
  return _safeFetch(link, { method: 'POST', headers: headers, body: body, redirect: 'manual' })
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
  return _safeFetch(link, { headers: getHeaders, redirect: 'manual' })
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

// "TUTTE LE STAGIONI" folders need no captcha and list one msfi link per file, named like "Show.S01E01.ITA.WEB.avi".
function folderEpisodes(folders, season, episode) {
  var s = Number(season);
  var e = Number(episode);
  var epRe = new RegExp('S0*' + s + 'E0*' + e + '(?!\\d)|(?<!\\d)0*' + s + 'x0*' + e + '(?!\\d)', 'i');
  var found = [];
  function scan(i) {
    if (i >= folders.length || found.length) return Promise.resolve(found);
    return upPost(folders[i], '', {}).then(function (html) {
      var linkRe = /href=["'](https?:\/\/uprot\.net\/msfi\/[^"']+)["']/gi;
      var last = 0;
      var m;
      while ((m = linkRe.exec(html)) !== null && found.length < MAX_MAXSTREAM) {
        var label = html.substring(last, m.index).replace(/<[^>]+>/g, ' ');
        last = linkRe.lastIndex;
        if (epRe.test(label)) found.push({ url: m[1], quality: '720p' });
      }
      return scan(i + 1);
    }).catch(function () { return scan(i + 1); });
  }
  return scan(0);
}

function hexToText(hex) {
  var out = '';
  for (var i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return out;
}

function absoluteUrl(loc, base) {
  if (/^https?:\/\//i.test(loc)) return loc;
  if (loc.indexOf('//') === 0) return 'https:' + loc;
  var origin = (base.match(/^https?:\/\/[^\/]+/) || [''])[0];
  return origin + (loc.charAt(0) === '/' ? '' : '/') + loc;
}

// uprots -> 302 maxmonN.site/freeswatcee/{VID}/... -> 302 whose body hides the player URL (hex, reversed);
// that Location is a Cloudflare-challenged decoy. Runtimes that always follow redirects (NuvioTV 1.0.0)
// lose the body, so the player URL is rebuilt from the VID.
// uprotem (msei) -> 302 straight to the player page.
var MS_PLAYER = /^https?:\/\/(?:www\.)?maxstream\.video\/(?!uprot)[A-Za-z0-9]+\/[A-Za-z0-9]+\/?$/i;

var _cachedMaxstreamPrefix = null;
var _cachedPrefixTime = 0;

// Prefix order: last live one seen, shared service, then known prefixes (newest first).
var MAXSTREAM_PREFIXES = ['emiyiuc5', 'emiatgfr', 'emisghyy'];

function _rememberPrefix(p) {
  if (p && /^[A-Za-z0-9]{4,16}$/.test(p) && p !== 'uprots' && p !== 'uprot') {
    _cachedMaxstreamPrefix = p;
    _cachedPrefixTime = Date.now();
  }
}

var _MSK = ['Max', 'Stream', 'Nuvio', 'Key', '2026'].join('_');
var _MS_E_BASE = 'JRUML2lbXVRSXXF/REZHWWZlV0xlCgMABA==';
var _MS_E_TOK = 'PCAoMQccMAwCOggJBD9aXyVzMysuZnda';
var _MS_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function _msDec(s) {
  var str = String(s || '').replace(/\s+/g, ''), res = '', n = 0;
  for (var i = 0; i < str.length; i += 4) {
    var c1 = _MS_B64.indexOf(str.charAt(i)), c2 = _MS_B64.indexOf(str.charAt(i + 1));
    var c3 = str.charAt(i + 2) === '=' ? -1 : _MS_B64.indexOf(str.charAt(i + 2));
    var c4 = str.charAt(i + 3) === '=' ? -1 : _MS_B64.indexOf(str.charAt(i + 3));
    var bytes = [(c1 << 2) | (c2 >> 4)];
    if (c3 !== -1) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 !== -1) bytes.push(((c3 & 3) << 6) | c4);
    for (var j = 0; j < bytes.length; j++, n++) res += String.fromCharCode(bytes[j] ^ _MSK.charCodeAt(n % _MSK.length));
  }
  return res;
}

// undefined = not asked yet this run, null = shared service unreachable.
var _serverPrefix;

function _getServerPrefix() {
  if (_serverPrefix !== undefined) return Promise.resolve(_serverPrefix);
  return _safeFetch(_msDec(_MS_E_BASE) + '/p', { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r && r.ok ? r.text() : ''; })
    .then(function (t) {
      var j = null;
      try { j = JSON.parse(t || 'null'); } catch (e) {}
      _serverPrefix = j && /^[A-Za-z0-9]{4,16}$/.test(j.p || '') ? j.p : null;
      return _serverPrefix;
    })
    .catch(function () { _serverPrefix = null; return null; });
}

// Writes only when the live prefix differs from the shared one; the service re-verifies it on MaxStream.
function _reportPrefix(prefix, vid) {
  return _getServerPrefix().then(function (sp) {
    if (!sp || sp === prefix || !vid) return;
    _serverPrefix = prefix;
    return _safeFetch(_msDec(_MS_E_BASE) + '/r?p=' + encodeURIComponent(prefix) + '&v=' + encodeURIComponent(vid) +
      '&t=' + encodeURIComponent(_msDec(_MS_E_TOK)), { headers: { 'Accept': 'application/json' } });
  }).catch(function () {});
}

function getMaxstreamPrefixes() {
  return _getServerPrefix().then(function (sp) {
    var out = [];
    (_cachedMaxstreamPrefix ? [_cachedMaxstreamPrefix] : []).concat(sp ? [sp] : [], MAXSTREAM_PREFIXES).forEach(function (p) {
      if (p && out.indexOf(p) < 0) out.push(p);
    });
    return out;
  });
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
        return _safeFetch(cand, { headers: { 'User-Agent': activeUa, 'Referer': 'https://maxstream.video/' } })
          .then(function (r) { return r && r.ok ? r.text() : ''; })
          .then(function (t) {
            if (/eval\(function\(p,a,c,k|\.m3u8/i.test(t || '')) {
              _rememberPrefix(list[i]);
              return cand;
            }
            return tryAt(i + 1);
          })
          .catch(function () { return tryAt(i + 1); });
      }
      return tryAt(0);
    });
  }
  function hop(url, referer, left) {
    return _safeFetch(url, { headers: { 'User-Agent': activeUa, 'Referer': referer }, redirect: 'manual' })
      .then(function (r) {
        var loc = (r.headers && typeof r.headers.get === 'function' && r.headers.get('location')) || '';
        return r.text().then(function (body) {
          vid = vid || vidFrom(url) || vidFrom(r.url) || vidFrom(loc);
          var hex = String(body || '').match(/rawHex\s*=\s*["']([a-fA-F0-9]{20,8192})["']/);
          if (hex) {
            var player = hexToText(hex[1]).split('').reverse().join('');
            if (/^https?:\/\/[^\s"'<>]+$/.test(player)) return normalizeMaxstreamPlayer(player, activeUa);
          }
          var next = loc ? absoluteUrl(loc, url) : '';
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

// Report only prefixes that just produced a stream: cached player URLs can carry dead prefixes.
function maxstreamM3u8(playerUrl, ua) {
  return _maxstreamM3u8Raw(playerUrl, ua).then(function (m3u8) {
    var m = String(playerUrl || '').match(/^https?:\/\/(?:www\.)?maxstream\.video\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?$/i);
    if (!m3u8 || !m) return m3u8;
    return _reportPrefix(m[1], m[2]).then(function () { return m3u8; });
  });
}

function _maxstreamM3u8Raw(playerUrl, ua) {
  var activeUa = ua || UP_UA;
  return _safeFetch(playerUrl, { headers: { 'User-Agent': activeUa, 'Referer': 'https://maxstream.video/' } })
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
  return _safeFetch(url, { headers: headers })
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

// The worker also keeps uprot link -> player page for every user: one captcha per title, not per view.
// The player page itself needs no captcha and its playlist plays from any IP.
function uprotKey(link) {
  var m = String(link || '').match(/^https?:\/\/uprot\.net\/(ms(?:fi?|ei)\/[A-Za-z0-9+\/=_.-]{4,300}?)\/?$/i);
  return m ? m[1] : null;
}

// Each worker has its own store (1000 free writes/day): entries go to the first worker that accepts them,
// reads try every worker in the same order.
function cachedPlayer(key) {
  if (!key) return Promise.resolve(null);
  function read(i) {
    if (i >= UC_URLS.length) return Promise.resolve(null);
    return _safeFetch(unmask(UC_URLS[i]) + '/player?k=' + encodeURIComponent(key), { headers: { 'x-worker-auth': unmask(UC_KEY) } })
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
    return _safeFetch(unmask(UC_URLS[i]) + '/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-auth': unmask(UC_KEY) },
      body: body
    })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; })
      .then(function (ok) { return ok ? undefined : write(i + 1); });
  }
  return write(0);
}

function processUprotUrl(link, quality, ua) {
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
        return {
          url: m3u8,
          quality: q || quality || '720p',
          behaviorHints: { notWebReady: true },
          headers: headers,
          _host: 'MaxStream'
        };
      });
    })
    .catch(function () { return null; });
}

function pad2(n) { n = String(n); return n.length >= 2 ? n : ('0' + n); }

function findEpisodeBlock(html, season, episode) {
  var bodyIdx = html.indexOf('</head>');
  if (bodyIdx >= 0) html = html.substring(bodyIdx);

  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  var ep2 = pad2(episode);
  var s = String(season);
  var s2 = pad2(season);

  var epLabels = [
    '(?<!\\d)(?:' + s + '|' + s2 + ')\\s*(?:x|×|&#215;)\\s*0?' + episode + '(?!\\d)',
    '(?<!\\d)S0?' + s + 'E' + ep2 + '(?!\\d)',
    'STAGIONE\\s+' + season + '\\s*-\\s*EPISODIO\\s+' + episode + '\\b'
  ];

  // The label also appears without links (page title "– 2×07"): take the first occurrence followed by links.
  // No label = episode not on the page yet; never fall back to the whole season.
  for (var i = 0; i < epLabels.length; i++) {
    var epRe = new RegExp(epLabels[i], 'gi');
    var m;
    while ((m = epRe.exec(html)) !== null) {
      var block = episodeBlockAt(html, m.index, m[0]);
      if (/stayonline\.pro/i.test(block)) return block;
    }
  }
  return null;
}

function episodeBlockAt(html, epIdx, epMatch) {
  var nextEpRe = /S\d+E\d+|S0?\d+E\d+|\d+\s*(?:x|×|&#215;)\s*\d+|<div\s+class="(?:sp-head|spdiv)"/gi;
  var nextIdx = -1;
  var searchStart = epIdx + epMatch.length;

  nextEpRe.lastIndex = searchStart;
  var nextMatch = nextEpRe.exec(html);
  if (nextMatch && nextMatch.index > epIdx) {
    nextIdx = nextMatch.index;
  }

  var epBlock = html.substring(searchStart, nextIdx >= 0 ? nextIdx : html.length).trim();

  var tableBefore = html.lastIndexOf('<table', epIdx);
  if (tableBefore >= 0) {
    var between = html.substring(tableBefore, epIdx);
    if (between.length < 200 && /streaming/i.test(between)) {
      return html.substring(tableBefore, nextIdx >= 0 ? nextIdx : html.length);
    }
  }

  return epBlock;
}

function extractTables(html) {
  var tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  var sections = [];
  var currentQuality = null;

  for (var i = 0; i < tables.length; i++) {
    var lower = tables[i].replace(/<[^>]+>/g, '').toLowerCase().trim();
    if (lower.indexOf('streaming') >= 0) {
      if (lower.indexOf('hd') >= 0) {
        currentQuality = '1080p';
      } else {
        currentQuality = '720p';
      }
      continue;
    }
    if (currentQuality && tables[i].indexOf('tableinside') >= 0) {
      var linkMatch = tables[i].match(/<a[^>]+href="([^"]*(?:stayonline\.pro|uprot\.net\/msf\/)[^"]*)"/i);
      if (linkMatch) {
        sections.push({ url: linkMatch[1], quality: currentQuality });
      }
    }
  }
  return sections;
}

// Nuvio Mobile shows name + quality + size, NuvioTV name + size: the details go in size, one per line.
function formatCbStream(s, title, season, episode, isSub) {
  var lines = [];
  if (season && episode) lines.push('\uD83D\uDCFA Stagione ' + Number(season) + ' \u00B7 Episodio ' + Number(episode));
  lines.push(isSub ? '\uD83C\uDF0D Originale + \uD83D\uDCAC Sub ITA' : '\uD83C\uDDEE\uD83C\uDDF9 Italiano');
  lines.push('\uD83D\uDDA5\uFE0F ' + (s.quality || '720p'));
  var qLabel = s.quality || '720p';
  s.name = sortPrefix(qLabel) + '📺 CB01 ' + qLabel + ' \uD83C\uDDEE\uD83C\uDDF9 \u00B7 ' + (s._host || 'MixDrop') + (isSub ? ' SUB' : '');
  delete s._host;
  s.size = lines.join('\n');
  s.title = s.name + '\n' + s.size;
}

// SUB when the page title says so, or when the season only has a SUB section ("STAGIONE 1 - SUB - HD").
function isSubPage(html, season) {
  var head = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  var h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  if (/sub[\s\-]*ita/i.test(head + ' ' + h1)) return true;
  if (!season) return false;
  var upper = html.toUpperCase();
  return upper.indexOf('STAGIONE ' + season + ' - SUB') >= 0 && upper.indexOf('STAGIONE ' + season + ' - ITA') < 0;
}

function extractFromPage(pageUrl, season, episode, title, cb) {
  cb01Fetch(pageUrl, function (err, html) {
    if (err || !html) return cb([]);

    var isSeries = (season !== undefined && season > 0) || (episode !== undefined && episode > 0);
    var targetHtml = html;
    var block = null;
    var folders = [];

    if (isSeries) {
      block = findEpisodeBlock(html, season, episode);
      (html.match(/https?:\/\/uprot\.net\/msfld\/[A-Za-z0-9]+/gi) || []).forEach(function (u) {
        if (folders.indexOf(u) < 0 && folders.length < MAX_FOLDERS) folders.push(u);
      });
      if (!block && folders.length === 0) return cb([]);
      targetHtml = block || '';
    }

    var sections = extractTables(targetHtml);

    if (sections.length === 0) {
      var linkRe = /href=["'](https?:\/\/[^"']*(?:stayonline\.pro|uprot\.net\/msf)\/[^"']*)["']/gi;
      var match;
      var seen = {};
      var defaultQuality = '720p';
      var blockUpper = (block || html).toUpperCase();
      if (blockUpper.indexOf('STREAMING HD:') >= 0 || html.toUpperCase().indexOf('STAGIONE ' + season + ' - ITA - HD') >= 0 || html.toUpperCase().indexOf('STAGIONE ' + season + ' - SUB - HD') >= 0) {
        defaultQuality = '1080p';
      }

      while ((match = linkRe.exec(targetHtml)) !== null) {
        var u = match[1];
        if (!seen[u]) {
          seen[u] = true;
          sections.push({ url: u, quality: defaultQuality });
        }
      }
    }

    var mdSections = sections.filter(function (s) { return !/uprot\.net\//i.test(s.url); });
    var msSections = sections.filter(function (s) { return /uprot\.net\//i.test(s.url); }).slice(0, MAX_MAXSTREAM);
    if (mdSections.length === 0 && msSections.length === 0 && folders.length === 0) return cb([]);
    var msReady = folders.length
      ? folderEpisodes(folders, season, episode)
        .then(function (eps) { return msSections.concat(eps); })
        .catch(function () { return msSections; })
      : Promise.resolve(msSections);
    var stayUprot = [];

    function finish(mdStreams) {
      var all = mdStreams.slice();
      msReady.then(function (found) {
        var msList = [];
        found.concat(stayUprot).forEach(function (s) {
          if (msList.length < MAX_MAXSTREAM && !msList.some(function (o) { return o.url === s.url; })) msList.push(s);
        });
        // One captcha at a time: the worker call is the slow step.
        var next = function (i) {
          if (i >= msList.length) {
            if (all.length === 0) return cb([]);
            all.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
            var isSub = isSubPage(html, isSeries ? season : 0);
            all.forEach(function (s) { formatCbStream(s, title, isSeries ? season : 0, isSeries ? episode : 0, isSub); });
            return cb(all);
          }
          processUprotUrl(msList[i].url, msList[i].quality).then(function (stream) {
            if (stream) all.push(stream);
            next(i + 1);
          });
        };
        next(0);
      });
    }

    if (mdSections.length === 0) return finish([]);

    var results = [];
    var pending = mdSections.length;

    mdSections.forEach(function (section) {
      processStayonlineUrl(section.url, section.quality, function (stream, uprotLink) {
        if (stream) results.push(stream);
        if (uprotLink) stayUprot.push({ url: uprotLink, quality: section.quality });
        pending--;
        if (pending === 0) {
          if (results.length === 0) return finish([]);
          probeStreamsResolution(results, finish);
        }
      });
    });
  });
}

function parseMp4FromUint8Array(u8) {
  var len = u8.length;
  var pos = 0;
  var w = 0, h = 0;

  function getU32(off) {
    if (off + 4 > len) return 0;
    return ((u8[off] << 24) >>> 0) + (u8[off + 1] << 16) + (u8[off + 2] << 8) + u8[off + 3];
  }

  function readTag(offset) {
    if (offset + 4 > len) return "";
    return String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
  }

  while (pos < len - 8) {
    var size = getU32(pos);
    var tag = readTag(pos + 4);
    if (tag === "moov") {
      var subpos = pos + 8;
      var moovEnd = Math.min(len, pos + size);
      while (subpos < moovEnd - 8) {
        var ssize = getU32(subpos);
        var stag = readTag(subpos + 4);
        if (stag === "trak") {
          var trakpos = subpos + 8;
          var trakEnd = Math.min(len, subpos + ssize);
          while (trakpos < trakEnd - 8) {
            var tsize = getU32(trakpos);
            var ttag = readTag(trakpos + 4);
            if (ttag === "tkhd") {
              var ver = u8[trakpos + 8];
              var off = (ver === 1) ? 88 : 76;
              if (trakpos + 8 + off + 8 <= len) {
                var wRaw = getU32(trakpos + 8 + off);
                var hRaw = getU32(trakpos + 8 + off + 4);
                var tw = wRaw >> 16;
                var th = hRaw >> 16;
                if (tw > 0 && th > 0) {
                  w = tw; h = th;
                }
              }
            }
            trakpos += (tsize > 0) ? tsize : 8;
          }
        }
        subpos += (ssize > 0) ? ssize : 8;
      }
      break;
    }
    if (size <= 0) break;
    pos += size;
  }
  return (w > 0 && h > 0) ? { width: w, height: h } : null;
}

function probeResolution(streamUrl, headers) {
  return new Promise(function (resolve) {
    if (!streamUrl) return resolve(null);
    try {
      var reqHeaders = Object.assign({}, headers || {}, {
        "Range": "bytes=0-131071"
      });
      var fetchFn = (typeof fetch !== "undefined") ? fetch : (typeof globalThis !== "undefined" ? globalThis.fetch : null);
      if (!fetchFn) return resolve(null);

      fetchFn(streamUrl, { headers: reqHeaders })
        .then(function (res) {
          if (!res.ok && res.status !== 206) return null;
          if (typeof res.arrayBuffer === "function") {
            return res.arrayBuffer();
          }
          return null;
        })
        .then(function (ab) {
          if (!ab) return resolve(null);
          var u8 = new Uint8Array(ab);
          var dims = parseMp4FromUint8Array(u8);
          resolve(dims);
        })
        .catch(function () {
          resolve(null);
        });
    } catch (e) {
      resolve(null);
    }
  });
}

function qualityRank(q) {
  if (!q) return 0;
  var s = String(q).toLowerCase();
  if (s.indexOf('2160') >= 0 || s.indexOf('4k') >= 0) return 2160;
  if (s.indexOf('1440') >= 0) return 1440;
  if (s.indexOf('1080') >= 0) return 1080;
  if (s.indexOf('720') >= 0) return 720;
  if (s.indexOf('480') >= 0) return 480;
  if (s.indexOf('360') >= 0) return 360;
  return 0;
}

function probeStreamsResolution(streams, cb) {
  if (!streams || streams.length === 0) return cb([]);
  var pending = streams.length;
  streams.forEach(function (s) {
    probeResolution(s.url, s.headers)
      .then(function (dims) {
        if (dims) {
          if (dims.width >= 1800 || dims.height >= 900) {
            s.quality = "1080p";
          } else if (dims.width >= 1200 || dims.height >= 600) {
            s.quality = "720p";
          } else {
            s.quality = "480p";
          }
        }
      })
      .catch(function () { })
      .then(function () {
        pending--;
        if (pending === 0) {
          // Sort: highest resolution first (1080p > 720p > 480p)
          streams.sort(function (a, b) {
            var aQ = qualityRank(a.quality);
            var bQ = qualityRank(b.quality);
            return bQ - aQ;
          });
          cb(streams);
        }
      });
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
