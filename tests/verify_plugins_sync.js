const assert = require("assert");

async function runTests() {
  console.log("=== INIZIO TEST AUTOMATICI PRISYNX ===");

  const dualsync = require("../providers/dualsync.js");
  
  // 1. Test unitario: deduplicazione provider e scoping errore per durata (Nightmare Before Christmas)
  console.log("\n[Test 1] DualSync: Unit test scoping errore e deduplicazione per durata...");
  const measuredCandidates = [
    { provider: "vidfast", resolution: 2160, status: "ok", offset: 0.063, rate: 1.0, has_cuts: false, video_duration: 4596.63 }
  ];
  const autoJobs = {
    status: "ok",
    measured: [
      { provider: "cinejoy", resolution: 1080, status: "ok", offset: -0.014, rate: 1.0, has_cuts: false, video_duration: 4596.63 }
    ],
    failedJobs: [
      { provider: "cinejoy", video_duration: 4598.88, error: "server offline (502 Bad Gateway)" }
    ],
    errors: { cinejoy: "server offline (502 Bad Gateway)" }
  };

  // Simula la deduplicazione con la nuova logica
  const mergedMeasured = [...measuredCandidates];
  autoJobs.measured.forEach(am => {
    const exists = mergedMeasured.some(m => {
      const providerMatch = !m.provider || !am.provider || (m.provider || "").toLowerCase() === (am.provider || "").toLowerCase();
      return providerMatch && Math.abs(Number(m.video_duration) - am.video_duration) <= 0.25;
    });
    if (!exists) mergedMeasured.push(am);
  });

  assert.strictEqual(mergedMeasured.length, 2, "Cinejoy 1080p non deve essere scartato se Vidfast ha la stessa durata!");
  
  // Test syncFor per Cinejoy 1080p (4596.63s)
  const enc1080 = { site: "cinejoy", server: "Nebula", length: 4596.63 };
  const res1080 = dualsync.syncFor(enc1080, mergedMeasured, 4596.66, autoJobs);
  console.log("Res 1080p Cinejoy:", res1080.level, res1080.tag);
  assert.strictEqual(res1080.level, "green", "Cinejoy 1080p deve essere verde (in sync)!");
  assert.strictEqual(res1080.tag, "in sync", "Cinejoy 1080p deve avere tag 'in sync'");

  // Test syncFor per Cinejoy 4K (4598.88s)
  const enc4K = { site: "cinejoy", server: "Secret", length: 4598.88 };
  const res4K = dualsync.syncFor(enc4K, mergedMeasured, 4596.66, autoJobs);
  console.log("Res 4K Cinejoy:", res4K.level, res4K.tag, res4K.error);
  assert.strictEqual(res4K.level, "red", "Cinejoy 4K deve essere rosso (fallito)");
  assert.strictEqual(res4K.error, "server offline (502 Bad Gateway)");
  console.log("-> PASS: Scoping dell'errore e deduplicazione funzionano perfettamente.");

  // 2. Test getStreams su Corpse Bride (tt0121164)
  console.log("\n[Test 2] DualSync: getStreams('tt0121164', 'movie')...");
  const dualStreams = await dualsync.getStreams("tt0121164", "movie");
  console.log(`DualSync ha restituito ${dualStreams.length} stream.`);
  assert(dualStreams.length > 0, "DualSync dovrebbe restituire almeno uno stream");
  
  const nebulaStream = dualStreams.find(s => s.name.includes("Cinejoy") || (s.title && s.title.includes("Nebula")));
  if (nebulaStream) {
    console.log("Nebula Stream trovato:", nebulaStream.name);
    assert(!nebulaStream.name.includes("❌ Fallito"), "Lo stream Cinejoy Nebula NON deve essere marcato come fallito!");
    assert(!nebulaStream.title.includes("AutoSync fallito"), "La descrizione non deve contenere 'AutoSync fallito'!");
    console.log("-> PASS: Cinejoy Nebula non è bloccato da errori storici.");
  }

  // 3. Test MovyITA: getStreams('tt0121164', 'movie')
  console.log("\n[Test 3] MovyITA: getStreams('tt0121164', 'movie')...");
  const movyita = require("../providers/movyita.js");
  const movyStreams = await movyita.getStreams("tt0121164", "movie");
  console.log(`MovyITA ha restituito ${movyStreams.length} stream.`);
  movyStreams.forEach(s => {
    assert(!s.name.includes("ToastFlix non raggiungibile"), "Non deve mostrare ToastFlix non raggiungibile!");
    assert(!s.title.includes("ToastFlix non raggiungibile"), "Il titolo non deve mostrare ToastFlix non raggiungibile!");
  });
  console.log("-> PASS: MovyITA non genera l'errore 'ToastFlix non raggiungibile'.");

  // 4. Test unitario con mock di global.fetch: mappatura episodi Lupin (tt2531336 / 96677)
  console.log("\n[Test 4] Unit test Lupin VixSrc episode mapping (vixsrc, movyita, dualsync)...");
  const vixsrc = require("../providers/vixsrc.js");

  // Verifica diretta helper mapVixSrcEpisode
  const helperCases = [
    { tmdb: "96677", imdb: "", s: 1, e: 5, expS: 1, expE: 5 },
    { tmdb: "tmdb:96677", imdb: "", s: 1, e: 6, expS: 2, expE: 1 },
    { tmdb: "", imdb: "tt2531336", s: 1, e: 10, expS: 2, expE: 5 },
    { tmdb: "96677", imdb: "tt2531336", s: 2, e: 1, expS: 3, expE: 1 },
    { tmdb: "96677", imdb: "tt2531336", s: 2, e: 7, expS: 3, expE: 7 },
    { tmdb: "", imdb: "tt2531336", s: 3, e: 1, expS: 4, expE: 1 },
    { tmdb: "96677", imdb: "", s: 3, e: 8, expS: 4, expE: 8 },
    { tmdb: "96677", imdb: "tt2531336", s: 4, e: 1, expS: 4, expE: 1 },
    { tmdb: "1396", imdb: "tt0903747", s: 1, e: 6, expS: 1, expE: 6 }
  ];
  helperCases.forEach(tc => {
    const mapped = vixsrc.mapVixSrcEpisode(tc.tmdb, tc.imdb, tc.s, tc.e);
    assert.deepStrictEqual(mapped, { season: tc.expS, episode: tc.expE },
      `mapVixSrcEpisode(${tc.tmdb}, ${tc.imdb}, ${tc.s}, ${tc.e}) atteso ${tc.expS}x${tc.expE}, ottenuto ${mapped.season}x${mapped.episode}`);
  });

  function encryptMovyPayloadForTest(jsonObj, seed, mediaId) {
    const uHash = e => {
      e >>>= 0;
      e ^= e >>> 16;
      e = Math.imul(e, 0x85ebca6b) >>> 0;
      e ^= e >>> 13;
      e = Math.imul(e, 0xc2b2ae35) >>> 0;
      return (e ^= e >>> 16) >>> 0;
    };
    const rotl = (e, t) => {
      e >>>= 0;
      t &= 31;
      return t === 0 ? e >>> 0 : ((e << t) | (e >>> (32 - t))) >>> 0;
    };
    const s = new Array(61);
    let h = 0x811c9dc5;
    for (let a = 0; a < seed.length; a++) h = Math.imul(h ^ seed.charCodeAt(a), 0x1000193) >>> 0;
    let idxAcc = uHash(uHash(h) ^ uHash((mediaId >>> 0) ^ 0x9e3779b9)) >>> 0;
    for (let e = 0; e < 8; e++) {
      const t = idxAcc % 61;
      idxAcc = rotl((idxAcc + 0x9e3779b9) >>> 0, 7 + (7 & e));
      s[t] = (idxAcc ^ uHash(idxAcc)) >>> 0;
      idxAcc = uHash((idxAcc + t) >>> 0);
    }
    const state = { S: s, acc: uHash(0xa5a5a5a5 ^ idxAcc) >>> 0 };
    const plain = Buffer.concat([Buffer.from("mvm1", "ascii"), Buffer.from(JSON.stringify(jsonObj), "utf8")]);
    const out = Buffer.alloc(plain.length);
    for (let i = 0, r = 0; i < plain.length; r++) {
      const idx = state.acc % 61;
      const inBounds = idx in state.S ? -1 : 0;
      const sv = ((state.S[idx] >>> 0) ^ (Math.imul(0x9e3779b9, r + 1) >>> 0)) >>> 0;
      let c = (((state.acc ^ sv) >>> 0) | ((state.acc & sv & inBounds) >>> 0)) >>> 0;
      c = (rotl((c + state.acc) >>> 0, 31 & idx) ^ rotl(state.acc, 31 & Math.imul(idx, 7))) >>> 0;
      state.acc = uHash((c + 0x9e3779b9) >>> 0);
      state.S[idx] = state.acc >>> 0;
      const w = state.acc >>> 0;
      for (let b = 0; b < 4 && i < plain.length; b++, i++) {
        out[i] = plain[i] ^ ((w >>> (8 * b)) & 255);
      }
    }
    return out.toString("base64");
  }

  function makeMockResponse(body, status = 200) {
    const textVal = typeof body === "string" ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      url: "",
      text: async () => textVal,
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
      arrayBuffer: async () => Buffer.from(textVal)
    };
  }

  const lupinCases = [
    { s: 1, e: 5, vixS: 1, vixE: 5, tag: "S01E05" },
    { s: 1, e: 6, vixS: 2, vixE: 1, tag: "S01E06" },
    { s: 1, e: 10, vixS: 2, vixE: 5, tag: "S01E10" },
    { s: 2, e: 1, vixS: 3, vixE: 1, tag: "S02E01" },
    { s: 2, e: 7, vixS: 3, vixE: 7, tag: "S02E07" },
    { s: 3, e: 1, vixS: 4, vixE: 1, tag: "S03E01" },
    { s: 3, e: 8, vixS: 4, vixE: 8, tag: "S03E08" }
  ];

  const originalFetch = global.fetch;
  const recordedCalls = [];
  let mockCandidatesItems = [];

  try {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      recordedCalls.push({ url: u, method: (options && options.method) || "GET", body: options && options.body });

      // TMDB mock (Lupin + non-Lupin Breaking Bad)
      if (u.startsWith("https://api.themoviedb.org/3/find/tt2531336")) {
        return makeMockResponse({ tv_results: [{ id: 96677, name: "Lupin", first_air_date: "2021-01-08" }] });
      }
      if (u.startsWith("https://api.themoviedb.org/3/find/tt0903747")) {
        return makeMockResponse({ tv_results: [{ id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20" }] });
      }
      if (u.startsWith("https://api.themoviedb.org/3/tv/96677")) {
        return makeMockResponse({
          id: 96677,
          name: "Lupin",
          first_air_date: "2021-01-08",
          episode_run_time: [45],
          external_ids: { imdb_id: "tt2531336" }
        });
      }
      if (u.startsWith("https://api.themoviedb.org/3/tv/1396")) {
        return makeMockResponse({
          id: 1396,
          name: "Breaking Bad",
          first_air_date: "2008-01-20",
          episode_run_time: [47],
          external_ids: { imdb_id: "tt0903747" }
        });
      }

      // VixSrc API + embed + master playlist + audio track
      if (/^https:\/\/vixsrc\.to\/api\/tv\//.test(u)) {
        return makeMockResponse({ src: "/embed/96677" });
      }
      if (u.startsWith("https://vixsrc.to/embed/")) {
        return makeMockResponse(
          "<script>window.canPlayFHD = true; window.masterPlaylist = { url: 'https://vixsrc.to/playlist/96677', params: { 'token': 'tok123', 'expires': '1999999999' } };</script>"
        );
      }
      if (u.startsWith("https://vixsrc.to/playlist/")) {
        return makeMockResponse(
          "#EXTM3U\n" +
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Italiano",LANGUAGE="ita",URI="https://vixsrc.to/audio/ita.m3u8"\n' +
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="eng",URI="https://vixsrc.to/audio/eng.m3u8"\n' +
          '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Italiano",LANGUAGE="ita",URI="https://vixsrc.to/sub/ita.vtt"\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"\n' +
          "https://vixsrc.to/video/1080.m3u8\n"
        );
      }
      if (u === "https://vixsrc.to/audio/ita.m3u8") {
        return makeMockResponse("#EXTM3U\n#EXTINF:1200.0,\nseg0.ts\n");
      }

      // Movy mock
      if (u.startsWith("https://api.wecollege.net/seed")) {
        return makeMockResponse({ seed: "testseed" });
      }
      if (u.startsWith("https://api.wecollege.net/miami/sources")) {
        const enc = encryptMovyPayloadForTest({
          sources: [
            { quality: "4K", url: "https://movy.example/2160.m3u8" },
            { quality: "1080p", url: "https://movy.example/1080.m3u8" }
          ],
          subtitles: []
        }, "testseed", 96677);
        return makeMockResponse(enc);
      }
      if (u.startsWith("https://movy.example/")) {
        return makeMockResponse("#EXTM3U\n#EXTINF:10.0,\nseg0.ts\n");
      }

      // ToastFlix & AutoSync mocks
      if (u.startsWith("https://toastflix.stremio-italia.eu/dual/offset/status")) {
        return makeMockResponse({ found: false });
      }
      if (u.startsWith("https://toastflix.stremio-italia.eu/dual/offset/candidates")) {
        return makeMockResponse({ items: mockCandidatesItems });
      }
      if (u.startsWith("https://autosync.stremio-italia.eu/plugin/jobs/status")) {
        return makeMockResponse({ items: [] });
      }
      if (u === "https://autosync.stremio-italia.eu/plugin/jobs") {
        return makeMockResponse({ ok: true });
      }

      // DualSync Cinejoy & Vidfast mocks
      if (u === "https://api.wing.st/servers") {
        return makeMockResponse({ servers: [{ name: "Alpha", status: "ok", "4k": false }] });
      }
      if (u.startsWith("https://enc-dec.app/api/enc-cinejoy")) {
        return makeMockResponse({ status: 200, result: { data: "AAAA", state: "st" } });
      }
      if (u === "https://api.wing.st/g") {
        return makeMockResponse("ok");
      }
      if (u === "https://enc-dec.app/api/dec-cinejoy") {
        return makeMockResponse({ status: 200, result: { data: { stream: [{ playlist: "https://cinejoy.example/master.m3u8" }] } } });
      }
      if (u === "https://cinejoy.example/master.m3u8") {
        return makeMockResponse(
          "#EXTM3U\n" +
          "#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\n" +
          "https://cinejoy.example/1080.m3u8\n"
        );
      }
      if (u === "https://cinejoy.example/1080.m3u8") {
        return makeMockResponse("#EXTM3U\n#EXTINF:1200.0,\nseg0.ts\n");
      }
      if (/^https:\/\/(vidfast\.vc|vidcore\.io|vidup\.to)\//.test(u)) {
        return makeMockResponse("Not found", 404);
      }

      throw new Error("Unexpected fetch URL in Test 4 mock: " + u);
    };

    for (const inputId of ["tt2531336", "96677"]) {
      for (const tc of lupinCases) {
        // vixsrc.js
        recordedCalls.length = 0;
        const vixStreams = await vixsrc.getStreams(inputId, "tv", tc.s, tc.e);
        assert(vixStreams.length > 0, `vixsrc(${inputId}, ${tc.s}, ${tc.e}) deve restituire stream`);
        const vixApiCalls = recordedCalls.filter(c => c.url.includes("/api/tv/"));
        assert(vixApiCalls.length > 0, "vixsrc deve chiamare /api/tv/");
        assert(
          vixApiCalls.some(c => c.url.includes(`/api/tv/${inputId}/${tc.vixS}/${tc.vixE}`)),
          `vixsrc(${inputId}, ${tc.s}, ${tc.e}) atteso /api/tv/${inputId}/${tc.vixS}/${tc.vixE}, ottenuto ${vixApiCalls.map(c => c.url).join(", ")}`
        );
        assert(
          vixStreams[0].title.includes(`Lupin ${tc.tag}`),
          `vixsrc heading deve mantenere canonico ${tc.tag}, ottenuto: ${vixStreams[0].title.split("\n")[0]}`
        );

        // movyita.js
        recordedCalls.length = 0;
        const movyLupinStreams = await movyita.getStreams(inputId, "tv", tc.s, tc.e);
        assert(movyLupinStreams.length > 0, `movyita(${inputId}, ${tc.s}, ${tc.e}) deve restituire stream`);
        const movyVixCalls = recordedCalls.filter(c => c.url.includes("/api/tv/"));
        assert(
          movyVixCalls.some(c => c.url.includes(`/api/tv/96677/${tc.vixS}/${tc.vixE}`)),
          `movyita(${inputId}, ${tc.s}, ${tc.e}) atteso /api/tv/96677/${tc.vixS}/${tc.vixE}, ottenuto ${movyVixCalls.map(c => c.url).join(", ")}`
        );
        const movyToastCall = recordedCalls.find(c => c.url.includes("/dual/offset/status"));
        assert(movyToastCall && movyToastCall.url.includes(`season=${tc.s}&episode=${tc.e}`),
          `movyita ToastFlix deve mantenere season=${tc.s}&episode=${tc.e}: ${movyToastCall && movyToastCall.url}`);
        const expectedMediaKey = `series:tt2531336:${tc.s}:${tc.e}`;
        const movyStatusCall = recordedCalls.find(c => c.url.includes("/plugin/jobs/status"));
        assert(movyStatusCall && decodeURIComponent(movyStatusCall.url).includes(`media_key=${expectedMediaKey}`),
          `movyita AutoSync status media_key deve restare ${expectedMediaKey}: ${movyStatusCall && movyStatusCall.url}`);
        const movyPostCall = recordedCalls.find(c => c.url === "https://autosync.stremio-italia.eu/plugin/jobs" && c.method === "POST");
        assert(movyPostCall && JSON.parse(movyPostCall.body).media_key === expectedMediaKey,
          `movyita AutoSync POST media_key deve restare ${expectedMediaKey}`);
        assert(
          movyLupinStreams[0].title.includes(`Lupin ${tc.tag}`),
          `movyita heading deve mantenere canonico ${tc.tag}, ottenuto: ${movyLupinStreams[0].title.split("\n")[0]}`
        );

        // dualsync.js
        recordedCalls.length = 0;
        const dualLupinStreams = await dualsync.getStreams(inputId, "tv", tc.s, tc.e);
        assert(dualLupinStreams.length > 0, `dualsync(${inputId}, ${tc.s}, ${tc.e}) deve restituire stream`);
        const dualVixCalls = recordedCalls.filter(c => c.url.includes("/api/tv/"));
        assert(
          dualVixCalls.some(c => c.url.includes(`/api/tv/96677/${tc.vixS}/${tc.vixE}`)),
          `dualsync(${inputId}, ${tc.s}, ${tc.e}) atteso /api/tv/96677/${tc.vixS}/${tc.vixE}, ottenuto ${dualVixCalls.map(c => c.url).join(", ")}`
        );
        const dualToastCall = recordedCalls.find(c => c.url.includes("/dual/offset/candidates"));
        assert(dualToastCall && dualToastCall.url.includes(`season=${tc.s}&episode=${tc.e}`),
          `dualsync ToastFlix deve mantenere season=${tc.s}&episode=${tc.e}: ${dualToastCall && dualToastCall.url}`);
        const dualStatusCall = recordedCalls.find(c => c.url.includes("/plugin/jobs/status"));
        assert(dualStatusCall && decodeURIComponent(dualStatusCall.url).includes(`media_key=${expectedMediaKey}`),
          `dualsync AutoSync status media_key deve restare ${expectedMediaKey}: ${dualStatusCall && dualStatusCall.url}`);
        const dualPostCall = recordedCalls.find(c => c.url === "https://autosync.stremio-italia.eu/plugin/jobs" && c.method === "POST");
        assert(dualPostCall && JSON.parse(dualPostCall.body).media_key === expectedMediaKey,
          `dualsync AutoSync POST media_key deve restare ${expectedMediaKey}`);
        assert(
          dualLupinStreams[0].title.includes(`Lupin ${tc.tag}`),
          `dualsync heading deve mantenere canonico ${tc.tag}, ottenuto: ${dualLupinStreams[0].title.split("\n")[0]}`
        );
      }
    }

    // Verifica che una serie diversa da Lupin non venga rimappata
    recordedCalls.length = 0;
    const otherStreams = await vixsrc.getStreams("1396", "tv", 1, 6);
    assert(otherStreams.length > 0, "Serie non-Lupin deve restituire stream");
    assert(
      recordedCalls.some(c => c.url.includes("/api/tv/1396/1/6")),
      "Serie non-Lupin S01E06 non deve essere rimappata su VixSrc"
    );
    console.log("-> PASS: Mappatura episodi Lupin verificata su vixsrc, movyita e dualsync.");

    // [Test 5] Regressione: Cinejoy 1200s NON deve essere bloccato da misura Movy 1200s su ToastFlix
    console.log("\n[Test 5] DualSync: Scoping provider su unmeasuredEncodes e unmatched...");
    mockCandidatesItems = [
      { provider: "movy", resolution: 1080, status: "ok", offset: -0.034, rate: 1.0, has_cuts: false, video_duration: 1200.0 }
    ];
    recordedCalls.length = 0;
    const cinejoyStreams = await dualsync.getStreams("tt0903747", "tv", 1, 6);
    assert(cinejoyStreams.length > 0, "DualSync deve restituire lo stream Cinejoy");
    const postJob = recordedCalls.find(c => c.url === "https://autosync.stremio-italia.eu/plugin/jobs" && c.method === "POST");
    assert(postJob, "Cinejoy non misurato deve inviare POST /plugin/jobs anche se Movy ha la stessa durata!");
    const postBody = JSON.parse(postJob.body);
    assert.strictEqual(postBody.items[0].provider, "cinejoy", "Il job accodato deve avere provider cinejoy");
    assert(recordedCalls.some(c => c.url === "https://vixsrc.to/audio/ita.m3u8"), "unmatched deve scaricare la durata ITA per encode Cinejoy non misurato");
    console.log("-> PASS: Cinejoy accodato correttamente ad AutoSync nonostante misura Movy di pari durata.");
  } finally {
    global.fetch = originalFetch;
  }

  console.log("\n=== TUTTI I TEST AUTOMATICI SUPERATI CON SUCCESSO ===");
}

runTests().catch(err => {
  console.error("ERRORE DURANTE I TEST:", err);
  process.exit(1);
});
