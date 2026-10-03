// VixSrc - Nuvio provider: Direct streaming from VixSrc in HD/FHD with multi-audio and Italian tracks.
// Written without async/await (generators via __async) so it runs seamlessly on Hermes and QuickJS plugin runtimes.

var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "68e094699525b18a70bab2f86b1fa706";
var TMDB_BASE = "https://api.themoviedb.org/3";

var VIX_DOMAINS_URL = "https://raw.githubusercontent.com/realbestia1/domains/refs/heads/main/domains.json";
var VIX_DEFAULT_BASE = "https://vixsrc.to";
var VIX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var REQUEST_TIMEOUT_MS = 12000;

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

var FLAGS = {
  af: "\uD83C\uDDFF\uD83C\uDDE6", ar: "\uD83C\uDDF8\uD83C\uDDE6", az: "\uD83C\uDDE6\uD83C\uDDFF",
  bg: "\uD83C\uDDE7\uD83C\uDDEC", bn: "\uD83C\uDDE7\uD83C\uDDE9", bs: "\uD83C\uDDE7\uD83C\uDDE6",
  ca: "\uD83C\uDDEA\uD83C\uDDF8", cs: "\uD83C\uDDE8\uD83C\uDDFF", da: "\uD83C\uDDE9\uD83C\uDDF0",
  de: "\uD83C\uDDE9\uD83C\uDDEA", el: "\uD83C\uDDEC\uD83C\uDDF7", en: "\uD83C\uDDEC\uD83C\uDDE7",
  es: "\uD83C\uDDEA\uD83C\uDDF8", et: "\uD83C\uDDEA\uD83C\uDDEA", eu: "\uD83C\uDDEA\uD83C\uDDF8",
  fa: "\uD83C\uDDEE\uD83C\uDDF7", fi: "\uD83C\uDDE8\uD83C\uDDEE", fr: "\uD83C\uDDE8\uD83C\uDDF7",
  he: "\uD83C\uDDEE\uD83C\uDDF1", hi: "\uD83C\uDDEE\uD83C\uDDF3", hr: "\uD83C\uDDED\uD83C\uDDF7",
  hu: "\uD83C\uDDED\uD83C\uDDFA", id: "\uD83C\uDDEE\uD83C\uDDE9", is: "\uD83C\uDDEE\uD83C\uDDF8",
  it: "\uD83C\uDDEE\uD83C\uDDF9", ja: "\uD83C\uDDEF\uD83C\uDDF5", ka: "\uD83C\uDDEC\uD83C\uDDEA",
  ko: "\uD83C\uDDF0\uD83C\uDDF7", lt: "\uD83C\uDDF1\uD83C\uDDF9", lv: "\uD83C\uDDF1\uD83C\uDDFB",
  ml: "\uD83C\uDDEE\uD83C\uDDF3", ms: "\uD83C\uDDF2\uD83C\uDDFE", nl: "\uD83C\uDDF3\uD83C\uDDF1",
  no: "\uD83C\uDDF3\uD83C\uDDF4", pl: "\uD83C\uDDF5\uD83C\uDDF1", pt: "\uD83C\uDDF5\uD83C\uDDF9",
  "pt-br": "\uD83C\uDDE7\uD83C\uDDF7", ro: "\uD83C\uDDF7\uD83C\uDDF4", ru: "\uD83C\uDDF7\uD83C\uDDFA",
  sk: "\uD83C\uDDF8\uD83C\uDDF0", sl: "\uD83C\uDDF8\uD83C\uDDEE", sq: "\uD83C\uDDE6\uD83C\uDDF1",
  sr: "\uD83C\uDDF7\uD83C\uDDF8", sv: "\uD83C\uDDF8\uD83C\uDDEA", ta: "\uD83C\uDDEE\uD83C\uDDF3",
  te: "\uD83C\uDDEE\uD83C\uDDF3", th: "\uD83C\uDDF9\uD83C\uDDED", tr: "\uD83C\uDDF9\uD83C\uDDF7",
  uk: "\uD83C\uDDFA\uD83C\uDDE6", ur: "\uD83C\uDDF5\uD83C\uDDF0", vi: "\uD83C\uDDF5\uD83C\uDDF3",
  zh: "\uD83C\uDDE8\uD83C\uDDF3"
};

var ALIASES = {
  ara: "ar", arabic: "ar", ces: "cs", cze: "cs", czech: "cs", dan: "da", danish: "da",
  deu: "de", ger: "de", german: "de", ell: "el", gre: "el", greek: "el", eng: "en", english: "en",
  spa: "es", spanish: "es", fin: "fi", finnish: "fi", fra: "fr", fre: "fr", french: "fr",
  heb: "he", hebrew: "he", hin: "hi", hindi: "hi", hun: "hu", hungarian: "hu", ind: "id", indonesian: "id",
  ita: "it", italian: "it", italiano: "it", jpn: "ja", japanese: "ja", kor: "ko", korean: "ko",
  nld: "nl", dut: "nl", dutch: "nl", nor: "no", norwegian: "no", pl: "pl", polish: "pl",
  por: "pt", portuguese: "pt", "por-br": "pt-br", ron: "ro", rum: "ro", romanian: "ro",
  rus: "ru", russian: "ru", swe: "sv", swedish: "sv", tha: "th", thai: "th", tur: "tr", turkish: "tr",
  ukr: "uk", ukrainian: "uk", vie: "vi", vietnamese: "vi", zho: "zh", chi: "zh", chinese: "zh"
};

function normalizeLang(v) {
  return String(v || "").toLowerCase().replace(/_/g, "-")
    .replace(/^\s*(?:forced|cc|sdh)[-\s]+/, "")
    .replace(/\s*(?:\[(?:forced|cc|sdh)\]|\((?:forced|cc|sdh)\))\s*/g, "")
    .replace(/\s*,\s*(?:forced|cc|sdh).*$/, "").trim();
}

function languageFlag(lang, name) {
  var candidates = [lang, name];
  for (var i = 0; i < candidates.length; i++) {
    var v = normalizeLang(candidates[i]);
    if (!v) continue;
    var exact = ALIASES[v] || v;
    var base = ALIASES[v.split("-")[0]] || v.split("-")[0];
    if (FLAGS[exact]) return FLAGS[exact];
    if (FLAGS[base]) return FLAGS[base];
  }
  return "";
}

function subtitleSummary(tracks) {
  if (!tracks || !tracks.length) return "";
  var flags = [];
  tracks.forEach(function (t) {
    var f = languageFlag(t.lang || t.LANGUAGE, t.name || t.NAME);
    if (f && flags.indexOf(f) === -1) flags.push(f);
  });
  flags.sort(function (a, b) {
    var p = function (flag) { return flag === FLAGS.it ? 0 : (flag === FLAGS.en ? 1 : 2); };
    return p(a) - p(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  var shown = flags.slice(0, 10);
  if (!shown.length) return "";
  var hidden = flags.length - shown.length;
  return "\uD83D\uDCAC " + shown.join(" ") + (hidden > 0 ? " +" + hidden : "") + " (" + flags.length + ")";
}

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

function pad2(n) { return (n < 10 ? "0" : "") + n; }

// ---------------------------------------------------------------- HTTP

function fetchWithTimeout(url, options, ms) {
  if (typeof setTimeout !== "function") return fetch(url, options);
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; reject(new Error("Timeout: " + url)); }
    }, ms || REQUEST_TIMEOUT_MS);
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

// ---------------------------------------------------------------- Base64 Helpers

var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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

// ---------------------------------------------------------------- TMDB & ID Resolution

function resolveMediaIds(rawId, isTv) {
  var raw = String(rawId || "").trim().replace(/^tmdb:/i, "");
  var isNum = /^\d+$/.test(raw);
  var imdbMatch = (raw.match(/tt\d+/) || [])[0];

  if (isNum) {
    var url = TMDB_BASE + "/" + (isTv ? "tv" : "movie") + "/" + raw + "?api_key=" + TMDB_KEY + (isTv ? "&append_to_response=external_ids" : "");
    return getJson(url, {}, 10000).then(function (d) {
      var imdbId = (d && (d.imdb_id || (d.external_ids && d.external_ids.imdb_id))) || null;
      return {
        tmdbId: raw,
        imdbId: imdbId,
        title: (isTv ? d.name : d.title) || "",
        year: ((isTv ? d.first_air_date : d.release_date) || "").slice(0, 4)
      };
    }).catch(function () {
      return { tmdbId: raw, imdbId: null, title: "", year: "" };
    });
  }

  if (imdbMatch) {
    return getJson(TMDB_BASE + "/find/" + imdbMatch + "?api_key=" + TMDB_KEY + "&external_source=imdb_id", {}, 10000).then(function (d) {
      var list = (isTv ? d.tv_results : d.movie_results) || [];
      var first = list.length ? list[0] : null;
      var tmdbId = first ? String(first.id) : null;
      var title = (first ? (isTv ? first.name : first.title) : "") || "";
      var year = ((first ? (isTv ? first.first_air_date : first.release_date) : "") || "").slice(0, 4);
      return {
        tmdbId: tmdbId,
        imdbId: imdbMatch,
        title: title,
        year: year
      };
    }).catch(function () {
      return { tmdbId: null, imdbId: imdbMatch, title: "", year: "" };
    });
  }

  return Promise.resolve({ tmdbId: null, imdbId: null, title: "", year: "" });
}

// ---------------------------------------------------------------- VixSrc Engine

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
  }, REQUEST_TIMEOUT_MS);
}

function absUrl(uri, base) {
  if (/^https?:\/\//i.test(uri)) return uri;
  var origin = (base.match(/^https?:\/\/[^\/]+/i) || [""])[0];
  if (uri.charAt(0) === "/") return origin + uri;
  return base.split("?")[0].replace(/[^\/]*$/, "") + uri;
}

function attributes(line) {
  var result = Object.create(null);
  var pattern = /(?:^|,)([A-Z0-9-]+)=("([^"]*)"|([^,]*))/g;
  var match;
  var source = line.slice(line.indexOf(":") + 1);
  while ((match = pattern.exec(source))) {
    result[match[1]] = match[3] !== undefined ? match[3] : match[4];
  }
  return result;
}

function formatBitrate(bps) {
  if (!bps) return "";
  if (bps >= 1000000) {
    var mbps = bps / 1000000;
    return (mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)).replace(/\.0+$/, "") + " Mbps";
  }
  return Math.round(bps / 1000) + " kbps";
}

function codecLabel(codecs) {
  var labels = [];
  var list = (codecs || "").split(",");
  for (var i = 0; i < list.length; i++) {
    var codec = list[i].trim().toLowerCase();
    var label = "";
    if (/^(?:avc1|avc3)/.test(codec)) label = "H.264";
    else if (/^(?:hev1|hvc1)/.test(codec)) label = "HEVC";
    else if (/^av01/.test(codec)) label = "AV1";
    else if (/^vp09/.test(codec)) label = "VP9";
    else if (/^mp4a/.test(codec)) label = "AAC";
    else if (/^ec-3/.test(codec)) label = "E-AC-3";
    else if (/^ac-3/.test(codec)) label = "AC-3";
    else if (/^opus/.test(codec)) label = "Opus";
    if (label && labels.indexOf(label) === -1) labels.push(label);
  }
  return labels.join(" / ");
}

function buildInlineVariantUri(variant, commonTags, base) {
  var lines = ["#EXTM3U\r#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];
  commonTags.forEach(function (t) {
    if (!t.startsWith("#EXT-X-MEDIA:")) {
      lines.push(t);
      return;
    }
    var media = attributes(t);
    if (variant.attrs[media.TYPE] === media["GROUP-ID"]) {
      var resolvedUri = absUrl(media.URI, base);
      var updated = t.replace(/\bURI="[^"]*"/, 'URI="' + resolvedUri + '"');
      lines.push(updated);
    }
  });
  lines.push(variant.line);
  lines.push(variant.url);
  var text = lines.join("\n") + "\n";
  if (text.length % 3 === 0) text += "\n";
  return "data://application/m3u8/;base64," + asciiToBase64(text) + "#.m3u8";
}

// ---------------------------------------------------------------- Entry point

function getStreams(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" || mediaType === "series";
  console.log("[VixSrc] getStreams id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode);

  return __async(function* () {
    var meta = yield resolveMediaIds(tmdbId, isTv);
    var candidateIds = [];
    if (meta.imdbId) candidateIds.push(meta.imdbId);
    if (meta.tmdbId && candidateIds.indexOf(meta.tmdbId) === -1) candidateIds.push(meta.tmdbId);

    if (!candidateIds.length) {
      console.warn("[VixSrc] unsupported id: " + tmdbId);
      return [];
    }

    var base = VIX_DEFAULT_BASE;
    var payload = null;
    var lastApiPath = "";

    for (var cIdx = 0; cIdx < candidateIds.length; cIdx++) {
      var cand = candidateIds[cIdx];
      var apiPath = isTv ? "/api/tv/" + cand + "/" + Number(season) + "/" + Number(episode) : "/api/movie/" + cand;
      lastApiPath = apiPath;
      try {
        payload = yield getVixPayload(base, apiPath);
        if (payload && payload.src) break;
      } catch (e) {
        var alt = yield lookupVixBase();
        if (alt && alt !== base) {
          base = alt;
          try {
            payload = yield getVixPayload(base, apiPath);
            if (payload && payload.src) break;
          } catch (e2) {}
        }
      }
    }

    if (!payload || !payload.src) {
      console.warn("[VixSrc] no payload src returned for " + lastApiPath);
      return [];
    }

    var embedUrl = absUrl(String(payload.src), base + "/");
    var html = yield getText(embedUrl, { "User-Agent": VIX_UA, "Referer": base + "/" }, REQUEST_TIMEOUT_MS);
    var token = (html.match(/'token'\s*:\s*'([^']+)'/) || [])[1];
    var expires = (html.match(/'expires'\s*:\s*'([^']+)'/) || [])[1];
    var playlist = (html.match(/url\s*:\s*'([^']+\/playlist\/\d+[^']*)'/) || [])[1];
    if (!token || !expires || !playlist) {
      console.warn("[VixSrc] incomplete playlist credentials in embed page");
      return [];
    }

    var fhd = /window\.canPlayFHD\s*=\s*true/.test(html) || /[?&]canPlayFHD=1/.test(embedUrl);
    var masterUrl = playlist + (playlist.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token) +
      "&expires=" + encodeURIComponent(expires) + (fhd ? "&h=1" : "") + "&b=1&lang=it";

    var playHeaders = { "User-Agent": VIX_UA, "Referer": embedUrl, "Origin": base };
    var masterContent = yield getText(masterUrl, playHeaders, REQUEST_TIMEOUT_MS);
    if (!masterContent.trim().startsWith("#EXTM3U")) {
      throw new Error("Invalid HLS master playlist returned from VixSrc");
    }

    // Parse variants & media tags
    var common = [];
    var variants = [];
    var pending = null;
    masterContent.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pending = { line: line, attrs: attributes(line) };
      } else if (line.charAt(0) !== "#") {
        if (pending) {
          var resMatch = /^(\d+)x(\d+)$/.exec(pending.attrs.RESOLUTION || "");
          var height = resMatch ? Number(resMatch[2]) : 0;
          var width = resMatch ? Number(resMatch[1]) : 0;
          var bw = Number(pending.attrs.BANDWIDTH) || 0;
          variants.push({
            line: pending.line,
            attrs: pending.attrs,
            url: absUrl(line, masterUrl),
            height: height,
            width: width,
            bandwidth: bw,
            displayBandwidth: Number(pending.attrs["AVERAGE-BANDWIDTH"]) || bw,
            quality: height ? height + "p" : (pending.attrs.NAME || "HD")
          });
          pending = null;
        }
      } else if (!line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
        common.push(line);
      }
    });

    // Extract audio and subtitles
    var audioTracks = [];
    var subTracks = [];
    common.forEach(function (line) {
      if (!line.startsWith("#EXT-X-MEDIA:")) return;
      var media = attributes(line);
      var flag = languageFlag(media.LANGUAGE, media.NAME);
      if (media.TYPE === "AUDIO") {
        var label = flag || media.NAME || media.LANGUAGE;
        if (label && audioTracks.indexOf(label) === -1) audioTracks.push(label);
      } else if (media.TYPE === "SUBTITLES") {
        subTracks.push({
          uri: absUrl(media.URI, masterUrl),
          name: media.NAME || "Sub",
          lang: media.LANGUAGE || "it",
          flag: flag
        });
      }
    });

    var heading = "\uD83D\uDCC1 " + (meta.title || "VixSrc") + (isTv ? " S" + pad2(season) + "E" + pad2(episode) : "") + (meta.year ? " (" + meta.year + ")" : "");
    var audioLine = audioTracks.length ? "\uD83D\uDD0A " + audioTracks.join(" ") : "\uD83D\uDD0A \uD83C\uDDEE\uD83C\uDDF9 Italiano";
    var subLine = subtitleSummary(subTracks);

    // Sort variants: 1080p > 720p > etc.
    variants.sort(function (a, b) { return b.height - a.height || b.bandwidth - a.bandwidth; });

    // Deduplicate qualities
    var seenQualities = {};
    var uniqueVariants = variants.filter(function (v) {
      if (seenQualities[v.quality]) return false;
      seenQualities[v.quality] = true;
      return true;
    });

    // If no variants were parsed, provide the master stream directly
    if (!uniqueVariants.length) {
      uniqueVariants.push({
        height: fhd ? 1080 : 720,
        width: fhd ? 1920 : 1280,
        quality: fhd ? "1080p" : "720p",
        line: "#EXT-X-STREAM-INF:BANDWIDTH=6000000",
        url: masterUrl,
        attrs: {}
      });
    }

    var streams = uniqueVariants.map(function (v) {
      var technical = [
        v.width && v.height ? "\uD83C\uDF9E\uFE0F " + v.width + "\u00D7" + v.height : "",
        codecLabel(v.attrs.CODECS),
        formatBitrate(v.displayBandwidth) ? "\uD83D\uDCF6 " + formatBitrate(v.displayBandwidth) : ""
      ].filter(Boolean).join(" \u00B7 ");

      var details = [
        technical,
        audioLine,
        subLine,
        "\uD83C\uDFAC VixSrc \u00B7 HLS \u00B7 \uD83C\uDDEE\uD83C\uDDF9"
      ].filter(Boolean).join("\n");

      var streamUrl = v.url === masterUrl ? masterUrl : buildInlineVariantUri(v, common, masterUrl);

      return {
        name: sortPrefix(v.height, 0) + "VixSrc " + v.quality + " \uD83C\uDDEE\uD83C\uDDF9",
        title: heading + "\n" + details,
        size: details,
        language: details,
        url: streamUrl,
        quality: v.quality,
        type: "hls",
        provider: "vixsrc",
        headers: playHeaders,
        subtitles: subTracks.map(function (s) {
          return { url: s.uri, name: s.name, language: s.lang };
        }),
        behaviorHints: {
          filename: "vixsrc-" + v.quality + ".m3u8"
        }
      };
    });

    // Sort by name using Nuvio alphabetical order
    streams.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    console.log("[VixSrc] Composed " + streams.length + " stream(s) for " + (meta.title || tmdbId));
    return streams;
  }()).catch(function (e) {
    console.error("[VixSrc] " + e.message);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof global !== "undefined") global.getStreams = getStreams;
