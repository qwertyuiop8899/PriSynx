// Test-only scraper: fixed streams with behaviorHints.audioDelayMs, to check the NuvioTV stream-audio-delay build.
// Offsets are seconds, not fractions: only then is "audio late" vs "audio early" obvious by eye and ear.
var TEARS = "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8";
var BUNNY = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

function testStream(label, url, delayMs) {
  var hint = delayMs == null ? "nessun audioDelayMs" : "audioDelayMs = " + (delayMs > 0 ? "+" : "") + delayMs + " ms";
  var stream = {
    name: "\uD83E\uDDEA Test ritardo " + label,
    title: "Test ritardo " + label,
    url: url,
    quality: "1080p",
    type: "hls",
    size: "\uD83D\uDD0A " + hint + "\n\uD83D\uDC49 Apri Audio nel player: il ritardo mostrato deve essere questo + quello del dispositivo"
  };
  if (delayMs != null) stream.behaviorHints = { audioDelayMs: delayMs };
  return stream;
}

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.resolve([
    testStream("Tears of Steel 0 (controllo)", TEARS, null),
    testStream("Tears of Steel +2 s", TEARS, 2000),
    testStream("Tears of Steel -2 s", TEARS, -2000),
    testStream("Big Buck Bunny 0 (controllo)", BUNNY, null),
    testStream("Big Buck Bunny +5 s", BUNNY, 5000),
    testStream("Big Buck Bunny -5 s", BUNNY, -5000)
  ]);
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
