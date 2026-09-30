// MovyITA - Nuvio provider: Movy video (up to 4K) + StreamingCommunity/vixsrc Italian audio in a single HLS stream.
// Written without async/await (generators via __async) so it runs on both Hermes and QuickJS plugin runtimes.

var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "68e094699525b18a70bab2f86b1fa706";
var TMDB_BASE = "https://api.themoviedb.org/3";

// Tried in order; add new mirrors here if the site moves without a redirect.
var MOVY_SITES = ["https://www.movy.sx", "https://movy.sx"];
// Used directly: the ~400 KB homepage is scraped for a new API host only when this one stops answering.
var MOVY_API = "https://api.wecollege.net";
// All servers of the movy.sx player, most useful first (probed 2026-09: only miami/boise have 4K; munich often times out).
var MOVY_SERVERS = ["miami", "boise", "atlanta", "orlando", "phoenix", "seattle", "denver", "portland", "dallas", "tampa",
  "paris", "cancun", "berlin", "austin", "delhi", "munich"];
// NOT the search list (that is MOVY_SERVERS): only these servers' files were measured by ToastFlix, so only they get its sync badge.
var TOASTFLIX_MEASURED_SERVERS = ["miami", "boise"];
// NuvioTV runs fetches one at a time, so stop asking further servers after this.
var MOVY_SERVERS_BUDGET_MS = 8000;
var MOVY_QUALITIES = ["2160", "1080", "720"];
var MOVY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

var VIX_DOMAINS_URL = "https://raw.githubusercontent.com/realbestia1/domains/refs/heads/main/domains.json";
var VIX_DEFAULT_BASE = "https://vixsrc.to";
var VIX_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

var TOASTFLIX_URL = "https://toastflix.stremio-italia.eu";
// Lip-sync becomes noticeable around 45 ms early / 125 ms late (ITU-R BT.1359); 100 ms is a safe "in sync" band.
var SYNC_OK_SECONDS = 0.1;
// A speed mismatch below this drifts less than the sync band over a 2-hour film.
var SYNC_RATE_TOLERANCE = SYNC_OK_SECONDS / 7200;
// NuvioTV (>=1.1.0-beta.3) clamps the manual audio delay to ±60000 ms in 25 ms steps.
var NUVIO_DELAY_STEP_MS = 25;
// Largest offset to hand to NuvioTV auto-sync (±60 s).
var AUTO_DELAY_MAX_MS = 60000;
var NUVIO_MAX_DELAY_MS = AUTO_DELAY_MAX_MS;

var AUTOSYNC_API_URL = "http://92.4.161.181:8095/plugin/jobs";
var PRISYNX_SECRET = "prisynx-hmac-secure-2026";
// Frame-rate pairs behind typical release speed changes (NTSC 1000/1001, PAL 25).
var FPS_PAIRS = [[23.976, 24], [24, 25], [23.976, 25]];

var QUALITY_INFO = {
  "2160": { label: "4K", resolution: "3840x2160", bandwidth: 16000000 },
  "1440": { label: "1440p", resolution: "2560x1440", bandwidth: 10000000 },
  "1080": { label: "1080p", resolution: "1920x1080", bandwidth: 6000000 },
  "720": { label: "720p", resolution: "1280x720", bandwidth: 3000000 },
  "480": { label: "480p", resolution: "854x480", bandwidth: 1500000 },
  "360": { label: "360p", resolution: "640x360", bandwidth: 800000 }
};

var movyCfg = { site: MOVY_SITES[0], api: MOVY_API };

function __async(gen) {
  return new Promise(function (resolve, reject) {
    function step(method, arg) {
      var r;
      try {
        r = gen[method](arg);
      } catch (e) {
        reject(e);
        return;
      }
      if (r.done) resolve(r.value);
      else Promise.resolve(r.value).then(function (v) { step("next", v); }, function (e) { step("throw", e); });
    }
    step("next");
  });
}

// ---------------------------------------------------------------- HTTP

function fetchWithTimeout(url, options, ms) {
  // NuvioTV's QuickJS runtime has no timers; its native fetch already has its own timeouts.
  if (typeof setTimeout !== "function") return fetch(url, options);
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; reject(new Error("Timeout: " + url)); }
    }, ms || 15000);
    fetch(url, options).then(function (res) {
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }, function (err) {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

function getText(url, headers, ms) {
  return fetchWithTimeout(url, { headers: headers || {} }, ms).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url.split("?")[0]);
    return res.text();
  });
}

function getJson(url, headers, ms) {
  return getText(url, headers, ms).then(function (text) { return JSON.parse(text); });
}

function reportUnmeasuredToAutoSync(payload) {
  if (!AUTOSYNC_API_URL) return;
  try {
    fetchWithTimeout(AUTOSYNC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PriSynx-Key": PRISYNX_SECRET
      },
      body: JSON.stringify(payload)
    }, 2500).catch(function () {});
  } catch (e) {}
}

function getAutoSyncJobStatus(mediaKey) {
  if (!AUTOSYNC_API_URL || !mediaKey) return Promise.resolve(null);
  var url = AUTOSYNC_API_URL.replace(/\/jobs\/?$/, "/jobs/status") + "?media_key=" + encodeURIComponent(mediaKey);
  return getJson(url, { "Accept": "application/json" }, 2500).then(function (d) {
    if (!d || !d.items || !d.items.length) return null;
    var running = d.items.some(function (it) { return it.status === "running"; });
    if (running) return "running";
    var queued = d.items.some(function (it) { return it.status === "queued"; });
    if (queued) return "queued";
    var incompatible = d.items.some(function (it) { return it.status === "incompatible"; });
    if (incompatible) return "incompatible";
    return null;
  }).catch(function () {
    return null;
  });
}

function toQuery(params) {
  return Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]).replace(/%20/g, "+");
  }).join("&");
}

function absUrl(uri, base) {
  if (/^https?:\/\//i.test(uri)) return uri;
  var origin = (base.match(/^https?:\/\/[^\/]+/i) || [""])[0];
  if (uri.charAt(0) === "/") return origin + uri;
  return base.split("?")[0].replace(/[^\/]*$/, "") + uri;
}

// ---------------------------------------------------------------- Encoding helpers (no Buffer/atob/TextDecoder needed)

var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(str) {
  var s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
  var out = new Uint8Array(Math.floor(s.length * 3 / 4));
  var buf = 0, bits = 0, n = 0;
  for (var i = 0; i < s.length; i++) {
    buf = ((buf << 6) | B64.indexOf(s.charAt(i))) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (buf >> bits) & 255;
    }
  }
  return out.subarray(0, n);
}

function asciiToBase64(str) {
  var out = "", i = 0, n;
  for (; i + 2 < str.length; i += 3) {
    n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8) | str.charCodeAt(i + 2);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
  }
  if (str.length - i === 1) {
    n = str.charCodeAt(i) << 16;
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + "==";
  } else if (str.length - i === 2) {
    n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + "=";
  }
  return out;
}

function utf8Decode(bytes) {
  var out = "", i = 0, c, cp;
  while (i < bytes.length) {
    c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c < 0xe0) {
      out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
    } else if (c < 0xf0) {
      out += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    } else {
      cp = (((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Movy payload cipher (ported from movy.js)

var MAGIC = [109, 118, 109, 49]; // "mvm1"

function uHash(e) {
  e >>>= 0;
  e ^= e >>> 16;
  e = Math.imul(e, 0x85ebca6b) >>> 0;
  e ^= e >>> 13;
  e = Math.imul(e, 0xc2b2ae35) >>> 0;
  return (e ^= e >>> 16) >>> 0;
}

function rotl(e, t) {
  e >>>= 0;
  t &= 31;
  return t === 0 ? e >>> 0 : ((e << t) | (e >>> (32 - t))) >>> 0;
}

function initKey(seed, mediaId) {
  var s = new Array(61);
  var h = 0x811c9dc5;
  for (var a = 0; a < seed.length; a++) h = Math.imul(h ^ seed.charCodeAt(a), 0x1000193) >>> 0;
  var i = uHash(uHash(h) ^ uHash((mediaId >>> 0) ^ 0x9e3779b9)) >>> 0;
  for (var e = 0; e < 8; e++) {
    var t = i % 61;
    i = rotl((i + 0x9e3779b9) >>> 0, 7 + (7 & e));
    s[t] = (i ^ uHash(i)) >>> 0;
    i = uHash((i + t) >>> 0);
  }
  return { S: s, acc: uHash(0xa5a5a5a5 ^ i) >>> 0 };
}

function nextWord(state, t) {
  var S = state.S, acc = state.acc, idx = acc % 61;
  var inBounds = idx in S ? -1 : 0;
  var s = ((S[idx] >>> 0) ^ (Math.imul(0x9e3779b9, t + 1) >>> 0)) >>> 0;
  var c = (((acc ^ s) >>> 0) | ((acc & s & inBounds) >>> 0)) >>> 0;
  c = (rotl((c + acc) >>> 0, 31 & idx) ^ rotl(acc, 31 & Math.imul(idx, 7))) >>> 0;
  acc = uHash((c + 0x9e3779b9) >>> 0);
  S[idx] = acc >>> 0;
  state.acc = acc;
  return acc >>> 0;
}

function decryptMovyPayload(encB64, seed, mediaId) {
  var raw = base64ToBytes(encB64);
  var state = initKey(seed, mediaId);
  var out = new Uint8Array(raw.length);
  for (var i = 0, r = 0; i < raw.length; r++) {
    var w = nextWord(state, r);
    for (var b = 0; b < 4 && i < raw.length; b++, i++) out[i] = raw[i] ^ ((w >>> (8 * b)) & 255);
  }
  for (var m = 0; m < MAGIC.length; m++) {
    if (out[m] !== MAGIC[m]) throw new Error("Movy payload magic mismatch");
  }
  return utf8Decode(out.subarray(MAGIC.length));
}

// ---------------------------------------------------------------- TMDB

function resolveTmdbId(rawId, isTv) {
  var id = String(rawId || "").trim().replace(/^tmdb:/i, "");
  if (/^\d+$/.test(id)) return Promise.resolve(id);
  var imdb = (id.match(/tt\d+/) || [])[0];
  if (!imdb) return Promise.resolve(null);
  return getJson(TMDB_BASE + "/find/" + imdb + "?api_key=" + TMDB_KEY + "&external_source=imdb_id", {}, 10000).then(function (d) {
    var list = (isTv ? d.tv_results : d.movie_results) || [];
    return list.length ? String(list[0].id) : null;
  });
}

function tmdbMeta(tmdbId, isTv) {
  var url = TMDB_BASE + "/" + (isTv ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&append_to_response=external_ids";
  return getJson(url, {}, 10000).then(function (d) {
    return {
      title: (isTv ? d.name : d.title) || "",
      year: ((isTv ? d.first_air_date : d.release_date) || "").slice(0, 4),
      imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || "",
      runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 90
    };
  });
}

// ---------------------------------------------------------------- Movy sources

// null for labels without a resolution ("Auto", "Hindi", ...).
function qualityKey(q) {
  var s = String(q || "").toLowerCase();
  if (s.indexOf("4k") >= 0) return "2160";
  var m = s.match(/(\d{3,4})p/);
  return m && QUALITY_INFO[m[1]] ? m[1] : null;
}

function movyHeaders(site) {
  return { "User-Agent": MOVY_UA, "Accept": "*/*", "Origin": site, "Referer": site + "/" };
}

// The Movy API lists links even when the file is gone (403), so each playlist is checked before use.
// Range keeps the check small when a link is really an MP4; playlist hosts ignore it.
function getPlaylistHead(url, headers) {
  var h = { "Range": "bytes=0-65535" };
  Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  return getText(url, h, 8000).catch(function () { return null; });
}

function masterVariants(body, baseUrl) {
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length - 1; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var width = Number(String(attr(lines[i], "RESOLUTION") || "").split("x")[0]);
    var uri = lines[i + 1].trim();
    var qkey = width >= 3200 ? "2160" : width >= 2400 ? "1440" : width >= 1800 ? "1080" : width >= 1200 ? "720" : width >= 800 ? "480" : width > 0 ? "360" : null;
    if (qkey && uri && uri.charAt(0) !== "#") out.push({ url: absUrl(uri, baseUrl), qkey: qkey });
  }
  return out;
}

function discoverMovyConfig() {
  return __async(function* () {
    for (var i = 0; i < MOVY_SITES.length; i++) {
      try {
        var res = yield fetchWithTimeout(MOVY_SITES[i] + "/", { headers: { "User-Agent": MOVY_UA, "Accept": "text/html" } }, 8000);
        if (!res.ok) continue;
        var html = yield res.text();
        var site = ((res.url || MOVY_SITES[i]).match(/^https?:\/\/[^\/]+/i) || [MOVY_SITES[i]])[0];
        var apis = (html.match(/https:\/\/api\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || []).filter(function (u) { return !/tmdb|themoviedb|google|cloudflare/i.test(u); });
        return { site: site, api: apis[0] || MOVY_API };
      } catch (e) {
        console.warn("[MovyITA] Movy site " + MOVY_SITES[i] + ": " + e.message);
      }
    }
    return null;
  }());
}

function getMovySeed(cfg, tmdbId) {
  return getJson(cfg.api + "/seed?mediaId=" + tmdbId, movyHeaders(cfg.site), 10000).then(function (d) {
    if (!d || !d.seed) throw new Error("Movy: no seed");
    return d.seed;
  });
}

function getMovySources(tmdbId, isTv, season, episode, meta) {
  return __async(function* () {
    var cfg = movyCfg, seed;
    try {
      seed = yield getMovySeed(cfg, tmdbId);
    } catch (e) {
      console.warn("[MovyITA] Movy API " + cfg.api + ": " + e.message);
      var found = yield discoverMovyConfig();
      if (!found || (found.api === cfg.api && found.site === cfg.site)) throw e;
      cfg = movyCfg = found;
      seed = yield getMovySeed(cfg, tmdbId);
    }
    var headers = movyHeaders(cfg.site);

    var result = { sources: [], subtitles: [], headers: headers, api: cfg.api };
    var have = {};
    var dirOk = {};
    var started = Date.now();
    for (var n = 0; n < MOVY_SERVERS.length; n++) {
      if (have["2160"] && have["1080"]) break;
      if (n > 0 && Date.now() - started > MOVY_SERVERS_BUDGET_MS) break;
      var server = MOVY_SERVERS[n];
      var add = function (url, qkey) {
        if (have[qkey] || MOVY_QUALITIES.indexOf(qkey) < 0) return;
        have[qkey] = true;
        result.sources.push({
          url: url,
          qkey: qkey,
          server: server.charAt(0).toUpperCase() + server.slice(1),
          measured: TOASTFLIX_MEASURED_SERVERS.indexOf(server) >= 0
        });
      };
      var params = {
        title: encodeURIComponent(meta.title),
        mediaType: isTv ? "tv" : "movie",
        year: meta.year || "",
        tmdbId: String(tmdbId),
        imdbId: meta.imdbId || "",
        enc: "2",
        seed: seed
      };
      if (isTv) {
        params.seasonId = String(season);
        params.episodeId = String(episode);
      }
      try {
        var enc = yield getText(cfg.api + "/" + server + "/sources?" + toQuery(params), headers, n < 2 ? 15000 : 6000);
        if (!enc || !enc.trim()) continue;
        var data = JSON.parse(decryptMovyPayload(enc.trim(), seed, Number(tmdbId)));
        // Non-.m3u8 links are MP4 or embeds: the ITA track can only be attached to HLS.
        var list = (data.sources || []).filter(function (s) { return s && s.url && /\.m3u8(?:$|[?#])/i.test(s.url); });
        for (var j = 0; j < list.length; j++) {
          if (n > 0 && Date.now() - started > MOVY_SERVERS_BUDGET_MS) break;
          var qkey = qualityKey(list[j].quality), url = list[j].url;
          var dir = url.split("?")[0].replace(/[^\/]*$/, "");
          if ((qkey && (have[qkey] || MOVY_QUALITIES.indexOf(qkey) < 0)) || dirOk[dir] === false) continue;
          // Qualities of one title sit in the same folder, so one working playlist vouches for its siblings.
          if (qkey && dirOk[dir]) {
            add(url, qkey);
            continue;
          }
          var body = yield getPlaylistHead(url, headers);
          if (body && body.indexOf("#EXT-X-STREAM-INF") >= 0) {
            masterVariants(body, url).forEach(function (v) { add(v.url, v.qkey); });
          } else if (body && body.indexOf("#EXTINF") >= 0) {
            dirOk[dir] = true;
            if (qkey) add(url, qkey);
          } else {
            dirOk[dir] = false;
            console.warn("[MovyITA] Movy " + server + " " + (list[j].quality || "?") + ": playlist not reachable");
          }
        }
        (data.subtitles || []).forEach(function (sub) {
          if (!sub || !sub.url || result.subtitles.some(function (x) { return x.url === sub.url; })) return;
          result.subtitles.push({ url: sub.url, language: String(sub.language || sub.lang || "en"), name: sub.label || sub.name || sub.language || sub.lang || "Sub" });
        });
      } catch (e) {
        console.warn("[MovyITA] Movy " + server + ": " + e.message);
      }
    }
    return result;
  }());
}

// ---------------------------------------------------------------- vixsrc (StreamingCommunity) Italian audio

// Only read when VIX_DEFAULT_BASE stops answering.
function lookupVixBase() {
  return getText(VIX_DOMAINS_URL + "?_=" + Date.now(), { "Accept": "application/json" }, 6000).then(function (text) {
    var cfg = JSON.parse(text.replace(/("[^"\r\n]+")\s*("[^"]+"\s*:)/g, "$1,$2"));
    var base = String((cfg && cfg.vixsrc) || "").trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(base) ? base : null;
  }).catch(function () {
    return null;
  });
}

function getVixPayload(base, apiPath) {
  return getJson(base + apiPath + "?lang=it", {
    "User-Agent": VIX_UA,
    "Referer": base + "/",
    "Accept": "application/json",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8"
  }, 12000);
}

function attr(line, key) {
  var m = line.match(new RegExp("(?:^|[,:])" + key + "=(\"([^\"]*)\"|[^,]*)"));
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[1];
}

function getItalianTracks(tmdbId, isTv, season, episode) {
  return __async(function* () {
    var apiPath = isTv ? "/api/tv/" + tmdbId + "/" + season + "/" + episode : "/api/movie/" + tmdbId;
    var base = VIX_DEFAULT_BASE, payload;
    try {
      payload = yield getVixPayload(base, apiPath);
    } catch (e) {
      var alt = yield lookupVixBase();
      if (!alt || alt === base) throw e;
      base = alt;
      payload = yield getVixPayload(base, apiPath);
    }
    if (!payload || !payload.src) return null;

    var embedUrl = absUrl(String(payload.src), base + "/");
    var html = yield getText(embedUrl, { "User-Agent": VIX_UA, "Referer": base + "/" }, 12000);
    var token = (html.match(/'token'\s*:\s*'([^']+)'/) || [])[1];
    var expires = (html.match(/'expires'\s*:\s*'([^']+)'/) || [])[1];
    var playlist = (html.match(/url\s*:\s*'([^']+\/playlist\/\d+[^']*)'/) || [])[1];
    if (!token || !expires || !playlist) return null;
    var fhd = /window\.canPlayFHD\s*=\s*true/.test(html) || /[?&]canPlayFHD=1/.test(embedUrl);

    var masterUrl = playlist + (playlist.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token) +
      "&expires=" + encodeURIComponent(expires) + (fhd ? "&h=1" : "") + "&lang=it";
    var master = yield getText(masterUrl, { "User-Agent": VIX_UA, "Referer": embedUrl, "Origin": base }, 12000);

    var audio = null, subtitles = [];
    master.split(/\r?\n/).forEach(function (line) {
      if (line.indexOf("#EXT-X-MEDIA:") !== 0 || !attr(line, "URI")) return;
      var type = attr(line, "TYPE");
      var lang = String(attr(line, "LANGUAGE") || "").toLowerCase();
      var name = String(attr(line, "NAME") || "");
      if (type === "AUDIO" && !audio && (lang === "ita" || lang === "it" || /^ita/i.test(name))) {
        audio = { uri: absUrl(attr(line, "URI"), masterUrl) };
      } else if (type === "SUBTITLES") {
        var subUri = absUrl(attr(line, "URI"), masterUrl);
        var forced = /forced/i.test(name + " " + lang) || attr(line, "FORCED") === "YES";
        if (subtitles.some(function (s) { return s.uri === subUri || s.forced === forced; })) return;
        subtitles.push({ uri: subUri, name: name || "Italiano", lang: lang || "ita", forced: forced });
      }
    });
    return audio ? { audio: audio, subtitles: subtitles } : null;
  }());
}

// ---------------------------------------------------------------- Combined HLS master (data: URI)

function quoteSafe(v) {
  return String(v).replace(/["\r\n]/g, "").replace(/[^\x20-\x7e]/g, "");
}

function buildMasterDataUri(movyUrl, qinfo, ita) {
  // First line ends with a bare CR so mpv's generic m3u parser doesn't grab it; FFmpeg/ExoPlayer accept CR line breaks.
  var lines = ["#EXTM3U\r#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];
  lines.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Italiano",LANGUAGE="it",DEFAULT=YES,AUTOSELECT=YES,URI="' + quoteSafe(ita.audio.uri) + '"');
  ita.subtitles.forEach(function (s) {
    lines.push('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="' + quoteSafe(s.name) + '",LANGUAGE="it"' +
      ',DEFAULT=NO,AUTOSELECT=' + (s.forced ? "YES" : "NO") + ',FORCED=' + (s.forced ? "YES" : "NO") + ',URI="' + quoteSafe(s.uri) + '"');
  });
  lines.push("#EXT-X-STREAM-INF:BANDWIDTH=" + qinfo.bandwidth + ",RESOLUTION=" + qinfo.resolution + ',AUDIO="aud"' +
    (ita.subtitles.length ? ',SUBTITLES="subs"' : ""));
  lines.push(quoteSafe(movyUrl));
  var text = lines.join("\n") + "\n";
  // Base64 must end with '=' so FFmpeg's decoder stops before the "#.m3u8" hint used for HLS probing.
  if (text.length % 3 === 0) text += "\n";
  // "data://" instead of "data:": mpv only treats proto:// strings as URLs; ExoPlayer still reads the payload after the comma.
  // "/m3u8/" in the media type lets NuvioTV (URL-based MIME detection, ignores "type") pick the HLS source.
  return "data://application/m3u8/;base64," + asciiToBase64(text) + "#.m3u8";
}

// ---------------------------------------------------------------- Entry point

function pad2(n) {
  return (Number(n) < 10 ? "0" : "") + Number(n);
}

function itNumber(n) {
  return String(n).replace(".", ",");
}

function nuvioDelayMs(seconds) {
  return Math.round(Number(seconds) * 1000 / NUVIO_DELAY_STEP_MS) * NUVIO_DELAY_STEP_MS;
}

function formatDelay(ms) {
  return (ms >= 0 ? "+" : "") + itNumber(ms / 1000) + " s";
}

function speedLabel(rate) {
  if (Math.abs(rate - 1) <= SYNC_RATE_TOLERANCE) return "stessa velocit\u00E0";
  for (var i = 0; i < FPS_PAIRS.length; i++) {
    var ratio = FPS_PAIRS[i][0] / FPS_PAIRS[i][1];
    if (Math.abs(rate - ratio) < 0.0003 || Math.abs(rate - 1 / ratio) < 0.0003) {
      return itNumber(FPS_PAIRS[i][0]) + "\u2194" + itNumber(FPS_PAIRS[i][1]) + " fps";
    }
  }
  return "velocit\u00E0 \u00D7" + itNumber(Math.round(rate * 10000) / 10000);
}

// `tag` is the short form shown in the stream name next to the emoji.
function classifySync(d) {
  if (d.status !== "ok") {
    return d.status === "incompatible"
      ? { level: "red", reason: "versioni audio/video diverse", tag: "versioni diverse" }
      : { level: "red", reason: "sync non calcolabile", tag: "sync n/d" };
  }
  var rate = Number(d.rate || 1);
  if (Math.abs(rate - 1) > SYNC_RATE_TOLERANCE) return { level: "red", reason: "velocit\u00E0 diversa", tag: speedLabel(rate) };
  if (d.has_cuts) return { level: "red", reason: "versioni con tagli diversi", tag: "tagli" };
  var offset = Number(d.offset || 0);
  if (Math.abs(offset) <= SYNC_OK_SECONDS) return { level: "green", tag: "in sync" };
  var delayMs = nuvioDelayMs(offset);
  if (Math.abs(delayMs) > NUVIO_MAX_DELAY_MS) return { level: "red", reason: "offset oltre " + (AUTO_DELAY_MAX_MS / 1000) + " s", tag: formatDelay(delayMs) };
  return { level: "yellow", delayMs: delayMs, tag: formatDelay(delayMs) };
}

// Offsets measured by ToastFlix for Movy video vs vixsrc audio; positive offset = audio must be delayed.
function getSyncStatus(meta, isTv, season, episode) {
  if (!meta.imdbId) return Promise.resolve({ level: "red", reason: "titolo senza IMDb", tag: "no IMDb" });
  var mediaKey = (isTv ? "series" : "movie") + ":" + meta.imdbId + ":" + (isTv ? Number(season) : 0) + ":" + (isTv ? Number(episode) : 0);
  var url = TOASTFLIX_URL + "/dual/offset/status?imdb=" + encodeURIComponent(meta.imdbId) +
    "&type=" + (isTv ? "series" : "movie") + "&season=" + (isTv ? Number(season) : 0) +
    "&episode=" + (isTv ? Number(episode) : 0) + "&provider=movy&audio_source=vixsrc";
  return getJson(url, { "Accept": "application/json" }, 8000).then(function (d) {
    if (d && d.found) {
      if (d.status === "incompatible") {
        return getAutoSyncJobStatus(mediaKey).then(function (jobStatus) {
          if (jobStatus === "running") {
            return { level: "yellow", jobStatus: "running", reason: "calcolo in corso", tag: "in calcolo" };
          }
          if (jobStatus === "queued") {
            return { level: "yellow", jobStatus: "queued", reason: "in coda", tag: "in coda" };
          }
          if (jobStatus === "incompatible") {
            return { level: "red", reason: "versioni audio/video diverse", tag: "versioni diverse" };
          }
          return { level: "yellow", jobStatus: "new", reason: "incompatibilit\u00E0 da verificare", tag: "da verificare" };
        });
      }
      var sync = classifySync(d);
      sync.info = {
        status: d.status,
        offsetMs: d.offset == null ? null : Math.round(Number(d.offset) * 1000),
        rate: Number(d.rate || 1),
        hasCuts: !!d.has_cuts
      };
      return sync;
    }
    // Not found in ToastFlix: check AutoSync job queue
    return getAutoSyncJobStatus(mediaKey).then(function (jobStatus) {
      if (jobStatus === "running") {
        return { level: "yellow", jobStatus: "running", reason: "calcolo in corso", tag: "in calcolo" };
      }
      if (jobStatus === "queued") {
        return { level: "yellow", jobStatus: "queued", reason: "in coda", tag: "in coda" };
      }
      if (jobStatus === "incompatible") {
        return { level: "red", reason: "versioni audio/video diverse", tag: "versioni diverse" };
      }
      return { level: "yellow", jobStatus: "new", reason: "offset da misurare", tag: "da misurare" };
    });
  }).catch(function (e) {
    console.warn("[MovyITA] ToastFlix sync status: " + e.message);
    return { level: "unknown", reason: "ToastFlix non raggiungibile", tag: "sync n/d" };
  });
}

// Only a constant delay can be applied automatically: same speed, no cuts, within AUTO_DELAY_MAX_MS.
function autoDelayMs(info) {
  if (!info || info.status !== "ok" || info.hasCuts || info.offsetMs == null) return undefined;
  if (Math.abs(info.rate - 1) > SYNC_RATE_TOLERANCE || Math.abs(info.offsetMs) > AUTO_DELAY_MAX_MS) return undefined;
  return info.offsetMs;
}

function syncBadge(sync) {
  var icon = { green: "\uD83D\uDD0A\u2705", yellow: "\u23F1\uFE0F", red: "\u26D4" }[sync.level] || "\u2754";
  if (sync.jobStatus === "running") icon = "\u2699\uFE0F";
  else if (sync.jobStatus === "queued" || sync.jobStatus === "new") icon = "\u23F3";
  var short = icon + " " + sync.tag;
  if (sync.level === "green") return { short: short, line: icon + " Audio in sync" };
  if (sync.level === "yellow" && sync.delayMs !== undefined) {
    return { short: short, line: icon + " Ritardo audio " + formatDelay(sync.delayMs) + " applicato in automatico (NuvioTV); altrimenti impostalo a mano" };
  }
  if (sync.jobStatus === "running") {
    return { short: short, line: icon + " Calcolo offset in corso su AutoSync (1-2 min)... Riapri tra poco." };
  }
  if (sync.jobStatus === "queued") {
    return { short: short, line: icon + " In coda su AutoSync (calcolo a breve)... Riapri tra poco." };
  }
  if (sync.jobStatus === "new") {
    return { short: short, line: icon + " Misurazione offset avviata in background. Sar\u00E0 pronta alla prossima apertura." };
  }
  if (sync.level === "red") return { short: short, line: icon + " Audio non in sync, non riproducibile (" + sync.reason + ")" };
  return { short: short, line: icon + " Sync audio non verificato (" + sync.reason + ")" };
}

function syncInfoLine(info) {
  if (info.status !== "ok") return "\u23F1\uFE0F offset n/d \u00B7 \uD83C\uDF9E\uFE0F velocit\u00E0 n/d";
  var line = "\u23F1\uFE0F offset " + formatDelay(nuvioDelayMs((info.offsetMs || 0) / 1000)) + " \u00B7 \uD83C\uDF9E\uFE0F " + speedLabel(info.rate);
  return info.hasCuts ? line + " \u00B7 \u2702\uFE0F tagli" : line;
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[MovyITA] getStreams id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode);
  return __async(function* () {
    var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";
    if (isTv && (season == null || episode == null)) return [];
    var id = yield resolveTmdbId(tmdbId, isTv);
    if (!id) {
      console.warn("[MovyITA] unsupported id: " + tmdbId);
      return [];
    }

    var meta = yield tmdbMeta(id, isTv);
    if (!meta.title) return [];

    var results = yield Promise.all([
      getMovySources(id, isTv, season, episode, meta).catch(function (e) {
        console.warn("[MovyITA] Movy failed: " + e.message);
        return { sources: [], subtitles: [] };
      }),
      getItalianTracks(id, isTv, season, episode).catch(function (e) {
        console.warn("[MovyITA] SC/vixsrc failed: " + e.message);
        return null;
      }),
      getSyncStatus(meta, isTv, season, episode)
    ]);
    var movy = results[0], ita = results[1], measuredSync = results[2];
    var unmeasuredSync = measuredSync.jobStatus ? measuredSync : { level: "unknown", reason: "server con file diverso da Miami", tag: "non misurato" };
    if (!movy.sources.length) {
      console.warn("[MovyITA] no Movy sources for " + meta.title);
      return [];
    }

    // Trigger background measurement on AutoSync if offset not yet established (and not confirmed incompatible)
    if (ita && (!measuredSync.info || measuredSync.info.status !== "ok") && measuredSync.jobStatus !== "incompatible" && movy.sources.length) {
      var byServer = {};
      movy.sources.forEach(function (s) {
        if (Number(s.qkey) < 1080) return;
        if (!byServer[s.server]) byServer[s.server] = [];
        byServer[s.server].push({ resolution: Number(s.qkey), url: s.url });
      });
      var autoItems = Object.keys(byServer).slice(0, 2).map(function (srv) {
        return {
          provider: "movy",
          server: srv,
          video_duration: (meta.runtime || 90) * 60,
          headers: movy.headers || {},
          renditions: byServer[srv]
        };
      });
      if (autoItems.length) {
        reportUnmeasuredToAutoSync({
          media_key: (isTv ? "series" : "movie") + ":" + meta.imdbId + ":" + (isTv ? Number(season) : 0) + ":" + (isTv ? Number(episode) : 0),
          audio: {
            source: "vixsrc",
            base_url: ita.audio.uri,
            headers: ita.headers || {}
          },
          items: autoItems
        });
      }
    }

    var heading = "\uD83D\uDCC1 " + meta.title + (isTv ? " S" + pad2(season) + "E" + pad2(episode) : "") + (meta.year ? " (" + meta.year + ")" : "");
    var streams = movy.sources.map(function (src) {
      var q = QUALITY_INFO[src.qkey];
      var sync = src.measured ? measuredSync : unmeasuredSync, badge = syncBadge(sync);
      var details = (ita
        ? badge.line + (sync.info ? "\n" + syncInfoLine(sync.info) : "") + "\n\uD83C\uDDEE\uD83C\uDDF9 Audio ITA (SC) + \uD83C\uDF0D originale"
        : "\uD83C\uDF0D Solo audio originale (ITA non trovato)") +
        "\n\uD83C\uDFAC Movy \u00B7 " + src.server + (ita && ita.subtitles.length ? " \u00B7 Sub ITA" : "");
      return {
        name: "MovyITA " + q.label + (ita ? " \uD83C\uDDEE\uD83C\uDDF9 " + badge.short : ""),
        title: heading + "\n" + details,
        // Text under the name: NuvioTV shows `size + language` (instead of `title`), Nuvio Mobile shows
        // `quality + size + language` and ignores `title`. So the details go in `size` for both apps.
        size: details,
        url: ita ? buildMasterDataUri(src.url, q, ita) : src.url,
        quality: q.label,
        type: "hls",
        provider: "movyita",
        headers: movy.headers,
        subtitles: movy.subtitles,
        audioSync: ita ? sync.info : undefined,
        // NuvioTV adds it to the device audio delay (>0 = audio later); other apps ignore it.
        behaviorHints: ita && autoDelayMs(sync.info) !== undefined ? { audioDelayMs: autoDelayMs(sync.info) } : undefined,
        _rank: Number(src.qkey)
      };
    });
    streams.sort(function (a, b) { return b._rank - a._rank; });
    streams.forEach(function (s) { delete s._rank; });
    console.log("[MovyITA] " + streams.length + " stream(s) via " + movy.api + ", ITA audio: " + (ita ? "yes" : "no") + ", sync: " + measuredSync.level);
    return streams;
  }()).catch(function (e) {
    console.error("[MovyITA] " + e.message);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
