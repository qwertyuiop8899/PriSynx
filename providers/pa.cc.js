// Partite.cc (pa.cc) - Nuvio Provider
// Direct HLS streaming from Partite.cc with multi-audio Italian support and adaptive streaming.
// Written without async/await (generators via __async) for seamless execution on Hermes and QuickJS runtimes.

var BASE_URL = "https://www.partite.cc";
var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "68e094699525b18a70bab2f86b1fa706";
var TMDB_BASE = "https://api.themoviedb.org/3";
var MAPPING_BASE = (typeof ANIME_MAPPING_API !== "undefined" && ANIME_MAPPING_API) ? ANIME_MAPPING_API : "https://animemapping.realbestia.com";
var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var REQUEST_TIMEOUT_MS = 8000;
var CACHE_TTL_MS = 5 * 60 * 1000;

var ZW_PREFIX = ["\u200B", "\u200C", "\u200D", "\u2060", "\u2061", "\u2062", "\u2063", "\u2064"];

function sortPrefix(qualityKey) {
  var qNum = Number(String(qualityKey || "").replace(/[^0-9]/g, "")) || 0;
  var r = 3;
  if (qNum >= 2160) r = 0;
  else if (qNum >= 1080) r = 1;
  else if (qNum >= 720) r = 2;
  return ZW_PREFIX[r] + ZW_PREFIX[0];
}

var FLAGS = {
  it: "\uD83C\uDDEE\uD83C\uDDF9", en: "\uD83C\uDDEC\uD83C\uDDE7", fr: "\uD83C\uDDE8\uD83C\uDDF7",
  es: "\uD83C\uDDEA\uD83C\uDDF8", de: "\uD83C\uDDE9\uD83C\uDDEA", ja: "\uD83C\uDDEF\uD83C\uDDF5",
  ko: "\uD83C\uDDF0\uD83C\uDDF7", ru: "\uD83C\uDDF7\uD83C\uDDFA", pt: "\uD83C\uDDF5\uD83C\uDDF9",
  zh: "\uD83C\uDDE8\uD83C\uDDF3", ar: "\uD83C\uDDF8\uD83C\uDDE6", tr: "\uD83C\uDDF9\uD83C\uDDF7",
  pl: "\uD83C\uDDF5\uD83C\uDDF1", nl: "\uD83C\uDDF3\uD83C\uDDF1", sv: "\uD83C\uDDF8\uD83C\uDDEA"
};

var ALIASES = {
  ita: "it", italian: "it", italiano: "it",
  eng: "en", english: "en",
  fra: "fr", fre: "fr", french: "fr",
  spa: "es", spanish: "es",
  ger: "de", deu: "de", german: "de",
  jpn: "ja", japanese: "ja",
  kor: "ko", korean: "ko",
  rus: "ru", russian: "ru",
  por: "pt", portuguese: "pt",
  zho: "zh", chi: "zh", chinese: "zh"
};

var LANG_LABELS = {
  it: "\uD83C\uDDEE\uD83C\uDDF9 Italiano",
  en: "\uD83C\uDDEC\uD83C\uDDE7 English",
  fr: "\uD83C\uDDE8\uD83C\uDDF7 Français",
  es: "\uD83C\uDDEA\uD83C\uDDF8 Español",
  de: "\uD83C\uDDE9\uD83C\uDDEA Deutsch",
  ja: "\uD83C\uDDEF\uD83C\uDDF5 日本語"
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
    var f = t.flag || languageFlag(t.lang, t.name);
    if (f && flags.indexOf(f) === -1) flags.push(f);
  });
  flags.sort(function (a, b) {
    var p = function (flag) { return flag === FLAGS.it ? 0 : (flag === FLAGS.en ? 1 : 2); };
    return p(a) - p(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  var shown = flags.slice(0, 8);
  if (!shown.length) return "";
  var hidden = flags.length - shown.length;
  return "\uD83D\uDCAC " + shown.join(" ") + (hidden > 0 ? " +" + hidden : "") + " (" + flags.length + ")";
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

function pad2(n) { return (n < 10 ? "0" : "") + n; }

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

function absUrl(uri, base) {
  if (!uri) return "";
  if (/^https?:\/\//i.test(uri)) return uri;
  var origin = (base.match(/^https?:\/\/[^\/]+/i) || [""])[0];
  if (uri.charAt(0) === "/") return origin + uri;
  return base.split("?")[0].replace(/[^\/]*$/, "") + uri;
}

function parsePositiveInt(v) {
  var n = parseInt(v, 10);
  return !isNaN(n) && n > 0 ? n : null;
}

function extractImdbId(v) {
  var m = String(v || "").match(/tt\d+/i);
  return m ? m[0] : null;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/\\\//g, "/");
}

function parsePccPlaylistUrl(value) {
  if (!value || typeof value !== "string") return null;
  var fullUrl = absUrl(decodeHtmlEntities(value), BASE_URL);
  var path = fullUrl.replace(/^https?:\/\/[^\/]+/i, "").split("?")[0];
  var match = path.match(/\/hls\/(?:p\/[^\/]+\/[^\/]+\/)?s(\d+)\/(movie|serial)\/([^\/]+)(?:\/(\d+)\/(\d+))?\/playlist\.m3u8$/i);
  if (!match) return null;
  return {
    url: fullUrl,
    server: parseInt(match[1], 10),
    kind: match[2].toLowerCase(),
    id: match[3],
    season: parsePositiveInt(match[4]),
    episode: parsePositiveInt(match[5])
  };
}

function extractPccPlaylistUrls(html) {
  var source = decodeHtmlEntities(html);
  var urls = [];
  var seen = {};
  var regex = /(?:https?:\/\/[^\s"'<>]+)?\/hls\/[^\s"'<>]+?\/playlist\.m3u8(?:\?[^\s"'<>]*)?/gi;
  var match;
  while ((match = regex.exec(source)) !== null) {
    var raw = match[0].replace(/[),.;]+$/g, "");
    var full = absUrl(raw, BASE_URL);
    if (!seen[full]) {
      seen[full] = true;
      urls.push(full);
    }
  }
  return urls;
}

function getSignedPccPlaylist(parsed) {
  return __async(function* () {
    if (!parsed || !parsed.url || !parsed.kind || !parsed.id) return null;
    if (/\/hls\/p\//i.test(parsed.url)) return parsed;

    var query = "";
    if (parsed.kind === "movie") {
      query = "type=movie&id=" + encodeURIComponent(parsed.id);
    } else if (parsed.kind === "serial" && parsed.season != null && parsed.episode != null) {
      query = "type=episode&id=" + encodeURIComponent(parsed.id) + "&season=" + encodeURIComponent(parsed.season) + "&episode=" + encodeURIComponent(parsed.episode);
    } else {
      return null;
    }
    query += "&_=" + Date.now();

    var referer = parsed.kind === "movie" ? (BASE_URL + "/film/" + parsed.id) : (BASE_URL + "/serie-tv/" + parsed.id);
    try {
      var r = yield fetchWithTimeout(BASE_URL + "/api/play/grant?" + query, {
        headers: {
          "Accept": "application/json",
          "Referer": referer,
          "User-Agent": DEFAULT_UA
        }
      }, 7000);
      if (!r.ok) return null;
      var payload = yield r.json();
      var rawUrl = payload && (payload.url || payload.playlist || payload.stream);
      var signed = parsePccPlaylistUrl(rawUrl);
      if (!signed || signed.kind !== parsed.kind || signed.id.toLowerCase() !== parsed.id.toLowerCase()) return null;
      if (parsed.kind === "serial" && (signed.season !== parsed.season || signed.episode !== parsed.episode)) return null;
      return signed;
    } catch (_) {
      return null;
    }
  });
}

function fetchAnimeMapping(provider, externalId, season, episode) {
  return __async(function* () {
    try {
      var query = "ep=" + encodeURIComponent(episode || 1) + "&lang=it";
      if (season && parseInt(season, 10) > 0) query += "&s=" + encodeURIComponent(season);
      var r = yield fetchWithTimeout(MAPPING_BASE + "/" + provider + "/" + externalId + "?" + query, {
        headers: { "User-Agent": DEFAULT_UA }
      }, 5000);
      if (!r.ok) return null;
      var payload = yield r.json();
      var tmdbEp = (payload.mappings && payload.mappings.tmdb_episode) || payload.tmdb_episode;
      var imdbId = extractImdbId((payload.mappings && payload.mappings.ids && payload.mappings.ids.imdb) || (payload.ids && payload.ids.imdb));
      return {
        imdbId: imdbId,
        season: parsePositiveInt(tmdbEp && tmdbEp.season),
        episode: parsePositiveInt(tmdbEp && tmdbEp.episode),
        absoluteEpisode: parsePositiveInt(tmdbEp && tmdbEp.absoluteEpisode)
      };
    } catch (_) {
      return null;
    }
  });
}

function getSiteEpisodeList(imdbId) {
  return __async(function* () {
    try {
      var r = yield fetchWithTimeout(BASE_URL + "/serie-tv/" + imdbId, {
        headers: { "User-Agent": DEFAULT_UA }
      }, 7000);
      if (!r.ok) return null;
      var html = yield r.text();
      var episodes = {};
      var urls = extractPccPlaylistUrls(html);
      for (var i = 0; i < urls.length; i++) {
        var parsed = parsePccPlaylistUrl(urls[i]);
        if (!parsed || parsed.kind !== "serial" || parsed.season == null || parsed.episode == null) continue;
        var key = parsed.season + ":" + parsed.episode;
        var entry = episodes[key] || { server: parsed.server, season: parsed.season, episode: parsed.episode, urls: [] };
        if (entry.urls.indexOf(parsed.url) === -1) entry.urls.push(parsed.url);
        episodes[key] = entry;
      }
      var list = Object.keys(episodes).map(function (k) { return episodes[k]; });
      list.sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });
      return list.length ? list : null;
    } catch (_) {
      return null;
    }
  });
}

function getSiteMoviePlaylists(imdbId) {
  return __async(function* () {
    try {
      var r = yield fetchWithTimeout(BASE_URL + "/film/" + imdbId, {
        headers: { "User-Agent": DEFAULT_UA }
      }, 7000);
      if (!r.ok) return [];
      var html = yield r.text();
      var urls = extractPccPlaylistUrls(html);
      var result = [];
      for (var i = 0; i < urls.length; i++) {
        var parsed = parsePccPlaylistUrl(urls[i]);
        if (parsed && parsed.kind === "movie" && parsed.id.toLowerCase() === imdbId.toLowerCase()) {
          result.push(parsed);
        }
      }
      return result;
    } catch (_) {
      return [];
    }
  });
}

function resolveMediaIdentity(rawId, isTv, season, episode) {
  return __async(function* () {
    var raw = String(rawId || "").trim();
    var directImdb = extractImdbId(raw);
    var s = parsePositiveInt(season) || 1;
    var e = parsePositiveInt(episode) || 1;

    if (!isTv) {
      if (directImdb) return { imdbId: directImdb, season: null, episode: null };
      var mMatch = raw.match(/^tmdb:(\d+)$/i) || raw.match(/^(\d+)$/);
      if (mMatch) {
        try {
          var r = yield fetchWithTimeout(TMDB_BASE + "/movie/" + mMatch[1] + "/external_ids?api_key=" + TMDB_KEY, {}, 5000);
          if (r.ok) {
            var data = yield r.json();
            var id = extractImdbId(data && data.imdb_id);
            if (id) return { imdbId: id, season: null, episode: null };
          }
        } catch (_) {}
      }
      return null;
    }

    var anime = raw.match(/^(kitsu|mal|anilist|anidb):(\d+)(?::(\d+))?$/i);
    if (anime) {
      var ep = anime[3] || e;
      var mapped = yield fetchAnimeMapping(anime[1].toLowerCase(), anime[2], null, ep);
      if (mapped && mapped.imdbId) {
        return {
          imdbId: mapped.imdbId,
          season: mapped.season || s,
          episode: mapped.episode || parsePositiveInt(ep) || 1,
          absoluteEpisode: mapped.absoluteEpisode
        };
      }
      return null;
    }

    if (directImdb) {
      var mappedImdb = yield fetchAnimeMapping("imdb", directImdb, s, e);
      if (mappedImdb && mappedImdb.imdbId && (mappedImdb.absoluteEpisode || (mappedImdb.season && mappedImdb.episode))) {
        return mappedImdb;
      }
      return { imdbId: directImdb, season: s, episode: e };
    }

    var tvMatch = raw.match(/^tmdb:(\d+)$/i) || raw.match(/^(\d+)$/);
    if (tvMatch) {
      try {
        var rTv = yield fetchWithTimeout(TMDB_BASE + "/tv/" + tvMatch[1] + "/external_ids?api_key=" + TMDB_KEY, {}, 5000);
        if (rTv.ok) {
          var tvData = yield rTv.json();
          var foundImdb = extractImdbId(tvData && tvData.imdb_id);
          if (foundImdb) {
            var mappedTv = yield fetchAnimeMapping("imdb", foundImdb, s, e);
            if (mappedTv && mappedTv.imdbId && (mappedTv.absoluteEpisode || (mappedTv.season && mappedTv.episode))) {
              return mappedTv;
            }
            return { imdbId: foundImdb, season: s, episode: e };
          }
        }
      } catch (_) {}
    }

    return null;
  });
}

function parseMediaTracks(m3u8Text, masterUrl) {
  var lines = m3u8Text.split(/\r?\n/);
  var audioTracks = [];
  var subTracks = [];
  var seenAudio = {};
  var seenSubs = {};
  var hasItalianAudio = false;
  var hasAnyAudio = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    var typeMatch = line.match(/TYPE=([A-Z]+)/i);
    var type = typeMatch ? typeMatch[1].toUpperCase() : "";

    var langMatch = line.match(/LANGUAGE="([^"]+)"/i);
    var nameMatch = line.match(/NAME="([^"]+)"/i);
    var uriMatch = line.match(/URI="([^"]+)"/i);

    var lang = (langMatch && langMatch[1]) || "";
    var name = (nameMatch && nameMatch[1]) || "";

    if (type === "AUDIO") {
      hasAnyAudio = true;
      if (/(?:^|\b)(?:it|ita|italiano|italian)(?:\b|$)/i.test(lang) || /(?:^|\b)(?:italian|italiano)(?:\b|$)/i.test(name)) {
        hasItalianAudio = true;
      }
      var audioKey = (lang || name).toLowerCase();
      if (audioKey && !seenAudio[audioKey]) {
        seenAudio[audioKey] = true;
        var norm = normalizeLang(lang || name);
        var baseNorm = norm.split("-")[0];
        var label = LANG_LABELS[norm] || LANG_LABELS[baseNorm] || languageFlag(lang, name) || name || lang;
        audioTracks.push(label);
      }
    } else if (type === "SUBTITLES") {
      var flag = languageFlag(lang, name);
      var subUri = uriMatch ? absUrl(uriMatch[1], masterUrl) : "";
      if (subUri && !seenSubs[subUri]) {
        seenSubs[subUri] = true;
        subTracks.push({
          url: subUri,
          name: name || lang || "Sub",
          lang: lang || "it",
          flag: flag
        });
      }
    }
  }

  // Sort audio tracks so Italian is always first
  audioTracks.sort(function (a, b) {
    var p = function (x) { return (x.indexOf(FLAGS.it) >= 0 || x.indexOf("Italian") >= 0) ? 0 : 1; };
    return p(a) - p(b);
  });

  return {
    hasAnyAudio: hasAnyAudio,
    hasItalianAudio: hasItalianAudio,
    audioTracks: audioTracks,
    subTracks: subTracks
  };
}

function getStreams(rawId, type, season, episode) {
  return __async(function* () {
    var animeEpisode = String(rawId || "").match(/^(?:kitsu|mal|anilist|anidb):\d+:(\d+)$/i);
    var isTv = String(type || "").toLowerCase() === "series" || String(type || "").toLowerCase() === "tv";
    var s = parsePositiveInt(season) || 1;
    var e = parsePositiveInt((animeEpisode && animeEpisode[1]) || episode) || 1;

    var identity = yield resolveMediaIdentity(rawId, isTv, s, e);
    if (!identity || !identity.imdbId) return [];

    var finalImdbId = identity.imdbId;

    var metaPromise = __async(function* () {
      try {
        var r = yield fetchWithTimeout(TMDB_BASE + "/find/" + finalImdbId + "?api_key=" + TMDB_KEY + "&external_source=imdb_id", {}, 5000);
        if (r.ok) {
          var d = yield r.json();
          var item = (isTv ? d.tv_results : d.movie_results) || [];
          if (item.length) {
            return {
              title: (isTv ? item[0].name : item[0].title) || "",
              year: ((isTv ? item[0].first_air_date : item[0].release_date) || "").slice(0, 4)
            };
          }
        }
      } catch (_) {}
      return { title: "", year: "" };
    });

    var preferredPlaylistUrls = [];
    var siteSeason = s;
    var siteEpisode = e;

    if (isTv) {
      var episodeList = yield getSiteEpisodeList(finalImdbId);
      var target = null;
      if (Number.isInteger(identity.absoluteEpisode) && identity.absoluteEpisode > 0 && episodeList) {
        target = episodeList[identity.absoluteEpisode - 1];
      }
      if (!target && episodeList) {
        target = episodeList.find(function (item) {
          return item.season === (identity.season || s) && item.episode === (identity.episode || e);
        });
      }
      if (target) {
        siteSeason = target.season;
        siteEpisode = target.episode;
        preferredPlaylistUrls = Array.isArray(target.urls) ? target.urls.slice() : [];
      }
    }

    var playlistCandidates = [];
    function addPlaylistCandidate(url, server) {
      if (!url) return;
      var fullUrl = absUrl(url, BASE_URL);
      for (var i = 0; i < playlistCandidates.length; i++) {
        if (playlistCandidates[i].url === fullUrl) return;
      }
      var parsed = parsePccPlaylistUrl(fullUrl);
      playlistCandidates.push({
        url: fullUrl,
        server: server || (parsed && parsed.server) || 1
      });
    }

    if (isTv) {
      var preferredParsed = preferredPlaylistUrls.map(parsePccPlaylistUrl).filter(Boolean);
      var signedList = yield Promise.all(preferredParsed.map(function (parsed) {
        return /\/hls\/p\//i.test(parsed.url) ? Promise.resolve(parsed) : getSignedPccPlaylist(parsed);
      }));
      signedList.filter(Boolean).forEach(function (signed) {
        addPlaylistCandidate(signed.url, signed.server);
      });
    } else {
      var moviePlaylists = yield getSiteMoviePlaylists(finalImdbId);
      var signedMovie = yield Promise.all(moviePlaylists.map(function (parsed) {
        return /\/hls\/p\//i.test(parsed.url) ? Promise.resolve(parsed) : getSignedPccPlaylist(parsed);
      }));
      signedMovie.filter(Boolean).forEach(function (signed) {
        addPlaylistCandidate(signed.url, signed.server);
      });
    }

    var meta = yield metaPromise;
    var heading = "\uD83D\uDCC1 " + (meta.title || "Partite.cc") + (isTv ? " S" + pad2(siteSeason) + "E" + pad2(siteEpisode) : "") + (meta.year ? " (" + meta.year + ")" : "");

    var streamResults = yield Promise.all(playlistCandidates.map(function (candidate) {
      return __async(function* () {
        try {
          var res = yield fetchWithTimeout(candidate.url, {
            headers: {
              "Referer": BASE_URL + "/",
              "User-Agent": DEFAULT_UA
            }
          }, 6000);
          if (!res.ok) return null;
          var text = yield res.text();

          var heights = [];
          var hRegex = /RESOLUTION=\d+x(\d+)/gi;
          var m;
          while ((m = hRegex.exec(text)) !== null) {
            heights.push(parseInt(m[1], 10));
          }
          var maxHeight = heights.length ? Math.max.apply(Math, heights) : 0;
          var quality = maxHeight >= 2160 ? "4K" : maxHeight >= 1440 ? "1440p" : maxHeight >= 1080 ? "1080p" : maxHeight >= 720 ? "720p" : (maxHeight ? maxHeight + "p" : "HD");

          var tracks = parseMediaTracks(text, candidate.url);
          // Only keep streams that feature Italian audio
          if (tracks.hasAnyAudio && !tracks.hasItalianAudio) {
            return null;
          }

          var audioLine = tracks.audioTracks.length ? "\uD83D\uDD0A " + tracks.audioTracks.join(" \u00B7 ") : "\uD83D\uDD0A \uD83C\uDDEE\uD83C\uDDF9 Italiano";
          var subLine = subtitleSummary(tracks.subTracks);
          var technical = "\uD83C\uDF9E\uFE0F " + quality + " \u00B7 HLS";

          var details = [
            technical,
            audioLine,
            subLine,
            "\uD83C\uDFAC Partite.cc \u00B7 Server " + candidate.server
          ].filter(Boolean).join("\n");

          return {
            name: sortPrefix(quality) + "Partite.cc " + quality + " \u00B7 Server " + candidate.server + " \uD83C\uDDEE\uD83C\uDDF9",
            title: heading + "\n" + details,
            size: details,
            language: details,
            quality: quality,
            type: "hls",
            url: candidate.url,
            provider: "pa.cc",
            headers: {
              "Referer": BASE_URL + "/"
            },
            behaviorHints: {
              notWebReady: true,
              proxyHeaders: {
                request: {
                  "Referer": BASE_URL + "/"
                }
              },
              headers: {
                "Referer": BASE_URL + "/"
              }
            },
            subtitles: tracks.subTracks.map(function (s) {
              return { url: s.url, name: s.name, language: s.lang };
            })
          };
        } catch (_) {
          return null;
        }
      });
    }));

    var validStreams = streamResults.filter(Boolean);
    validStreams.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return validStreams;
  });
}

// In-memory cache
var pccCache = {};
var pccInFlight = {};

function cachedGetStreams(id, type, season, episode) {
  var animeEpisode = String(id || "").match(/^(?:kitsu|mal|anilist|anidb):\d+:(\d+)$/i);
  var s = parsePositiveInt(season) || 1;
  var e = parsePositiveInt((animeEpisode && animeEpisode[1]) || episode) || 1;
  var key = String(type || "").toLowerCase() + ":" + String(id || "").toLowerCase() + ":" + s + ":" + e;

  var cached = pccCache[key];
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.streams.slice());
  }

  var inFlight = pccInFlight[key];
  if (inFlight) {
    return inFlight.then(function (res) { return res.slice(); });
  }

  var promise = getStreams(id, type, season, episode).then(function (streams) {
    pccCache[key] = { streams: streams, expiresAt: Date.now() + CACHE_TTL_MS };
    return streams;
  }).finally(function () {
    delete pccInFlight[key];
  });

  pccInFlight[key] = promise;
  return promise;
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: cachedGetStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = cachedGetStreams;
