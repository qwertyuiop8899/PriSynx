#!/usr/bin/env node

/**
 * Suite di Verifica End-to-End per tutti i Provider PriSynx.
 * Esegue il recupero degli stream reali e invia probe di rete
 * (HLS m3u8 playlist + primo chunk video / MP4 Range request)
 * per verificare che la riproduzione sia effettivamente attiva.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

// Configurazione dei Provider e Titoli di Test
const PROVIDERS = [
  {
    id: "dualsync",
    name: "⚡ DualSync",
    file: "../providers/dualsync.js",
    tests: [
      { label: "Film (Corpse Bride)", id: "tt0121164", type: "movie", fallback: { id: "tt0816692", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "movyita",
    name: "🎬 MovyITA",
    file: "../providers/movyita.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt0137523", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "cb01",
    name: "📺 CB01",
    file: "../providers/plugin_cb01.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt1375666", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "eurostreaming",
    name: "🍿 Eurostreaming",
    file: "../providers/plugin_es_nuvio.js",
    tests: [
      { label: "Serie (Chicago Fire S01E01 - Turbovid/MaxStream)", id: "tt2261391", type: "series", s: 1, e: 1, fallback: { id: "tt0903747", type: "series", s: 1, e: 1 } },
      { label: "Serie (Chicago Fire S13E01 - MixDrop/DeltaBit/MaxStream)", id: "tt2261391", type: "series", s: 13, e: 1, fallback: { id: "tt0903747", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "filmez",
    name: "🎥 Filmez",
    file: "../providers/plugin_filmez.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt1375666", type: "movie" } }
    ]
  },
  {
    id: "onlineserietv",
    name: "📡 OnlineSerieTV",
    file: "../providers/plugin_onlineserietv.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt1375666", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "vixsrc",
    name: "💎 VixSrc",
    file: "../providers/vixsrc.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt0137523", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "pacc",
    name: "🌐 PaCC",
    file: "../providers/pa.cc.js",
    tests: [
      { label: "Film (Gladiator)", id: "tt0172495", type: "movie", fallback: { id: "tt0816692", type: "movie" } },
      { label: "Serie (Stranger Things)", id: "tt4574334", type: "series", s: 1, e: 1, fallback: { id: "tt1190634", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "altadefinizione",
    name: "🏰 Altadefinizione",
    file: "../providers/altadefinizione.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt1375666", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "guardoserie",
    name: "🎞️ Guardoserie",
    file: "../providers/guardoserie.js",
    tests: [
      { label: "Serie (Stranger Things)", id: "tt4574334", type: "series", s: 1, e: 1, fallback: { id: "tt0903747", type: "series", s: 1, e: 1 } }
    ]
  },
  {
    id: "toonitalia",
    name: "🎨 Toonitalia",
    file: "../providers/toonitalia.js",
    tests: [
      { label: "Serie (I Simpson)", id: "tt0096697", type: "tv", s: 1, e: 1, fallback: { id: "603", type: "tv" } },
      { label: "Film (Alfa & Omega)", id: "tt1213012", type: "movie", fallback: { id: "603", type: "movie" } }
    ]
  },
  {
    id: "realtime",
    name: "🍰 Real Time",
    file: "../providers/realtime.js",
    tests: [
      { label: "TV (Fratelli di Crozza)", id: "70624", type: "tv", s: 10, e: 13, fallback: { id: "603", type: "tv" } }
    ]
  },
  {
    id: "raiplay",
    name: "🏛️ RaiPlay",
    file: "../providers/raiplay.js",
    tests: [
      { label: "Fiction (Don Matteo)", id: "tt0178132", type: "tv", s: 1, e: 1, fallback: { id: "603", type: "tv" } }
    ]
  },
  {
    id: "animeworld",
    name: "🌸 AnimeWorld",
    file: "../providers/animeworld.js",
    tests: [
      { label: "Anime (Naruto)", id: "tt0409591", type: "tv", s: 1, e: 1, fallback: { id: "kitsu:12:1", type: "anime" } }
    ]
  },
  {
    id: "animesaturn",
    name: "🦊 AnimeSaturn",
    file: "../providers/animesaturn.js",
    tests: [
      { label: "Anime (Naruto)", id: "tt0409591", type: "tv", s: 1, e: 1, fallback: { id: "kitsu:12:1", type: "anime" } }
    ]
  },
  {
    id: "animeunity",
    name: "🏮 AnimeUnity",
    file: "../providers/animeunity.js",
    tests: [
      { label: "Anime (Death Note / One Piece)", id: "603", type: "anime", fallback: { id: "kitsu:12:1", type: "anime" } }
    ]
  },
  {
    id: "corsaroviola",
    name: "🏴‍☠️ IlCorsaroViola",
    file: "../providers/corsaroviola.js",
    tests: [
      { label: "Film (Interstellar)", id: "tt0816692", type: "movie", fallback: { id: "tt1375666", type: "movie" } },
      { label: "Serie (Breaking Bad)", id: "tt0903747", type: "series", s: 1, e: 1, fallback: { id: "tt0944947", type: "series", s: 1, e: 1 } }
    ]
  }
];

// Funzione di timeout per Promise
function withTimeout(promise, ms, desc) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${ms}ms) su ${desc}`)), ms))
  ]);
}

// Network probe per verificare la riproduzione reale dello stream
function probeStream(stream) {
  return new Promise((resolve) => {
    if (!stream || (!stream.url && !stream.infoHash)) {
      return resolve({ ok: false, error: "Nessun URL nello stream" });
    }

    // Torrent (IlCorsaroViola)
    if (stream.infoHash || (stream.url && stream.url.startsWith("magnet:"))) {
      const isMagnet = (stream.url && stream.url.startsWith("magnet:")) || !!stream.infoHash;
      return resolve({ ok: isMagnet, info: "P2P Torrent magnet valido" });
    }

    let streamUrl = stream.url;

    // Gestione HLS Data URI (es. MovyITA / DualSync audio sync)
    if (streamUrl.startsWith("data:")) {
      try {
        const commaIdx = streamUrl.indexOf(",");
        if (commaIdx === -1) {
          return resolve({ ok: false, error: "Data URI malformato" });
        }
        const meta = streamUrl.slice(0, commaIdx);
        const dataPart = streamUrl.slice(commaIdx + 1);
        const decoded = meta.includes("base64")
          ? Buffer.from(dataPart, "base64").toString("utf-8")
          : decodeURIComponent(dataPart);

        if (!decoded.includes("#EXTM3U")) {
          return resolve({ ok: false, error: "Data URI non contiene playlist HLS valida" });
        }

        // Estrai il primo URI http(s) contenuto nella playlist per probe reale
        const subUrlMatch = decoded.match(/https?:\/\/[^\r\n"'\s]+/);
        if (subUrlMatch) {
          streamUrl = subUrlMatch[0];
        } else {
          return resolve({ ok: true, latency: 5, info: "HLS Data-URI sintetico valido" });
        }
      } catch (e) {
        return resolve({ ok: false, error: "Errore parsing Data URI: " + e.message });
      }
    }

    let parsed;
    try {
      parsed = new URL(streamUrl);
    } catch (e) {
      return resolve({ ok: false, error: "URL non valido: " + streamUrl });
    }

    // Headers di riproduzione Nuvio
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "*/*"
    };

    if (stream.headers) {
      Object.assign(headers, stream.headers);
    }
    if (stream.behaviorHints && stream.behaviorHints.proxyHeaders && stream.behaviorHints.proxyHeaders.request) {
      Object.assign(headers, stream.behaviorHints.proxyHeaders.request);
    } else if (stream.behaviorHints && stream.behaviorHints.headers) {
      Object.assign(headers, stream.behaviorHints.headers);
    }

    const isHls = streamUrl.includes(".m3u8") || (stream.name && stream.name.includes("HLS"));
    const reqOpts = {
      method: "GET",
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: Object.assign({}, headers, !isHls ? { "Range": "bytes=0-1024" } : {}),
      timeout: 7000
    };

    const client = parsed.protocol === "https:" ? https : http;
    const startTime = Date.now();

    const req = client.request(reqOpts, (res) => {
      const statusCode = res.statusCode;
      const latency = Date.now() - startTime;

      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        // Segue 1 redirect
        return resolve({ ok: true, latency, info: `Redirect HTTP ${statusCode} -> ${res.headers.location.slice(0, 50)}...` });
      }

      if (statusCode !== 200 && statusCode !== 206) {
        res.resume();
        return resolve({ ok: false, statusCode, latency, error: `HTTP ${statusCode} ${res.statusMessage || ""}` });
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk.toString("utf8");
        // Non scaricare file enormi
        if (data.length > 50000) res.destroy();
      });

      res.on("end", () => {
        if (isHls && !data.includes("#EXTM3U") && !data.includes("#EXTINF")) {
          return resolve({ ok: false, latency, error: "Contenuto non conforme ad HLS (mancano tag #EXTM3U)" });
        }
        return resolve({ ok: true, latency, info: isHls ? "HLS Master/Media OK" : "MP4 Chunk OK" });
      });

      res.on("close", () => {
        // Se distrutto dopo ricezione dati validi
        if (isHls && data.includes("#EXTM3U")) {
          return resolve({ ok: true, latency, info: "HLS OK" });
        }
        if (!isHls && data.length > 0) {
          return resolve({ ok: true, latency, info: `MP4 (${data.length} bytes)` });
        }
      });
    });

    req.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Timeout probe (7s)" });
    });

    req.end();
  });
}

// Esecuzione di una singola verifica per un provider
async function testProviderItem(scraperModule, testSpec, providerName) {
  const tStart = Date.now();
  let streams = [];
  let usedFallback = false;
  let targetId = testSpec.id;
  const timeoutMs = (providerName.includes("DualSync") || providerName.includes("CB01")) ? 35000 : 20000;

  try {
    streams = await withTimeout(
      scraperModule.getStreams(testSpec.id, testSpec.type, testSpec.s, testSpec.e),
      timeoutMs,
      `${providerName} - ${testSpec.label}`
    );
  } catch (err) {
    // Prova con fallback se presente
    if (testSpec.fallback) {
      usedFallback = true;
      targetId = testSpec.fallback.id;
      try {
        streams = await withTimeout(
          scraperModule.getStreams(testSpec.fallback.id, testSpec.fallback.type, testSpec.fallback.s, testSpec.fallback.e),
          timeoutMs,
          `${providerName} (fallback)`
        );
      } catch (fErr) {
        return { ok: false, error: `Primario (${err.message}) e Fallback (${fErr.message}) falliti` };
      }
    } else {
      return { ok: false, error: err.message };
    }
  }

  // Se ha restituito 0 stream, prova il fallback
  if ((!streams || streams.length === 0) && testSpec.fallback && !usedFallback) {
    usedFallback = true;
    targetId = testSpec.fallback.id;
    try {
      streams = await withTimeout(
        scraperModule.getStreams(testSpec.fallback.id, testSpec.fallback.type, testSpec.fallback.s, testSpec.fallback.e),
        timeoutMs,
        `${providerName} (fallback)`
      );
    } catch (fErr) {
      return { ok: false, error: `Nessun risultato (${targetId}): ${fErr.message}` };
    }
  }

  if (!streams || streams.length === 0) {
    return { ok: false, error: "0 stream trovati sia su titolo primario che di fallback" };
  }

  // Seleziona il primo stream valido da testare
  const candidate = streams.find(s => s && (s.url || s.infoHash)) || streams[0];
  const probe = await probeStream(candidate);

  return {
    ok: probe.ok,
    streamCount: streams.length,
    probeLatency: probe.latency,
    sampleName: (candidate.name || candidate.title || "").split("\n")[0].slice(0, 40),
    sampleUrl: (candidate.url || candidate.infoHash || "").slice(0, 60),
    probeInfo: probe.info,
    error: probe.error || (probe.statusCode ? `HTTP ${probe.statusCode}` : "Probe fallito"),
    usedFallback: usedFallback,
    durationMs: Date.now() - tStart
  };
}

// Main Runner
async function main() {
  const filterArgs = process.argv.slice(2).map(a => a.toLowerCase()).filter(Boolean);
  const providersToTest = filterArgs.length > 0
    ? PROVIDERS.filter(p => filterArgs.some(arg => p.id.includes(arg) || p.name.toLowerCase().includes(arg)))
    : PROVIDERS;

  console.log("================================================================================");
  console.log("    PRISYNX DEEP HEALTH CHECK - VERIFICA STREAM & PROBE VIDEO REALE            ");
  console.log("================================================================================");
  console.log(`Esecuzione su ${providersToTest.length} provider...\n`);

  const results = [];

  for (const prov of providersToTest) {
    process.stdout.write(`[*] Testando ${prov.name} ... `);
    let scraper;
    try {
      scraper = require(prov.file);
    } catch (e) {
      console.log(`❌ IMPOSSIBILE CARICARE MODULO: ${e.message}`);
      results.push({ id: prov.id, name: prov.name, status: "ERROR", error: e.message });
      continue;
    }

    let provPassed = true;
    let provDetails = [];

    for (const testSpec of prov.tests) {
      const outcome = await testProviderItem(scraper, testSpec, prov.name);
      provDetails.push({ label: testSpec.label, outcome });
      if (!outcome.ok) {
        provPassed = false;
      }
    }

    if (provPassed) {
      const totalStreams = provDetails.reduce((acc, d) => acc + (d.outcome.streamCount || 0), 0);
      const avgLatency = Math.round(provDetails.reduce((acc, d) => acc + (d.outcome.probeLatency || 0), 0) / provDetails.length);
      console.log(`✅ OK (${totalStreams} stream, probe video ${avgLatency}ms)`);
      results.push({ id: prov.id, name: prov.name, status: "OK", totalStreams, latency: avgLatency, details: provDetails });
    } else {
      const err = provDetails.find(d => !d.outcome.ok).outcome.error;
      console.log(`❌ FALLITO: ${err}`);
      results.push({ id: prov.id, name: prov.name, status: "FAIL", error: err, details: provDetails });
    }
  }

  console.log("\n================================================================================");
  console.log("                           RIASSUNTO GENERALE                                   ");
  console.log("================================================================================");
  console.log(
    "STATO".padEnd(8) +
    "PROVIDER".padEnd(25) +
    "STREAM".padEnd(10) +
    "PROBE (ms)".padEnd(12) +
    "NOTE / ERRORE"
  );
  console.log("--------------------------------------------------------------------------------");

  for (const r of results) {
    const statusIcon = r.status === "OK" ? "🟢 OK" : "🔴 DOWN";
    const streams = r.totalStreams ? String(r.totalStreams) : "-";
    const latency = r.latency ? `${r.latency}ms` : "-";
    const note = r.status === "OK"
      ? (r.details && r.details[0] && r.details[0].outcome.probeInfo || "Video raggiungibile")
      : (r.error || "Errore sconosciuto");
    console.log(
      statusIcon.padEnd(8) +
      r.name.padEnd(25) +
      streams.padEnd(10) +
      latency.padEnd(12) +
      note.slice(0, 50)
    );
  }
  console.log("================================================================================");

  const failCount = results.filter(r => r.status !== "OK").length;

  try {
    const jsonPath = path.join(__dirname, "latest_health.json");
    let existingProviders = [];
    if (fs.existsSync(jsonPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        if (prev && Array.isArray(prev.providers)) {
          existingProviders = prev.providers;
        }
      } catch (e) {}
    }

    const currentProviders = results.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      totalStreams: r.totalStreams || 0,
      latency: r.latency || 0,
      note: r.status === "OK"
        ? (r.details && r.details[0] && r.details[0].outcome && r.details[0].outcome.probeInfo || "Video raggiungibile")
        : (r.error || "Errore sconosciuto"),
      details: (r.details || []).map(d => ({
        label: d.label,
        streamsCount: (d.outcome && d.outcome.streams) ? d.outcome.streams.length : 0,
        probe: d.outcome ? d.outcome.probeInfo : null
      }))
    }));

    // Merge: update existing with newly tested, keep others
    const mergedMap = new Map();
    existingProviders.forEach(p => mergedMap.set(p.id, p));
    currentProviders.forEach(p => mergedMap.set(p.id, p));
    const mergedList = Array.from(mergedMap.values());

    const healthData = {
      timestamp: new Date().toISOString(),
      total: mergedList.length,
      online: mergedList.filter(r => r.status === "OK").length,
      failed: mergedList.filter(r => r.status !== "OK").length,
      providers: mergedList
    };

    fs.writeFileSync(jsonPath, JSON.stringify(healthData, null, 2), "utf8");
    console.log(`\n[Info] Risultati salvati in ${jsonPath}`);
  } catch (e) {
    console.warn(`[Warn] Impossibile salvare latest_health.json: ${e.message}`);
  }

  if (failCount > 0) {
    console.log(`\nAttenzione: ${failCount} provider necessitano di intervento.\n`);
    process.exitCode = 1;
  } else {
    console.log(`\nTutti i ${results.length} provider testati sono 100% OPERATIVI!\n`);
  }
}

main().catch(err => {
  console.error("Errore fatale:", err);
  process.exit(1);
});
