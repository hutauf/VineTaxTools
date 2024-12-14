# VineTaxTools

**VineTaxTools** ist ein nützliches Set von User-Skripten, das Amazon Vine Voices (Produkttester) unterstützt, ihre Steuerberechnungen einfacher durchzuführen. Die Skripte erfassen relevante Informationen zu getesteten Produkten, dokumentieren diese und helfen bei der Schätzung von Steuerwerten.

Inwieweit dieses Tool wirklich hilfreich ist, kann ich nicht beurteilen, da die Entscheidung über die Höhe der fälligen Steuer vom jeweiligen Finanzamt abhängt. Jedoch scheint die Berechnung des Teilwerts etwas zu sein, was viele Finanzämter verlangen.

## Voraussetzungen

- Ein Browser, der User-Skripte unterstützt. Empfohlene Tools:
  - **Violentmonkey** (verfügbar für Chrome, Firefox, Edge, etc.).
  - **Kiwi-Browser** unter Android (unterstützt Chrome-Extensions).

## Installation der Skripte

1. **Violentmonkey** oder einen ähnlichen User-Skript-Manager über den Browser-Extension-Store installieren (einfach nach violentmonkey googln..).
2. Gehe zu diesem Repository und klicke auf das Skript **`main_order_tax_cancellations_eval.user.js`**.
3. Klicke auf **Raw**, um den Skript-Quelltext anzuzeigen.
4. Violentmonkey erkennt das Skript automatisch und bietet die Installation an.
5. Bestätige mit **Installieren**.

## Verfügbare Skripte

### 1. Hauptskript: `main_order_tax_cancellations_eval.user.js`

**Funktionalität:**
- Dieses Skript sammelt Informationen auf folgenden Seiten von [vine.amazon.de](https://vine.amazon.de):
  - **Bestellseite**: Hier werden Produktdaten gesammelt der angezeigten 10 Bestellungen.
  - **Konto-Seite**: Bitte das Jahr, das geladen werden soll, auswählen und auf "Load XLSX Info" klicken. Im Hintergrund wird nun die Steuer-xlsx-Datei von Amazon geladen, ausgewertet und in eine lokale Datenbank auf deinem Computer geschrieben.
- **Auf hutaufs Server übermittelte Informationen:**
  - **ASIN**: Produkt-ID.
  - **ETV**: Geschätzter Steuerwert (Estimated Tax Value) von Amazon.
  - **Name des Produkts**.
- **Keine sensiblen Daten** werden gesendet: Es werden **keine Bestellnummern, Bestellzeitpunkte oder Nutzer-IDs** an den Server übertragen.

**Backend-Verarbeitung:**
- Das Backend führt Teilwertschätzungen durch. Das kann durchaus mehrere Tage dauern.
- Durch Aufrufen der Konto-Seite wird das neueste Update vom Server abgerufen.

**Zusatzfunktionen:**
- Auf der Bestellseite erscheint unten ein Button **"show all data"**, über den alle gesammelten Daten angezeigt werden.
- Ein PDF-Link wird bereitgestellt, der die dokumentierte Teilwertschätzung enthält.

---

### 2. Zusatzskript: `Rezessionsseite_zeigt_ETV.user.js`

**Funktionalität:**
- Dieses Skript zeigt den **ETV-Wert** (Estimated Tax Value) direkt auf der **Rezensionsseite** an.
- Es bietet eine schnelle Übersicht über den Steuerwert, ohne zusätzliche Seiten aufzurufen.

## Haftungsausschluss
Dieses Projekt wird inoffiziell bereitgestellt und steht in keinem Zusammenhang mit Amazon. Die Nutzung der Skripte erfolgt auf eigene Verantwortung.
