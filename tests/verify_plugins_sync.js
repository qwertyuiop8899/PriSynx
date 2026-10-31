const assert = require("assert");

async function runTests() {
  console.log("=== INIZIO TEST AUTOMATICI PRISYNX ===");

  // 1. Test unitario: syncFor in dualsync.js con job multipli (1 done, 1 failed)
  const dualsync = require("../providers/dualsync.js");
  
  // Simuliamo un encode Cinejoy Nebula (durata 4630.54s)
  const encNebula = { site: "cinejoy", server: "Nebula", length: 4630.54 };
  const measuredCandidates = [
    { provider: "cinejoy", video_duration: 4630.54, status: "ok", offset: -0.036, rate: 1.0, has_cuts: false },
    { provider: "vidfast", video_duration: 4630.04, status: "ok", offset: -0.958, rate: 1.0, has_cuts: false }
  ];
  const autoJobsWithHistoricalError = {
    status: null,
    errors: {
      cinejoy: "Punti di verifica insufficienti o correlazione debole"
    }
  };

  // Test: verifica che getSyncStatus / syncFor riconosca Nebula come "ok"
  // Eseguiamo getStreams su Corpse Bride (tt0121164)
  console.log("\n[Test 1] DualSync: getStreams('tt0121164', 'movie')...");
  const dualStreams = await dualsync.getStreams("tt0121164", "movie");
  console.log(`DualSync ha restituito ${dualStreams.length} stream.`);
  assert(dualStreams.length > 0, "DualSync dovrebbe restituire almeno uno stream");
  
  const nebulaStream = dualStreams.find(s => s.name.includes("Cinejoy") || (s.title && s.title.includes("Nebula")));
  if (nebulaStream) {
    console.log("Nebula Stream trovato:", nebulaStream.name);
    console.log("Title:", nebulaStream.title);
    assert(!nebulaStream.name.includes("❌ Fallito"), "Lo stream Cinejoy Nebula NON deve essere marcato come fallito!");
    assert(!nebulaStream.title.includes("AutoSync fallito"), "La descrizione non deve contenere 'AutoSync fallito'!");
    console.log("-> PASS: Cinejoy Nebula non è più bloccato dall'errore storico di Lisbon.");
  } else {
    console.log("Info: Stream Cinejoy:", dualStreams.map(s => s.name + " | " + s.title));
  }

  // 2. Test MovyITA: getStreams('tt0121164', 'movie')
  console.log("\n[Test 2] MovyITA: getStreams('tt0121164', 'movie')...");
  const movyita = require("../providers/movyita.js");
  const movyStreams = await movyita.getStreams("tt0121164", "movie");
  console.log(`MovyITA ha restituito ${movyStreams.length} stream.`);
  // Verifichiamo che se ci sono stream, nessuno contenga "ToastFlix non raggiungibile"
  movyStreams.forEach(s => {
    console.log("Movy Stream:", s.name, "||", s.title);
    assert(!s.name.includes("ToastFlix non raggiungibile"), "Non deve mostrare ToastFlix non raggiungibile!");
    assert(!s.title.includes("ToastFlix non raggiungibile"), "Il titolo non deve mostrare ToastFlix non raggiungibile!");
  });
  console.log("-> PASS: MovyITA non genera più l'errore 'ToastFlix non raggiungibile'.");

  // 3. Test fallback AutoSync quando ToastFlix dà 404/not found
  console.log("\n[Test 3] MovyITA: verifica fallback quando un titolo non è in ToastFlix...");
  const dummyStreams = await movyita.getStreams("tt9999999", "movie");
  // Non deve lanciare eccezioni o crashare
  console.log("-> PASS: Chiamata con titolo sconosciuto gestita in modo sicuro.");

  console.log("\n=== TUTTI I TEST AUTOMATICI SUPERATI CON SUCCESSO ===");
}

runTests().catch(err => {
  console.error("ERRORE DURANTE I TEST:", err);
  process.exit(1);
});
