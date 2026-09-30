var USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';

function _cbTmdbMeta(id, type) {
  return new Promise(function(resolve) {
    var cleanId = String(id || '').replace(/^tmdb:/, '');
    if (/^tt\d+$/.test(cleanId)) {
      fetch('https://api.themoviedb.org/3/find/' + cleanId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id&language=it-IT', { timeout: 10000 })
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
      fetch(endpoint, { timeout: 10000 })
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
  
  fetch('https://cb01official.uno/', { headers: { 'User-Agent': USER_AGENT }, timeout: 5000 })
    .then(function (res) {
      var finalUrl = res.url || 'https://cb01official.uno/';
      var match = finalUrl.match(/https?:\/\/([a-zA-Z0-9.-]+)/);
      if (match && match[1] && match[1] !== 'cb01official.uno') {
        activeDomain = match[1];
      } else {
        activeDomain = 'cb01uno.top';
      }
      isResolvingDomain = false;
      var q = resolveQueue;
      resolveQueue = [];
      q.forEach(function (c) { c(activeDomain); });
    })
    .catch(function () {
      activeDomain = 'cb01uno.top';
      isResolvingDomain = false;
      var q = resolveQueue;
      resolveQueue = [];
      q.forEach(function (c) { c(activeDomain); });
    });
}

function getStreams(id, type, season, episode) {
  return new Promise(function (resolve, reject) {
    resolveActiveDomain(function (domain) {
      var tmdbId = String(id || '').replace(/^tmdb:/, '');
      var imdbId = (typeof __imdb_id !== 'undefined' ? __imdb_id : tmdbId);
      var mediaType = String(type || 'movie').toLowerCase();
      var cinemetaType = mediaType === 'tv' ? 'series' : mediaType;

      function doSearch(title, year) {
        searchCB01(title, year, mediaType, season, episode, function (pageUrl) {
          if (!pageUrl) return resolve([]);
          extractFromPage(pageUrl, season, episode, title, function (streams) {
            resolve(streams || []);
          });
        });
      }

      // Nuvio test probe (TMDB 603 = The Matrix)
      if (tmdbId === '603') {
        return doSearch('Matrix', '1999');
      }

      // CB01 lists Italian titles: TMDB (it-IT) first, Cinemeta (English, IMDb ids only) as fallback.
      _cbTmdbMeta(imdbId, mediaType).then(function(tmdbMeta) {
        if (tmdbMeta && tmdbMeta.name) return doSearch(tmdbMeta.name, tmdbMeta.releaseInfo || '');
        if (!/^tt\d+$/.test(imdbId)) return resolve([]);
        getCinemetaMeta(cinemetaType, imdbId, function (err, meta) {
          if (meta && meta.name) return doSearch(meta.name, meta.releaseInfo || '');
          resolve([]);
        });
      }).catch(function () { resolve([]); });
    });
  });
}

function getCinemetaMeta(type, imdbId, cb) {
  var url = 'https://v3-cinemeta.strem.io/meta/' + type + '/' + imdbId + '.json';
  fetch(url, { timeout: 10000 })
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
  fetch(url, { headers: headers, timeout: 15000 })
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
  fetch(url, { headers: headers, timeout: 15000 })
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
        name: "CB01 - " + streamLabel,
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
  fetch('https://stayonline.pro/ajax/linkEmbedView.php', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': 'https://stayonline.pro',
      'Referer': 'https://stayonline.pro/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formBody,
    timeout: 15000
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var value = (data.data && data.data.value) || data.value || '';
    cb(null, value.trim() || null);
  })
  .catch(function (err) { cb(err, null); });
}

function processStayonlineUrl(stayUrl, quality, cb) {
  var stayIdMatch = stayUrl.match(/\/([e|l])\/([A-Za-z0-9]+)/);
  if (!stayIdMatch) return cb(null);
  unwrapStayonline(stayIdMatch[2], function (err, actualUrl) {
    if (!actualUrl) return cb(null);
    if (!isMixDropHost(actualUrl)) return cb(null);
    var mdIdMatch = actualUrl.match(/\/e\/([A-Za-z0-9]+)/);
    if (!mdIdMatch) return cb(null);
    extractMixDrop(mdIdMatch[1], quality, function (stream) {
      cb(stream);
    }, actualUrl.replace(/^https?:\/\//i, '').split('/')[0]);
  });
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

  var epIdx = -1;
  var epMatch = null;

  for (var i = 0; i < epLabels.length && epIdx < 0; i++) {
    var epRe = new RegExp(epLabels[i], 'i');
    var m = epRe.exec(html);
    if (m) {
      epIdx = m.index;
      epMatch = m[0];
    }
  }

  if (epIdx < 0) {
    var spHeadRe = new RegExp('<div[^>]+class="[^"]*sp-head[^"]*"[^>]*>(?:[\\s\\S]*?)\\bSTAGIONE\\s+0?' + season + '\\b[\\s\\S]*?<div[^>]+class="[^"]*sp-body[^"]*"[^>]*>([\\s\\S]*?)<div[^>]+class="[^"]*spdiv[^"]*"', 'i');
    var spMatch = html.match(spHeadRe);
    return spMatch ? spMatch[1] : null;
  }

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
      var linkMatch = tables[i].match(/<a[^>]+href="([^"]*stayonline\.pro[^"]*)"/i);
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
  lines.push('\u25B6\uFE0F MixDrop');
  s.name = '\uD83C\uDF7F CB01 - ' + (title || 'CB01');
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

    if (isSeries) {
      block = findEpisodeBlock(html, season, episode);
      if (block) {
        targetHtml = block;
      }
    }

    var sections = extractTables(targetHtml);

    if (sections.length === 0 && isSeries && targetHtml !== html) {
      sections = extractTables(html);
    }

    if (sections.length === 0) {
      var linkRe = /href=["'](https?:\/\/[^"']*stayonline\.pro\/[^"']*)["']/gi;
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

    if (sections.length === 0) return cb([]);

    var results = [];
    var pending = sections.length;

    sections.forEach(function (section) {
      processStayonlineUrl(section.url, section.quality, function (stream) {
        if (stream) results.push(stream);
        pending--;
        if (pending === 0) {
          if (results.length === 0) return cb([]);
          probeStreamsResolution(results, function (finalStreams) {
            var isSub = isSubPage(html, isSeries ? season : 0);
            finalStreams.forEach(function (s) { formatCbStream(s, title, isSeries ? season : 0, isSeries ? episode : 0, isSub); });
            cb(finalStreams.length > 0 ? finalStreams : []);
          });
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
        if (pending === 0) cb(streams);
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
