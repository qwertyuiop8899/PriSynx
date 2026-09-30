# Modifiche a MovyITA e DualSync per il ritardo audio automatico

Si applicano quando la PR NuvioTV (`behaviorHints.audioDelayMs`) è in una versione rilasciata.
Nuvio Mobile e le NuvioTV vecchie ignorano il campo: per loro resta l'indicazione manuale.

File: `nuvio-movyita/providers/movyita.js`, `nuvio-movyita/providers/dualsync.js`, `nuvio-movyita/manifest.json`.

---

## 1. Spostare il ritardo dentro `behaviorHints` (obbligatorio)

NuvioTV legge solo `behaviorHints.audioDelayMs`; oggi il campo sta al primo livello e viene ignorato.
Segno: positivo = audio in ritardo (già così, confermato dai test su ExoPlayer e mpv).

**movyita.js** (in `getStreams`, oggetto stream) e **dualsync.js** (in `streams.push({...})`), sostituire:
```js
        // Not read by Nuvio yet. audioSync is informational; audioDelayMs (>0 = delay audio) is the proposed auto-sync field.
        audioSync: ita ? sync.info : undefined,
        audioDelayMs: ita ? autoDelayMs(sync.info) : undefined,
```
con:
```js
        audioSync: ita ? sync.info : undefined,
        // NuvioTV adds it to the device audio delay (>0 = audio later); other apps ignore it.
        behaviorHints: ita && autoDelayMs(sync.info) !== undefined ? { audioDelayMs: autoDelayMs(sync.info) } : undefined,
```
(in dualsync.js l'indentazione è di due spazi in più).

Attenzione: in NuvioTV `behaviorHints` di un plugin viene letto solo per `audioDelayMs`; non servono altri campi.

---

## 2. Limite ±3 s non più valido

Il limite del ritardo di NuvioTV è ora ±60 s, e l'auto-applicazione è già limitata a `AUTO_DELAY_MAX_MS = 15000`.
Oggi `classifySync` segna ⛔ "offset oltre il limite di Nuvio ±3 s" tutto ciò che supera 3 s, anche se verrebbe applicato.

In **entrambi** i file:
```js
var NUVIO_MAX_DELAY_MS = 3000;
```
→
```js
// NuvioTV audio delay range (±60 s); above AUTO_DELAY_MAX_MS seeks buffer too long, so those stay red.
var NUVIO_MAX_DELAY_MS = AUTO_DELAY_MAX_MS;
```
(spostare la riga **dopo** la dichiarazione di `AUTO_DELAY_MAX_MS`), e in `classifySync` il testo:
```js
reason: "offset oltre il limite di Nuvio \u00B13 s"
```
→
```js
reason: "offset oltre " + (AUTO_DELAY_MAX_MS / 1000) + " s"
```

---

## 3. Testo del badge giallo

Oggi: `⚠️ Attenzione: audio da impostare a +X s (poi rimetti 0)`.
Con NuvioTV aggiornata il ritardo si applica da solo e non va rimesso a 0 (non viene salvato sul dispositivo).

In `syncBadge` di **entrambi** i file, la riga del caso giallo con `delayMs`:
```js
line: icon + " Attenzione: audio da impostare a " + formatDelay(sync.delayMs) + " (poi rimetti 0)"
```
→
```js
line: icon + " Ritardo audio " + formatDelay(sync.delayMs) + " applicato in automatico (NuvioTV); altrimenti impostalo a mano"
```
Il `tag` breve nel nome (`⚠️ +1,25 s`) può restare; se si vuole, cambiare l'icona gialla da `⚠️` a `⏱️` in `syncBadge`
(`yellow: "\u23F1\uFE0F"`), perché non è più un avviso ma un'informazione.

Il caso giallo senza `delayMs` di DualSync ("Offset non misurato, da provare") resta invariato: lì non c'è `audioDelayMs`.

---

## 4. Versioni

`manifest.json`:
- repo `1.4.4` → `1.4.5`
- `movyita` `1.2.6` → `1.2.7`
- `dualsync` `1.0.2` → `1.0.3`

---

## 5. Verifica

1. Sandbox VPS (vedi `BRAIN_NUVIO.md` §1): `node --check` dei due file, poi
   `FULL=1 MOBILE=0 node harness.js run new/movyita.js 558449 movie` e lo stesso per `dualsync.js`:
   gli stream con offset misurato devono avere `behaviorHints.audioDelayMs` e il nuovo testo; nessun `audioDelayMs` al primo livello.
2. Sulla TV con NuvioTV aggiornata: titolo con offset noto → pannello Audio del player = ritardo del dispositivo + offset del badge;
   poi uno stream senza offset → torna al solo ritardo del dispositivo.
3. Nuvio Mobile: gli stream si vedono e partono come prima (il campo viene ignorato).
