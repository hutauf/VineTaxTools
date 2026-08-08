# Self-hosted Sync V2

`self_hosted_backend.py` bleibt eine eigenständige Flask-Anwendung. Für ein
Update wird die Datei wie bisher vollständig in die eigene PythonAnywhere-App
kopiert. Zusätzliche Python-Pakete sind für die Synchronisierung nicht nötig.
Ohne Umgebungsvariable bleibt der etablierte, zum Prozess-Arbeitsverzeichnis
relative Ordner `user_databases` erhalten. Ein expliziter absoluter Pfad kann
vor dem Start über `VINE_SYNC_DB_DIR` gesetzt werden. Vor jedem Deployment
muss der tatsächlich aufgelöste Pfad geprüft werden, damit nicht versehentlich
eine leere Datenbank an einem anderen Ort angelegt wird.

## Automatische Migration

Beim ersten Zugriff auf eine bestehende `DATABASE_<token>.sqlite` wird die
Datenbank unter einer `BEGIN IMMEDIATE`-Sperre auf das revisionierte Schema
angehoben. Vorher entstehen einmalig folgende Sicherungen:

- `DATABASE_<token>.sqlite.pre-sync-v2.bak`
- `HISTORY_<token>.sqlite.pre-sync-v2.bak`

Produkte, Lagerorte, Verfahrensdokumente und ihre Historien werden geprüft und
verlustfrei übernommen. ASIN-Schreibweisen werden auf Großbuchstaben
vereinheitlicht. Die bisherige `HISTORY_`-Datei bleibt als Recovery-Kopie
erhalten; neue Historieneinträge liegen atomar mit den Produktdaten in der
`DATABASE_`-Datei. Die initiale Migration bindet beide SQLite-Dateien in eine
Transaktion ein. Vor der ersten V2-Migration müssen alle alten Worker dauerhaft
beendet und durch die neue Version ersetzt werden; sie dürfen danach nicht
wieder gestartet werden. Alte Worker schreiben Hauptdaten und Historie in
getrennten Transaktionen, und ein bereits migrierter Server importiert solche
späteren Direktwrites bewusst nicht erneut. Die Migration muss außerdem ohne
WAL-Modus erfolgen, da SQLite die Crash-Atomizität über angehängte Datenbanken
nur unter diesen Bedingungen garantiert. `delete_all`
leert auch die Recovery-Historie und vorhandene
automatische Migrationssicherungen, damit die Danger Zone wirklich alle
von der Anwendung verwalteten serverseitigen Produktdaten entfernt. Manuell
angelegte Operator-Backups außerhalb dieser Dateinamen bleiben bewusst
unberührt und müssen bei Bedarf separat gelöscht werden.

Vor dem Austausch der Anwendung sollte das komplette Verzeichnis
`user_databases` gesichert werden. Bei einem Migrationsfehler wird die
Transaktion zurückgerollt; die V1-Tabellen bleiben lesbar und ein späterer
Start kann die Migration erneut ausführen.

## Kompatibilität und Protokoll

Die bisherigen V1-Requests und Antworten bleiben erhalten. Dazu gehören
`get_all`, `get_asin`, `update_asin`, alle History-, Lagerort- und
Verfahrensdokument-Operationen sowie `delete_all`.

Neue Clients erkennen V2 mit `get_capabilities_v2` und verwenden anschließend:

- `sync_v2_push` für idempotente Feldmutationen,
- `sync_v2_pull` für revisionierte Änderungen,
- `sync_v2_snapshot` für einen konsistent paginierten Vollstand.

Der Server führt verschiedene Felder desselben Datensatzes automatisch
zusammen. Änderungen desselben Felds nach der Basisrevision werden als
Konflikt zurückgegeben. Eine `mutation_id` kann sicher wiederholt, aber niemals
für andere Inhalte wiederverwendet werden. Token, ASINs und Produktobjekte
werden nicht protokolliert.

## Lokale Prüfung

Aus dem Repository-Stamm:

```powershell
python -m py_compile self_hosted_backend.py
python -m unittest discover -s test -p "test_self_hosted_backend.py" -v
```

Die Tests decken V1-Verträge, Legacy-Migration und Rollback, V2-Push/Pull,
Snapshots, Hashing, Idempotenz, Konflikte, Tombstones und Generation-Reset ab.

## Änderungen aus dem führenden Backend übertragen

`pythonanywhere/hutaufvine.py` ist weiterhin die fachlich führende
Implementierung. Beide Dateien markieren den synchronisationsrelevanten Bereich
mit `VINE SYNC CORE BEGIN` und `VINE SYNC CORE END`. Die Blöcke werden bewusst
nicht importiert oder blind kopiert: Pfadmodell, Legacy-Tabellen, Demo-Token und
Migrationsadapter unterscheiden sich. Bei einer Übertragung muss stattdessen
folgende Verhaltens-Checkliste abgearbeitet werden:

1. Protokoll- und Canonicalization-Version sowie Push-/Pull-/Snapshot-Limits
   vergleichen.
2. Requestvalidierung und sämtliche Response-Felder der vier V2-Requests
   abgleichen; die bestehenden V1-Golden-Tests dürfen sich nicht ändern.
3. JCS-Zahlendarstellung, UTF-16-Sortierung und den festen SHA-256-Testvektor
   unverändert übernehmen.
4. Revisionen, Feldkonflikte, Mutation-Quittungen, Tombstones, Retention,
   Generation-Reset und Snapshot-Sessions auf beiden Seiten testen.
5. Host-spezifische Migration und `delete_all` separat prüfen; keine
   Datenbanknamen, Tokens oder Produktinhalte protokollieren.
6. Abschließend beide Testsuiten ausführen:

   ```powershell
   python -m unittest discover -s ..\pythonanywhere\tests -p "test_hutaufvine_api.py" -v
   python -m unittest discover -s test -p "test_self_hosted_backend.py" -v
   ```

Die gemeinsame Core-Version darf erst erhöht werden, wenn beide Suiten denselben
Wire-Vertrag und denselben Hashvektor bestätigen.

## Produktions-Gate

Die automatisierten Tests verwenden absichtlich synthetische, isolierte
Legacy-Datenbanken. Vor einem echten Deployment muss zusätzlich eine Kopie
der produktiven `DATABASE_`-/`HISTORY_`-Dateien in ein temporäres Verzeichnis
gelegt und die Anwendung mit `VINE_SYNC_DB_DIR` dagegen gestartet werden. Erst
nach Vergleich von V1-Export, Datensatzanzahl, History und `PRAGMA
integrity_check` darf die produktive Datei migriert werden. Für die echte
Migration werden alle alten App-Worker/Writer dauerhaft beendet und ersetzt;
der Journal-Modus beider Dateien wird kontrolliert und WAL vorher sauber
beendet beziehungsweise in den Standardmodus zurückgeführt. Niemals Tests
direkt gegen die einzige
produktive Datenbank ausführen.
