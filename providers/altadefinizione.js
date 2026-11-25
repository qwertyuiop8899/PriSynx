// Altadefinizione - provider locale per NuvioTV / Nuvio Mobile.
// Usa /api/player-sources del sito (MP4 720p su piu' edge CDN, link legati all'IP del dispositivo).
// Cookie provati in ordine: SCRAPER_SETTINGS.altadefinizioneCookie, ADS_COOKIE di realbestia domains.json, OWN_COOKIE.

var DOMAINS_URL = 'https://raw.githubusercontent.com/realbestia1/domains/refs/heads/main/domains.json';
var DEFAULT_BASE = 'https://altastreaming.duckdns.org';
var OWN_COOKIE = 'sid=63eb86ff548cc0d81c89eb328993d91a3e776a7f2ea9d0d65d2d975462bd01d3';
var TMDB_KEY_FALLBACK = '68e094699525b18a70bab2f86b1fa706';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var MAX_STREAMS = 2;
var MAX_PROBES = 4;

function run(genFn) {
  return new Promise(function (resolve, reject) {
    var it = genFn();
    function step(method, value) {
      var r;
      try { r = it[method](value); } catch (e) { reject(e); return; }
      if (r.done) { resolve(r.value); return; }
      Promise.resolve(r.value).then(function (x) { step('next', x); }, function (e) { step('throw', e); });
    }
    step('next');
  });
}

function req(url, opts) {
  return fetch(url, opts || {}).then(function (r) {
    return r.text().then(function (t) {
      return { ok: r.ok, status: r.status, text: t || '', header: function (k) { try { return r.headers.get(k) || ''; } catch (e) { return ''; } } };
    });
  }).catch(function () { return { ok: false, status: 0, text: '', header: function () { return ''; } }; });
}

function getJson(url, headers) {
  return req(url, { headers: headers || {} }).then(function (r) {
    var data = null;
    try { data = JSON.parse(r.text); } catch (e) { }
    return { status: r.status, data: data };
  });
}

function log(msg) { try { console.log('[Altadefinizione] ' + msg); } catch (e) { } }

// ---------- formato stream (come PriSynx vixsrc.js) ----------

var FLAG_IT = '\uD83C\uDDEE\uD83C\uDDF9';
var ZW_PREFIX = ['\u200B', '\u200C', '\u200D', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064'];

function sortPrefix(quality, syncLevel) {
  var q = Number(String(quality || '').replace(/[^0-9]/g, '')) || 0;
  var r = q >= 2160 ? 0 : q >= 1080 ? 1 : q >= 720 ? 2 : 3;
  return ZW_PREFIX[r] + ZW_PREFIX[syncLevel];
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatBitrate(bps) {
  if (!bps) return '';
  if (bps >= 1000000) {
    var mbps = bps / 1000000;
    return (mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)).replace(/\.0+$/, '') + ' Mbps';
  }
  return Math.round(bps / 1000) + ' kbps';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  return Math.round(bytes / 1048576) + ' MB';
}

// ---------- config / TMDB ----------

function getConfig() {
  return req(DOMAINS_URL + '?_=' + Date.now(), { headers: { 'Accept': 'application/json' } }).then(function (r) {
    var cfg = {};
    // il file a volte ha virgole mancanti tra le chiavi
    try { cfg = JSON.parse(r.text.replace(/("[^"\r\n]+")\s*("[^"]+"\s*:)/g, '$1,$2')) || {}; } catch (e) { }
    var base = String(cfg.ADS || '').trim().replace(/\/+$/, '');
    var custom = '';
    try { custom = String((globalThis.SCRAPER_SETTINGS || {}).altadefinizioneCookie || '').trim(); } catch (e) { }
    return {
      base: /^https?:\/\/[^/]+$/i.test(base) ? base : DEFAULT_BASE,
      cookies: [custom, String(cfg.ADS_COOKIE || '').trim(), OWN_COOKIE].filter(function (c, i, a) { return c && a.indexOf(c) === i; })
    };
  });
}

function tmdbKey() {
  try { if (typeof TMDB_API_KEY === 'string' && TMDB_API_KEY.length > 10) return TMDB_API_KEY; } catch (e) { }
  return TMDB_KEY_FALLBACK;
}

function getInfo(id, isTv, season, episode) {
  return run(function* () {
    var key = tmdbKey();
    var tmdbId = String(id || '').trim().replace(/^tmdb:/i, '');
    var imdb = (tmdbId.match(/^tt\d+/) || [])[0];
    if (imdb) {
      var f = yield getJson('https://api.themoviedb.org/3/find/' + imdb + '?api_key=' + key + '&external_source=imdb_id');
      var hit = f.data && ((isTv ? f.data.tv_results : f.data.movie_results) || [])[0];
      if (!hit) return null;
      tmdbId = String(hit.id);
    }
    if (!/^\d+$/.test(tmdbId)) return null;
    var url = 'https://api.themoviedb.org/3/' + (isTv ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + key + '&language=it-IT' +
      (isTv ? '&append_to_response=season/' + season : '');
    var r = yield getJson(url);
    var j = r.data;
    if (!j || !(j.name || j.title)) return { tmdbId: tmdbId, title: '', year: '', runtime: 0, episodeName: '' };
    var runtime = j.runtime || 0, epName = '';
    if (isTv) {
      var eps = (j['season/' + season] || {}).episodes || [];
      for (var i = 0; i < eps.length; i++) {
        if (eps[i].episode_number === episode) { runtime = eps[i].runtime || 0; epName = eps[i].name || ''; break; }
      }
      if (!runtime && j.episode_run_time && j.episode_run_time.length) runtime = j.episode_run_time[0];
    }
    return {
      tmdbId: tmdbId,
      title: j.name || j.title,
      year: String(j.first_air_date || j.release_date || '').slice(0, 4),
      runtime: runtime,
      // TMDB usa "Episodio N" quando manca il titolo italiano
      episodeName: /^Episodio \d+$/i.test(epName) ? '' : epName
    };
  });
}

// ---------- sorgenti CDN ----------

function probeEdge(url) {
  return req(url, { headers: { 'User-Agent': UA, 'Range': 'bytes=0-0' } }).then(function (r) {
    if (r.status !== 206 && r.status !== 200) return null;
    var total = parseInt((r.header('content-range').match(/\/(\d+)/) || [])[1], 10) || 0;
    return { size: total };
  });
}

function regionLabel(region) {
  return String(region || '').replace(/-\d+g.*$/i, '').replace(/^leaseweb-/i, '').toUpperCase();
}

function findStreams(tmdbId, mediaType, season, episode) {
  return run(function* () {
    try {
      var isTv = mediaType === 'tv' || mediaType === 'series';
      var s = parseInt(season, 10) || 1;
      var ep = parseInt(episode, 10) || 1;
      var info = yield getInfo(tmdbId, isTv, s, ep);
      if (!info) { log('id non supportato: ' + tmdbId); return []; }
      var cfg = yield getConfig();
      var api = cfg.base + '/api/player-sources/' + (isTv ? 'tv/' + info.tmdbId + '/' + s + '/' + ep : 'movie/' + info.tmdbId);
      var res = { status: 401, data: null };
      for (var ci = 0; ci < cfg.cookies.length && res.status === 401; ci++) {
        res = yield getJson(api, { 'User-Agent': UA, 'Referer': cfg.base + '/', 'Accept': 'application/json', 'Cookie': cfg.cookies[ci] });
        if (res.status === 401) log('cookie ' + (ci + 1) + ' scaduto (401)');
      }
      var data = res.data;
      if (res.status === 401) return [];
      if (!data) { log('player-sources HTTP ' + res.status); return []; }
      if (data.unavailable) { log('non disponibile'); return []; }
      if (data.gate) { log('gate ' + data.gate); return []; }
      var cdn = (data.sources || []).filter(function (x) { return x && x.provider === 'cdn' && /^https:\/\//.test(x.url || ''); });
      cdn.sort(function (a, b) { return (a.priority || 99) - (b.priority || 99); });
      if (!cdn.length) { log('nessuna CDN (' + (data.playerPolicy || '-') + ')'); return []; }

      var title = info.title || (isTv ? 'Serie' : 'Film');
      var heading = '\uD83D\uDCC1 ' + title + (isTv ? ' S' + pad2(s) + 'E' + pad2(ep) : '') + (info.year ? ' (' + info.year + ')' : '') +
        (info.episodeName ? ' \u00B7 ' + info.episodeName : '');
      var streams = [];
      var seenHosts = {};
      for (var i = 0; i < cdn.length && i < MAX_PROBES && streams.length < MAX_STREAMS; i++) {
        var src = cdn[i];
        var host = (src.url.match(/^https:\/\/([^/]+)/) || [])[1];
        if (seenHosts[host]) continue;
        seenHosts[host] = 1;
        var probe = yield probeEdge(src.url);
        if (!probe) { log('edge ' + host + ' non risponde'); continue; }
        var n = streams.length;
        var quality = String(src.quality || '720p').replace(/^m/i, '');
        var bitrate = probe.size && info.runtime ? formatBitrate(probe.size * 8 / (info.runtime * 60)) : '';
        var technical = ['\uD83C\uDF9E\uFE0F ' + quality + ' \u00B7 MP4',
          bitrate ? '\uD83D\uDCF6 ~' + bitrate : '',
          probe.size ? '\uD83D\uDCBE ' + formatSize(probe.size) : ''].filter(Boolean).join(' \u00B7 ');
        var details = [
          technical,
          '\uD83D\uDD0A ' + FLAG_IT + ' Italiano',
          '\uD83C\uDFAC Altadefinizione \u00B7 CDN ' + (n + 1) + (src.region ? ' ' + regionLabel(src.region) : '') + ' \u00B7 ' + FLAG_IT
        ].join('\n');
        streams.push({
          name: sortPrefix(quality, n) + '🏰 Altadefinizione ' + quality + ' ' + FLAG_IT + (n ? ' \u00B7 alt' : ''),
          title: heading + '\n' + details,
          size: details,
          url: src.url,
          quality: quality,
          provider: 'altadefinizione',
          behaviorHints: {
            bingeGroup: 'altadefinizione-cdn',
            videoSize: probe.size || undefined,
            filename: 'altadefinizione-' + info.tmdbId + (isTv ? '-s' + pad2(s) + 'e' + pad2(ep) : '') + '-' + quality + '.mp4'
          }
        });
      }
      return streams;
    } catch (e) {
      log('errore: ' + (e && e.message ? e.message : e));
      return [];
    }
  });
}

// ---------- Test di Nuvio ----------
// Il Test di Nuvio chiama sempre TMDB 603 (Matrix, assente qui): come PaCC lo si reindirizza a un titolo noto.
var PROBE = { id: 'tt1375666', type: 'movie', season: null, episode: null }; // Inception

function getStreams(tmdbId, mediaType, season, episode) {
  if (String(tmdbId || '').replace(/^tmdb:/i, '').trim() !== '603') return findStreams(tmdbId, mediaType, season, episode);
  log('test Nuvio (603) -> ' + PROBE.id);
  return findStreams(PROBE.id, PROBE.type, PROBE.season, PROBE.episode).then(function (list) {
    return (list || []).map(function (st) {
      st.name += ' \uD83E\uDDEA';
      st.title = '\uD83E\uDDEA Test Nuvio (603 -> titolo noto)\n' + st.title;
      return st;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  globalThis.getStreams = getStreams;
}
