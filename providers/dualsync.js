// DualSync - Nuvio provider: 4K/FHD video from sites decoded through enc-dec.app + StreamingCommunity/vixsrc Italian audio.
// The offset comes from ToastFlix only when the video playlist has the exact length of a measured rendition;
// otherwise the video and ITA audio lengths decide between "worth a try" (yellow) and "incompatible" (red).
// Written without async/await (generators via __async) so it runs on both Hermes and QuickJS plugin runtimes.

var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "68e094699525b18a70bab2f86b1fa706";
var TMDB_BASE = "https://api.themoviedb.org/3";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

var ENCDEC_API = "https://enc-dec.app/api";
// One player backend behind three sites: the next one is only asked when the previous gives no 4K/FHD video.
var VIDFAST_SITES = [
  { name: "Vidfast", key: "vidfast", origin: "https://vidfast.vc" },
  { name: "Vidcore", key: "vidcore", origin: "https://vidcore.io" },
  { name: "Vidup", key: "vidup", origin: "https://vidup.to" }
];
var CINEJOY_API = "https://api.wing.st";
var CINEJOY_ORIGIN = "https://cinejoy.pk";
// NuvioTV runs fetches one at a time and stops plugins at 60 s: no new source requests after this.
var SOURCES_BUDGET_MS = 25000;

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
// Frame-rate pairs behind typical release speed changes (NTSC 1000/1001, PAL 25).
var FPS_PAIRS = [[23.976, 24], [24, 25], [23.976, 25]];
// One encode always has the same playlist length; separate encodes of a release differ by 0.5 s or more.
var DB_LENGTH_TOLERANCE_S = 0.25;
// Unmeasured video vs ITA audio: equal lengths point to the same cut...
var SAME_LENGTH_S = 1;
// ...and a gap of a few seconds is usually dub cards or credits, so still worth a try.
var SIMILAR_LENGTH_S = 15;

var QUALITY_INFO = {
  "2160": { label: "4K", resolution: "3840x2160", bandwidth: 16000000 },
  "1080": { label: "1080p", resolution: "1920x1080", bandwidth: 6000000 }
};

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

function send(url, options, ms) {
  return fetchWithTimeout(url, options, ms).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url.split("?")[0]);
    return res;
  });
}

function getText(url, headers, ms) {
  return send(url, { headers: headers || {} }, ms).then(function (res) { return res.text(); });
}

function getJson(url, headers, ms) {
  return getText(url, headers, ms).then(function (text) { return JSON.parse(text); });
}

function postText(url, headers, body, ms) {
  return send(url, { method: "POST", headers: headers || {}, body: body }, ms).then(function (res) { return res.text(); });
}

function postBytes(url, headers, bytes, ms) {
  return send(url, { method: "POST", headers: headers || {}, body: bytes }, ms).then(function (res) {
    return res.arrayBuffer();
  }).then(function (buf) { return new Uint8Array(buf); });
}

function query(params) {
  return Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
}

function absUrl(uri, base) {
  if (/^https?:\/\//i.test(uri)) return uri;
  var origin = (base.match(/^https?:\/\/[^\/]+/i) || [""])[0];
  if (uri.charAt(0) === "/") return origin + uri;
  return base.split("?")[0].replace(/[^\/]*$/, "") + uri;
}

// enc-dec.app wraps every answer as {status, result}.
function encdec(path, payload) {
  var request = payload === undefined
    ? getText(ENCDEC_API + "/" + path, { "Accept": "application/json" }, 15000)
    : postText(ENCDEC_API + "/" + path, { "Content-Type": "application/json", "Accept": "application/json" }, JSON.stringify(payload), 15000);
  return request.then(function (text) {
    var d = JSON.parse(text);
    if (!d || d.status !== 200) throw new Error("enc-dec " + path.split("?")[0] + ": " + (d && (d.error || d.status)));
    return d.result;
  });
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

function bytesToBase64(bytes) {
  var out = "", i = 0, n;
  for (; i + 2 < bytes.length; i += 3) {
    n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
  }
  if (bytes.length - i === 1) {
    n = bytes[i] << 16;
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + "==";
  } else if (bytes.length - i === 2) {
    n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + "=";
  }
  return out;
}

function asciiToBase64(str) {
  var bytes = new Array(str.length);
  for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 255;
  return bytesToBase64(bytes);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
      imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || ""
    };
  });
}

// ---------------------------------------------------------------- HLS playlists

function attr(line, key) {
  var m = line.match(new RegExp("(?:^|[,:])" + key + "=(\"([^\"]*)\"|[^,]*)"));
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[1];
}

// Rounded like ToastFlix stores video_duration.
function playlistLength(text) {
  var total = 0, re = /#EXTINF:([\d.]+)/g, m;
  while ((m = re.exec(text))) total += Number(m[1]);
  return Math.round(total * 100) / 100;
}

function qualityForWidth(width) {
  if (width >= 3200) return "2160";
  if (width >= 1800) return "1080";
  return null;
}

function parseMaster(text, baseUrl) {
  var lines = text.split(/\r?\n/), variants = [], audios = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf("#EXT-X-MEDIA:") === 0 && attr(line, "TYPE") === "AUDIO" && attr(line, "URI")) {
      audios.push({
        group: attr(line, "GROUP-ID"),
        lang: String(attr(line, "LANGUAGE") || "").toLowerCase(),
        isDefault: attr(line, "DEFAULT") === "YES",
        uri: absUrl(attr(line, "URI"), baseUrl)
      });
    } else if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
      var uri = String(lines[i + 1] || "").trim();
      if (!uri || uri.charAt(0) === "#") continue;
      variants.push({
        width: Number(String(attr(line, "RESOLUTION") || "").split("x")[0]) || 0,
        bandwidth: Number(attr(line, "BANDWIDTH")) || 0,
        audioGroup: attr(line, "AUDIO"),
        url: absUrl(uri, baseUrl)
      });
    }
  }
  return { variants: variants, audios: audios };
}

// Picks the 4K/FHD renditions of a source master and measures its length on the top one.
function resolveEncode(src) {
  return __async(function* () {
    var text = yield getText(src.url, src.headers, 10000);
    // A bare media playlist says nothing about its resolution, so only masters qualify.
    if (text.indexOf("#EXT-X-STREAM-INF") < 0) return null;
    var master = parseMaster(text, src.url);
    var renditions = {};
    master.variants.slice().sort(function (a, b) { return b.bandwidth - a.bandwidth; }).forEach(function (v) {
      var q = qualityForWidth(v.width);
      if (q && !renditions[q]) renditions[q] = v;
    });
    var top = renditions["2160"] || renditions["1080"];
    if (!top) return null;
    var length = playlistLength(yield getText(top.url, src.headers, 12000));
    if (!length) return null;
    // Video-only renditions leave the original language in a separate track of the source master.
    var group = master.audios.filter(function (a) { return a.group === top.audioGroup; });
    var original = group.filter(function (a) { return a.isDefault; })[0] || group.filter(function (a) { return /^en/.test(a.lang); })[0] || group[0] || null;
    return { site: src.site, server: src.server, headers: src.headers, length: length, renditions: renditions, original: original };
  }());
}

// ---------------------------------------------------------------- Video sources

function makeCollector(deadline) {
  var encodes = [];
  return {
    encodes: encodes,
    expired: function () { return Date.now() > deadline; },
    // Same playlist length means the same encode reached through another server or site.
    add: function (enc) {
      if (!enc || encodes.some(function (e) { return Math.abs(e.length - enc.length) < 0.05; })) return false;
      encodes.push(enc);
      return true;
    }
  };
}

function is4kServer(server) {
  if (server && server["4k"] === true) return 1;
  return /4k/i.test(String((server && (server.description || server.image || server.name)) || "")) ? 1 : 0;
}

// Per site: 4K from the first server that has it, FHD from the first server whose best is 1080p, then stop.
// Without such an FHD server the 4K master's own 1080p rendition is offered instead.
function pickFromServers(keep, siteName, servers, openServer) {
  return __async(function* () {
    servers = servers.slice().sort(function (a, b) { return is4kServer(b) - is4kServer(a); });
    var uhd = null, fhd = null;
    for (var i = 0; i < servers.length && !keep.expired(); i++) {
      if (fhd && (uhd || !servers.slice(i).some(is4kServer))) break;
      if (uhd && is4kServer(servers[i])) continue;
      try {
        var enc = yield openServer(servers[i]);
        if (!enc) continue;
        if (!uhd && enc.renditions["2160"]) uhd = enc;
        else if (!fhd && !enc.renditions["2160"]) fhd = enc;
      } catch (e) {
        console.warn("[DualSync] " + siteName + " " + servers[i].name + ": " + e.message);
      }
    }
    if (uhd) {
      uhd.qualities = fhd || !uhd.renditions["1080"] ? ["2160"] : ["2160", "1080"];
      keep.add(uhd);
    }
    if (fhd) {
      fhd.qualities = ["1080"];
      keep.add(fhd);
    }
  }());
}

function getCinejoyEncodes(ctx, keep) {
  return __async(function* () {
    var headers = { "User-Agent": UA, "Accept": "*/*", "Origin": CINEJOY_ORIGIN, "Referer": CINEJOY_ORIGIN + "/" };
    var list = ((yield getJson(CINEJOY_API + "/servers", headers, 8000)) || {}).servers || [];
    var servers = list.filter(function (s) { return s && s.name && s.status === "ok"; });
    yield pickFromServers(keep, "Cinejoy", servers, function (server) {
      return __async(function* () {
        var params = { title: ctx.meta.title, type: ctx.isTv ? "series" : "movie", year: ctx.meta.year, imdb: ctx.meta.imdbId, tmdb: ctx.id, server: server.name };
        if (ctx.isTv) {
          params.season = ctx.season;
          params.episode = ctx.episode;
        }
        var sealed = yield encdec("enc-cinejoy?url=" + encodeURIComponent(CINEJOY_API + "/?" + query(params)));
        var answer = yield postBytes(CINEJOY_API + "/g", {
          "User-Agent": UA, "Accept": "*/*", "Origin": CINEJOY_ORIGIN, "Referer": CINEJOY_ORIGIN + "/",
          "Content-Type": "text/plain;charset=UTF-8"
        }, base64ToBytes(sealed.data), 12000);
        var opened = yield encdec("dec-cinejoy", { text: bytesToBase64Url(answer), state: sealed.state });
        var streams = ((opened && opened.data && opened.data.stream) || []).filter(function (s) { return s && s.playlist; });
        for (var j = 0; j < streams.length; j++) {
          var enc = yield resolveEncode({ site: "Cinejoy", server: server.name, url: streams[j].playlist, headers: headers });
          if (enc) return enc;
        }
        return null;
      }());
    });
  }());
}

function getVidfastEncodes(site, ctx, keep) {
  return __async(function* () {
    var page = site.origin + (ctx.isTv ? "/tv/" + ctx.id + "/" + ctx.season + "/" + ctx.episode : "/movie/" + ctx.id) + "/";
    var html = yield getText(page, { "User-Agent": UA, "Referer": site.origin + "/" }, 12000);
    var token = (html.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/) || [])[1];
    if (!token) throw new Error("token not found");
    var parts = yield encdec("enc-" + site.key + "?text=" + encodeURIComponent(token));
    var headers = { "User-Agent": UA, "Referer": site.origin + "/", "X-Requested-With": "XMLHttpRequest", "X-CSRF-Token": parts.token };
    var serverList = yield postText(parts.servers, headers, undefined, 10000);
    var servers = (yield encdec("dec-" + site.key, { text: serverList })) || [];
    yield pickFromServers(keep, site.name, servers, function (server) {
      return __async(function* () {
        var sealed = yield postText(parts.stream + "/" + server.data, headers, undefined, 10000);
        var stream = yield encdec("dec-" + site.key, { text: sealed });
        if (!stream || !stream.url) return null;
        var playHeaders = stream.noReferrer ? { "User-Agent": UA } : { "User-Agent": UA, "Referer": site.origin + "/", "Origin": site.origin };
        return yield resolveEncode({ site: site.name, server: server.name, url: stream.url, headers: playHeaders });
      }());
    });
  }());
}

function collectEncodes(ctx) {
  return __async(function* () {
    var keep = makeCollector(ctx.deadline);
    try {
      yield getCinejoyEncodes(ctx, keep);
    } catch (e) {
      console.warn("[DualSync] Cinejoy: " + e.message);
    }
    for (var i = 0; i < VIDFAST_SITES.length && !keep.expired(); i++) {
      var before = keep.encodes.length;
      try {
        yield getVidfastEncodes(VIDFAST_SITES[i], ctx, keep);
      } catch (e) {
        console.warn("[DualSync] " + VIDFAST_SITES[i].name + ": " + e.message);
      }
      if (keep.encodes.length > before) break;
    }
    return keep.encodes;
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
    var playHeaders = { "User-Agent": VIX_UA, "Referer": embedUrl, "Origin": base };
    var master = yield getText(masterUrl, playHeaders, 12000);

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
    return audio ? { audio: audio, subtitles: subtitles, headers: playHeaders } : null;
  }());
}

// ---------------------------------------------------------------- Combined HLS master (data: URI)

function quoteSafe(v) {
  return String(v).replace(/["\r\n]/g, "").replace(/[^\x20-\x7e]/g, "");
}

function buildMasterDataUri(videoUrl, qinfo, ita, original) {
  // First line ends with a bare CR so mpv's generic m3u parser doesn't grab it; FFmpeg/ExoPlayer accept CR line breaks.
  var lines = ["#EXTM3U\r#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];
  lines.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Italiano",LANGUAGE="it",DEFAULT=YES,AUTOSELECT=YES,URI="' + quoteSafe(ita.audio.uri) + '"');
  if (original) {
    lines.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Originale",LANGUAGE="' + quoteSafe(original.lang || "en") +
      '",DEFAULT=NO,AUTOSELECT=NO,URI="' + quoteSafe(original.uri) + '"');
  }
  ita.subtitles.forEach(function (s) {
    lines.push('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="' + quoteSafe(s.name) + '",LANGUAGE="it"' +
      ',DEFAULT=NO,AUTOSELECT=' + (s.forced ? "YES" : "NO") + ',FORCED=' + (s.forced ? "YES" : "NO") + ',URI="' + quoteSafe(s.uri) + '"');
  });
  lines.push("#EXT-X-STREAM-INF:BANDWIDTH=" + qinfo.bandwidth + ",RESOLUTION=" + qinfo.resolution + ',AUDIO="aud"' +
    (ita.subtitles.length ? ',SUBTITLES="subs"' : ""));
  lines.push(quoteSafe(videoUrl));
  var text = lines.join("\n") + "\n";
  // Base64 must end with '=' so FFmpeg's decoder stops before the "#.m3u8" hint used for HLS probing.
  if (text.length % 3 === 0) text += "\n";
  // "data://" instead of "data:": mpv only treats proto:// strings as URLs; ExoPlayer still reads the payload after the comma.
  // "/m3u8/" in the media type lets NuvioTV (URL-based MIME detection, ignores "type") pick the HLS source.
  return "data://application/m3u8/;base64," + asciiToBase64(text) + "#.m3u8";
}

// ---------------------------------------------------------------- Sync

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

function formatClock(seconds) {
  var s = Math.round(seconds);
  return Math.floor(s / 3600) + ":" + pad2(Math.floor(s / 60) % 60) + ":" + pad2(s % 60);
}

function fpsPairLabel(rate) {
  for (var i = 0; i < FPS_PAIRS.length; i++) {
    var ratio = FPS_PAIRS[i][0] / FPS_PAIRS[i][1];
    if (Math.abs(rate - ratio) < 0.0003 || Math.abs(rate - 1 / ratio) < 0.0003) {
      return itNumber(FPS_PAIRS[i][0]) + "\u2194" + itNumber(FPS_PAIRS[i][1]) + " fps";
    }
  }
  return null;
}

function speedLabel(rate) {
  if (Math.abs(rate - 1) <= SYNC_RATE_TOLERANCE) return "stessa velocit\u00E0";
  return fpsPairLabel(rate) || "velocit\u00E0 \u00D7" + itNumber(Math.round(rate * 10000) / 10000);
}

// Same verdicts as MovyITA; `tag` is the short form shown in the stream name next to the emoji.
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

// Measured renditions of the title (ToastFlix /dual/offset/candidates); null when ToastFlix can't be asked.
function getMeasuredRenditions(meta, isTv, season, episode) {
  if (!meta.imdbId) return Promise.resolve(null);
  var url = TOASTFLIX_URL + "/dual/offset/candidates?imdb=" + encodeURIComponent(meta.imdbId) +
    "&type=" + (isTv ? "series" : "movie") + "&season=" + (isTv ? Number(season) : 0) +
    "&episode=" + (isTv ? Number(episode) : 0) + "&audio_source=vixsrc";
  return getJson(url, { "Accept": "application/json" }, 8000).then(function (d) {
    return (d && d.items) || [];
  }).catch(function (e) {
    console.warn("[DualSync] ToastFlix renditions: " + e.message);
    return null;
  });
}

// Without a measurement only the lengths speak: positive diff = ITA audio longer than the video.
function estimateSync(videoLength, itaLength) {
  if (!itaLength) return { level: "unknown", reason: "durata audio ITA non disponibile", tag: "non misurato" };
  var diff = itaLength - videoLength;
  var diffText = formatDelay(Math.round(diff * 10) * 100);
  if (Math.abs(diff) <= SAME_LENGTH_S) return { level: "yellow", reason: "stessa durata dell'audio ITA", tag: "non misurato" };
  var fps = fpsPairLabel(itaLength / videoLength);
  if (fps) return { level: "red", reason: "velocit\u00E0 diversa (" + fps + ")", tag: fps };
  if (Math.abs(diff) <= SIMILAR_LENGTH_S) return { level: "yellow", reason: "audio ITA " + diffText + " rispetto al video, sigla o titoli diversi?", tag: "non misurato" };
  return { level: "red", reason: "durata diversa di " + diffText, tag: "durata " + diffText };
}

function syncFor(enc, measured, itaLength) {
  var hit = null;
  (measured || []).forEach(function (m) {
    var d = Math.abs(Number(m.video_duration) - enc.length);
    if (d <= DB_LENGTH_TOLERANCE_S && (!hit || d < hit.d)) hit = { m: m, d: d };
  });
  if (!hit) {
    var guess = estimateSync(enc.length, itaLength);
    guess.itaLength = itaLength;
    return guess;
  }
  var sync = classifySync(hit.m);
  sync.measured = hit.m;
  sync.info = {
    status: hit.m.status,
    offsetMs: hit.m.offset == null ? null : Math.round(Number(hit.m.offset) * 1000),
    rate: Number(hit.m.rate || 1),
    hasCuts: !!hit.m.has_cuts
  };
  return sync;
}

// Only a constant delay can be applied automatically: same speed, no cuts, within AUTO_DELAY_MAX_MS.
function autoDelayMs(info) {
  if (!info || info.status !== "ok" || info.hasCuts || info.offsetMs == null) return undefined;
  if (Math.abs(info.rate - 1) > SYNC_RATE_TOLERANCE || Math.abs(info.offsetMs) > AUTO_DELAY_MAX_MS) return undefined;
  return info.offsetMs;
}

function syncBadge(sync) {
  var icon = { green: "\uD83D\uDD0A\u2705", yellow: "\u23F1\uFE0F", red: "\u26D4" }[sync.level] || "\u2754";
  var short = icon + " " + sync.tag;
  if (sync.level === "green") return { short: short, line: icon + " Audio in sync" };
  if (sync.level === "yellow" && sync.delayMs !== undefined) {
    return { short: short, line: icon + " Ritardo audio " + formatDelay(sync.delayMs) + " applicato in automatico (NuvioTV); altrimenti impostalo a mano" };
  }
  if (sync.level === "yellow") return { short: short, line: icon + " Offset non misurato, da provare (" + sync.reason + ")" };
  if (sync.level === "red") return { short: short, line: icon + " Audio non in sync, non riproducibile (" + sync.reason + ")" };
  return { short: short, line: icon + " Sync audio non verificato (" + sync.reason + ")" };
}

function syncInfoLine(info) {
  if (info.status !== "ok") return "\u23F1\uFE0F offset n/d \u00B7 \uD83C\uDF9E\uFE0F velocit\u00E0 n/d";
  var line = "\u23F1\uFE0F offset " + formatDelay(nuvioDelayMs((info.offsetMs || 0) / 1000)) + " \u00B7 \uD83C\uDF9E\uFE0F " + speedLabel(info.rate);
  return info.hasCuts ? line + " \u00B7 \u2702\uFE0F tagli" : line;
}

function lengthLine(enc, sync) {
  if (sync.measured) {
    return "\uD83D\uDCCF Video " + formatClock(enc.length) + ", stessa durata di quello misurato da ToastFlix" +
      (sync.measured.provider ? " (" + sync.measured.provider + ")" : "");
  }
  return "\uD83D\uDCCF Video " + formatClock(enc.length) + (sync.itaLength ? " \u00B7 audio ITA " + formatClock(sync.itaLength) : "");
}

// ---------------------------------------------------------------- Entry point

var LEVEL_RANK = { green: 0, yellow: 1, unknown: 2, red: 3 };

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[DualSync] getStreams id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode);
  var deadline = Date.now() + SOURCES_BUDGET_MS;
  return __async(function* () {
    var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";
    if (isTv && (season == null || episode == null)) return [];
    var id = yield resolveTmdbId(tmdbId, isTv);
    if (!id) {
      console.warn("[DualSync] unsupported id: " + tmdbId);
      return [];
    }
    var meta = yield tmdbMeta(id, isTv);
    if (!meta.title) return [];
    var ctx = { id: id, meta: meta, isTv: isTv, season: season, episode: episode, deadline: deadline };

    var results = yield Promise.all([
      getItalianTracks(id, isTv, season, episode).catch(function (e) {
        console.warn("[DualSync] SC/vixsrc failed: " + e.message);
        return null;
      }),
      getMeasuredRenditions(meta, isTv, season, episode),
      collectEncodes(ctx)
    ]);
    var ita = results[0], measured = results[1], encodes = results[2];
    if (!encodes.length) {
      console.warn("[DualSync] no 4K/FHD video for " + meta.title);
      return [];
    }

    // The ITA length is only needed for encodes ToastFlix never measured.
    var itaLength = 0;
    var unmatched = encodes.some(function (enc) {
      return !(measured || []).some(function (m) { return Math.abs(Number(m.video_duration) - enc.length) <= DB_LENGTH_TOLERANCE_S; });
    });
    if (ita && unmatched) {
      itaLength = yield getText(ita.audio.uri, ita.headers, 12000).then(playlistLength).catch(function (e) {
        console.warn("[DualSync] ITA audio length: " + e.message);
        return 0;
      });
    }

    var heading = "\uD83D\uDCC1 " + meta.title + (isTv ? " S" + pad2(season) + "E" + pad2(episode) : "") + (meta.year ? " (" + meta.year + ")" : "");
    var streams = [];
    encodes.forEach(function (enc) {
      var sync = syncFor(enc, measured, itaLength), badge = syncBadge(sync);
      enc.qualities.forEach(function (qkey) {
        var rendition = enc.renditions[qkey];
        if (!rendition) return;
        var q = QUALITY_INFO[qkey];
        var details = (ita
          ? badge.line + (sync.info ? "\n" + syncInfoLine(sync.info) : "") + "\n" + lengthLine(enc, sync) +
            "\n\uD83C\uDDEE\uD83C\uDDF9 Audio ITA (SC) + \uD83C\uDF0D originale"
          : "\uD83C\uDF0D Solo audio originale (ITA non trovato)") +
          "\n\uD83C\uDFAC " + enc.site + " \u00B7 " + enc.server + (ita && ita.subtitles.length ? " \u00B7 Sub ITA" : "");
        streams.push({
          name: "DualSync " + q.label + (ita ? " \uD83C\uDDEE\uD83C\uDDF9 " + badge.short : ""),
          title: heading + "\n" + details,
          // Text under the name: NuvioTV shows `size + language` (instead of `title`), Nuvio Mobile shows
          // `quality + size + language` and ignores `title`. So the details go in `size` for both apps.
          size: details,
          url: ita ? buildMasterDataUri(rendition.url, q, ita, enc.original) : rendition.url,
          quality: q.label,
          type: "hls",
          provider: "dualsync",
          headers: enc.headers,
          audioSync: ita ? sync.info : undefined,
          // NuvioTV adds it to the device audio delay (>0 = audio later); other apps ignore it.
          behaviorHints: ita && autoDelayMs(sync.info) !== undefined ? { audioDelayMs: autoDelayMs(sync.info) } : undefined,
          // 4K before FHD, then best verdict, then a measured offset before an estimate.
          _rank: -Number(qkey) * 1000 + (ita ? LEVEL_RANK[sync.level] * 10 + (sync.measured ? 0 : 5) : 0)
        });
      });
    });
    streams.sort(function (a, b) { return a._rank - b._rank; });
    streams.forEach(function (s) { delete s._rank; });
    console.log("[DualSync] " + streams.length + " stream(s) from " + encodes.length + " encode(s), ITA audio: " + (ita ? "yes" : "no") +
      ", measured renditions: " + (measured ? measured.length : "n/d"));
    return streams;
  }()).catch(function (e) {
    console.error("[DualSync] " + e.message);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
