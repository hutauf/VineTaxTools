"""Contract and sync tests for the standalone self-hosted Flask backend."""

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import self_hosted_backend as backend


TOKEN = "mydummytoken1"


class SelfHostedBackendTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_dir = backend.DB_DIR
        backend.DB_DIR = self.temp_dir.name
        backend.app.config.update(TESTING=True)
        self.client = backend.app.test_client()

    def tearDown(self):
        backend.DB_DIR = self.original_db_dir
        self.temp_dir.cleanup()

    def post(self, request_name, payload=...):
        body = {"token": TOKEN, "request": request_name}
        if payload is not ...:
            body["payload"] = payload
        return self.client.post("/data_operations", json=body)

    def capabilities(self):
        response = self.post("get_capabilities_v2")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def v1_product(self, asin="B000000001", timestamp=10, **data):
        value = {"ASIN": asin, "name": "Initial", **data}
        return {
            "ASIN": asin,
            "timestamp": timestamp,
            "value": json.dumps(value),
        }

    def push(self, generation, mutations, client_id="test-client"):
        return self.post("sync_v2_push", {
            "generation_id": generation,
            "client_id": client_id,
            "mutations": mutations,
        })

    def mutation(self, mutation_id, entity_id="B000000001", base=0,
                 set_values=None, unset=None, operation="patch", **extra):
        return {
            "mutation_id": mutation_id,
            "entity_type": "product",
            "entity_id": entity_id,
            "base_revision": base,
            "operation": operation,
            "set": {} if set_values is None else set_values,
            "unset": [] if unset is None else unset,
            **extra,
        }

    # --- V1 golden contract -------------------------------------------------

    def test_v1_product_replace_merge_stale_and_history(self):
        inserted = self.post("update_asin", [
            self.v1_product(timestamp=10, etv=4.5, obsolete=True)
        ])
        self.assertEqual(inserted.status_code, 200)
        self.assertEqual(inserted.get_json(), {
            "status": "success",
            "message": "Update operation complete.",
            "inserted": 1,
            "updated": 0,
            "skipped": 0,
        })

        merged = self.post("update_asin", [{
            "ASIN": "b000000001",
            "timestamp": 0,
            "value": json.dumps({"etv": 5, "nullable": None}),
        }])
        self.assertEqual(merged.get_json()["updated"], 1)

        stale = self.post("update_asin", [{
            "ASIN": "B000000001",
            "timestamp": 9,
            "value": json.dumps({"name": "Must not win"}),
        }])
        self.assertEqual(stale.get_json()["skipped"], 1)

        replacement = self.post("update_asin", [{
            "ASIN": "B000000001",
            "timestamp": 11,
            "value": json.dumps({"ASIN": "B000000001", "name": "Replacement"}),
        }])
        self.assertEqual(replacement.get_json()["updated"], 1)

        fetched = self.post("get_asin", ["b000000001"]).get_json()["data"]
        self.assertEqual(len(fetched), 1)
        self.assertEqual(fetched[0]["ASIN"], "B000000001")
        self.assertEqual(fetched[0]["last_update_time"], 11)
        self.assertEqual(json.loads(fetched[0]["value"]), {
            "ASIN": "B000000001", "name": "Replacement"
        })

        history = self.post(
            "get_asin_history", {"ASIN": "B000000001"}
        ).get_json()["data"]
        self.assertTrue(any(row["changed_key"] == "obsolete" and row["new_value"] is None
                            for row in history))
        self.assertEqual(
            self.post("list_audited_asins").get_json()["data"],
            ["B000000001"],
        )

    def test_v1_batch_validation_is_atomic(self):
        response = self.post("update_asin", [
            self.v1_product(asin="B000000001"),
            {"ASIN": "B000000002", "timestamp": 10, "value": "not json"},
        ])
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("code", response.get_json())
        self.assertEqual(self.post("get_all").get_json()["data"], [])

    def test_v1_data_history_and_revision_roll_back_together(self):
        with mock.patch.object(backend.app.logger, "error"):
            with mock.patch.object(
                backend, "_record_change",
                side_effect=sqlite3.OperationalError("injected"),
            ):
                response = self.post("update_asin", [self.v1_product()])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.post("get_all").get_json()["data"], [])
        self.assertEqual(self.post("list_audited_asins").get_json()["data"], [])
        self.assertEqual(self.capabilities()["current_revision"], 0)

    def test_v1_generic_entities_and_audit_contract(self):
        location = {
            "location_id": "shelf-a",
            "timestamp": 100,
            "value": json.dumps({"label": "Shelf A", "capacity": 5}),
        }
        response = self.post("update_storage_location", [location])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["inserted"], 1)
        result = self.post("get_storage_location", ["shelf-a"]).get_json()["data"]
        self.assertEqual(result[0]["location_id"], "shelf-a")
        self.assertEqual(json.loads(result[0]["value"])["capacity"], 5)
        listed = self.post("list_storage_locations").get_json()["data"]
        self.assertEqual(listed, result)
        history = self.post(
            "get_storage_location_history", {"location_id": "shelf-a"}
        ).get_json()["data"]
        self.assertEqual({row["changed_key"] for row in history}, {"label", "capacity"})

        doc = {
            "doc_id": "doc-1", "timestamp": 1,
            "value": json.dumps({"title": "Process"}),
        }
        self.assertEqual(
            self.post("update_procedure_doc", [doc]).get_json()["inserted"], 1
        )
        self.assertEqual(
            self.post("list_procedure_docs").get_json()["data"][0]["doc_id"],
            "doc-1",
        )

    def test_v1_auth_and_unknown_request_responses_are_preserved(self):
        invalid = self.client.post("/data_operations", json={
            "token": "not-valid", "request": "get_all"
        })
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(invalid.get_json(), {
            "status": "error", "message": "Invalid token"
        })
        unknown = self.post("does_not_exist")
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(unknown.get_json()["message"], "Unknown request type: does_not_exist")

    # --- Migration ---------------------------------------------------------

    def _create_legacy_databases(self):
        os.makedirs(backend.DB_DIR, exist_ok=True)
        main = sqlite3.connect(backend.get_db_path(TOKEN))
        main.executescript("""
            CREATE TABLE entries (
                ASIN TEXT PRIMARY KEY,
                last_update_time INTEGER NOT NULL,
                value TEXT NOT NULL
            );
            CREATE TABLE storage_locations (
                entity_id TEXT PRIMARY KEY,
                last_update_time INTEGER NOT NULL,
                value TEXT NOT NULL
            );
            CREATE TABLE procedure_docs (
                entity_id TEXT PRIMARY KEY,
                last_update_time INTEGER NOT NULL,
                value TEXT NOT NULL
            );
        """)
        main.execute(
            "INSERT INTO entries VALUES (?, ?, ?)",
            ("b000000001", 5, json.dumps({
                "ASIN": "b000000001", "old": 1,
                "etv": "12,50 EUR", "futureField": {"nested": [None, False]},
            })),
        )
        main.execute(
            "INSERT INTO entries VALUES (?, ?, ?)",
            ("B000000001", 7, json.dumps({"ASIN": "B000000001", "new": 2})),
        )
        main.execute(
            "INSERT INTO storage_locations VALUES (?, ?, ?)",
            ("legacy-shelf", 8, json.dumps({"label": "Legacy"})),
        )
        main.commit()
        main.close()

        history = sqlite3.connect(backend.get_history_db_path(TOKEN))
        history.execute("""
            CREATE TABLE history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ASIN TEXT NOT NULL,
                change_timestamp INTEGER NOT NULL,
                changed_key TEXT NOT NULL,
                new_value TEXT,
                old_value TEXT
            )
        """)
        history.execute(
            """
            INSERT INTO history
                (ASIN, change_timestamp, changed_key, new_value, old_value)
            VALUES ('b000000001', 1, 'name', 'new', 'old')
            """
        )
        history.commit()
        history.close()

    def test_legacy_migration_is_verified_backed_up_and_idempotent(self):
        self._create_legacy_databases()
        capabilities = self.capabilities()
        self.assertEqual(capabilities["current_revision"], 0)
        self.assertTrue(os.path.exists(backend.get_db_path(TOKEN) + ".pre-sync-v2.bak"))
        self.assertTrue(os.path.exists(
            backend.get_history_db_path(TOKEN) + ".pre-sync-v2.bak"
        ))
        self.assertFalse(any(
            file_name.endswith(".tmp")
            for file_name in os.listdir(backend.DB_DIR)
        ))
        fetched = self.post("get_all").get_json()["data"]
        self.assertEqual(len(fetched), 1)
        self.assertEqual(fetched[0]["ASIN"], "B000000001")
        self.assertEqual(fetched[0]["last_update_time"], 7)
        self.assertEqual(json.loads(fetched[0]["value"]), {
            "ASIN": "B000000001", "old": 1, "new": 2,
            "etv": "12,50 EUR", "futureField": {"nested": [None, False]},
        })
        self.assertEqual(
            self.post("list_storage_locations").get_json()["data"][0]["location_id"],
            "legacy-shelf",
        )
        self.assertEqual(len(self.post(
            "get_asin_history", {"ASIN": "B000000001"}
        ).get_json()["data"]), 1)

        # A second initialization must neither rotate generation nor reimport history.
        again = self.capabilities()
        self.assertEqual(again["generation_id"], capabilities["generation_id"])
        self.assertEqual(len(self.post(
            "get_asin_history", {"ASIN": "B000000001"}
        ).get_json()["data"]), 1)

        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            product = connection.execute(
                "SELECT etv_json, unknown_json FROM products WHERE asin = ?",
                ("B000000001",),
            ).fetchone()
            self.assertEqual(json.loads(product[0]), "12,50 EUR")
            self.assertEqual(json.loads(product[1])["futureField"], {
                "nested": [None, False]
            })
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
                (backend.SYNC_SCHEMA_VERSION,),
            ).fetchone()[0], 1)
        finally:
            connection.close()

    def test_legacy_history_ids_and_autoincrement_sequences_are_preserved(self):
        self._create_legacy_databases()
        history_path = backend.get_history_db_path(TOKEN)
        history = sqlite3.connect(history_path)
        try:
            history.execute("UPDATE history SET id = 41")
            history.execute("""
                CREATE TABLE entity_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    change_timestamp INTEGER NOT NULL,
                    changed_key TEXT NOT NULL,
                    new_value TEXT,
                    old_value TEXT
                )
            """)
            history.execute(
                """
                INSERT INTO entity_audit_log (
                    id, entity_type, entity_id, change_timestamp,
                    changed_key, new_value, old_value
                ) VALUES (73, 'storage_location', 'legacy-shelf', 2,
                          'label', 'new', 'old')
                """
            )
            history.commit()
        finally:
            history.close()

        self.capabilities()
        product_history = self.post(
            "get_asin_history", {"ASIN": "B000000001"}
        ).get_json()["data"]
        entity_history = self.post(
            "get_storage_location_history", {"location_id": "legacy-shelf"}
        ).get_json()["data"]
        self.assertEqual([row["id"] for row in product_history], [41])
        self.assertEqual([row["id"] for row in entity_history], [73])

        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            sequences = dict(connection.execute(
                "SELECT name, seq FROM sqlite_sequence"
            ).fetchall())
            self.assertEqual(sequences["history"], 41)
            self.assertEqual(sequences["entity_audit_log"], 73)
        finally:
            connection.close()

    def test_migration_failure_rolls_back_and_can_retry(self):
        self._create_legacy_databases()
        original = backend._import_legacy_history
        with mock.patch.object(
            backend, "_import_legacy_history", side_effect=RuntimeError("injected")
        ):
            with self.assertRaises(RuntimeError):
                backend._open_database(TOKEN)
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )}
            self.assertNotIn("schema_migrations", tables)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM entries").fetchone()[0], 2)
        finally:
            connection.close()
        self.assertIs(backend._import_legacy_history, original)
        self.assertEqual(self.capabilities()["current_revision"], 0)

    def test_legacy_migration_rejects_unsafe_json_integer_atomically(self):
        self._create_legacy_databases()
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            connection.execute(
                "UPDATE entries SET value = ? WHERE ASIN = ?",
                (json.dumps({"unsafe": 1 << 53}), "B000000001"),
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaises(sqlite3.IntegrityError):
            backend._open_database(TOKEN)
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )}
            self.assertNotIn("schema_migrations", tables)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM entries"
            ).fetchone()[0], 2)
        finally:
            connection.close()

        # Repairing the source and retrying must refresh the pre-migration
        # backup instead of silently retaining the invalid first snapshot.
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            connection.execute(
                "UPDATE entries SET value = ? WHERE ASIN = ?",
                (json.dumps({"safe": 1}), "B000000001"),
            )
            connection.commit()
        finally:
            connection.close()
        self.capabilities()
        backup = sqlite3.connect(
            backend.get_db_path(TOKEN) + ".pre-sync-v2.bak"
        )
        try:
            repaired = json.loads(backup.execute(
                "SELECT value FROM entries WHERE ASIN = ?",
                ("B000000001",),
            ).fetchone()[0])
            self.assertEqual(repaired, {"safe": 1})
        finally:
            backup.close()

    def test_legacy_migration_rejects_unsafe_timestamps_atomically(self):
        self._create_legacy_databases()
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            connection.execute(
                "UPDATE entries SET last_update_time = ? WHERE ASIN = ?",
                (1 << 53, "B000000001"),
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaises(sqlite3.IntegrityError):
            backend._open_database(TOKEN)
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )}
            self.assertNotIn("schema_migrations", tables)
        finally:
            connection.close()

    def test_legacy_history_import_uses_attached_transaction(self):
        self._create_legacy_databases()
        original = backend._import_legacy_history
        observations = []

        def checked_import(cursor, history_path, source_database=None):
            databases = {
                row[1] for row in cursor.execute("PRAGMA database_list").fetchall()
            }
            observations.append((cursor.connection.in_transaction, source_database, databases))
            return original(cursor, history_path, source_database)

        with mock.patch.object(backend, "_import_legacy_history", checked_import):
            connection = backend._open_database(TOKEN)
            connection.close()
        self.assertEqual(len(observations), 1)
        self.assertTrue(observations[0][0])
        self.assertEqual(observations[0][1], "legacy_history")
        self.assertIn("legacy_history", observations[0][2])

    def test_incomplete_existing_backup_is_atomically_replaced(self):
        self._create_legacy_databases()
        backup_path = backend.get_db_path(TOKEN) + ".pre-sync-v2.bak"
        open(backup_path, "wb").close()

        self.capabilities()
        connection = sqlite3.connect(backup_path)
        try:
            self.assertEqual(connection.execute(
                "PRAGMA integrity_check"
            ).fetchone()[0], "ok")
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM entries"
            ).fetchone()[0], 2)
        finally:
            connection.close()

    def test_known_good_backup_survives_a_later_corrupt_retry(self):
        self._create_legacy_databases()
        with mock.patch.object(
            backend, "_import_legacy_history", side_effect=RuntimeError("injected")
        ):
            with self.assertRaises(RuntimeError):
                backend._open_database(TOKEN)

        backup_path = backend.get_db_path(TOKEN) + ".pre-sync-v2.bak"
        backup_digest = backend._sha256_file(backup_path)
        history_backup_path = (
            backend.get_history_db_path(TOKEN) + ".pre-sync-v2.bak"
        )
        history_backup_digest = backend._sha256_file(history_backup_path)
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            connection.execute(
                "UPDATE entries SET value = ? WHERE ASIN = ?",
                (json.dumps({"unsafe": 1 << 53}), "B000000001"),
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaises(sqlite3.IntegrityError):
            backend._open_database(TOKEN)

        self.assertEqual(backend._sha256_file(backup_path), backup_digest)
        self.assertEqual(
            backend._sha256_file(history_backup_path), history_backup_digest
        )
        backup = sqlite3.connect(backup_path)
        try:
            original = json.loads(backup.execute(
                "SELECT value FROM entries WHERE ASIN = ?",
                ("B000000001",),
            ).fetchone()[0])
            self.assertEqual(original, {"ASIN": "B000000001", "new": 2})
        finally:
            backup.close()
        history_backup = sqlite3.connect(history_backup_path)
        try:
            self.assertEqual(history_backup.execute(
                "SELECT ASIN, change_timestamp FROM history"
            ).fetchall(), [("b000000001", 1)])
        finally:
            history_backup.close()
        self.assertFalse(any(
            file_name.endswith(".tmp")
            for file_name in os.listdir(backend.DB_DIR)
        ))

    def test_corrupt_structured_json_fails_closed_without_breaking_v1_mirror(self):
        self._create_legacy_databases()
        self.capabilities()
        connection = sqlite3.connect(backend.get_db_path(TOKEN))
        try:
            connection.execute(
                "UPDATE products SET record_json = 'not-json' WHERE asin = ?",
                ("B000000001",),
            )
            connection.commit()
        finally:
            connection.close()

        v1 = self.post("get_all")
        self.assertEqual(v1.status_code, 200)
        self.assertEqual(len(v1.get_json()["data"]), 1)
        generation = self.capabilities()["generation_id"]
        v2 = self.post("sync_v2_snapshot", {
            "generation_id": generation, "limit": 10,
        })
        self.assertEqual(v2.status_code, 500)
        self.assertEqual(v2.get_json(), {
            "status": "error", "message": "Database error."
        })

    def test_default_database_directory_remains_cwd_relative(self):
        repository_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        environment = os.environ.copy()
        environment.pop("VINE_SYNC_DB_DIR", None)
        environment["PYTHONPATH"] = repository_root
        with tempfile.TemporaryDirectory() as working_directory:
            configured = subprocess.check_output(
                [
                    sys.executable,
                    "-c",
                    "import self_hosted_backend; print(self_hosted_backend.DB_DIR)",
                ],
                cwd=working_directory,
                env=environment,
                text=True,
            ).strip()
            self.assertEqual(
                os.path.normcase(configured),
                os.path.normcase(os.path.join(working_directory, "user_databases")),
            )

    def test_concurrent_legacy_initialization_is_idempotent(self):
        self._create_legacy_databases()

        def initialize():
            connection = backend._open_database(TOKEN)
            try:
                meta = connection.execute(
                    "SELECT generation_id FROM sync_meta WHERE singleton = 1"
                ).fetchone()[0]
                count = connection.execute("SELECT COUNT(*) FROM products").fetchone()[0]
                history_count = connection.execute("SELECT COUNT(*) FROM history").fetchone()[0]
                return meta, count, history_count
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: initialize(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0][1:], (1, 1))

    # --- V2 contract -------------------------------------------------------

    def test_capability_contract_is_constant_time_metadata(self):
        capabilities = self.capabilities()
        self.assertEqual(capabilities["protocol_version"], 2)
        self.assertEqual(capabilities["sync_core_version"], "2.1.0")
        self.assertEqual(capabilities["canonicalization"], "jcs-rfc8785-v1")
        self.assertEqual(capabilities["limits"], {
            "push_mutations": 100,
            "pull_changes": 500,
            "snapshot_records": 500,
        })
        self.assertNotIn("dataset_hash", capabilities)
        self.assertTrue(capabilities["features"]["push_pull_exchange"])
        self.assertTrue(capabilities["features"]["on_demand_pull_hash"])
        self.assertTrue(capabilities["features"]["authoritative_status_fields"])
        self.assertTrue(capabilities["features"]["product_last_write_wins"])
        self.assertTrue(capabilities["features"]["product_intent_age_lww"])
        self.assertFalse(capabilities["features"]["product_delete_supported"])
        connection, cursor = backend.get_db_conn(TOKEN)
        try:
            self.assertEqual(cursor.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
        finally:
            cursor.close()
            connection.close()

    def test_jcs_cross_backend_fixed_hash_vector(self):
        projection = [{
            "entity_type": "product",
            "entity_id": "B000000001",
            "data": {
                "array": [None, True, False, 0.000001, 1e-7, 1e21],
                "nested": {"z": 1, "\u00e4": "Gr\u00fc\u00dfe", "\U0001f600": 0},
                "text": "line\n\"x\"",
            },
        }]
        self.assertEqual(
            backend._sha256_json(projection),
            "8d181042a53c24f744c7fbb6a64ff54ee4b1119c1cbec6295a0ee5b67d689d58",
        )

    def test_unsafe_json_integers_are_rejected_at_v1_and_v2_ingress(self):
        generation = self.capabilities()["generation_id"]
        unsafe = 1 << 53
        v2 = self.push(generation, [self.mutation(
            "unsafe-v2", set_values={"nested": [unsafe]}
        )])
        self.assertEqual(v2.status_code, 400)
        self.assertEqual(v2.get_json()["code"], "invalid_mutation")

        v1 = self.post("update_asin", [self.v1_product(unsafe=unsafe)])
        self.assertEqual(v1.status_code, 400)
        self.assertNotIn("code", v1.get_json())
        unsafe_timestamp = self.post(
            "update_asin", [self.v1_product(timestamp=unsafe)]
        )
        boolean_timestamp = self.post(
            "update_asin", [self.v1_product(timestamp=True)]
        )
        self.assertEqual(unsafe_timestamp.status_code, 400)
        self.assertEqual(boolean_timestamp.status_code, 400)
        self.assertEqual(self.capabilities()["current_revision"], 0)
        self.assertEqual(self.post("get_all").get_json()["data"], [])

    def test_push_pull_snapshot_and_hash_contract(self):
        generation = self.capabilities()["generation_id"]
        response = self.push(generation, [self.mutation(
            "m-create", set_values={
                "ASIN": "B000000001", "name": "One", "etv": 0,
                "nullable": None,
            }
        )])
        self.assertEqual(response.status_code, 200)
        result = response.get_json()["results"][0]
        self.assertEqual(result["status"], "applied")
        self.assertEqual(result["revision"], 1)
        self.assertEqual(result["data"]["ASIN"], "B000000001")

        pull = self.post("sync_v2_pull", {
            "generation_id": generation, "cursor": 0, "limit": 10,
            "include_hash": True,
        }).get_json()
        self.assertFalse(pull["has_more"])
        self.assertEqual(pull["next_cursor"], 1)
        self.assertEqual(pull["changes"][0]["set"], {
            "ASIN": "B000000001", "name": "One", "etv": 0, "nullable": None
        })
        self.assertEqual(pull["changes"][0]["unset"], [])

        snapshot = self.post("sync_v2_snapshot", {
            "generation_id": generation, "limit": 10
        }).get_json()
        snapshot_record = snapshot["records"][0]
        self.assertEqual(snapshot_record["entity_type"], "product")
        self.assertEqual(snapshot_record["entity_id"], "B000000001")
        self.assertEqual(snapshot_record["record_revision"], 1)
        self.assertIsInstance(snapshot_record["legacy_last_update_time"], int)
        self.assertEqual(snapshot_record["data"], result["data"])
        # Hash projection intentionally excludes revisions and timestamps.
        projection = [{
            "entity_type": "product",
            "entity_id": "B000000001",
            "data": result["data"],
        }]
        expected_hash = hashlib.sha256(
            backend.canonical_json(projection).encode("utf-8")
        ).hexdigest()
        self.assertEqual(snapshot["dataset_hash"], expected_hash)
        self.assertEqual(pull["dataset_hash"], expected_hash)

    def test_v21_push_exchange_and_authoritative_status_overwrite(self):
        generation = self.capabilities()["generation_id"]
        created = self.push(generation, [self.mutation(
            "status-create", set_values={"usageStatus": ["Lager"]},
        )]).get_json()["results"][0]
        changed = self.push(generation, [self.mutation(
            "status-remote", base=created["revision"],
            set_values={"usageStatus": ["entsorgt"]},
        )]).get_json()["results"][0]

        authoritative = self.mutation(
            "status-authoritative",
            base=created["revision"],
            set_values={"usageStatus": ["verkauft"]},
            authoritative_fields=["usageStatus"],
        )
        exchange = self.post("sync_v2_push", {
            "generation_id": generation,
            "client_id": "v21-client",
            "mutations": [authoritative],
            "pull_since": 0,
            "pull_limit": 10,
            "entity_types": ["product"],
        }).get_json()
        self.assertEqual(exchange["results"][0]["status"], "applied")
        self.assertGreater(exchange["results"][0]["revision"], changed["revision"])
        self.assertEqual(exchange["results"][0]["data"]["usageStatus"], ["verkauft"])
        self.assertEqual([item["revision"] for item in exchange["changes"]], [1, 2, 3])
        self.assertEqual(exchange["next_cursor"], 3)
        self.assertFalse(exchange["has_more"])
        self.assertIsNone(exchange["dataset_hash"])

        same_target = self.push(generation, [self.mutation(
            "status-noop", base=created["revision"],
            set_values={"usageStatus": ["verkauft"]},
            authoritative_fields=["usageStatus"],
        )]).get_json()
        self.assertEqual(same_target["results"][0]["status"], "noop")
        self.assertEqual(same_target["current_revision"], 3)

    def test_scoped_pull_skips_other_entities_without_losing_cursor(self):
        generation = self.capabilities()["generation_id"]
        self.push(generation, [
            self.mutation("product-1", set_values={"name": "One"}),
        ])
        location = self.mutation(
            "location-1", entity_id="shelf-a", set_values={"label": "Shelf"}
        )
        location["entity_type"] = "storage_location"
        self.push(generation, [location])
        self.push(generation, [
            self.mutation(
                "product-2", entity_id="B000000002", set_values={"name": "Two"}
            ),
        ])
        first = self.post("sync_v2_pull", {
            "generation_id": generation, "cursor": 0, "limit": 1,
            "entity_types": ["product"],
        }).get_json()
        self.assertEqual(first["changes"][0]["revision"], 1)
        self.assertTrue(first["has_more"])
        self.assertIsNone(first["dataset_hash"])
        second = self.post("sync_v2_pull", {
            "generation_id": generation, "cursor": first["next_cursor"],
            "limit": 1, "entity_types": ["product"],
        }).get_json()
        self.assertEqual(second["next_cursor"], 3)
        self.assertFalse(second["has_more"])
        self.assertEqual(second["hash_entity_types"], ["product"])
        self.assertEqual(second["changes"][0]["entity_id"], "B000000002")

    def test_idempotency_and_mutation_id_reuse_are_transactional(self):
        generation = self.capabilities()["generation_id"]
        mutation = self.mutation(
            "same-id", set_values={"name": "Original"}, intent_age_ms=1_000,
        )
        first = self.push(generation, [mutation]).get_json()
        retry_with_increased_age = {**mutation, "intent_age_ms": 2_000}
        second = self.push(generation, [retry_with_increased_age]).get_json()
        self.assertEqual(second["results"], first["results"])
        self.assertEqual(second["current_revision"], 1)

        response = self.push(generation, [
            self.mutation("new-in-same-batch", "B000000002", set_values={"name": "Two"}),
            self.mutation("same-id", set_values={"name": "Different"}),
        ])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "mutation_id_reused")
        self.assertEqual(self.capabilities()["current_revision"], 1)
        self.assertEqual(self.post("get_asin", ["B000000002"]).get_json()["data"], [])

        negative_age = self.push(generation, [self.mutation(
            "negative-age", set_values={"name": "Future bug"}, intent_age_ms=-1,
        )])
        self.assertEqual(negative_age.status_code, 400)
        self.assertEqual(negative_age.get_json()["code"], "invalid_mutation")

    def test_base_revision_ahead_rejects_the_entire_push_batch(self):
        generation = self.capabilities()["generation_id"]
        response = self.push(generation, [
            self.mutation("valid-first", set_values={"name": "Must roll back"}),
            self.mutation(
                "future-base", "B000000002", base=1,
                set_values={"name": "Future"},
            ),
        ])
        self.assertEqual(response.status_code, 409)
        body = response.get_json()
        self.assertEqual(body["code"], "base_revision_ahead")
        self.assertEqual(body["current_revision"], 0)
        self.assertEqual(self.capabilities()["current_revision"], 0)
        self.assertEqual(self.post("get_all").get_json()["data"], [])

    def test_product_field_level_merge_same_value_noop_and_last_write_wins(self):
        generation = self.capabilities()["generation_id"]
        created = self.push(generation, [self.mutation(
            "create", set_values={"name": "Base", "etv": 1}
        )]).get_json()["results"][0]
        base = created["revision"]

        name_update = self.push(generation, [self.mutation(
            "name", base=base, set_values={"name": "Server"}
        )]).get_json()["results"][0]
        self.assertEqual(name_update["status"], "applied")

        disjoint = self.push(generation, [self.mutation(
            "etv", base=base, set_values={"etv": 2}
        )]).get_json()["results"][0]
        self.assertEqual(disjoint["status"], "applied")
        self.assertEqual(disjoint["data"]["name"], "Server")

        same_target = self.push(generation, [self.mutation(
            "same-target", base=base, set_values={"name": "Server"}
        )]).get_json()["results"][0]
        self.assertEqual(same_target["status"], "noop")

        last_write = self.push(generation, [self.mutation(
            "last-write", base=base, set_values={"name": "Client"}
        )]).get_json()["results"][0]
        self.assertEqual(last_write["status"], "applied")
        self.assertEqual(last_write["data"]["name"], "Client")
        self.assertEqual(last_write["data"]["etv"], 2)

    def test_older_offline_product_intent_cannot_overwrite_newer_client_intent(self):
        generation = self.capabilities()["generation_id"]
        newer = self.push(generation, [self.mutation(
            "newer-five-euros", set_values={"myteilwert": 5},
            intent_age_ms=0,
        )]).get_json()["results"][0]
        revision = newer["revision"]

        older_offline = self.push(generation, [self.mutation(
            "older-ten-euros", base=0, set_values={"myteilwert": 10},
            intent_age_ms=14 * 24 * 60 * 60 * 1000,
        )]).get_json()["results"][0]
        self.assertEqual(older_offline["status"], "noop")
        self.assertEqual(older_offline["revision"], revision)
        self.assertEqual(older_offline["data"]["myteilwert"], 5)
        self.assertEqual(older_offline["ignored_fields"], ["myteilwert"])
        self.assertEqual(self.capabilities()["current_revision"], revision)

        equal_clock_arrives_later = self.push(generation, [self.mutation(
            "equal-clock-arrival-wins", base=0, set_values={"myteilwert": 7},
            intent_age_ms=0,
        )]).get_json()["results"][0]
        self.assertEqual(equal_clock_arrives_later["status"], "applied")
        self.assertEqual(equal_clock_arrives_later["data"]["myteilwert"], 7)

    def test_null_unset_delete_tombstone_and_generation_errors(self):
        generation = self.capabilities()["generation_id"]
        create = self.push(generation, [self.mutation(
            "create", set_values={"optional": None, "remove": "yes"}
        )]).get_json()["results"][0]
        revision = create["revision"]
        unset = self.push(generation, [self.mutation(
            "unset", base=revision, unset=["remove"]
        )]).get_json()["results"][0]
        self.assertIn("optional", unset["data"])
        self.assertIsNone(unset["data"]["optional"])
        self.assertNotIn("remove", unset["data"])

        deleted = self.push(generation, [self.mutation(
            "delete", base=unset["revision"], operation="delete"
        )])
        self.assertEqual(deleted.status_code, 400)
        self.assertEqual(deleted.get_json()["code"], "invalid_mutation")
        self.assertEqual(len(self.post("get_all").get_json()["data"]), 1)

        mismatch = self.post("sync_v2_pull", {
            "generation_id": "wrong", "cursor": 0
        })
        self.assertEqual(mismatch.status_code, 409)
        self.assertEqual(mismatch.get_json()["code"], "generation_mismatch")
        ahead = self.post("sync_v2_pull", {
            "generation_id": generation, "cursor": 999
        })
        self.assertEqual(ahead.status_code, 409)
        self.assertEqual(ahead.get_json()["code"], "cursor_ahead")

    def test_snapshot_is_stable_across_concurrent_writes_and_pages(self):
        generation = self.capabilities()["generation_id"]
        self.push(generation, [
            self.mutation("one", "B000000001", set_values={"name": "One"}),
            self.mutation("two", "B000000002", set_values={"name": "Two"}),
        ])
        first = self.post("sync_v2_snapshot", {
            "generation_id": generation, "limit": 1
        }).get_json()
        self.assertTrue(first["has_more"])
        self.assertEqual(first["records"][0]["data"]["name"], "One")

        self.push(generation, [self.mutation(
            "change-two", "B000000002", base=2, set_values={"name": "Changed"}
        )])
        second = self.post("sync_v2_snapshot", {
            "generation_id": generation,
            "session_id": first["session_id"],
            "offset": first["next_offset"],
            "limit": 1,
        }).get_json()
        self.assertFalse(second["has_more"])
        self.assertEqual(second["records"][0]["data"]["name"], "Two")
        self.assertEqual(second["snapshot_revision"], first["snapshot_revision"])
        self.assertEqual(second["dataset_hash"], first["dataset_hash"])

    def test_snapshot_page_is_materialized_inside_one_read_transaction(self):
        generation = self.capabilities()["generation_id"]
        self.push(generation, [self.mutation(
            "snapshot-record", set_values={"name": "One"}
        )])
        first = self.post("sync_v2_snapshot", {
            "generation_id": generation, "limit": 1,
        }).get_json()

        connection = backend._open_database(TOKEN)
        cursor = connection.cursor()
        original = backend._safe_json_object
        transaction_states = []

        def observed_json(raw):
            transaction_states.append(connection.in_transaction)
            return original(raw)

        try:
            with mock.patch.object(backend, "_safe_json_object", observed_json):
                page = backend.sync_snapshot(connection, cursor, {
                    "session_id": first["session_id"],
                    "offset": 0,
                    "limit": 1,
                })
        finally:
            cursor.close()
            connection.close()
        self.assertEqual(page["records"][0]["data"]["name"], "One")
        self.assertEqual(transaction_states, [True])

    def test_delete_all_is_transactional_rotates_generation_and_clears_history(self):
        generation = self.capabilities()["generation_id"]
        self.post("update_asin", [self.v1_product()])
        self.assertTrue(self.post(
            "get_asin_history", {"ASIN": "B000000001"}
        ).get_json()["data"])

        main_backup_path = backend.get_db_path(TOKEN) + ".pre-sync-v2.bak"
        source = sqlite3.connect(backend.get_db_path(TOKEN))
        main_backup = sqlite3.connect(main_backup_path)
        try:
            source.backup(main_backup)
        finally:
            main_backup.close()
            source.close()
        history_backup_path = backend.get_history_db_path(TOKEN) + ".pre-sync-v2.bak"
        history_backup = sqlite3.connect(history_backup_path)
        history_backup.execute("""
            CREATE TABLE history (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ASIN TEXT NOT NULL,
                change_timestamp INTEGER NOT NULL, changed_key TEXT NOT NULL,
                new_value TEXT, old_value TEXT
            )
        """)
        history_backup.execute(
            """
            INSERT INTO history
                (ASIN, change_timestamp, changed_key, new_value, old_value)
            VALUES ('B000000001', 1, 'name', 'secret', NULL)
            """
        )
        history_backup.commit()
        history_backup.close()

        response = self.post("delete_all")
        self.assertEqual(response.status_code, 200)
        after = self.capabilities()
        self.assertNotEqual(after["generation_id"], generation)
        self.assertEqual(after["current_revision"], 1)
        self.assertEqual(self.post("get_all").get_json()["data"], [])
        self.assertEqual(self.post(
            "get_asin_history", {"ASIN": "B000000001"}
        ).get_json()["data"], [])
        reset = self.post("sync_v2_pull", {
            "generation_id": after["generation_id"], "cursor": 0
        }).get_json()
        self.assertEqual(reset["changes"][0]["operation"], "dataset_reset")

        history = sqlite3.connect(backend.get_history_db_path(TOKEN))
        try:
            self.assertEqual(history.execute("SELECT COUNT(*) FROM history").fetchone()[0], 0)
        finally:
            history.close()
        main_backup = sqlite3.connect(main_backup_path)
        history_backup = sqlite3.connect(history_backup_path)
        try:
            self.assertEqual(main_backup.execute("SELECT COUNT(*) FROM entries").fetchone()[0], 0)
            self.assertEqual(history_backup.execute("SELECT COUNT(*) FROM history").fetchone()[0], 0)
        finally:
            main_backup.close()
            history_backup.close()

    def test_delete_all_rolls_back_main_data_if_attached_history_cannot_clear(self):
        self.post("update_asin", [self.v1_product()])
        history_path = backend.get_history_db_path(TOKEN)
        history = sqlite3.connect(history_path)
        history.executescript("""
            CREATE TABLE history (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ASIN TEXT NOT NULL,
                change_timestamp INTEGER NOT NULL, changed_key TEXT NOT NULL,
                new_value TEXT, old_value TEXT
            );
            CREATE TABLE entity_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL, change_timestamp INTEGER NOT NULL,
                changed_key TEXT NOT NULL, new_value TEXT, old_value TEXT
            );
            INSERT INTO history
                (ASIN, change_timestamp, changed_key, new_value, old_value)
            VALUES ('B000000001', 1, 'name', 'secret', NULL);
            CREATE TRIGGER reject_history_delete BEFORE DELETE ON history
            BEGIN
                SELECT RAISE(ABORT, 'synthetic delete failure');
            END;
        """)
        history.commit()
        history.close()

        with mock.patch.object(backend.app.logger, "error"):
            response = self.post("delete_all")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(len(self.post("get_all").get_json()["data"]), 1)
        history = sqlite3.connect(history_path)
        try:
            self.assertEqual(history.execute("SELECT COUNT(*) FROM history").fetchone()[0], 1)
        finally:
            history.close()


if __name__ == "__main__":
    unittest.main()
