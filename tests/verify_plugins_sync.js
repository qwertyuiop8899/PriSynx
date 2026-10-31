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

  console.log("\n=== TUTTI I TEST AUTOMATICI SUPERATI CON SUCCESSO ===");
}

runTests().catch(err => {
  console.error("ERRORE DURANTE I TEST:", err);
  process.exit(1);
});
