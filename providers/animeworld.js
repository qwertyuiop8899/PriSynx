// AnimeWorld - provider per NuvioTV / Nuvio Mobile.
// Mapping TMDB/IMDb/Kitsu -> pagine AnimeWorld da anime.stremio-italia.eu, poi
// pagina anime -> token episodio -> /api/episode/info -> MP4 diretto (SweetPixel).

var MAPPING_BASES = [
  (typeof ANIME_MAPPING_API !== 'undefined' && ANIME_MAPPING_API) ? ANIME_MAPPING_API : 'https://animemapping.realbestia.com',
  'https://anime.stremio-italia.eu'
];
var AW_BASE = 'https://www.animeworld.ac';
var TMDB_KEY_FALLBACK = '68e094699525b18a70bab2f86b1fa706';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var MAX_PATHS = 4;
// domini che servono video segnaposto
var BLOCKED = ['jujutsukaisenanime.com', 'onepunchman.it', 'dragonballhd.it', 'narutolegend.it'];

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
      return { ok: r.ok, status: r.status, text: t || '', url: r.url || url, header: function (k) { try { return r.headers.get(k) || ''; } catch (e) { return ''; } } };
    });
  }).catch(function () { return { ok: false, status: 0, text: '', url: url, header: function () { return ''; } }; });
}

function log(msg) { try { console.log('[AnimeWorld] ' + msg); } catch (e) { } }

function parseJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

function decodeEntities(s) {
  return String(s || '').replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ---------- formato stream (come PriSynx vixsrc.js) ----------

var FLAG_IT = '\uD83C\uDDEE\uD83C\uDDF9';
var FLAG_JP = '\uD83C\uDDEF\uD83C\uDDF5';
var ZW_PREFIX = ['\u200B', '\u200C', '\u200D', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064'];

function sortPrefix(quality, syncLevel) {
  var q = Number(String(quality || '').replace(/[^0-9]/g, '')) || 0;
  var r = q >= 2160 ? 0 : q >= 1080 ? 1 : q >= 720 ? 2 : 3;
  return ZW_PREFIX[r] + ZW_PREFIX[syncLevel];
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  return Math.round(bytes / 1048576) + ' MB';
}

function hostLabel(u) {
  var h = (String(u).match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
  if (/sweetpixel/i.test(h)) return 'SweetPixel';
  h = h.replace(/^www\./, '').split('.')[0];
  return h ? h.charAt(0).toUpperCase() + h.slice(1) : 'Server';
}

// ---------- id / mapping ----------

function tmdbKey() {
  try { if (typeof TMDB_API_KEY === 'string' && TMDB_API_KEY.length > 10) return TMDB_API_KEY; } catch (e) { }
  return TMDB_KEY_FALLBACK;
}

// "603", "tmdb:603", "tt0409591", "kitsu:11", "kitsu:11:5", "mal:20"...
function parseId(raw, episode) {
  var v = String(raw || '').trim();
  try { v = decodeURIComponent(v); } catch (e) { }
  var m = v.match(/^(kitsu|mal|anilist|anidb):(\d+)(?::(\d+))?(?::(\d+))?$/i);
  if (m) return { provider: m[1].toLowerCase(), id: m[2], episode: parseInt(m[4] || m[3], 10) || episode, absolute: true };
  m = v.match(/^(?:imdb:)?(tt\d+)/i);
  if (m) return { provider: 'imdb', id: m[1] };
  m = v.match(/^(?:tmdb:)?(\d+)$/i);
  if (m) return { provider: 'tmdb', id: m[1] };
  return null;
}

function fetchMapping(provider, id, season, episode) {
  var q = '?ep=' + episode + (season ? '&s=' + season : '') + '&lang=it';
  function tryBase(idx) {
    if (idx >= MAPPING_BASES.length) return Promise.resolve(null);
    var base = MAPPING_BASES[idx];
    return req(base + '/' + provider + '/' + encodeURIComponent(id) + q, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
      .then(function (r) {
        var j = parseJson(r.text);
        if (j && j.ok && j.mappings && j.mappings.animeworld) return j;
        return tryBase(idx + 1);
      }).catch(function () {
        return tryBase(idx + 1);
      });
  }
  return tryBase(0);
}

function awPaths(map) {
  var raw = map && map.mappings && map.mappings.animeworld;
  var list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  var out = [];
  list.forEach(function (x) {
    var p = typeof x === 'string' ? x : x && (x.path || x.url || x.href);
    p = (String(p || '').replace(/^https?:\/\/[^/]+/i, '').match(/^\/play\/[^/?#]+/) || [])[0];
    if (p && out.indexOf(p) === -1) out.push(p);
  });
  // doppiato ITA prima del sottotitolato
  out.sort(function (a, b) { return (isItaPath(b) ? 1 : 0) - (isItaPath(a) ? 1 : 0); });
  return out.slice(0, MAX_PATHS);
}

function isItaPath(p) { return /-ita(?:[.\-/]|$)/i.test(p); }

function tmdbInfo(tmdbId, isTv) {
  return req('https://api.themoviedb.org/3/' + (isTv ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + tmdbKey() + '&language=it-IT&append_to_response=external_ids')
    .then(function (r) { return r.ok ? parseJson(r.text) : null; });
}

// ---------- AnimeWorld ----------

var securityCookie = '';

function awGet(url, extra) {
  return run(function* () {
    var h = { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8' };
    if (securityCookie) h.Cookie = securityCookie;
    var r = yield req(url, { headers: h });
    // challenge anti-bot: cookie SecurityAW nel corpo e reload con ?d=1
    var m = r.text.match(/(SecurityAW[\w-]*)=([a-f0-9]+)/i);
    if (m && !/data-episode-num/.test(r.text)) {
      securityCookie = m[1] + '=' + m[2];
      h.Cookie = securityCookie;
      r = yield req(url + (url.indexOf('?') === -1 ? '?d=1' : '&d=1'), { headers: h });
    }
    return r;
  });
}

function parseEpisodes(html) {
  var out = [], tags = html.match(/<a\b[^>]*data-episode-num=[^>]*>/gi) || [];
  tags.forEach(function (t) {
    var num = parseFloat(String((t.match(/data-episode-num=["']([^"']+)/) || [])[1] || '').replace(',', '.'));
    var token = (t.match(/data-id=["']([^"']+)/) || [])[1];
    if (token && isFinite(num)) out.push({ num: Math.round(num), token: token });
  });
  return out;
}

function pickEpisode(list, ep, isMovie) {
  if (!list.length) return null;
  if (isMovie) return list[0];
  for (var i = 0; i < list.length; i++) if (list[i].num === ep) return list[i];
  return list.length === 1 && ep === 1 ? list[0] : null;
}

function resolvePath(path, ep, isMovie) {
  return run(function* () {
    var animeUrl = AW_BASE + path;
    var page = yield awGet(animeUrl);
    if (!page.ok) { log(path + ' HTTP ' + page.status); return null; }
    var eps = parseEpisodes(page.text);
    var entry = pickEpisode(eps, ep, isMovie);
    if (!entry) { log(path + ': episodio ' + ep + ' non trovato (' + eps.length + ' episodi)'); return null; }
    var csrf = (page.text.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)/i) || [])[1] || '';
    var sess = (page.header('set-cookie').match(/sessionId=[^;,\s]+/) || [])[0] || '';
    var cookie = [securityCookie, sess].filter(Boolean).join('; ');
    var h = { 'User-Agent': UA, 'Referer': animeUrl, 'X-Requested-With': 'XMLHttpRequest' };
    if (csrf) h['csrf-token'] = csrf;
    if (cookie) h.Cookie = cookie;
    var info = parseJson((yield req(AW_BASE + '/api/episode/info?id=' + encodeURIComponent(entry.token), { headers: h })).text) || {};
    var media = /^https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:[?#][^\s"'<>]*)?$/i.test(info.grabber || '') ? info.grabber : '';
    if (!media && info.target) {
      // fallback: pagina del player
      var tr = yield req(AW_BASE + String(info.target).replace(/^https?:\/\/[^/]+/i, ''), { headers: h });
      media = (tr.text.replace(/\\\//g, '/').match(/https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8)[^\s"'<>\\]*/i) || [])[0] || '';
    }
    if (!media) { log(path + ' ep ' + entry.num + ': nessun link'); return null; }
    var low = media.toLowerCase();
    if (/\.mkv\.mp4$/.test(low) || BLOCKED.some(function (d) { return low.indexOf(d) !== -1; })) { log('link scartato ' + media); return null; }
    var title = decodeEntities((page.text.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1] || '')
      .replace(/\s*-\s*AnimeWorld.*$/i, '').replace(/\s+(?:Streaming|Episodio)\b.*$/i, '').trim();
    var headers = { 'User-Agent': UA, 'Referer': animeUrl };
    var size = 0;
    if (/\.mp4/i.test(media)) {
      var pr = yield req(media, { headers: { 'User-Agent': UA, 'Referer': animeUrl, 'Range': 'bytes=0-0' } });
      if (pr.status !== 206 && pr.status !== 200) {
        log('MP4 probe Range HTTP ' + pr.status + ' (procedo senza size)');
        size = 0;
      } else {
        size = parseInt((pr.header('content-range').match(/\/(\d+)/) || [])[1], 10) || 0;
      }
    }
    return { url: media, headers: headers, size: size, num: entry.num, ita: isItaPath(path), pageTitle: title, hls: /\.m3u8/i.test(media) };
  });
}

// ---------- flusso principale ----------

function findStreams(tmdbId, mediaType, season, episode) {
  return run(function* () {
    try {
      var isMovie = mediaType === 'movie';
      var s = parseInt(season, 10) || 1;
      var ep = parseInt(episode, 10) || 1;
      var id = parseId(tmdbId, ep);
      if (!id) { log('id non supportato: ' + tmdbId); return []; }

      var map = null, tmdb = null;
      if (id.provider === 'tmdb') {
        map = yield fetchMapping('tmdb', id.id, isMovie ? 0 : s, isMovie ? 1 : ep);
        if (!awPaths(map).length) {
          // molti anime sono mappati solo via IMDb
          tmdb = yield tmdbInfo(id.id, !isMovie);
          var imdb = tmdb && tmdb.external_ids && tmdb.external_ids.imdb_id;
          if (imdb) map = yield fetchMapping('imdb', imdb, isMovie ? 0 : s, isMovie ? 1 : ep);
        }
      } else if (id.provider === 'imdb') {
        map = yield fetchMapping('imdb', id.id, isMovie ? 0 : s, isMovie ? 1 : ep);
      } else {
        map = yield fetchMapping(id.provider, id.id, 0, id.episode || ep);
      }
      var paths = awPaths(map);
      if (!paths.length && map) {
        var kitsuId = (map.requested && map.requested.resolvedKitsuId) || (map.kitsu && map.kitsu.id);
        if (kitsuId && (id.provider !== 'kitsu' || id.id !== String(kitsuId))) {
          var kMap = yield fetchMapping('kitsu', String(kitsuId), 0, id.episode || ep);
          if (kMap && awPaths(kMap).length) {
            map = kMap;
            paths = awPaths(map);
          }
        }
      }
      if (!paths.length) { log('nessuna pagina AnimeWorld per ' + tmdbId); return []; }
      var absEp = (map.kitsu && parseInt(map.kitsu.episode, 10)) || id.episode || ep;
      log((map.kitsu && map.kitsu.canonicalTitle) + ' ep ' + absEp + ': ' + paths.join(', '));

      if (!tmdb && id.provider === 'tmdb') tmdb = yield tmdbInfo(id.id, !isMovie);
      var title = (tmdb && (tmdb.name || tmdb.title)) || (map.kitsu && (map.kitsu.titles && map.kitsu.titles.en || map.kitsu.canonicalTitle)) || '';
      var year = String((tmdb && (tmdb.first_air_date || tmdb.release_date)) || (map.kitsu && map.kitsu.startDate) || '').slice(0, 4);
      var epLabel = isMovie ? '' : id.absolute ? ' Ep ' + absEp : ' S' + pad2(s) + 'E' + pad2(ep);

      var streams = [], seen = {};
      for (var i = 0; i < paths.length; i++) {
        var res = yield resolvePath(paths[i], absEp, isMovie);
        if (!res || seen[res.url]) continue;
        seen[res.url] = 1;
        var heading = '\uD83D\uDCC1 ' + (title || res.pageTitle || 'Anime') + epLabel + (year ? ' (' + year + ')' : '');
        var quality = (res.url.match(/(2160|1080|720|480)p?/i) || [])[1];
        quality = quality ? quality + 'p' : 'HD';
        var technical = [
          '\uD83C\uDF9E\uFE0F ' + (quality === 'HD' ? 'HD' : quality) + ' \u00B7 ' + (res.hls ? 'HLS' : 'MP4'),
          res.size ? '\uD83D\uDCBE ' + formatSize(res.size) : '',
          !isMovie && absEp !== ep && !id.absolute ? '\uD83D\uDD22 Ep. assoluto ' + absEp : ''
        ].filter(Boolean).join(' \u00B7 ');
        var details = [
          technical,
          res.ita ? '\uD83D\uDD0A ' + FLAG_IT + ' Italiano' : '\uD83D\uDD0A ' + FLAG_JP + ' Giapponese \u00B7 \uD83D\uDCAC ' + FLAG_IT + ' Sub-ITA',
          '\uD83C\uDFAC AnimeWorld \u00B7 ' + hostLabel(res.url) + ' \u00B7 ' + (res.hls ? 'HLS' : 'MP4') + ' \u00B7 ' + FLAG_IT
        ].join('\n');
        var stream = {
          name: sortPrefix(quality === 'HD' ? '720' : quality, res.ita ? 0 : 2) + '🌸 AnimeWorld ' + quality + ' ' + FLAG_IT + (res.ita ? '' : ' SUB'),
          title: heading + '\n' + details,
          size: details,
          url: res.url,
          quality: quality,
          provider: 'animeworld',
          headers: res.headers,
          behaviorHints: {
            notWebReady: true,
            headers: res.headers,
            proxyHeaders: { request: res.headers },
            bingeGroup: 'animeworld-' + (res.ita ? 'ita' : 'sub'),
            videoSize: res.size || undefined,
            filename: decodeURIComponent(res.url.split('?')[0].split('/').pop() || 'animeworld.mp4')
          }
        };
        if (res.hls) stream.type = 'hls';
        if (!res.ita) stream.name = stream.name.replace(FLAG_IT, FLAG_JP);
        streams.push(stream);
      }
      streams.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      return streams;
    } catch (e) {
      log('errore: ' + (e && e.message ? e.message : e));
      return [];
    }
  });
}

// ---------- Test di Nuvio ----------
// Il Test di Nuvio chiama sempre TMDB 603 (Matrix, assente qui): come PaCC lo si reindirizza a un titolo noto.
var PROBE = { id: 'tt0409591', type: 'tv', season: 1, episode: 1 }; // Naruto

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
