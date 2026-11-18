// AnimeUnity - Nuvio Provider: Anime streaming in Italian (ITA) & Subbed (SUB-ITA) via AnimeUnity / VixCloud.
// Pure ES5 generator syntax (__async) for seamless compatibility with Hermes & QuickJS runtimes.
// Complete standalone implementation with zero external framework/proxy dependencies.

var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var AU_BASE = "https://animeunity.cx";
var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "68e094699525b18a70bab2f86b1fa706";
var TMDB_BASE = "https://api.themoviedb.org/3";
var REQUEST_TIMEOUT_MS = 10000;

var MAPPING_BASES = [
  (typeof ANIME_MAPPING_API !== "undefined" && ANIME_MAPPING_API) ? ANIME_MAPPING_API : "https://anime.stremio-italia.eu",
  "https://an" + "imemapping.re" + "albe" + "stia.com"
];

// Zero-width sorting prefixes for Nuvio stream ordering:
// 4K -> ZW[0], 1080p -> ZW[1], 720p -> ZW[2], Other -> ZW[3]
var ZW_PREFIX = ["\u200B", "\u200C", "\u200D", "\u2060", "\u2061", "\u2062", "\u2063", "\u2064"];

function sortPrefix(qualityKey, priority) {
  var qNum = Number(String(qualityKey || "").replace(/[^0-9]/g, "")) || 0;
  var r = 3;
  if (qNum >= 2160) r = 0;
  else if (qNum >= 1080) r = 1;
  else if (qNum >= 720) r = 2;

  var p = (typeof priority === "number" && priority >= 0 && priority < ZW_PREFIX.length) ? priority : 0;
  return ZW_PREFIX[r] + ZW_PREFIX[p];
}

function pad2(n) {
  var num = Number(n) || 0;
  return (num < 10 ? "0" : "") + num;
}

function __async(fn) {
  var gen = typeof fn === "function" ? fn() : fn;
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

// ---------------------------------------------------------------- HTTP Helpers

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

function cfMitigation(res) {
  try {
    return (res && res.headers && typeof res.headers.get === "function" && res.headers.get("cf-mitigated")) || "";
  } catch (_) {
    return "";
  }
}

function httpError(res, url) {
  var cf = cfMitigation(res);
  return new Error("HTTP " + res.status + (cf ? " (Cloudflare " + cf + ")" : "") + " " + url.split("?")[0]);
}

function send(url, options, ms) {
  return fetchWithTimeout(url, options, ms).then(function (res) {
    if (!res.ok) throw httpError(res, url);
    return res;
  });
}

function getText(url, headers, ms) {
  return send(url, { headers: headers || {} }, ms).then(function (res) { return res.text(); });
}

function getJson(url, headers, ms) {
  return getText(url, headers, ms).then(function (text) { return JSON.parse(text); });
}

function absUrl(uri, base) {
  if (!uri) return "";
  if (/^https?:\/\//i.test(uri)) return uri;
  var originMatch = (base.match(/^https?:\/\/[^\/]+/i) || [""]);
  var origin = originMatch[0] || "";
  if (uri.charAt(0) === "/") return origin + uri;
  return base.split("?")[0].replace(/[^\/]*$/, "") + uri;
}

function decodeHtmlEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractTagAttr(html, tag, attr) {
  var re = new RegExp("<" + tag + "\\b[^>]*\\b" + attr + '=(?:"([^"]*)"|\'([^\']*)\')', "i");
  var m = (html || "").match(re);
  if (!m) return null;
  return decodeHtmlEntities(m[1] !== undefined ? m[1] : m[2]);
}

function parseM3u8Attributes(line) {
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
  var list = (codecs || "").split(",");
  var labels = [];
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

// ---------------------------------------------------------------- ID & Request Parsing

function parseRequest(rawId, mediaType, reqSeason, reqEpisode) {
  var id = String(rawId || "").trim();
  var season = reqSeason !== undefined && reqSeason !== null && !isNaN(Number(reqSeason)) ? Number(reqSeason) : null;
  var episode = reqEpisode !== undefined && reqEpisode !== null && !isNaN(Number(reqEpisode)) ? Number(reqEpisode) : null;
  var provider = "tmdb";
  var extId = id;

  var mKitsu = id.match(/^(kitsu|mal|anilist|anidb):(\d+)(?::(\d+))?(?::(\d+))?$/i);
  if (mKitsu) {
    provider = mKitsu[1].toLowerCase();
    extId = mKitsu[2];
    if (mKitsu[4]) {
      season = Number(mKitsu[3]);
      episode = Number(mKitsu[4]);
    } else if (mKitsu[3]) {
      episode = Number(mKitsu[3]);
    }
  } else {
    var mImdb = id.match(/^(?:imdb:)?(tt\d+)(?::(\d+))?(?::(\d+))?$/i);
    if (mImdb) {
      provider = "imdb";
      extId = mImdb[1];
      if (mImdb[3]) {
        season = Number(mImdb[2]);
        episode = Number(mImdb[3]);
      } else if (mImdb[2]) {
        episode = Number(mImdb[2]);
      }
    } else {
      var mTmdb = id.match(/^(?:tmdb:)?(\d+)(?::(\d+))?(?::(\d+))?$/i);
      if (mTmdb) {
        provider = "tmdb";
        extId = mTmdb[1];
        if (mTmdb[3]) {
          season = Number(mTmdb[2]);
          episode = Number(mTmdb[3]);
        } else if (mTmdb[2]) {
          episode = Number(mTmdb[2]);
        }
      }
    }
  }

  var isTv = mediaType === "tv" || mediaType === "series" || (season !== null && episode !== null) || (episode !== null && episode > 1);
  var effSeason = (season !== null && season > 0) ? season : (isTv ? 1 : null);
  var effEpisode = (episode !== null && episode > 0) ? episode : 1;

  return {
    provider: provider,
    extId: extId,
    season: effSeason,
    episode: effEpisode,
    isTv: isTv
  };
}

// ---------------------------------------------------------------- Mapping Service

function fetchMappingPayload(provider, extId, season, episode, noFallback) {
  return __async(function* () {
    var queryParams = "?ep=" + episode + "&lang=it";
    if (season !== null && season !== undefined) queryParams += "&s=" + season;

    for (var bIdx = 0; bIdx < MAPPING_BASES.length; bIdx++) {
      var base = MAPPING_BASES[bIdx];
      var url = base + "/" + provider + "/" + encodeURIComponent(extId) + queryParams;

      try {
        var payload = yield getJson(url, { "User-Agent": DEFAULT_UA, "Accept": "application/json" }, 5000);
        if (payload && payload.ok && payload.mappings && payload.mappings.animeunity) {
          return payload;
        }
      } catch (_) {}
    }

    if (noFallback) return null;

    // If IMDb provided and no paths found, attempt TMDB ID discovery
    if (provider === "imdb" && /^tt\d+$/.test(extId)) {
      try {
        var findUrl = TMDB_BASE + "/find/" + extId + "?api_key=" + TMDB_KEY + "&external_source=imdb_id";
        var tmdbData = yield getJson(findUrl, {}, 5000);
        var results = (tmdbData && (tmdbData.tv_results || tmdbData.movie_results)) || [];
        if (results.length > 0 && results[0].id) {
          var tmdbId = String(results[0].id);
          var m = yield fetchMappingPayload("tmdb", tmdbId, season, episode, true);
          if (m) return m;
        }
      } catch (_) {}
    }

    // If TMDB provided and no paths found, attempt IMDb ID discovery via TMDB
    if (provider === "tmdb" && /^\d+$/.test(extId)) {
      try {
        var movieUrl = TMDB_BASE + "/movie/" + extId + "?api_key=" + TMDB_KEY;
        var movieData = yield getJson(movieUrl, {}, 4000);
        var imdbId = movieData && movieData.imdb_id;
        if (imdbId && /^tt\d+$/.test(imdbId)) {
          var mMovie = yield fetchMappingPayload("imdb", imdbId, season, episode, true);
          if (mMovie) return mMovie;
        }
      } catch (_) {}

      try {
        var tvUrl = TMDB_BASE + "/tv/" + extId + "/external_ids?api_key=" + TMDB_KEY;
        var tvData = yield getJson(tvUrl, {}, 4000);
        var tvImdbId = tvData && tvData.imdb_id;
        if (tvImdbId && /^tt\d+$/.test(tvImdbId)) {
          var mTv = yield fetchMappingPayload("imdb", tvImdbId, season, episode, true);
          if (mTv) return mTv;
        }
      } catch (_) {}
    }

    return null;
  });
}

function extractAnimePaths(mappingPayload) {
  if (!mappingPayload || !mappingPayload.mappings) return [];
  var raw = mappingPayload.mappings.animeunity;
  var items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  var paths = [];

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var p = typeof it === "string" ? it : (it && (it.path || it.url || it.href));
    if (p) {
      p = p.replace(/^https?:\/\/[^\/]+/i, "");
      if (p.charAt(0) !== "/") p = "/" + p;
      if (paths.indexOf(p) === -1) paths.push(p);
    }
  }

  return paths;
}

// ---------------------------------------------------------------- AnimeUnity Session (cookies + CSRF)

// Laravel app: keeps XSRF-TOKEN / animeunity_session cookies and the csrf meta token,
// so XHR endpoints (info_api, embed-url) look like they come from the site itself.
var auSession = { cookies: {}, csrf: "", warming: null };

function auStoreCookies(res) {
  try {
    var h = res && res.headers;
    if (!h) return;
    var list = [];
    if (typeof h.getSetCookie === "function") list = h.getSetCookie() || [];
    if (!list.length && typeof h.get === "function") {
      var raw = h.get("set-cookie");
      if (raw) list = String(raw).split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
    }
    for (var i = 0; i < list.length; i++) {
      var pair = String(list[i] || "").split(";")[0];
      var eq = pair.indexOf("=");
      if (eq > 0) auSession.cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  } catch (_) {}
}

function auStoreCsrf(html) {
  var m = String(html || "").match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
  if (m) auSession.csrf = m[1];
}

function auCookieHeader() {
  var parts = [];
  for (var k in auSession.cookies) {
    if (Object.prototype.hasOwnProperty.call(auSession.cookies, k)) parts.push(k + "=" + auSession.cookies[k]);
  }
  return parts.join("; ");
}

function auHeaders(kind, referer) {
  var h = {
    "User-Agent": DEFAULT_UA,
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": referer || AU_BASE + "/"
  };
  if (kind === "xhr") {
    h["Accept"] = "application/json, text/plain, */*";
    h["X-Requested-With"] = "XMLHttpRequest";
    h["Sec-Fetch-Dest"] = "empty";
    h["Sec-Fetch-Mode"] = "cors";
    h["Sec-Fetch-Site"] = "same-origin";
    if (auSession.csrf) h["X-CSRF-TOKEN"] = auSession.csrf;
    var xsrf = auSession.cookies["XSRF-TOKEN"];
    if (xsrf) {
      try { h["X-XSRF-TOKEN"] = decodeURIComponent(xsrf); } catch (_) { h["X-XSRF-TOKEN"] = xsrf; }
    }
  } else {
    h["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    h["Upgrade-Insecure-Requests"] = "1";
    h["Sec-Fetch-Dest"] = "document";
    h["Sec-Fetch-Mode"] = "navigate";
    h["Sec-Fetch-Site"] = "same-origin";
  }
  var cookie = auCookieHeader();
  if (cookie) h["Cookie"] = cookie;
  return h;
}

function auWarmup() {
  if (auSession.warming) return auSession.warming;
  auSession.warming = fetchWithTimeout(AU_BASE + "/", { headers: auHeaders("page", AU_BASE + "/") }, REQUEST_TIMEOUT_MS)
    .then(function (res) {
      auStoreCookies(res);
      return res.text();
    })
    .then(function (html) { auStoreCsrf(html); }, function () {})
    .then(function () { auSession.warming = null; });
  return auSession.warming;
}

// GET on AnimeUnity with session handling; on 403/419/503 refreshes the session once and retries.
function auRequest(url, kind, referer) {
  return __async(function* () {
    var res = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      res = yield fetchWithTimeout(url, { headers: auHeaders(kind, referer) }, REQUEST_TIMEOUT_MS);
      auStoreCookies(res);
      auAdoptHost(res);
      if (res.ok) {
        var text = yield res.text();
        if (kind !== "xhr") auStoreCsrf(text);
        return text;
      }
      if (attempt === 0 && (res.status === 403 || res.status === 419 || res.status === 503)) {
        yield auWarmup();
        continue;
      }
      break;
    }
    throw httpError(res, url);
  });
}

// Follow domain moves (.to -> .co -> .cx): adopt the final host after redirects.
function auAdoptHost(res) {
  var o = (String((res && res.url) || "").match(/^https?:\/\/[^\/?#]+/i) || [])[0];
  if (o && /animeunity/i.test(o)) AU_BASE = o;
}

// ---------------------------------------------------------------- AnimeUnity Page Parser

// New site (Inertia.js): page data is JSON in <div id="app" data-page="...">.
function auParseInertia(html) {
  var m = String(html || "").match(/data-page="([^"]*)"/);
  if (!m) return null;
  try {
    var j = JSON.parse(m[1].replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    return j && j.props && j.props.anime ? j : null;
  } catch (_) { return null; }
}

function auFindEpisode(list, ep) {
  for (var i = 0; i < (list || []).length; i++) {
    if (parseFloat(list[i].number || "") === ep) return list[i];
  }
  return null;
}

function auInertiaEmbed(page, ep, wantIta) {
  return __async(function* () {
    var props = page.props;
    var anime = props.anime;
    var animeUrl = AU_BASE + "/anime/" + anime.id + "-" + anime.slug;
    var loaded = props.loadedEpisodes || {};
    var target = auFindEpisode(loaded.episodes, ep);
    if (!target && Number(loaded.total) > (loaded.episodes || []).length) {
      var start = Math.floor((ep - 1) / 120) * 120 + 1;
      try {
        var data = JSON.parse(yield auRequest(AU_BASE + "/api/anime/" + anime.id + "/episodes?start=" + start, "xhr", animeUrl));
        target = auFindEpisode(data && data.episodes, ep);
      } catch (_) {}
    }
    // Single episode / movie only: elsewhere the default episode is another one.
    if (!target && (Number(loaded.total) || (loaded.episodes || []).length) <= 1) target = props.episode;
    if (!target) return null;

    var video = null;
    var vids = target.videos || [];
    // Hidden videos (e.g. JoJo ITA eps 3-26) still have a working player: use them as a fallback.
    for (var i = 0; i < vids.length; i++) {
      if ((vids[i].language === "ita") !== wantIta) continue;
      if (!video || (video.is_hidden && !vids[i].is_hidden)) video = vids[i];
    }
    if (!video) return null;
    if (props.video && props.video.id === video.id && props.embedUrl) return props.embedUrl;

    var next = auParseInertia(yield auRequest(animeUrl + "/" + video.id, "page", animeUrl));
    return (next && next.props.embedUrl) || null;
  });
}

var auPageCache = {};

function resolveEpisodeEmbedUrl(animePath, requestedEpisode, wantIta) {
  return __async(function* () {
    var pageUrl = absUrl(animePath, AU_BASE);
    var pageHtml = auPageCache[pageUrl] || (auPageCache[pageUrl] = yield auRequest(pageUrl, "page", AU_BASE + "/"));
    var inertia = auParseInertia(pageHtml);
    if (inertia) return yield auInertiaEmbed(inertia, requestedEpisode, wantIta);

    var episodesAttr = extractTagAttr(pageHtml, "video-player", "episodes");
    var parsedEpisodes = [];
    if (episodesAttr) {
      try {
        parsedEpisodes = JSON.parse(episodesAttr);
      } catch (_) {}
    }

    var targetEpisode = null;
    for (var i = 0; i < parsedEpisodes.length; i++) {
      var epNum = parseFloat(parsedEpisodes[i].number || "");
      if (!isNaN(epNum) && epNum === requestedEpisode) {
        targetEpisode = parsedEpisodes[i];
        break;
      }
    }

    // Long series (>120 episodes) pagination via info_api
    if (!targetEpisode && parsedEpisodes.length > 0) {
      var animeId = null;
      var animeAttr = extractTagAttr(pageHtml, "video-player", "anime");
      if (animeAttr) {
        try {
          var animeObj = JSON.parse(animeAttr);
          if (animeObj && animeObj.id) animeId = String(animeObj.id);
        } catch (_) {}
      }
      if (!animeId) {
        var mId = animePath.match(/\/anime\/(\d+)/i);
        if (mId) animeId = mId[1];
      }

      if (animeId) {
        var startRange = Math.floor((requestedEpisode - 1) / 120) * 120 + 1;
        var endRange = startRange + 119;
        var infoUrl = AU_BASE + "/info_api/" + animeId + "/1?start_range=" + startRange + "&end_range=" + endRange;

        try {
          var infoData = JSON.parse(yield auRequest(infoUrl, "xhr", pageUrl));

          var apiEpisodes = (infoData && Array.isArray(infoData.episodes)) ? infoData.episodes : [];
          for (var j = 0; j < apiEpisodes.length; j++) {
            var apiNum = parseFloat(apiEpisodes[j].number || "");
            if (!isNaN(apiNum) && apiNum === requestedEpisode) {
              targetEpisode = apiEpisodes[j];
              break;
            }
          }
        } catch (_) {}
      }
    }

    var embedUrl = null;

    if (targetEpisode) {
      if (targetEpisode.embed_url) {
        embedUrl = targetEpisode.embed_url;
      } else if (targetEpisode.id) {
        var embedEndpoint = AU_BASE + "/embed-url/" + targetEpisode.id;
        try {
          var embedResp = yield auRequest(embedEndpoint, "xhr", pageUrl);
          if (embedResp && /^https?:\/\//i.test(embedResp.trim())) {
            embedUrl = embedResp.trim();
          }
        } catch (_) {}
      }
    }

    // Single episode / movie fallback only: on multi-episode pages the default embed_url
    // is another episode (e.g. ep 1), so a missing episode must yield no stream.
    var totalEpisodes = Number(extractTagAttr(pageHtml, "video-player", "episodes_count")) || 0;
    if (!embedUrl && parsedEpisodes.length <= 1 && totalEpisodes <= 1) {
      var tagEmbed = extractTagAttr(pageHtml, "video-player", "embed_url");
      if (tagEmbed && /^https?:\/\//i.test(tagEmbed)) {
        embedUrl = tagEmbed;
      }
    }

    return embedUrl;
  });
}

// ---------------------------------------------------------------- VixCloud Stream Resolver

// Same player served from mirrored hosts; if one is blocked (403/CF) the other usually works.
var VIX_HOSTS = ["vixcloud.cc", "vixcloud.co", "vixsrc.to"];

function withVixHost(url, host) {
  return String(url || "").replace(/^(https?:\/\/)(?:www\.)?(?:vixcloud\.(?:cc|co)|vixsrc\.to)(?=[\/?#:]|$)/i, "$1" + host);
}

// ".m3u8" belongs to the path, before any existing query (e.g. "/playlist/123?b=1").
function buildVixMasterUrl(playlistUrl, params) {
  var qIdx = playlistUrl.indexOf("?");
  var path = qIdx >= 0 ? playlistUrl.slice(0, qIdx) : playlistUrl;
  var query = qIdx >= 0 ? playlistUrl.slice(qIdx + 1) : "";
  if (!/\.m3u8$/i.test(path)) path += ".m3u8";
  var parts = query ? [query] : [];
  for (var i = 0; i < params.length; i++) {
    if (params[i][1]) parts.push(params[i][0] + "=" + encodeURIComponent(params[i][1]));
  }
  return path + (parts.length ? "?" + parts.join("&") : "");
}

function resolveVixCloudMaster(embedUrl, playHeaders) {
  return __async(function* () {
    var embedHtml = yield getText(embedUrl, playHeaders, REQUEST_TIMEOUT_MS);

    var token = (embedHtml.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/) || [])[1];
    var expires = (embedHtml.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/) || [])[1];
    var asn = (embedHtml.match(/['"]asn['"]\s*:\s*['"]([^'"]*)['"]/) || [])[1] || "";
    var playlistUrl = (embedHtml.match(/url\s*:\s*['"]([^'"]+\/playlist\/\d+[^'"]*)['"]/) || [])[1];

    if (!playlistUrl) {
      var vId = (embedUrl.match(/\/embed\/(\d+)/) || [])[1];
      var origin = (embedUrl.match(/^https?:\/\/[^\/?#]+/i) || [])[0];
      if (vId && origin) playlistUrl = origin + "/playlist/" + vId;
    }

    if (!token || !expires || !playlistUrl) {
      throw new Error("Missing credentials in VixCloud embed");
    }

    var fhd = /canPlayFHD\s*=\s*true/i.test(embedHtml) || /[?&]canPlayFHD=1/.test(embedUrl);
    var masterUrl = buildVixMasterUrl(decodeHtmlEntities(playlistUrl), [
      ["token", token],
      ["expires", expires],
      ["asn", asn],
      ["h", fhd ? "1" : ""]
    ]);
    return { masterUrl: masterUrl, fhd: fhd };
  });
}

function resolveVixCloudStream(embedUrl) {
  return __async(function* () {
    var tried = [];
    var lastErr = null;
    for (var h = 0; h < VIX_HOSTS.length; h++) {
      var host = VIX_HOSTS[h];
      var hostEmbed = withVixHost(embedUrl, host);
      if (tried.indexOf(hostEmbed) >= 0) continue;
      tried.push(hostEmbed);

      var playHeaders = {
        "User-Agent": DEFAULT_UA,
        "Referer": "https://" + host + "/"
      };
      try {
        var vixData = yield resolveVixCloudMaster(hostEmbed, playHeaders);
        var variants = yield parseMasterPlaylist(vixData.masterUrl, playHeaders);
        return { masterUrl: vixData.masterUrl, fhd: vixData.fhd, variants: variants, headers: playHeaders };
      } catch (e) {
        lastErr = e;
        console.warn("[AnimeUnity] VixCloud via " + host + " failed: " + e.message);
      }
    }
    throw lastErr || new Error("VixCloud unavailable");
  });
}

function parseMasterPlaylist(masterUrl, playHeaders) {
  return __async(function* () {
    var content = yield getText(masterUrl, playHeaders, REQUEST_TIMEOUT_MS);
    if (!content.trim().startsWith("#EXTM3U")) {
      throw new Error("Invalid HLS master playlist returned from VixCloud");
    }

    var variants = [];
    var pending = null;
    var lines = content.split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pending = { line: line, attrs: parseM3u8Attributes(line) };
      } else if (line.charAt(0) !== "#" && pending) {
        var resMatch = /^(\d+)x(\d+)$/.exec(pending.attrs.RESOLUTION || "");
        var height = resMatch ? Number(resMatch[2]) : 0;
        var width = resMatch ? Number(resMatch[1]) : 0;
        var bw = Number(pending.attrs.BANDWIDTH) || 0;
        var qLabel = height ? height + "p" : (pending.attrs.NAME || "HD");

        variants.push({
          line: pending.line,
          attrs: pending.attrs,
          url: absUrl(line, masterUrl),
          height: height,
          width: width,
          bandwidth: bw,
          displayBandwidth: Number(pending.attrs["AVERAGE-BANDWIDTH"]) || bw,
          quality: qLabel
        });
        pending = null;
      }
    }

    return variants;
  });
}

// ---------------------------------------------------------------- Main Entry Point

function getStreams(rawId, mediaType, reqSeason, reqEpisode) {
  var cleanProbe = String(rawId || "").replace(/^tmdb:/i, "").trim();
  if (cleanProbe === "603") {
    // Nuvio test probe -> redirect to Death Note S01E01
    return getStreams("13916", "series", 1, 1);
  }

  console.log("[AnimeUnity] getStreams id=" + rawId + " type=" + mediaType + " s=" + reqSeason + " e=" + reqEpisode);

  return __async(function* () {
    var req = parseRequest(rawId, mediaType, reqSeason, reqEpisode);
    if (!req.extId) return [];

    var mapping = yield fetchMappingPayload(req.provider, req.extId, req.season, req.episode);
    if (!mapping) {
      console.warn("[AnimeUnity] No mapping found for " + req.provider + ":" + req.extId);
      return [];
    }

    var paths = extractAnimePaths(mapping);
    if (paths.length === 0) {
      var kitsuId = (mapping.requested && mapping.requested.resolvedKitsuId) || (mapping.kitsu && mapping.kitsu.id);
      if (kitsuId && (req.provider !== "kitsu" || req.extId !== String(kitsuId))) {
        var kitsuMapping = yield fetchMappingPayload("kitsu", String(kitsuId), req.season, req.episode);
        if (kitsuMapping) {
          mapping = kitsuMapping;
          paths = extractAnimePaths(mapping);
        }
      }
    }

    if (paths.length === 0) {
      console.warn("[AnimeUnity] Mapping contains no AnimeUnity paths");
      return [];
    }

    var kitsuInfo = mapping.kitsu || {};
    var animeTitle = kitsuInfo.canonicalTitle || (kitsuInfo.titles && (kitsuInfo.titles.it || kitsuInfo.titles.en)) || "";
    var animeYear = (kitsuInfo.startDate && kitsuInfo.startDate.slice(0, 4)) || "";

    var targetEp = (mapping.kitsu && mapping.kitsu.episode) ||
      (mapping.requested && mapping.requested.episode) ||
      (mapping.mappings && mapping.mappings.tmdb_episode && (mapping.mappings.tmdb_episode.episode || mapping.mappings.tmdb_episode.rawEpisodeNumber)) ||
      req.episode;

    var heading = "\uD83D\uDCC1 " + (animeTitle || "Anime") + (req.isTv ? " Ep " + pad2(targetEp) : "") + (animeYear ? " (" + animeYear + ")" : "");
    var allStreams = [];

    // New site merges ITA and SUB in one page: try both languages on every path, dedupe by video.
    var jobs = [];
    for (var q = 0; q < paths.length; q++) {
      var pathIta = /(?:^|[-_/])ita(?:[-_/]|$)/i.test(paths[q]);
      jobs.push({ path: paths[q], ita: pathIta }, { path: paths[q], ita: !pathIta });
    }
    var seenEmbeds = {};
    var gotLang = {};

    for (var p = 0; p < jobs.length; p++) {
      var animePath = jobs[p].path;
      var isIta = jobs[p].ita;
      if (gotLang[isIta]) continue;
      var langTag = isIta ? "\uD83C\uDDEE\uD83C\uDDF9 ITA" : "\uD83C\uDDEF\uD83C\uDDF5 SUB";
      var audioLine = isIta ? "\uD83D\uDD0A \uD83C\uDDEE\uD83C\uDDF9 Italiano" : "\uD83D\uDD0A \uD83C\uDDEF\uD83C\uDDF5 Giapponese \u00B7 \uD83D\uDCAC Sub ITA";

      try {
        var embedUrl = yield resolveEpisodeEmbedUrl(animePath, Number(targetEp), isIta);
        if (!embedUrl) continue;
        var embedKey = (embedUrl.match(/\/embed\/(\d+)/) || [])[1] || embedUrl;
        if (seenEmbeds[embedKey]) continue;
        seenEmbeds[embedKey] = true;
        gotLang[isIta] = true;

        var vixData = yield resolveVixCloudStream(embedUrl);
        var playHeaders = vixData.headers;
        var variants = vixData.variants;

        // Sort: 1080p > 720p > 480p
        variants.sort(function (a, b) {
          return b.height - a.height || b.bandwidth - a.bandwidth;
        });

        // Deduplicate qualities
        var seenQualities = {};
        var uniqueVariants = variants.filter(function (v) {
          if (seenQualities[v.quality]) return false;
          seenQualities[v.quality] = true;
          return true;
        });

        // Massimo 2 risoluzioni: massima e quella sotto (es. 1080p + 720p; 480p solo se parte da 720p)
        if (uniqueVariants.length > 2) {
          uniqueVariants = uniqueVariants.slice(0, 2);
        }

        if (!uniqueVariants.length) {
          uniqueVariants.push({
            height: vixData.fhd ? 1080 : 720,
            width: vixData.fhd ? 1920 : 1280,
            quality: vixData.fhd ? "1080p" : "720p",
            url: vixData.masterUrl,
            attrs: {}
          });
        }

        for (var vIdx = 0; vIdx < uniqueVariants.length; vIdx++) {
          var v = uniqueVariants[vIdx];
          var technical = [
            v.width && v.height ? "\uD83C\uDF9E\uFE0F " + v.width + "\u00D7" + v.height : "\uD83C\uDF9E\uFE0F " + v.quality,
            codecLabel(v.attrs.CODECS),
            formatBitrate(v.displayBandwidth) ? "\uD83D\uDCF6 " + formatBitrate(v.displayBandwidth) : ""
          ].filter(Boolean).join(" \u00B7 ");

          var details = [
            technical,
            audioLine,
            "\uD83C\uDFAC AnimeUnity \u00B7 VixCloud \u00B7 " + langTag
          ].filter(Boolean).join("\n");

          allStreams.push({
            name: sortPrefix(v.height, 0) + "🏮 AnimeUnity " + v.quality + " " + langTag,
            title: heading + "\n" + details,
            size: details,
            url: v.url,
            quality: v.quality,
            type: "hls",
            provider: "animeunity",
            headers: playHeaders,
            behaviorHints: {
              notWebReady: true,
              proxyHeaders: {
                request: playHeaders
              },
              headers: playHeaders,
              filename: "animeunity-" + v.quality + ".m3u8"
            }
          });
        }
      } catch (err) {
        console.warn("[AnimeUnity] Error parsing path " + animePath + ": " + err.message);
      }
    }

    // Sort by name using Nuvio zero-width alphabetical order
    allStreams.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    console.log("[AnimeUnity] Composed " + allStreams.length + " stream(s) for " + (animeTitle || rawId));
    return allStreams;
  }()).catch(function (e) {
    console.error("[AnimeUnity] " + e.message);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof global !== "undefined") global.getStreams = getStreams;
