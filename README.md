# PriSynx (MovyITA & DualSync)

**PriSynx** è una suite di provider per **Nuvio** che combina dinamicamente i migliori flussi video ad altissima definizione (4K / 1080p da Movy, Cinejoy, Vidfast) con la traccia audio in lingua italiana (da vixsrc / StreamingCommunity), assemblando al volo un master stream HLS multi-traccia (`data://application/m3u8/...`).

---

## 🎯 Come Funziona l'Audio Delay Automatico

Spesso i video 4K/FHD originali e le tracce audio italiane provengono da masterizzazioni o release differenti (es. presenza o assenza di loghi iniziali, sigle con durata leggermente diversa, piccoli sfasamenti temporali). Per avere un sincronismo perfetto ("labiale"), è necessario applicare un ritardo audio (offset).

### 📺 La PR NuvioTV ([#3781](https://github.com/NuvioMedia/NuvioTV/pull/3781))
I plugin PriSynx includono già nei metadati dello stream:
```javascript
behaviorHints: {
  audioDelayMs: 1250 // Ritardo in millisecondi (fino a ±60 secondi)
}
```

* **Dove funziona in automatico**: **Esclusivamente su NuvioTV (Android TV / Google TV)** con ExoPlayer o mpv.
* **Quando la PR viene accettata/rilasciata**: NuvioTV legge direttamente `behaviorHints.audioDelayMs` e imposta il ritardo audio **in modo del tutto trasparente e automatico** all'avvio del video. Non serve premere alcun pulsante sul telecomando.

### ✋ In alternativa (Come impostarlo a mano)
Finché la PR non è rilasciata pubblicamente, oppure se si utilizza **Nuvio Mobile** (smartphone o tablet, che non implementa l'auto-delay):
1. Quando selezioni un film o un episodio, il badge dello stream riporta l'offset esatto calcolato (es. `⏱️ +1,25 s` oppure `⏱️ -0,50 s`).
2. Avvia la riproduzione dello stream.
3. Apri le impostazioni audio del lettore (icona altoparlante / impostazioni audio sul player).
4. Imposta manualmente il valore del ritardo audio indicato nel badge (es. `+1.25s` o `1250ms`).

---

## ⚙️ Come Funziona AutoSync (Background Engine & Coda)

Quando un titolo o un episodio non è mai stato misurato in precedenza, entra in gioco il motore di intelligenza audio **AutoSync**.

```mermaid
flowchart TD
    A["Utente clicca su Film/Episodio in Nuvio"] --> B["getStreams() interroga ToastFlix (dual.db)"]
    B -->|Offset Trovato| C["Badge ⏱️ +X s<br/>behaviorHints.audioDelayMs pronto"]
    B -->|Offset Non Trovato| D["Badge ⏳ da misurare<br/>Video subito visibile all'utente"]
    D --> E["reportUnmeasuredToAutoSync()<br/>(Chiamata asincrona in background)"]
    E --> F["AutoSync Queue (SQLite WAL)<br/>Deduplicazione su MediaKey"]
    F --> G{"Posti Worker Liberi?<br/>(Max 2 contemporanei)"}
    G -->|Sì| H["Worker 1 o 2: Download & Cross-Correlazione"]
    G -->|No (2 già attivi)| I["Stato 'queued' in attesa"]
    H --> J["Salvataggio Offset su ToastFlix dual.db"]
    J --> K["Alla successiva riapertura: Offset Sincronizzato!"]
```

### 1. Trigger al Click del Singolo Episodio
* La misurazione **NON parte durante la ricerca** nel catalogo (dove sono note solo locandine e trame da TMDB).
* Parte nel momento esatto in cui l'utente **apre la scheda dell'episodio o del film** per visualizzare la lista degli stream.
* In quel momento il plugin risolve gli URL reali del video e dell'audio e, se l'offset non esiste ancora:
  1. Mostra istantaneamente i link video all'utente (senza farlo attendere).
  2. Spedisce in background una richiesta protetta da firma HMAC al server AutoSync.

### 2. Gestione della Coda & Concorrenza (Max 2 Risoluzioni)
L'analisi spettrale delle forme d'onda audio tramite FFT e cross-correlazione richiede risorse di CPU e banda di rete:
* **Limite rigido di 2 Worker contemporanei**: su AutoSync sono attivi esattamente 2 worker in parallelo.
* **Coda ordinata**: se arrivano più di 2 richieste contemporanee, i job in eccesso vengono mantenuti nello stato `queued` nel database SQLite.
* **Deduplicazione e Priorità**: se più utenti aprono lo stesso episodio, AutoSync **non calcola due volte** lo stesso stream; incrementa invece il contatore delle richieste (`requests`), garantendo che i titoli più visti e richiesti vengano elaborati per primi.
* Appena uno dei 2 worker termina, preleva automaticamente il prossimo job in coda.

---

## 🏷️ Significato dei Badge a Schermo

| Badge | Significato | Cosa fare |
| :--- | :--- | :--- |
| `⏱️ +X,XX s` | **Offset misurato e verificato** | Su NuvioTV si applica da solo. Su Mobile o lettori manuali, imposta il valore indicato. |
| `🔊✅ in sync` | **Perfettamente allineato** | Nessun ritardo necessario (differenza < 100 ms). |
| `⏳ da misurare` | **Primo avvio (Job inviato)** | Puoi guardare il video subito; la misurazione automatica è stata avviata in background per la prossima volta. |
| `⏳ in coda` | **In coda di attesa** | Ci sono già 2 elaborazioni in corso su AutoSync; il titolo verrà calcolato a breve. |
| `⚙️ in calcolo` | **In elaborazione (1-2 min)** | Uno dei 2 worker sta calcolando l'offset in questo istante. Riapri tra poco. |
| `⛔ versioni diverse` | **Tagli o versioni non compatibili** | L'audio e il video provengono da montaggi diversi con scene aggiunte/tagliate. |

---

## 📦 Installazione in Nuvio

Aggiungi il seguente manifest nella sezione **Plugin** di Nuvio:

```text
https://raw.githubusercontent.com/qwertyuiop8899/PriSynx/main/manifest.json
```
