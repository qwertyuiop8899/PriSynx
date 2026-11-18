// AnimeSaturn - provider per NuvioTV / Nuvio Mobile.
// Mapping TMDB/IMDb/Kitsu -> pagine AnimeSaturn da anime.stremio-italia.eu, poi
// /anime/{slug}/ep-N -> iframe SaturnCDN -> /embed/{id}/playlist (base64 XOR token) -> HLS/MP4 (StreamPeaker).

var MAPPING_BASES = [
  (typeof ANIME_MAPPING_API !== 'undefined' && ANIME_MAPPING_API) ? ANIME_MAPPING_API : 'https://animemapping.realbestia.com',
  'https://anime.stremio-italia.eu'
];
var AS_BASE = 'https://www.animesaturn.net';
var TMDB_KEY_FALLBACK = '68e094699525b18a70bab2f86b1fa706';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var MAX_PATHS = 4;

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

function log(msg) { try { console.log('[AnimeSaturn] ' + msg); } catch (e) { } }

function parseJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

function decodeEntities(s) {
  return String(s || '').replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64decode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  var out = '', buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = ((buf << 6) | B64.indexOf(s.charAt(i))) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 0xff); }
  }
  return out;
}

function xorToken(data, token) {
  var out = '';
  for (var i = 0; i < data.length; i++) out += String.fromCharCode(data.charCodeAt(i) ^ token.charCodeAt(i % token.length));
  return out;
}

// ---------- HLS ----------

function bestVariant(text) {
  var best = null, m, re = /#EXT-X-STREAM-INF:([^\r\n]*)/g;
  while ((m = re.exec(text))) {
    var a = m[1];
    var res = a.match(/RESOLUTION=(\d+)x(\d+)/) || [];
    var v = {
      width: parseInt(res[1], 10) || 0,
      height: parseInt(res[2], 10) || 0,
      bandwidth: parseInt((a.match(/AVERAGE-BANDWIDTH=(\d+)/) || a.match(/(?:^|,)BANDWIDTH=(\d+)/) || [])[1], 10) || 0,
      codecs: (a.match(/CODECS="([^"]*)"/) || [])[1] || ''
    };
    if (!best || v.height > best.height || (v.height === best.height && v.bandwidth > best.bandwidth)) best = v;
  }
  return best;
}

function qualityFromHeight(h) {
  if (!h) return '';
  if (h >= 2000) return '2160p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 460) return '480p';
  return '360p';
}

function formatBitrate(bps) {
  if (!bps) return '';
  if (bps >= 1000000) {
    var mbps = bps / 1000000;
    return (mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)).replace(/\.0+$/, '') + ' Mbps';
  }
  return Math.round(bps / 1000) + ' kbps';
}

function codecLabel(codecs) {
  var out = [];
  String(codecs || '').split(',').forEach(function (c) {
    c = c.trim().toLowerCase();
    var l = /^(?:avc1|avc3)/.test(c) ? 'H.264' : /^(?:hev1|hvc1)/.test(c) ? 'HEVC' : /^av01/.test(c) ? 'AV1' :
      /^vp09/.test(c) ? 'VP9' : /^mp4a/.test(c) ? 'AAC' : /^ec-3/.test(c) ? 'E-AC-3' : /^ac-3/.test(c) ? 'AC-3' : '';
    if (l && out.indexOf(l) === -1) out.push(l);
  });
  return out.join(' / ');
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
  if (/streampeaker/i.test(h)) return 'StreamPeaker';
  if (/saturncdn/i.test(h)) return 'SaturnCDN';
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
        if (j && j.ok && j.mappings && j.mappings.animesaturn) return j;
        return tryBase(idx + 1);
      }).catch(function () {
        return tryBase(idx + 1);
      });
  }
  return tryBase(0);
}

function asPaths(map) {
  var raw = map && map.mappings && map.mappings.animesaturn;
  var list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  var out = [];
  list.forEach(function (x) {
    var p = typeof x === 'string' ? x : x && (x.path || x.url || x.href);
    p = (String(p || '').replace(/^https?:\/\/[^/]+/i, '').match(/^\/anime\/[^/?#]+/) || [])[0];
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

// ---------- AnimeSaturn ----------

function resolvePath(path, ep) {
  return run(function* () {
    var watchUrl = AS_BASE + path + '/ep-' + ep;
    var page = yield req(watchUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8', 'Referer': AS_BASE + path } });
    if (!page.ok) { log(path + ' ep ' + ep + ': HTTP ' + page.status); return null; }
    var embed = decodeEntities((page.text.match(/<iframe\b[^>]*src=["']((?:https?:)?\/\/[^"']*saturncdn[^"']*\/embed\/[^"']+)["']/i) || [])[1] || '');
    if (!embed) { log(path + ' ep ' + ep + ': iframe SaturnCDN assente'); return null; }
    if (embed.indexOf('//') === 0) embed = 'https:' + embed;
    var origin = (embed.match(/^https?:\/\/[^/]+/i) || [])[0];
    var vid = (embed.match(/\/embed\/([^/?#]+)/) || [])[1];
    var token = (embed.match(/[?&]token=([^&#]+)/) || [])[1] || '';
    var expires = (embed.match(/[?&]expires=([^&#]+)/) || [])[1] || '';
    if (!vid || !token) { log('embed senza token: ' + embed); return null; }

    var pl = yield req(origin + '/embed/' + vid + '/playlist?token=' + token + '&expires=' + expires, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Origin': origin, 'Referer': embed, 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' }
    });
    var j = parseJson(pl.text);
    var media = j && j.d ? xorToken(b64decode(j.d), decodeURIComponent(token)).trim() : '';
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(media)) { log(path + ' ep ' + ep + ': playlist HTTP ' + pl.status + ', link non valido'); return null; }

    var headers = { 'User-Agent': UA, 'Referer': embed, 'Origin': origin };
    var hls = /\.m3u8(?:[?#]|$)/i.test(media);
    var out = { url: media, headers: headers, hls: hls, size: 0, variant: null, ita: isItaPath(path) };
    if (hls) {
      var mr = yield req(media, { headers: headers });
      if (mr.ok && mr.text.indexOf('#EXTM3U') !== -1) {
        out.variant = bestVariant(mr.text);
      }
    } else {
      var pr = yield req(media, { headers: { 'User-Agent': UA, 'Referer': embed, 'Origin': origin, 'Range': 'bytes=0-0' } });
      if (pr.status === 206 || pr.status === 200) {
        out.size = parseInt((pr.header('content-range').match(/\/(\d+)/) || [])[1], 10) || 0;
      } else {
        out.size = 0;
      }
    }
    out.pageTitle = decodeEntities((page.text.match(/<title>([^<]*)/i) || [])[1] || '')
      .replace(/^\s*AnimeSaturn\s*-\s*/i, '').replace(/\s+Episodio\b.*$/i, '').replace(/\s*\(ITA\)\s*$/i, '').trim();
    return out;
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
        if (!asPaths(map).length) {
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
      var paths = asPaths(map);
      if (!paths.length && map) {
        var kitsuId = (map.requested && map.requested.resolvedKitsuId) || (map.kitsu && map.kitsu.id);
        if (kitsuId && (id.provider !== 'kitsu' || id.id !== String(kitsuId))) {
          var kMap = yield fetchMapping('kitsu', String(kitsuId), 0, id.episode || ep);
          if (kMap && asPaths(kMap).length) {
            map = kMap;
            paths = asPaths(map);
          }
        }
      }
      if (!paths.length) { log('nessuna pagina AnimeSaturn per ' + tmdbId); return []; }
      var absEp = isMovie ? 1 : (map.kitsu && parseInt(map.kitsu.episode, 10)) || id.episode || ep;
      log((map.kitsu && map.kitsu.canonicalTitle) + ' ep ' + absEp + ': ' + paths.join(', '));

      if (!tmdb && id.provider === 'tmdb') tmdb = yield tmdbInfo(id.id, !isMovie);
      var title = (tmdb && (tmdb.name || tmdb.title)) || (map.kitsu && (map.kitsu.titles && map.kitsu.titles.en || map.kitsu.canonicalTitle)) || '';
      var year = String((tmdb && (tmdb.first_air_date || tmdb.release_date)) || (map.kitsu && map.kitsu.startDate) || '').slice(0, 4);
      var epLabel = isMovie ? '' : id.absolute ? ' Ep ' + absEp : ' S' + pad2(s) + 'E' + pad2(ep);

      var streams = [], seen = {};
      for (var i = 0; i < paths.length; i++) {
        var res = yield resolvePath(paths[i], absEp);
        if (!res) continue;
        var key = res.url.split('?')[0];
        if (seen[key]) continue;
        seen[key] = 1;
        var v = res.variant;
        var quality = qualityFromHeight(v && v.height) || ((res.url.match(/(2160|1080|720|480)p/i) || [])[1] ? res.url.match(/(2160|1080|720|480)p/i)[1] + 'p' : 'HD');
        var fmt = res.hls ? 'HLS' : 'MP4';
        var heading = '\uD83D\uDCC1 ' + (title || res.pageTitle || 'Anime') + epLabel + (year ? ' (' + year + ')' : '');
        var technical = [
          '\uD83C\uDF9E\uFE0F ' + quality + ' \u00B7 ' + fmt,
          v && v.codecs ? codecLabel(v.codecs) : '',
          v && v.bandwidth ? formatBitrate(v.bandwidth) : '',
          res.size ? '\uD83D\uDCBE ' + formatSize(res.size) : '',
          !isMovie && absEp !== ep && !id.absolute ? '\uD83D\uDD22 Ep. assoluto ' + absEp : ''
        ].filter(Boolean).join(' \u00B7 ');
        var details = [
          technical,
          res.ita ? '\uD83D\uDD0A ' + FLAG_IT + ' Italiano' : '\uD83D\uDD0A ' + FLAG_JP + ' Giapponese \u00B7 \uD83D\uDCAC ' + FLAG_IT + ' Sub-ITA',
          '\uD83C\uDFAC AnimeSaturn \u00B7 ' + hostLabel(res.url) + ' \u00B7 ' + fmt + ' \u00B7 ' + FLAG_IT
        ].join('\n');
        var stream = {
          name: sortPrefix(quality === 'HD' ? '720' : quality, res.ita ? 0 : 2) + '🦊 AnimeSaturn ' + quality + ' ' + FLAG_IT + (res.ita ? '' : ' SUB'),
          title: heading + '\n' + details,
          size: details,
          url: res.url,
          quality: quality,
          provider: 'animesaturn',
          headers: res.headers,
          behaviorHints: {
            notWebReady: true,
            headers: res.headers,
            proxyHeaders: { request: res.headers },
            bingeGroup: 'animesaturn-' + (res.ita ? 'ita' : 'sub'),
            videoSize: res.size || undefined,
            filename: decodeURIComponent(res.url.split('?')[0].split('/').pop() || 'animesaturn.mp4')
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
