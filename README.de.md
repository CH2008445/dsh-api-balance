# dsh-api-balance

**DeepSeek-API-Guthaben und Kosten des aktuellen Laufs** für die Weboberfläche von [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Eine Zeile im Fuß der Seitenleiste zeigt das Guthaben und was der aktuelle Lauf bisher gekostet hat.

Das Plugin hat ein Ziel: Ausgaben zeigen, **ohne den Zugriffsbereich für den API-Schlüssel zu vergrößern**. Das ganze Plugin besteht aus vier kleinen Dateien, die man in wenigen Minuten lesen kann.

[English](README.md) | [中文](README.zh.md) | [Русский](README.ru.md)

## Warum es das gibt

Ein DSH-Plugin läuft im selben Prozess wie der API-Schlüssel. Zwischen Plugin und Credential-Speicher gibt es keine Zugriffsgrenze, jedes Plugin kann den Schlüssel also im Klartext auflösen. Was ein Bilanz-Plugin sonst noch damit tut, hängt allein am Code dieses Plugins — und nichts prüft das für Sie.

Manche vorhandenen Bilanz-Plugins gehen vermeidbare Risiken ein:

| Riskantes Muster | Warum das zählt |
|---|---|
| Den Schlüssel in eine Shell-Anweisung einsetzen | Der Schlüssel landet in den Argumenten des Kindprozesses und ist für jeden Prozess über die Prozessliste lesbar |
| `curl` starten und die Sandbox dafür abschalten | Ein reiner GET-Aufruf braucht nie `danger-full-access` |
| Den Schlüssel an eine beliebige konfigurierte `baseURL` senden | Ein Tippfehler oder ein bösartiger Mirror führt den Schlüssel ab |
| Ein lokaler HTTP-Endpunkt ohne Herkunftsprüfung | Jeder lokale Prozess und jede Webseite kann Ihre Kontodaten lesen |

Dieses Plugin tut nichts davon, und die Release-Prüfungen stellen sicher, dass es nicht zurückkehrt.

## Was es tut

- Löst `DEEPSEEK_API_KEY` über den Credential-Speicher von DSH auf der Host-Seite auf
- Ruft `GET https://api.deepseek.com/user/balance` mit dem prozessinternen `fetch` auf
- Berechnet die Kosten jedes Modellaufrufs aus dem Usage-Block, den das Harness zu jeder Anfrage liefert, nach den offiziellen Yuan-Preisen mit Haupt- und Nebenzeit-Tarif
- Liefert Guthaben, Token-Summen, Kosten und die Preistabelle und zeichnet eine Zeile in `sidebar.footer.action`

Die Zeile lautet `Balance ¥6.39  ·  Cost ¥0.12`: Guthaben und Kosten seit dem Start dieses Prozesses, jeder Wert beschriftet. Beide sind immer vorhanden — ein unbekannter Wert behält seinen Platzhalter `--`, statt zu verschwinden, damit die Zeile nach dem ersten kostenpflichtigen Aufruf nicht springt.

Beim Überfahren öffnet sich ein Tooltip, der **mit der Preistabelle beginnt**: die Rate jedes Modells je 1 Mio. Token für beide Tarife, mit Markierung des gerade geltenden, gefolgt von Guthaben, Kosten des Laufs und Token-Aufschlüsselung. Die Preise stehen zuerst, damit man die Raten sieht, aus denen die Kosten stammen. Ein Klick aktualisiert.

## Kostenrechnung

Die Kosten stammen aus dem Usage-Block, den das Harness zu jedem Modellaufruf liefert; sie spiegeln also die tatsächlich gestellten Anfragen einschließlich Wiederholungen. Die Summen gelten für den aktuellen Prozesslauf und werden gespeichert, sodass ein Nachladen des Plugins die Zahl behält; ein neuer Start beginnt bei null.

Die Preise stammen von der [offiziellen Preisseite](https://api-docs.deepseek.com/quick_start/pricing), in Yuan je 1 Mio. Token:

| Modell | Tarif | Cache-Treffer | Cache-Fehlschlag | Ausgabe |
|---|---|---|---|---|
| `deepseek-flash` | Nebenzeit | 0.02 | 1 | 4 |
| `deepseek-flash` | Hauptzeit | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | Nebenzeit | 0.15 | 4.5 | 13.5 |
| `deepseek-v4-pro` | Hauptzeit | 0.30 | 9.0 | 27.0 |

Angewandte Regeln:

- **Hauptzeit** ist Pekinger Zeit (UTC+8), Montag bis Freitag, 09:00–12:00 und 14:00–18:00. Alles andere, Wochenenden eingeschlossen, ist Nebenzeit.
- **Cache-Schreibvorgänge werden zum Trefferpreis berechnet**, wie es bei DeepSeek historisch war.
- **Ausgemusterte Namen werden nach dem Modell berechnet, das sie bedient**: `deepseek-v4-flash` und `deepseek-v4-flash-vision-exp` nach `deepseek-flash`.
- **Unbekannte Modelle kosten null**, statt einen Preis zu raten.

Zwei Dinge lassen sich nicht ableiten und kommen daher aus der Konfiguration: der **Kalender der chinesischen Feiertage** (an denen Werktage als Nebenzeit gelten) und eine Preisänderung.

## Sicherheit

| Einschränkung | Umsetzung |
|---|---|
| Der Schlüssel verlässt den Host-Prozess nicht | Gelesen über `ctx.credentials.resolve()`; gelangt nie in eine Antwort, ein Log oder den Browser |
| Der Schlüssel erreicht keine Kommandozeile | Nur prozessinternes `fetch` — kein Kindprozess, keine Shell. Durch eine Release-Prüfung abgesichert |
| Keine Sandbox wird umgangen | Das Plugin liest und ändert keine Sandbox-Richtlinie. Durch eine Release-Prüfung abgesichert |
| Der Schlüssel geht nur an DeepSeek | Der Host des Endpunkts muss `api.deepseek.com` sein, sonst verweigert das Plugin den Versand. Nicht konfigurierbar |
| Der Endpunkt ist nicht site-übergreifend lesbar | Er verlangt den Header `x-dsh-balance: 1` (ein eigener Header erzwingt eine CORS-Vorabanfrage) und prüft `Origin` auf die Loopback-Adresse |
| Fehler verraten nichts | Netz-, Parse- und HTTP-Fehler liefern eine feste Formulierung, nie den zugrunde liegenden Fehler |
| Anfragen werden nicht vervielfacht | Erfolgreiche Guthabenabfragen werden zwischengespeichert; Fehlschläge nie |

Endpunkt und Umgang mit den Credentials sind **Sicherheitsinvarianten und bewusst keine Konfigurationsoptionen**. Einstellbar sind nur die Felder im Abschnitt „Konfiguration".

## Voraussetzungen

- DeepSeek Harness mit Web-Client (Bundle `dsh-web-app` aktiv)
- Ein DeepSeek-API-Schlüssel als Credential `DEEPSEEK_API_KEY` (Einstellungen → Modelle) oder unter diesem Namen exportiert
- Die Provider-Route `deepseek-official`. **Der Bilanz-Endpunkt ist ausschließlich offiziell**: Zeigt Ihre `baseURL` auf ein Gateway oder einen Mirror, verweigert das Plugin den Versand des Schlüssels, statt ihn dort zu offenbaren. Die Kostenrechnung funktioniert weiter, weil sie kein Netz braucht.

## Installation

### Aus einer lokalen Arbeitskopie

```sh
dsh plugin --profile desktop add /path/to/dsh-api-balance
```

Die DSH-CLI verknüpft das Paket mit dem Profil und hängt es an `dsh.profile.bundles` an, weil das Paket `dsh.bundle` deklariert.

Die Installation in ein Profil **verlangt keine Freigabe für Code-Ausführung während der Installation**: Das Paket liefert fertiges `lib/` und deklariert kein `prepare`-Skript, pnpm braucht daher kein `allowBuilds`.

### Manuelle Installation

Ergänzen Sie Abhängigkeit und Bundle-Zeile in `$DSH_HOME/profiles/<profile>/package.json` und führen Sie danach `pnpm install` im Profilverzeichnis aus:

```json
{
  "dependencies": { "dsh-api-balance": "file:/path/to/dsh-api-balance" },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-api-balance"
      ]
    }
  }
}
```

Starten Sie DSH neu. Die Zeile erscheint dann unten in der linken Seitenleiste.

### Wenn das Paket nicht materialisiert wird

`pnpm` kann `Already up to date` melden und trotzdem `node_modules/dsh-api-balance` nicht anlegen, wenn ein veralteter Importer in der Lockdatei die Abhängigkeit als erfüllt ansieht. Prüfen Sie, was tatsächlich angekommen ist:

```sh
ls "$DSH_HOME/profiles/<profile>/node_modules/dsh-api-balance/lib"
```

Fehlt `lib/`, verknüpfen Sie den Profil-Eintrag mit Ihrer Arbeitskopie. Unter Windows:

```bat
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-api-balance" "C:\path\to\dsh-api-balance"
```

Unter macOS oder Linux:

```sh
ln -s /path/to/dsh-api-balance "$HOME/.dsh/profiles/desktop/node_modules/dsh-api-balance"
```

Eine Verknüpfung hat beim Entwickeln einen zweiten Vorteil: Änderungen an der Arbeitskopie wirken ohne Neuinstallation. Die Kehrseite ist, dass `pnpm install` in diesem Profil die Verknüpfung ersetzen kann; legen Sie sie erneut an, wenn das Paket wieder verschwindet.

### Installation prüfen

Öffnen Sie die Browser-Konsole in der Oberfläche und führen Sie aus:

```js
fetch('/api/dsh-api-balance', { headers: { 'x-dsh-balance': '1' } }).then(r => r.json()).then(console.log)
```

Ein Objekt `{ ok: true, currency: "CNY", totalBalance: "...", prices: { ... } }` bedeutet, dass die Host-Hälfte läuft. `404` bedeutet, dass die Loader-Zeile nicht aktiviert wurde; `403`, dass die Anfrage den Endpunkt ohne den nötigen Header oder aus einer anderen Herkunft erreicht hat.

## Fehlersuche

### Die Zeile erscheint, meldet aber `Balance unavailable`

Fahren Sie über die Zeile oder führen Sie das obige Snippet aus, um den Grund zu lesen. `HTTP 404` bedeutet, dass die Host-Hälfte ihre Route nie registriert hat: ein Aktivierungsfehler, kein Schlüsselproblem. Prüfen Sie das Aktivierungsprotokoll.

### Aktivierungsprotokoll

Das Plugin schreibt seine Aktivierungsschritte in `dsh-api-balance/plugin.log` im temporären Verzeichnis des Benutzers (`%TEMP%` unter Windows, `$TMPDIR` sonst). `DSH_BALANCE_DIAG=<dir>` lenkt die Ausgabe um. Eine gesunde Aktivierung hinterlässt vier Zeilen:

```
module evaluated (exports: name=api-balance, apply=function)
apply() entered; config={}
inject callback fired
webServer resolved: function
```

Das Protokoll existiert, weil ein Aktivierungsfehler sonst unsichtbar ist: Das Plugin zeichnet weiterhin seine Zeile, trägt aber nichts bei, und kein Framework-Log hält den Fehler fest.

| Protokollinhalt | Bedeutung |
|---|---|
| Datei fehlt | Der Loader hat das Modul nie importiert: die Bundle-Zeile wurde nicht aufgelöst |
| Nur `module evaluated` | Das Modul wurde geladen, aber das Framework hat es abgelehnt. Prüfen Sie zuerst den `Config`-Export: Cordis verlangt von einem vorhandenen `Config` die Umsetzung von Standard Schema (`Config["~standard"].validate`) und bricht die Aktivierung sonst ab |
| `apply() entered` ohne `inject callback fired` | Eine deklarierte Abhängigkeit wurde nie verfügbar, die Route also nie registriert |
| Alle vier Zeilen | Die Aktivierung ist in Ordnung; die Ursache liegt in der Anfrage oder im Credential |

Das Protokoll enthält nur Dienstnamen, Auflösungsergebnisse und Statuscodes. Der API-Schlüssel steht nie darin.

### Die `Config`-Falle

Das Plugin exportiert `Config` nur, wenn `@deepseek-ai/schemastery` aufgelöst wird **und** sein Ergebnis Standard Schema umsetzt. Ein Schema zu exportieren, das nicht validieren kann, ist schlimmer als keines: Cordis ruft `Config["~standard"].validate(config)` vor `apply` auf, und diese Ausnahme entfernt jeden Beitrag des Plugins, während die Oberfläche intakt bleibt. Ein Plugin, das zeichnet, aber nichts tut, hat fast immer genau diesen Fehler.

## Konfiguration

Optional, in `cordis.yml`/`cordis.patch.yml` des Profils:

```yaml
- id: api-balance
  name: dsh-api-balance
  config:
    cacheMs: 60000
    path: /api/dsh-api-balance
    persistUsage: true
    holidays:
      - '2026-10-01'
      - '2026-10-02'
    prices:
      deepseek-flash:
        cacheHit: 0.02
        cacheMiss: 1
        output: 4
        peak:
          cacheHit: 0.04
          cacheMiss: 2
          output: 8
```

| Feld | Standard | Bedeutung |
|---|---|---|
| `cacheMs` | `60000` | Lebensdauer einer zwischengespeicherten Guthabenabfrage in Millisekunden (0 – 3600000) |
| `path` | `/api/dsh-api-balance` | Genaue HTTP-Route, die die Daten liefert |
| `persistUsage` | `true` | Nutzungssummen speichern, damit ein Nachladen die Kosten des Laufs behält |
| `holidays` | `[]` | Pekinger Feiertage (`YYYY-MM-DD`), die als Nebenzeit berechnet werden |
| `prices` | eingebaut | Preistabelle ersetzen oder erweitern, Yuan je 1 Mio. Token |

Die Nutzungssummen liegen in `$DSH_HOME/storages/api-balance/usage.json`.

## Entwicklung

Es gibt keinen Build-Schritt: Die Dateien unter `lib/` sind die ausgelieferten Artefakte. `lib/client.js` ist ein handgeschriebenes Bundle im Format `window.__ModuleLoader__` von DSH, und `lib/types/index.d.ts` enthält die öffentlichen Typen.

```sh
node scripts/verify.mjs           # Prüfungen ohne Netz und ohne Credentials
BALANCE_TEST_KEY=sk-... node scripts/verify.mjs --live   # plus eine echte Abfrage
```

`scripts/verify.mjs` prüft den Manifest-Vertrag, den Loader-Patch, die Exportfläche des Hosts, die oben genannten Sicherheitsinvarianten, die Preisarithmetik und die Hauptzeitfenster, die Persistenz des Ledgers, das Ablehnungsverhalten der Route, die Stream-Abrechnung, die Preistabelle und den Vertrag des Client-Bundles sowie die Darstellung auf Englisch, Chinesisch, Russisch und Deutsch. Eine DSH-Installation und Netz sind unnötig, solange `--live` fehlt.

**Regel für die Bundle-ID.** Die an `window.__ModuleLoader__.load` übergebene Modul-ID muss dem Paketnamen entsprechen. Eine Abweichung lässt das Browser-Modulsystem die Factory ablehnen und lässt den gesamten Web-Boot-Eintrag mit `duplicate factory registration` scheitern, wodurch die Anwendung nicht mehr startet. `scripts/verify.mjs` sichert das ausdrücklich ab — diese Prüfung muss bleiben.

## Rücknahme

Entfernen Sie `"dsh-api-balance"` aus `dsh.profile.bundles` in der `package.json` des Profils und starten Sie neu. Verweigert die Anwendung den Start, bietet der DSH-Fehlerdialog **Drittanbieter-Plugins deaktivieren und neu starten** an, was diese Wiederherstellung übernimmt.

## Grenzen

- Guthaben nur vom offiziellen Endpunkt; `baseURL` von Gateways und Mirrors werden bewusst abgelehnt
- Die Kosten betreffen den aktuellen Prozesslauf, nicht die Historie früherer Läufe
- Chinesische Feiertage gelten nur als Nebenzeit, wenn sie in `holidays` stehen; der offizielle Kalender ist vorab nicht bekannt
- Die Preise sind eingebaut und müssen bei Preisänderungen von DeepSeek aktualisiert werden
- Es wird nur der erste Eintrag aus `balance_infos` gezeigt
- In der eingeklappten Leiste entfallen die Beschriftungen, es bleiben die Beträge

## Lizenz

[Apache-2.0](LICENSE)
