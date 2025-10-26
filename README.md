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
6. Durch den im Skript hinterlegten `@updateURL` wird bei neuen Versionen automatisch ein Update angeboten.

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


### Vine Produkt Manager

Wer den Vine Produkt Manager direkt mit den tax tools verbinden möchte, kann das tun, mit hutaufs backend (dann sehe ich alle Daten) oder mit einem eigenen backend.

#### hutauf backend

Kontaktiere mich auf discord und frag nach einem Token.

#### eigenes backend

(Anleitung mit KI erstellt..)

# Vine Backend-Einrichtung

Willkommen! Dies ist die Anleitung zur Einrichtung deines persönlichen Backends für den **Vine Produkt Manager** und das **Tax Summary Tools Userscript**.

Indem du dieses simple Backend auf deinem eigenen, kostenlosen [PythonAnywhere](https://www.pythonanywhere.com/)-Account einrichtest, behältst du die volle Kontrolle über deine Produktdaten. Die Einrichtung dauert nur wenige Minuten.

## Schritt-für-Schritt-Anleitung

Folge diesen Schritten sorgfältig, um alles korrekt zu konfigurieren.

### Teil 1: Das Backend auf PythonAnywhere einrichten

1.  **PythonAnywhere Account erstellen**
    Erstelle einen kostenlosen "Beginner" Account auf [pythonanywhere.com](https://www.pythonanywhere.com/).

2.  **Flask-App anpassen**
    *   Navigiere im Dashboard zum Tab **"Web"**.
    *   Erstelle eine neue WebApp.
    *   Navigiere im Dashboard zum Tab **"Files"**.
    *   Öffne die Datei `flask_app.py`, die bereits für dich angelegt wurde.
    *   Lösche den gesamten vorhandenen Inhalt und ersetze ihn durch den Code aus der `self_hosted_backend.py` dieses Repositories.

3.  **Sicherheitstoken festlegen**
    *   Suche im Code nach den Zeilen, die die `VALID_TOKENS`s definieren (z.B. `VALID_TOKENS = ['DEIN_GEHEIMER_TOKEN']`).
    *   Ersetze die Platzhalter `'DEIN_GEHEIMER_TOKEN'` durch deine eigenen, zufälligen und sicheren Zeichenketten. Diese Token sind wie Passwörter für deine API, also denk dir etwas aus, das schwer zu erraten ist!

4.  **Speichern und Server neustarten**
    *   Klicke auf **"Save"**, um deine Änderungen an der `flask_app.py` zu speichern.
    *   Gehe nun zum **"Web"**-Tab in PythonAnywhere.
    *   Klicke auf den grünen **"Reload ..."**-Button, um deinen Server mit dem neuen Code neu zu starten.

5.  **Server am Leben halten (Wichtig!)**
    Im kostenlosen Tarif von PythonAnywhere wird deine Web-App nach drei Monaten deaktiviert. Um das zu verhindern:
    *   Logge dich einfach alle **2-3 Monate** bei PythonAnywhere ein.
    *   Gehe zum **"Web"**-Tab.
    *   Klicke auf den Button **"Run until 3 months from today"**. Fertig!

### Teil 2: Deine Tools mit dem Backend verbinden

Jetzt, wo dein Backend läuft, müssen wir den Tools noch sagen, wo sie es finden können.

6.  **Vine Produkt Manager konfigurieren**
    *   Öffne die **Einstellungen** im Vine Produkt Manager.
    *   Finde das Feld **"Backend API URL"**.
    *   Ersetze die Standard-URL durch deine eigene. Tausche `hutaufvine` einfach gegen deinen PythonAnywhere-Benutzernamen aus:
        ```
        https://DEIN_BENUTZERNAME.pythonanywhere.com/data_operations
        ```
    *   Gib im Feld darunter deinen **API Token** ein, den du in Schritt 3 festgelegt hast.
    *   Klicke auf **"Speichern"**.

7.  **Tax Summary Userscript im Vine Portal konfigurieren**
    *   Gehe im Amazon Vine Portal auf die Seite **"Konto"**.
    *   Das Userscript sollte dir dort neue Buttons anzeigen.
    *   Klicke auf **"Set backend"** und gib deinen PythonAnywhere-Benutzernamen ein.
    *   Klicke danach auf **"Set token"** und gib denselben API-Token wie zuvor ein.

---

### 🎉 Fertig!

Das war's schon! Deine Tools sind nun mit deinem persönlichen Backend verbunden und synchronisieren deine Daten sicher an einen Ort, den nur du kontrollierst. Viel Erfolg