"""Standalone backend for VineTaxTools and Vine-Produkt-Manager.

The module deliberately has no runtime dependency on the hosted hutaufvine
application.  It keeps the legacy V1 wire format while storing all entities in
one revisioned SQLite database per token and exposing the V2 sync protocol.
"""

import hashlib
import json
import math
import os
import re
import sqlite3
import time
import uuid
from decimal import Decimal

from flask import Flask, jsonify, request
from flask_cors import CORS


app = Flask(__name__)
CORS(app)


# --- Configuration -------------------------------------------------------

VALID_TOKENS = {
    "mydummytoken1",
    "mydummytoken2",
    "mydummytoken3",
}

# Keep the established CWD-relative default.  Deployments can opt into an
# explicit absolute location through VINE_SYNC_DB_DIR without silently moving
# existing token databases after an application update.
DB_DIR = os.path.abspath(os.environ.get("VINE_SYNC_DB_DIR", "user_databases"))
TOKEN_FILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
SQLITE_TIMEOUT_SECONDS = 30.0
SQLITE_BUSY_TIMEOUT_MS = 30_000

os.makedirs(DB_DIR, exist_ok=True)


def _validate_token_for_path(token):
    if not isinstance(token, str) or not TOKEN_FILE_NAME_PATTERN.fullmatch(token):
        raise ValueError("Invalid token format for database path.")


def get_db_path(token):
    """Return the established DATABASE_<token>.sqlite path."""
    _validate_token_for_path(token)
    return os.path.join(DB_DIR, f"DATABASE_{token}.sqlite")


def get_history_db_path(token):
    """Return the established HISTORY_<token>.sqlite path."""
    _validate_token_for_path(token)
    return os.path.join(DB_DIR, f"HISTORY_{token}.sqlite")


def connect_sqlite(path):
    connection = sqlite3.connect(path, timeout=SQLITE_TIMEOUT_SECONDS)
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


# === VINE SYNC CORE BEGIN ===============================================
# This marked block is intentionally self-contained.  The hosted backend has
# an equivalent copy and parity tests compare its public protocol behaviour.

SYNC_CORE_VERSION = "2.1.0"
SYNC_SCHEMA_VERSION = 2
SYNC_MIGRATION_CHECKSUM = hashlib.sha256(
    b"self-hosted-vine-sync-schema-v2-2026-07-31-known-fields-2"
).hexdigest()
CANONICALIZATION_VERSION = "jcs-rfc8785-v1"
HASH_ALGORITHM = "sha256"
MAX_SAFE_JSON_INTEGER = (1 << 53) - 1
SUPPORTED_ENTITY_TYPES = ("product", "storage_location", "procedure_doc")
AUTHORITATIVE_PRODUCT_FIELDS = {
    "usageStatus", "verkauft", "lager", "entsorgt", "storniert",
    "betriebsausgabe",
}
MAX_PUSH_MUTATIONS = 100
MAX_PULL_CHANGES = 500
MAX_SNAPSHOT_RECORDS = 500
SNAPSHOT_TTL_SECONDS = 15 * 60
CHANGE_RETENTION_SECONDS = 365 * 24 * 60 * 60
CHANGE_RETENTION_REVISIONS = 250_000

GENERIC_ENTITY_CONFIG = {
    "storage_location": {
        "legacy_table": "storage_locations",
        "id_field": "location_id",
    },
    "procedure_doc": {
        "legacy_table": "procedure_docs",
        "id_field": "doc_id",
    },
}

PRODUCT_COLUMN_MAP = {
    "name": "name_json",
    "date": "date_json",
    "orderDate": "order_date_json",
    "ordernumber": "order_number_json",
    "orderNumber": "order_number_camel_json",
    "etv": "etv_json",
    "ETV": "legacy_etv_json",
    "keepa": "keepa_json",
    "teilwert": "teilwert_json",
    "teilwert_v2": "teilwert_v2_json",
    "pdf": "pdf_json",
    "myTeilwert": "my_teilwert_json",
    "myteilwert": "legacy_my_teilwert_json",
    "myTeilwertReason": "my_teilwert_reason_json",
    "usageStatus": "usage_status_json",
    "verkauft": "legacy_verkauft_json",
    "lager": "legacy_lager_json",
    "entsorgt": "legacy_entsorgt_json",
    "storniert": "legacy_storniert_json",
    "betriebsausgabe": "legacy_betriebsausgabe_json",
    "barcodes": "barcodes_json",
    "salePrice": "sale_price_json",
    "saleDate": "sale_date_json",
    "buyerAddress": "buyer_address_json",
    "privatentnahmeDate": "privatentnahme_date_json",
    "festgeschrieben": "festgeschrieben_json",
    "rechnungsNummer": "rechnungs_nummer_json",
    "entnahmeBelegNummer": "entnahme_beleg_nummer_json",
    "storageLocationId": "storage_location_id_json",
}


class SyncProtocolError(Exception):
    """An expected request error with a stable HTTP status and code."""

    def __init__(self, message, status=400, code="invalid_request", **details):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details


class V1RequestError(SyncProtocolError):
    """Legacy validation error whose JSON body must not gain V2 fields."""

    def __init__(self, message, status=400):
        super().__init__(message, status=status, code=None)


def _utf16_sort_key(value):
    return value.encode("utf-16be", "surrogatepass")


def _entity_sort_key(record):
    return (
        _utf16_sort_key(record["entity_type"]),
        _utf16_sort_key(record["entity_id"]),
    )


def _json_dump(value):
    """Lossless storage JSON, including unusual values from old databases."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _jcs_number(value):
    """Serialize a finite Python number with ECMAScript/JCS thresholds.

    Python and ECMAScript both use shortest round-trippable IEEE-754 decimal
    representations.  The remaining observable differences are exponent
    formatting and the fixed/scientific notation thresholds handled here.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_JSON_INTEGER:
            raise ValueError(
                "JSON integers must be within JavaScript's safe integer range."
            )
        return str(value)
    if not isinstance(value, float) or not math.isfinite(value):
        raise ValueError("Only finite JSON numbers can be canonicalized.")
    if value == 0:
        return "0"

    rendered = repr(value).lower()
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        fixed = format(Decimal(rendered), "f")
        if "." in fixed:
            fixed = fixed.rstrip("0").rstrip(".")
        return fixed

    if "e" not in rendered:
        rendered = format(value, ".15e")
    mantissa, exponent = rendered.split("e", 1)
    mantissa = mantissa.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    exponent_text = f"+{exponent_value}" if exponent_value >= 0 else str(exponent_value)
    return f"{mantissa}e{exponent_text}"


def canonical_json(value):
    """Return deterministic RFC-8785-style JSON used by hashes and receipts."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _jcs_number(value)
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError("JSON strings must not contain lone surrogates.") from error
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("JSON object keys must be strings.")
        keys = sorted(value, key=_utf16_sort_key)
        return "{" + ",".join(
            f"{canonical_json(key)}:{canonical_json(value[key])}" for key in keys
        ) + "}"
    raise ValueError(f"Unsupported JSON value type: {type(value).__name__}")


def _sha256_json(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _canonical_data_json(data):
    if not isinstance(data, dict):
        raise ValueError("Entity data must be a JSON object.")
    # Stored entity values participate in hashes calculated by JavaScript
    # clients.  Validate before persistence so Python cannot retain an integer
    # that JavaScript would round to a different value.
    canonical_json(data)
    return _json_dump(data)


def _schema_sql():
    return """
        CREATE TABLE IF NOT EXISTS entries (
            ASIN TEXT PRIMARY KEY,
            last_update_time INTEGER NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS storage_locations (
            entity_id TEXT PRIMARY KEY,
            last_update_time INTEGER NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS procedure_docs (
            entity_id TEXT PRIMARY KEY,
            last_update_time INTEGER NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            generation_id TEXT NOT NULL,
            current_revision INTEGER NOT NULL,
            min_available_revision INTEGER NOT NULL,
            canonicalization_version TEXT NOT NULL,
            sync_core_version TEXT NOT NULL,
            last_pruned_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            asin TEXT PRIMARY KEY COLLATE NOCASE,
            legacy_last_update_time INTEGER NOT NULL,
            record_json TEXT NOT NULL,
            presence_json TEXT NOT NULL,
            unknown_json TEXT NOT NULL,
            name_json TEXT, date_json TEXT, order_date_json TEXT,
            order_number_json TEXT, order_number_camel_json TEXT,
            etv_json TEXT, legacy_etv_json TEXT,
            keepa_json TEXT, teilwert_json TEXT, teilwert_v2_json TEXT,
            pdf_json TEXT, my_teilwert_json TEXT,
            legacy_my_teilwert_json TEXT, my_teilwert_reason_json TEXT,
            usage_status_json TEXT, legacy_verkauft_json TEXT,
            legacy_lager_json TEXT, legacy_entsorgt_json TEXT,
            legacy_storniert_json TEXT, legacy_betriebsausgabe_json TEXT,
            barcodes_json TEXT, sale_price_json TEXT, sale_date_json TEXT,
            buyer_address_json TEXT, privatentnahme_date_json TEXT,
            festgeschrieben_json TEXT, rechnungs_nummer_json TEXT,
            entnahme_beleg_nummer_json TEXT, storage_location_id_json TEXT,
            record_revision INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
            deleted_revision INTEGER
        );
        CREATE TABLE IF NOT EXISTS sync_entities (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            legacy_last_update_time INTEGER NOT NULL,
            record_json TEXT NOT NULL,
            presence_json TEXT NOT NULL,
            unknown_json TEXT NOT NULL,
            record_revision INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
            deleted_revision INTEGER,
            PRIMARY KEY (entity_type, entity_id),
            CHECK (entity_type IN ('storage_location', 'procedure_doc'))
        );
        CREATE TABLE IF NOT EXISTS field_revisions (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            field_name TEXT NOT NULL,
            revision INTEGER NOT NULL,
            intent_timestamp_ms INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (entity_type, entity_id, field_name)
        );
        CREATE TABLE IF NOT EXISTS sync_changes (
            revision INTEGER PRIMARY KEY,
            generation_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (
                operation IN ('upsert', 'delete', 'dataset_reset')
            ),
            record_revision INTEGER NOT NULL,
            set_json TEXT NOT NULL,
            unset_json TEXT NOT NULL,
            record_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_changes_entity
            ON sync_changes (entity_type, revision);
        CREATE TABLE IF NOT EXISTS mutation_receipts (
            mutation_id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            generation_id TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_conflicts (
            mutation_id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            base_revision INTEGER NOT NULL,
            conflict_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tombstones (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            deleted_at INTEGER NOT NULL,
            PRIMARY KEY (entity_type, entity_id)
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ASIN TEXT NOT NULL,
            change_timestamp INTEGER NOT NULL,
            changed_key TEXT NOT NULL,
            new_value TEXT,
            old_value TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_history_asin ON history (ASIN);
        CREATE TABLE IF NOT EXISTS entity_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            change_timestamp INTEGER NOT NULL,
            changed_key TEXT NOT NULL,
            new_value TEXT,
            old_value TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_entity_audit_lookup
            ON entity_audit_log (entity_type, entity_id, change_timestamp);
        CREATE TABLE IF NOT EXISTS sync_snapshot_sessions (
            session_id TEXT PRIMARY KEY,
            generation_id TEXT NOT NULL,
            snapshot_revision INTEGER NOT NULL,
            entity_types_json TEXT NOT NULL,
            dataset_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_snapshot_records (
            session_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            record_revision INTEGER NOT NULL,
            legacy_last_update_time INTEGER NOT NULL,
            record_json TEXT NOT NULL,
            PRIMARY KEY (session_id, position),
            FOREIGN KEY (session_id) REFERENCES sync_snapshot_sessions(session_id)
                ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS dataset_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            previous_generation_id TEXT NOT NULL,
            generation_id TEXT NOT NULL,
            reset_at INTEGER NOT NULL
        );
    """


def _table_exists(connection, table_name, database="main"):
    row = connection.execute(
        f"SELECT 1 FROM {database}.sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def _remove_backup_candidate(path):
    if not path:
        return
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _fsync_parent_directory(path):
    if os.name == "nt":
        return
    directory_fd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _publish_backup_candidate(temporary_path, backup_path):
    temporary_digest = _sha256_file(temporary_path)
    try:
        os.replace(temporary_path, backup_path)
    except OSError:
        # Concurrent startup workers may both finish an equivalent snapshot.
        # Accept only the exact verified candidate, never a stale destination.
        if not os.path.exists(backup_path):
            raise sqlite3.DatabaseError(
                "Could not publish the verified migration backup."
            ) from None
        if _sha256_file(backup_path) != temporary_digest:
            raise sqlite3.DatabaseError(
                "Could not replace a stale migration backup."
            ) from None
        return
    try:
        _fsync_parent_directory(backup_path)
    except OSError:
        raise sqlite3.DatabaseError(
            "Could not durably publish the migration backup."
        ) from None


def _backup_once(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return None
    backup_path = f"{path}.pre-sync-v2.bak"
    temporary_path = f"{backup_path}.{uuid.uuid4().hex}.tmp"
    keep_candidate = False
    try:
        source = connect_sqlite(path)
        backup = None
        try:
            backup = connect_sqlite(temporary_path)
            source.backup(backup)
            if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise sqlite3.DatabaseError("Backup integrity verification failed.")
        finally:
            if backup is not None:
                backup.close()
            source.close()
        # Windows requires a writable descriptor for fsync/FlushFileBuffers.
        with open(temporary_path, "r+b") as backup_file:
            os.fsync(backup_file.fileno())
        if os.path.exists(backup_path):
            # Preserve a previous recovery point until this source has passed
            # strict semantic migration validation.
            keep_candidate = True
            return temporary_path
        _publish_backup_candidate(temporary_path, backup_path)
        return None
    finally:
        if not keep_candidate:
            _remove_backup_candidate(temporary_path)


def _safe_json_object(raw):
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        raise sqlite3.IntegrityError("Stored sync JSON is invalid.") from None
    if not isinstance(value, dict):
        raise sqlite3.IntegrityError("Stored sync JSON is not an object.")
    try:
        canonical_json(value)
    except ValueError:
        raise sqlite3.IntegrityError(
            "Stored sync JSON is not interoperable."
        ) from None
    return value


def _validate_legacy_timestamp(value, label):
    if not isinstance(value, int) or isinstance(value, bool):
        raise sqlite3.IntegrityError(
            f"Legacy timestamp for {label} is not an integer."
        )
    if abs(value) > MAX_SAFE_JSON_INTEGER:
        raise sqlite3.IntegrityError(
            f"Legacy timestamp for {label} is outside the safe integer range."
        )
    return value


def _legacy_json_object(raw, entity_label):
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise sqlite3.IntegrityError(
            f"Invalid legacy JSON for {entity_label}; migration was rolled back."
        ) from error
    if not isinstance(value, dict):
        raise sqlite3.IntegrityError(
            f"Legacy value for {entity_label} is not an object; migration was rolled back."
        )
    try:
        canonical_json(value)
    except ValueError as error:
        raise sqlite3.IntegrityError(
            f"Legacy JSON for {entity_label} is not I-JSON compatible; "
            "migration was rolled back."
        ) from error
    return value


def _history_value(value):
    if value is None or isinstance(value, str):
        return value
    # Preserve the established V1 history representation (including its
    # default spacing/ASCII escaping) independently of V2 storage JSON.
    return json.dumps(value)


def _log_changes(cursor, entity_type, entity_id, timestamp, old_data, new_data):
    for key in sorted(set(old_data) | set(new_data), key=_utf16_sort_key):
        old_value = old_data.get(key)
        new_value = new_data.get(key)
        if old_value == new_value and (key in old_data) == (key in new_data):
            continue
        if entity_type == "product":
            cursor.execute(
                """
                INSERT INTO history
                    (ASIN, change_timestamp, changed_key, new_value, old_value)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    entity_id,
                    timestamp,
                    key,
                    _history_value(new_value) if key in new_data else None,
                    _history_value(old_value) if key in old_data else None,
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO entity_audit_log
                    (entity_type, entity_id, change_timestamp, changed_key,
                     new_value, old_value)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    entity_type,
                    entity_id,
                    timestamp,
                    key,
                    _history_value(new_value) if key in new_data else None,
                    _history_value(old_value) if key in old_data else None,
                ),
            )


def log_changes(history_cursor, asin, timestamp, old_data, new_data):
    """Backward-compatible public helper writing the integrated history."""
    _log_changes(history_cursor, "product", asin.upper(), timestamp, old_data, new_data)


def log_entity_changes(history_cursor, entity_type, entity_id, timestamp, old_data, new_data):
    """Backward-compatible public helper writing the integrated audit log."""
    _log_changes(history_cursor, entity_type, entity_id, timestamp, old_data, new_data)


def _product_storage_values(data):
    known = set(PRODUCT_COLUMN_MAP)
    values = {
        column: _json_dump(data[field]) if field in data else None
        for field, column in PRODUCT_COLUMN_MAP.items()
    }
    values["presence_json"] = _json_dump(sorted(data, key=_utf16_sort_key))
    values["unknown_json"] = _json_dump({
        key: value for key, value in data.items() if key not in known
    })
    return values


def _write_record(cursor, entity_type, entity_id, data, legacy_timestamp,
                  record_revision, deleted=False):
    record_json = _canonical_data_json(data)
    presence_json = _json_dump(sorted(data, key=_utf16_sort_key))
    if entity_type == "product":
        values = _product_storage_values(data)
        json_columns = list(PRODUCT_COLUMN_MAP.values())
        assignments = ",\n                ".join(
            f"{column} = excluded.{column}" for column in json_columns
        )
        placeholders = ", ".join("?" for _ in json_columns)
        cursor.execute(
            f"""
            INSERT INTO products (
                asin, legacy_last_update_time, record_json, presence_json,
                unknown_json, {', '.join(json_columns)},
                record_revision, deleted, deleted_revision
            ) VALUES (
                ?, ?, ?, ?, ?, {placeholders}, ?, ?, ?
            )
            ON CONFLICT(asin) DO UPDATE SET
                legacy_last_update_time = excluded.legacy_last_update_time,
                record_json = excluded.record_json,
                presence_json = excluded.presence_json,
                unknown_json = excluded.unknown_json,
                {assignments},
                record_revision = excluded.record_revision,
                deleted = excluded.deleted,
                deleted_revision = excluded.deleted_revision
            """,
            (
                entity_id, legacy_timestamp, record_json,
                values["presence_json"], values["unknown_json"],
                *(values[column] for column in json_columns),
                record_revision, int(deleted),
                record_revision if deleted else None,
            ),
        )
        cursor.execute(
            "DELETE FROM entries WHERE ASIN = ? COLLATE NOCASE", (entity_id,)
        )
        if not deleted:
            cursor.execute(
                """
                INSERT INTO entries (ASIN, last_update_time, value)
                VALUES (?, ?, ?)
                """,
                (entity_id, legacy_timestamp, record_json),
            )
    else:
        cursor.execute(
            """
            INSERT INTO sync_entities (
                entity_type, entity_id, legacy_last_update_time, record_json,
                presence_json, unknown_json, record_revision, deleted,
                deleted_revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                legacy_last_update_time = excluded.legacy_last_update_time,
                record_json = excluded.record_json,
                presence_json = excluded.presence_json,
                unknown_json = excluded.unknown_json,
                record_revision = excluded.record_revision,
                deleted = excluded.deleted,
                deleted_revision = excluded.deleted_revision
            """,
            (
                entity_type, entity_id, legacy_timestamp, record_json,
                presence_json, record_json, record_revision, int(deleted),
                record_revision if deleted else None,
            ),
        )
        legacy_table = GENERIC_ENTITY_CONFIG[entity_type]["legacy_table"]
        if deleted:
            cursor.execute(
                f"DELETE FROM {legacy_table} WHERE entity_id = ?", (entity_id,)
            )
        else:
            cursor.execute(
                f"""
                INSERT INTO {legacy_table} (entity_id, last_update_time, value)
                VALUES (?, ?, ?)
                ON CONFLICT(entity_id) DO UPDATE SET
                    last_update_time = excluded.last_update_time,
                    value = excluded.value
                """,
                (entity_id, legacy_timestamp, record_json),
            )


def _read_record(cursor, entity_type, entity_id, include_deleted=False):
    if entity_type == "product":
        row = cursor.execute(
            """
            SELECT asin AS entity_id, legacy_last_update_time, record_json,
                   record_revision, deleted
            FROM products WHERE asin = ? COLLATE NOCASE
            """,
            (entity_id,),
        ).fetchone()
    else:
        row = cursor.execute(
            """
            SELECT entity_id, legacy_last_update_time, record_json,
                   record_revision, deleted
            FROM sync_entities WHERE entity_type = ? AND entity_id = ?
            """,
            (entity_type, entity_id),
        ).fetchone()
    if row is None or (row["deleted"] and not include_deleted):
        return None
    return {
        "entity_id": row["entity_id"],
        "legacy_last_update_time": row["legacy_last_update_time"],
        "record_revision": row["record_revision"],
        "deleted": bool(row["deleted"]),
        "data": _safe_json_object(row["record_json"]),
    }


def _iter_live_records(cursor, entity_types=None):
    selected = _validate_entity_types(entity_types)
    if "product" in selected:
        for row in cursor.execute(
            """
            SELECT asin AS entity_id, legacy_last_update_time, record_json,
                   record_revision
            FROM products WHERE deleted = 0 ORDER BY asin
            """
        ):
            yield {
                "entity_type": "product",
                "entity_id": row["entity_id"],
                "record_revision": row["record_revision"],
                "legacy_last_update_time": row["legacy_last_update_time"],
                "data": _safe_json_object(row["record_json"]),
            }
    generic = [entity_type for entity_type in selected if entity_type != "product"]
    if generic:
        placeholders = ",".join("?" for _ in generic)
        for row in cursor.execute(
            f"""
            SELECT entity_type, entity_id, legacy_last_update_time,
                   record_json, record_revision
            FROM sync_entities
            WHERE deleted = 0 AND entity_type IN ({placeholders})
            ORDER BY entity_type, entity_id
            """,
            generic,
        ):
            yield {
                "entity_type": row["entity_type"],
                "entity_id": row["entity_id"],
                "record_revision": row["record_revision"],
                "legacy_last_update_time": row["legacy_last_update_time"],
                "data": _safe_json_object(row["record_json"]),
            }


def _dataset_hash_from_records(records):
    projection = [
        {
            "entity_type": record["entity_type"],
            "entity_id": record["entity_id"],
            "data": record["data"],
        }
        for record in sorted(records, key=_entity_sort_key)
    ]
    return _sha256_json(projection)


def dataset_hash(cursor, entity_types=None):
    return _dataset_hash_from_records(list(_iter_live_records(cursor, entity_types)))


def _meta(cursor):
    row = cursor.execute("SELECT * FROM sync_meta WHERE singleton = 1").fetchone()
    if row is None:
        raise sqlite3.DatabaseError("Sync metadata is missing.")
    return dict(row)


def _next_revision(cursor):
    cursor.execute(
        """
        UPDATE sync_meta
        SET current_revision = current_revision + 1, updated_at = ?
        WHERE singleton = 1
        """,
        (int(time.time()),),
    )
    return cursor.execute(
        "SELECT current_revision FROM sync_meta WHERE singleton = 1"
    ).fetchone()[0]


def _record_change(cursor, revision, generation_id, entity_type, entity_id,
                   operation, set_values, unset_fields, data):
    unset_fields = sorted(unset_fields, key=_utf16_sort_key)
    cursor.execute(
        """
        INSERT INTO sync_changes (
            revision, generation_id, entity_type, entity_id, operation,
            record_revision, set_json, unset_json, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            revision, generation_id, entity_type, entity_id, operation,
            revision, _json_dump(set_values), _json_dump(unset_fields),
            _json_dump(data) if data is not None else None, int(time.time()),
        ),
    )


def _update_field_revisions(
    cursor, entity_type, entity_id, fields, revision, intent_timestamp_ms=0
):
    for field in fields:
        cursor.execute(
            """
            INSERT INTO field_revisions
                (entity_type, entity_id, field_name, revision, intent_timestamp_ms)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id, field_name)
            DO UPDATE SET
                revision = excluded.revision,
                intent_timestamp_ms = excluded.intent_timestamp_ms
            """,
            (entity_type, entity_id, field, revision, intent_timestamp_ms),
        )


def _update_field_intent_timestamps(
    cursor, entity_type, entity_id, fields, revision, intent_timestamp_ms
):
    for field in fields:
        cursor.execute(
            """
            INSERT INTO field_revisions
                (entity_type, entity_id, field_name, revision, intent_timestamp_ms)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id, field_name)
            DO UPDATE SET intent_timestamp_ms = excluded.intent_timestamp_ms
            """,
            (entity_type, entity_id, field, revision, intent_timestamp_ms),
        )


def _legacy_tables_from_records(cursor):
    """Keep legacy tables as a recovery mirror, never as V2 authority."""
    cursor.execute("DELETE FROM entries")
    for row in cursor.execute(
        """
        SELECT asin, legacy_last_update_time, record_json
        FROM products WHERE deleted = 0 ORDER BY asin
        """
    ).fetchall():
        cursor.execute(
            "INSERT INTO entries (ASIN, last_update_time, value) VALUES (?, ?, ?)",
            (row["asin"], row["legacy_last_update_time"], row["record_json"]),
        )
    for entity_type, config in GENERIC_ENTITY_CONFIG.items():
        table = config["legacy_table"]
        cursor.execute(f"DELETE FROM {table}")
        rows = cursor.execute(
            """
            SELECT entity_id, legacy_last_update_time, record_json
            FROM sync_entities
            WHERE entity_type = ? AND deleted = 0 ORDER BY entity_id
            """,
            (entity_type,),
        ).fetchall()
        cursor.executemany(
            f"INSERT INTO {table} (entity_id, last_update_time, value) VALUES (?, ?, ?)",
            [
                (row["entity_id"], row["legacy_last_update_time"], row["record_json"])
                for row in rows
            ],
        )


def _import_legacy_history(cursor, history_path, source_database=None):
    if not os.path.exists(history_path) or os.path.getsize(history_path) == 0:
        return
    source = cursor.connection if source_database else connect_sqlite(history_path)
    database = source_database or "main"
    try:
        if source_database and (
            cursor.execute("SELECT 1 FROM history LIMIT 1").fetchone()
            or cursor.execute("SELECT 1 FROM entity_audit_log LIMIT 1").fetchone()
        ):
            raise sqlite3.IntegrityError(
                "Main history tables must be empty before legacy history import."
            )
        if _table_exists(source, "history", database):
            rows = source.execute(
                f"""
                SELECT id, ASIN, change_timestamp, changed_key, new_value, old_value
                FROM {database}.history ORDER BY id
                """
            ).fetchall()
            cursor.executemany(
                """
                INSERT INTO history
                    (id, ASIN, change_timestamp, changed_key, new_value, old_value)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        row["id"], row["ASIN"].upper(),
                        _validate_legacy_timestamp(
                            row["change_timestamp"], "product history"
                        ),
                        row["changed_key"], row["new_value"], row["old_value"],
                    )
                    for row in rows
                ],
            )
        if _table_exists(source, "entity_audit_log", database):
            rows = source.execute(
                f"""
                SELECT id, entity_type, entity_id, change_timestamp, changed_key,
                       new_value, old_value
                FROM {database}.entity_audit_log ORDER BY id
                """
            ).fetchall()
            cursor.executemany(
                """
                INSERT INTO entity_audit_log
                    (id, entity_type, entity_id, change_timestamp, changed_key,
                     new_value, old_value)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        row["id"], row["entity_type"], row["entity_id"],
                        _validate_legacy_timestamp(
                            row["change_timestamp"], "entity history"
                        ),
                        row["changed_key"], row["new_value"], row["old_value"],
                    )
                    for row in rows
                ],
            )
    finally:
        if source_database is None:
            source.close()


def _migrate_legacy_records(cursor):
    rows = cursor.execute(
        "SELECT ASIN, last_update_time, value FROM entries"
    ).fetchall()
    grouped = {}
    for row in rows:
        if not isinstance(row["ASIN"], str) or not row["ASIN"]:
            raise sqlite3.IntegrityError(
                "A legacy product has no valid ASIN; migration was rolled back."
            )
        _validate_legacy_timestamp(row["last_update_time"], "product")
        grouped.setdefault(row["ASIN"].upper(), []).append(row)

    expected = {}
    for asin, variants in grouped.items():
        merged = {}
        ordered = sorted(
            variants,
            key=lambda row: (
                row["last_update_time"], row["ASIN"] == asin, row["ASIN"],
            ),
        )
        for row in ordered:
            merged.update(_legacy_json_object(row["value"], "product"))
        timestamp = max(row["last_update_time"] for row in variants)
        expected[asin] = (timestamp, merged)
        _write_record(cursor, "product", asin, merged, timestamp, 0)
        _update_field_revisions(cursor, "product", asin, merged, 0)

    expected_generic = {}
    for entity_type, config in GENERIC_ENTITY_CONFIG.items():
        legacy_rows = cursor.execute(
            f"SELECT entity_id, last_update_time, value FROM {config['legacy_table']}"
        ).fetchall()
        for row in legacy_rows:
            if not isinstance(row["entity_id"], str) or not row["entity_id"]:
                raise sqlite3.IntegrityError(
                    f"A legacy {entity_type} has no valid ID; migration was rolled back."
                )
            _validate_legacy_timestamp(row["last_update_time"], entity_type)
            data = _legacy_json_object(row["value"], entity_type)
            expected_generic[(entity_type, row["entity_id"])] = (
                row["last_update_time"], data
            )
            _write_record(
                cursor, entity_type, row["entity_id"], data,
                row["last_update_time"], 0,
            )
            _update_field_revisions(cursor, entity_type, row["entity_id"], data, 0)

    migrated_products = cursor.execute(
        "SELECT asin, legacy_last_update_time, record_json FROM products"
    ).fetchall()
    if len(migrated_products) != len(expected):
        raise sqlite3.DatabaseError("Legacy product count verification failed.")
    for row in migrated_products:
        timestamp, data = expected[row["asin"]]
        if row["legacy_last_update_time"] != timestamp:
            raise sqlite3.DatabaseError("Legacy timestamp verification failed.")
        if _safe_json_object(row["record_json"]) != data:
            raise sqlite3.DatabaseError("Legacy product hash verification failed.")

    migrated_generic = cursor.execute(
        """
        SELECT entity_type, entity_id, legacy_last_update_time, record_json
        FROM sync_entities
        """
    ).fetchall()
    if len(migrated_generic) != len(expected_generic):
        raise sqlite3.DatabaseError("Legacy generic entity count verification failed.")
    for row in migrated_generic:
        timestamp, data = expected_generic[(row["entity_type"], row["entity_id"])]
        if row["legacy_last_update_time"] != timestamp:
            raise sqlite3.DatabaseError("Legacy generic timestamp verification failed.")
        if _safe_json_object(row["record_json"]) != data:
            raise sqlite3.DatabaseError("Legacy generic entity verification failed.")


def ensure_sync_schema(connection, token):
    cursor = connection.cursor()
    history_attached = False
    pending_backups = []
    try:
        if _table_exists(connection, "schema_migrations"):
            migration = cursor.execute(
                "SELECT checksum FROM schema_migrations WHERE version = ?",
                (SYNC_SCHEMA_VERSION,),
            ).fetchone()
            if migration:
                if migration["checksum"] != SYNC_MIGRATION_CHECKSUM:
                    raise sqlite3.DatabaseError("Sync schema checksum mismatch.")
                columns = {
                    row["name"] for row in cursor.execute(
                        "PRAGMA table_info(field_revisions)"
                    ).fetchall()
                }
                if "intent_timestamp_ms" not in columns:
                    cursor.execute("BEGIN IMMEDIATE")
                    columns = {
                        row["name"] for row in cursor.execute(
                            "PRAGMA table_info(field_revisions)"
                        ).fetchall()
                    }
                    if "intent_timestamp_ms" not in columns:
                        cursor.execute(
                            "ALTER TABLE field_revisions ADD COLUMN "
                            "intent_timestamp_ms INTEGER NOT NULL DEFAULT 0"
                        )
                    connection.commit()
                return
        history_path = get_history_db_path(token)
        if os.path.exists(history_path) and os.path.getsize(history_path) > 0:
            cursor.execute("ATTACH DATABASE ? AS legacy_history", (history_path,))
            history_attached = True
        # BEGIN IMMEDIATE covers both the main and attached history database.
        # This prevents a legacy writer from changing history halfway through
        # the verified import.
        cursor.execute("BEGIN IMMEDIATE")
        if history_attached:
            history_integrity = cursor.execute(
                "PRAGMA legacy_history.integrity_check"
            ).fetchone()[0]
            if history_integrity != "ok":
                raise sqlite3.DatabaseError(
                    "Legacy history database integrity verification failed."
                )
        # sqlite3.executescript() issues an implicit COMMIT before executing.
        # Execute each DDL statement ourselves so schema creation, legacy
        # import, verification and migration marker truly share one lock and
        # one rollback boundary.
        for statement in _schema_sql().split(";"):
            statement = statement.strip()
            if statement:
                cursor.execute(statement)
        migration = cursor.execute(
            "SELECT checksum FROM schema_migrations WHERE version = ?",
            (SYNC_SCHEMA_VERSION,),
        ).fetchone()
        if migration and migration["checksum"] == SYNC_MIGRATION_CHECKSUM:
            connection.commit()
            return
        if migration:
            raise sqlite3.DatabaseError("Sync schema checksum mismatch.")

        # A missing backup is published immediately, so even a malformed
        # legacy database has a raw recovery point. If a backup already
        # exists, keep it until this source passes the semantic migration
        # checks below; only then replace it with the fresher snapshot.
        for source_path in (get_db_path(token), history_path):
            candidate = _backup_once(source_path)
            if candidate:
                pending_backups.append((
                    candidate,
                    f"{source_path}.pre-sync-v2.bak",
                ))

        now = int(time.time())
        cursor.execute(
            """
            INSERT OR IGNORE INTO sync_meta (
                singleton, generation_id, current_revision,
                min_available_revision, canonicalization_version,
                sync_core_version, last_pruned_at, updated_at
            ) VALUES (1, ?, 0, 0, ?, ?, 0, ?)
            """,
            (str(uuid.uuid4()), CANONICALIZATION_VERSION, SYNC_CORE_VERSION, now),
        )
        _migrate_legacy_records(cursor)
        _import_legacy_history(
            cursor, history_path,
            "legacy_history" if history_attached else None,
        )
        _legacy_tables_from_records(cursor)
        cursor.execute(
            """
            INSERT INTO schema_migrations (version, checksum, applied_at)
            VALUES (?, ?, ?)
            """,
            (SYNC_SCHEMA_VERSION, SYNC_MIGRATION_CHECKSUM, now),
        )
        foreign_key_errors = cursor.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise sqlite3.DatabaseError("Foreign key verification failed.")
        integrity = cursor.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise sqlite3.DatabaseError("Database integrity verification failed.")
        for candidate, backup_path in pending_backups:
            _publish_backup_candidate(candidate, backup_path)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        for candidate, _backup_path in pending_backups:
            _remove_backup_candidate(candidate)
        if history_attached:
            connection.execute("DETACH DATABASE legacy_history")
        cursor.close()


def _open_database(token):
    path = get_db_path(token)
    connection = connect_sqlite(path)
    try:
        ensure_sync_schema(connection, token)
        return connection
    except Exception:
        connection.close()
        raise


def get_db_conn(token):
    """Open and migrate the token database; retained for existing deployments."""
    connection = _open_database(token)
    return connection, connection.cursor()


def get_history_db_conn(token):
    """History is integrated in DATABASE_ from V2 onward."""
    connection = _open_database(token)
    return connection, connection.cursor()


def ensure_generic_tables(connection):
    """Compatibility no-op: generic tables are part of the atomic schema."""
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS storage_locations (
            entity_id TEXT PRIMARY KEY,
            last_update_time INTEGER NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS procedure_docs (
            entity_id TEXT PRIMARY KEY,
            last_update_time INTEGER NOT NULL,
            value TEXT NOT NULL
        );
    """)


def ensure_entity_audit_table(connection):
    """Compatibility no-op: entity audit is part of the atomic schema."""
    connection.execute("""
        CREATE TABLE IF NOT EXISTS entity_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            change_timestamp INTEGER NOT NULL,
            changed_key TEXT NOT NULL,
            new_value TEXT,
            old_value TEXT
        )
    """)


def get_generic_entity_config(entity_type):
    config = GENERIC_ENTITY_CONFIG.get(entity_type)
    if config is None:
        raise ValueError(f"Unknown entity type: {entity_type}")
    return {"table": config["legacy_table"], "id_field": config["id_field"]}


def _validate_entity_types(value):
    if value is None:
        return list(SUPPORTED_ENTITY_TYPES)
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, str) for item in value)
    ):
        raise SyncProtocolError("entity_types must be a non-empty list of strings.")
    unknown = sorted(set(value) - set(SUPPORTED_ENTITY_TYPES))
    if unknown:
        raise SyncProtocolError(f"Unsupported entity_types: {', '.join(unknown)}")
    return [item for item in SUPPORTED_ENTITY_TYPES if item in set(value)]


def _canonical_entity_id(entity_type, entity_id):
    if not isinstance(entity_id, str) or not entity_id:
        raise SyncProtocolError("entity_id must be a non-empty string.")
    if entity_type == "product":
        entity_id = entity_id.upper()
        if not re.fullmatch(r"[A-Z0-9]{10}", entity_id):
            raise SyncProtocolError("Product entity_id must be a 10-character ASIN.")
    return entity_id


def _validate_generation(cursor, generation_id):
    meta = _meta(cursor)
    if not isinstance(generation_id, str) or generation_id != meta["generation_id"]:
        raise SyncProtocolError(
            "The client generation does not match this dataset.",
            status=409, code="generation_mismatch", snapshot_required=True,
            generation_id=meta["generation_id"],
            current_revision=meta["current_revision"],
            min_available_revision=meta["min_available_revision"],
        )
    return meta


def _next_legacy_timestamp(existing):
    now = int(time.time())
    return max(now, existing or 0)


def _validate_mutation(raw, batch_client_id=None):
    if not isinstance(raw, dict):
        raise SyncProtocolError("Each mutation must be an object.")
    mutation_id = raw.get("mutation_id")
    client_id = raw.get("client_id", batch_client_id)
    if not isinstance(mutation_id, str) or not mutation_id or len(mutation_id) > 200:
        raise SyncProtocolError(
            "mutation_id must be a non-empty string of at most 200 characters."
        )
    if not isinstance(client_id, str) or not client_id or len(client_id) > 200:
        raise SyncProtocolError("client_id must be supplied for every mutation or batch.")
    entity_type = raw.get("entity_type")
    if entity_type not in SUPPORTED_ENTITY_TYPES:
        raise SyncProtocolError("Unsupported mutation entity_type.")
    entity_id = _canonical_entity_id(entity_type, raw.get("entity_id"))
    base_revision = raw.get("base_revision")
    if not isinstance(base_revision, int) or isinstance(base_revision, bool) or base_revision < 0:
        raise SyncProtocolError("base_revision must be a non-negative integer.")
    operation = raw.get("operation")
    if operation not in {"patch", "delete"}:
        raise SyncProtocolError("operation must be 'patch' or 'delete'.")
    if entity_type == "product" and operation == "delete":
        raise SyncProtocolError(
            "Product records cannot be deleted; use usageStatus 'storniert'."
        )
    intent_age_ms = raw.get("intent_age_ms")
    if intent_age_ms is not None and (
        not isinstance(intent_age_ms, int)
        or isinstance(intent_age_ms, bool)
        or not 0 <= intent_age_ms <= MAX_SAFE_JSON_INTEGER
    ):
        raise SyncProtocolError(
            "intent_age_ms must be a non-negative safe integer."
        )
    if operation == "patch":
        set_values = raw.get("set", {})
        unset_fields = raw.get("unset", [])
        authoritative_fields = raw.get("authoritative_fields", [])
        if not isinstance(set_values, dict) or not all(
            isinstance(key, str) and key for key in set_values
        ):
            raise SyncProtocolError("set must be an object with non-empty string keys.")
        if not isinstance(unset_fields, list) or not all(
            isinstance(field, str) and field for field in unset_fields
        ):
            raise SyncProtocolError("unset must be a list of non-empty field names.")
        if len(unset_fields) != len(set(unset_fields)):
            raise SyncProtocolError("unset must not contain duplicate fields.")
        overlap = set(set_values) & set(unset_fields)
        if overlap:
            raise SyncProtocolError("A field cannot occur in both set and unset.")
        if not isinstance(authoritative_fields, list) or not all(
            isinstance(field, str) and field for field in authoritative_fields
        ):
            raise SyncProtocolError(
                "authoritative_fields must be a list of non-empty field names."
            )
        if len(authoritative_fields) != len(set(authoritative_fields)):
            raise SyncProtocolError("authoritative_fields must not contain duplicates.")
        requested_fields = set(set_values) | set(unset_fields)
        if not set(authoritative_fields) <= requested_fields:
            raise SyncProtocolError(
                "authoritative_fields must also occur in set or unset."
            )
        if authoritative_fields and (
            entity_type != "product"
            or not set(authoritative_fields) <= AUTHORITATIVE_PRODUCT_FIELDS
        ):
            raise SyncProtocolError("Only product status fields may be authoritative.")
    else:
        if raw.get("set") not in (None, {}):
            raise SyncProtocolError("A delete mutation cannot contain set values.")
        if raw.get("unset") not in (None, []):
            raise SyncProtocolError("A delete mutation cannot contain unset fields.")
        set_values = {}
        unset_fields = []
        authoritative_fields = []
    normalized = {
        "mutation_id": mutation_id,
        "client_id": client_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "base_revision": base_revision,
        "operation": operation,
        "set": set_values,
        "unset": unset_fields,
        "authoritative_fields": authoritative_fields,
        "intent_age_ms": intent_age_ms,
    }
    # Validate all values now, before acquiring the write lock.
    canonical_json(normalized)
    return normalized


def _receipt_hash(mutation):
    stable_mutation = {
        key: value for key, value in mutation.items() if key != "intent_age_ms"
    }
    return _sha256_json(stable_mutation)


def _stored_receipt(cursor, mutation):
    row = cursor.execute(
        "SELECT request_hash, response_json FROM mutation_receipts WHERE mutation_id = ?",
        (mutation["mutation_id"],),
    ).fetchone()
    if row is None:
        return None
    if row["request_hash"] != _receipt_hash(mutation):
        raise SyncProtocolError(
            "mutation_id was already used with different content.",
            status=409, code="mutation_id_reused",
        )
    return json.loads(row["response_json"])


def _store_receipt(cursor, mutation, generation_id, result):
    if result["status"] == "conflict":
        cursor.execute(
            """
            INSERT INTO sync_conflicts (
                mutation_id, client_id, entity_type, entity_id,
                base_revision, conflict_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mutation["mutation_id"], mutation["client_id"],
                mutation["entity_type"], mutation["entity_id"],
                mutation["base_revision"], _json_dump(result["conflict"]),
                int(time.time()),
            ),
        )
    cursor.execute(
        """
        INSERT INTO mutation_receipts (
            mutation_id, client_id, request_hash, generation_id,
            response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            mutation["mutation_id"], mutation["client_id"],
            _receipt_hash(mutation), generation_id, _json_dump(result),
            int(time.time()),
        ),
    )


def _field_revisions(cursor, entity_type, entity_id, fields):
    if not fields:
        return {}
    placeholders = ",".join("?" for _ in fields)
    rows = cursor.execute(
        f"""
        SELECT field_name, revision, intent_timestamp_ms FROM field_revisions
        WHERE entity_type = ? AND entity_id = ?
          AND field_name IN ({placeholders})
        """,
        (entity_type, entity_id, *fields),
    ).fetchall()
    return {
        row["field_name"]: {
            "revision": row["revision"],
            "intent_timestamp_ms": row["intent_timestamp_ms"],
        }
        for row in rows
    }


def _apply_mutation(cursor, generation_id, mutation):
    cached = _stored_receipt(cursor, mutation)
    if cached is not None:
        return cached

    entity_type = mutation["entity_type"]
    entity_id = mutation["entity_id"]
    current = _read_record(cursor, entity_type, entity_id, include_deleted=True)
    current_data = current["data"] if current and not current["deleted"] else {}
    current_revision = current["record_revision"] if current else 0

    if mutation["operation"] == "delete":
        if current is None or current["deleted"]:
            result = {
                "mutation_id": mutation["mutation_id"],
                "status": "noop",
                "entity_type": entity_type,
                "entity_id": entity_id,
                "revision": current_revision or mutation["base_revision"],
                "data": None,
            }
            _store_receipt(cursor, mutation, generation_id, result)
            return result
        if current_revision > mutation["base_revision"]:
            result = {
                "mutation_id": mutation["mutation_id"],
                "status": "conflict",
                "entity_type": entity_type,
                "entity_id": entity_id,
                "conflict": {
                    "fields": {
                        "__record__": {
                            "reason": "changed_since_base",
                            "server_revision": current_revision,
                        }
                    },
                    "server_revision": current_revision,
                    "server_data": current_data,
                },
            }
            _store_receipt(cursor, mutation, generation_id, result)
            return result

        revision = _next_revision(cursor)
        legacy_timestamp = _next_legacy_timestamp(current["legacy_last_update_time"])
        _log_changes(cursor, entity_type, entity_id, int(time.time()), current_data, {})
        _write_record(
            cursor, entity_type, entity_id, {}, legacy_timestamp, revision,
            deleted=True,
        )
        cursor.execute(
            """
            INSERT INTO tombstones (entity_type, entity_id, revision, deleted_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                revision = excluded.revision,
                deleted_at = excluded.deleted_at
            """,
            (entity_type, entity_id, revision, int(time.time())),
        )
        _update_field_revisions(cursor, entity_type, entity_id, current_data, revision)
        _record_change(
            cursor, revision, generation_id, entity_type, entity_id,
            "delete", {}, sorted(current_data, key=_utf16_sort_key), None,
        )
        result = {
            "mutation_id": mutation["mutation_id"],
            "status": "applied",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "revision": revision,
            "data": None,
        }
        _store_receipt(cursor, mutation, generation_id, result)
        return result

    if (
        entity_type != "product"
        and current
        and current["deleted"]
        and current_revision > mutation["base_revision"]
    ):
        result = {
            "mutation_id": mutation["mutation_id"],
            "status": "conflict",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "conflict": {
                "fields": {
                    "__record__": {
                        "reason": "deleted_since_base",
                        "server_revision": current_revision,
                    }
                },
                "server_revision": current_revision,
                "server_data": None,
            },
        }
        _store_receipt(cursor, mutation, generation_id, result)
        return result

    requested_fields = sorted(
        set(mutation["set"]) | set(mutation["unset"]), key=_utf16_sort_key
    )
    revisions = _field_revisions(cursor, entity_type, entity_id, requested_fields)
    conflict_fields = {}
    authoritative_fields = set(mutation.get("authoritative_fields", []))
    intent_age_ms = mutation.get("intent_age_ms")
    if entity_type == "product":
        # The outbox age is measured from the user's local change to this
        # attempt, then normalized onto the server clock. Legacy V2 clients
        # without an age retain server-arrival semantics.
        server_received_ms = int(time.time() * 1000)
        intent_timestamp_ms = max(0, server_received_ms - (intent_age_ms or 0))
        authoritative_fields = {
            field for field in requested_fields
            if intent_timestamp_ms >= revisions.get(field, {}).get(
                "intent_timestamp_ms", 0
            )
        }
    ignored_fields = sorted(
        set(requested_fields) - authoritative_fields,
        key=_utf16_sort_key,
    ) if entity_type == "product" else []
    for field in requested_fields:
        if field in authoritative_fields:
            continue
        if entity_type == "product":
            continue
        field_revision = revisions.get(field, {}).get("revision", 0)
        if field_revision <= mutation["base_revision"]:
            continue
        if field in mutation["set"]:
            server_present = field in current_data
            same_target = server_present and current_data[field] == mutation["set"][field]
            if not same_target:
                conflict_fields[field] = {
                    "reason": "changed_since_base",
                    "server_revision": field_revision,
                    "server_value": current_data.get(field),
                    "server_present": server_present,
                    "client_value": mutation["set"][field],
                    "client_present": True,
                }
        else:
            same_target = field not in current_data
            if not same_target:
                conflict_fields[field] = {
                    "reason": "changed_since_base",
                    "server_revision": field_revision,
                    "server_value": current_data[field],
                    "server_present": True,
                    "client_present": False,
                }
    if conflict_fields:
        result = {
            "mutation_id": mutation["mutation_id"],
            "status": "conflict",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "conflict": {
                "fields": conflict_fields,
                "server_revision": (
                    current_revision if current and not current["deleted"] else None
                ),
                "server_data": (
                    current_data if current and not current["deleted"] else None
                ),
            },
        }
        _store_receipt(cursor, mutation, generation_id, result)
        return result

    target = dict(current_data)
    effective_set = {}
    effective_unset = []
    for field, value in mutation["set"].items():
        if entity_type == "product" and field not in authoritative_fields:
            continue
        if field not in target or target[field] != value:
            target[field] = value
            effective_set[field] = value
    for field in mutation["unset"]:
        if entity_type == "product" and field not in authoritative_fields:
            continue
        if field in target:
            del target[field]
            effective_unset.append(field)
    if not effective_set and not effective_unset:
        if entity_type == "product" and authoritative_fields:
            _update_field_intent_timestamps(
                cursor, entity_type, entity_id, authoritative_fields,
                current_revision, intent_timestamp_ms,
            )
        result = {
            "mutation_id": mutation["mutation_id"],
            "status": "noop",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "revision": current_revision if current else mutation["base_revision"],
            "data": current_data,
            "ignored_fields": ignored_fields,
        }
        _store_receipt(cursor, mutation, generation_id, result)
        return result

    revision = _next_revision(cursor)
    legacy_timestamp = _next_legacy_timestamp(
        current["legacy_last_update_time"] if current else None
    )
    _log_changes(cursor, entity_type, entity_id, int(time.time()), current_data, target)
    _write_record(cursor, entity_type, entity_id, target, legacy_timestamp, revision)
    cursor.execute(
        "DELETE FROM tombstones WHERE entity_type = ? AND entity_id = ?",
        (entity_type, entity_id),
    )
    _update_field_revisions(
        cursor, entity_type, entity_id,
        sorted(set(effective_set) | set(effective_unset), key=_utf16_sort_key),
        revision,
        intent_timestamp_ms if entity_type == "product" else 0,
    )
    if entity_type == "product":
        unchanged_accepted = authoritative_fields - set(effective_set) - set(effective_unset)
        _update_field_intent_timestamps(
            cursor, entity_type, entity_id, unchanged_accepted,
            revision, intent_timestamp_ms,
        )
    _record_change(
        cursor, revision, generation_id, entity_type, entity_id, "upsert",
        effective_set, effective_unset, target,
    )
    result = {
        "mutation_id": mutation["mutation_id"],
        "status": "applied",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "revision": revision,
        "data": target,
        "ignored_fields": ignored_fields,
    }
    _store_receipt(cursor, mutation, generation_id, result)
    return result


def _prune_change_log(cursor):
    meta = _meta(cursor)
    now = int(time.time())
    if now - meta["last_pruned_at"] < 24 * 60 * 60:
        return
    revision_cutoff = meta["current_revision"] - CHANGE_RETENTION_REVISIONS
    time_cutoff = now - CHANGE_RETENTION_SECONDS
    deleted = cursor.execute(
        """
        SELECT MAX(revision) FROM sync_changes
        WHERE revision <= ? AND created_at < ?
        """,
        (revision_cutoff, time_cutoff),
    ).fetchone()[0]
    if deleted is not None:
        cursor.execute(
            "DELETE FROM sync_changes WHERE revision <= ? AND created_at < ?",
            (revision_cutoff, time_cutoff),
        )
        cursor.execute(
            """
            UPDATE sync_meta
            SET min_available_revision = MAX(min_available_revision, ?)
            WHERE singleton = 1
            """,
            (deleted,),
        )
    cursor.execute(
        "UPDATE sync_meta SET last_pruned_at = ? WHERE singleton = 1", (now,)
    )


def sync_capabilities(connection, cursor, payload=None):
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise SyncProtocolError(
            "get_capabilities_v2 payload must be an object.",
            code="invalid_payload",
        )
    try:
        cursor.execute("BEGIN")
        entity_types = _validate_entity_types(payload.get("entity_types"))
        meta = _meta(cursor)
        body = {
            "status": "success",
            "protocol_version": 2,
            "sync_core_version": SYNC_CORE_VERSION,
            "canonicalization": CANONICALIZATION_VERSION,
            "generation_id": meta["generation_id"],
            "current_revision": meta["current_revision"],
            "min_available_revision": meta["min_available_revision"],
            "entity_types": list(SUPPORTED_ENTITY_TYPES),
            "hash_entity_types": entity_types,
            "limits": {
                "push_mutations": MAX_PUSH_MUTATIONS,
                "pull_changes": MAX_PULL_CHANGES,
                "snapshot_records": MAX_SNAPSHOT_RECORDS,
            },
            "features": {
                "push_pull_exchange": True,
                "on_demand_pull_hash": True,
                "authoritative_status_fields": True,
                "product_last_write_wins": True,
                "product_intent_age_lww": True,
                "product_delete_supported": False,
            },
        }
        connection.commit()
        return body
    except Exception:
        connection.rollback()
        raise


def _collect_sync_changes(cursor, cursor_value, limit, entity_types, include_hash=False):
    """Collect one change-log page for pull or the V2.1 push exchange."""
    meta = _meta(cursor)
    placeholders = ",".join("?" for _ in entity_types)
    rows = cursor.execute(
        f"""
        SELECT * FROM sync_changes
        WHERE revision > ? AND revision <= ?
          AND (entity_type IN ({placeholders}) OR operation = 'dataset_reset')
        ORDER BY revision
        LIMIT ?
        """,
        (cursor_value, meta["current_revision"], *entity_types, limit + 1),
    ).fetchall()
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    changes = []
    for row in page_rows:
        data = _safe_json_object(row["record_json"]) if row["record_json"] else None
        changes.append({
            "revision": row["revision"],
            "entity_type": row["entity_type"],
            "entity_id": row["entity_id"],
            "operation": row["operation"],
            "set": _safe_json_object(row["set_json"]),
            "unset": json.loads(row["unset_json"]),
            "data": data,
        })
    next_cursor = (
        page_rows[-1]["revision"]
        if has_more and page_rows else meta["current_revision"]
    )
    return {
        "changes": changes,
        "next_cursor": next_cursor,
        "current_revision": meta["current_revision"],
        "min_available_revision": meta["min_available_revision"],
        "generation_id": meta["generation_id"],
        "has_more": has_more,
        "hash_entity_types": entity_types,
        "dataset_hash": (
            dataset_hash(cursor, entity_types)
            if include_hash and not has_more else None
        ),
    }


def sync_push(connection, cursor, payload):
    if not isinstance(payload, dict):
        raise SyncProtocolError(
            "sync_v2_push payload must be an object.", code="invalid_payload"
        )
    meta = _validate_generation(cursor, payload.get("generation_id"))
    raw_mutations = payload.get("mutations")
    if not isinstance(raw_mutations, list):
        raise SyncProtocolError("mutations must be a list.", code="invalid_payload")
    if len(raw_mutations) > MAX_PUSH_MUTATIONS:
        raise SyncProtocolError(
            f"A push may contain at most {MAX_PUSH_MUTATIONS} mutations.",
            code="batch_too_large",
        )
    try:
        mutations = [
            _validate_mutation(raw, payload.get("client_id"))
            for raw in raw_mutations
        ]
    except SyncProtocolError as error:
        error.code = "invalid_mutation"
        raise
    except ValueError as error:
        raise SyncProtocolError(str(error), code="invalid_mutation") from error
    mutation_ids = [mutation["mutation_id"] for mutation in mutations]
    if len(mutation_ids) != len(set(mutation_ids)):
        raise SyncProtocolError(
            "A push batch must not contain duplicate mutation IDs.",
            code="duplicate_mutation_id",
        )
    pull_since = payload.get("pull_since")
    pull_limit = payload.get("pull_limit", MAX_PULL_CHANGES)
    if pull_since is not None:
        if (
            not isinstance(pull_since, int)
            or isinstance(pull_since, bool)
            or pull_since < 0
        ):
            raise SyncProtocolError(
                "pull_since must be a non-negative integer.", code="invalid_cursor"
            )
        if (
            not isinstance(pull_limit, int)
            or isinstance(pull_limit, bool)
            or not 1 <= pull_limit <= MAX_PULL_CHANGES
        ):
            raise SyncProtocolError(
                f"pull_limit must be between 1 and {MAX_PULL_CHANGES}.",
                code="invalid_limit",
            )
        try:
            pull_entity_types = _validate_entity_types(payload.get("entity_types"))
        except SyncProtocolError as error:
            error.code = "invalid_payload"
            raise
    else:
        pull_entity_types = None
    try:
        cursor.execute("BEGIN IMMEDIATE")
        meta = _validate_generation(cursor, payload.get("generation_id"))
        if pull_since is not None:
            if pull_since < meta["min_available_revision"]:
                raise SyncProtocolError(
                    "The requested cursor is no longer available.",
                    status=409, code="cursor_expired", snapshot_required=True,
                    min_available_revision=meta["min_available_revision"],
                    generation_id=meta["generation_id"],
                    current_revision=meta["current_revision"],
                )
            if pull_since > meta["current_revision"]:
                raise SyncProtocolError(
                    "The requested cursor is ahead of the server.",
                    status=409, code="cursor_ahead", snapshot_required=True,
                    min_available_revision=meta["min_available_revision"],
                    generation_id=meta["generation_id"],
                    current_revision=meta["current_revision"],
                )
        if any(
            mutation["base_revision"] > meta["current_revision"]
            for mutation in mutations
        ):
            raise SyncProtocolError(
                "A mutation base revision is ahead of the server.",
                status=409,
                code="base_revision_ahead",
                generation_id=meta["generation_id"],
                current_revision=meta["current_revision"],
                min_available_revision=meta["min_available_revision"],
            )
        # Preflight all reused IDs before applying any mutation in this batch.
        for mutation in mutations:
            _stored_receipt(cursor, mutation)
        results = [
            _apply_mutation(cursor, meta["generation_id"], mutation)
            for mutation in mutations
        ]
        _prune_change_log(cursor)
        current_revision = _meta(cursor)["current_revision"]
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    body = {
        "status": "success",
        "generation_id": meta["generation_id"],
        "current_revision": current_revision,
        "results": results,
    }
    if pull_since is not None:
        body.update(_collect_sync_changes(
            cursor,
            pull_since,
            pull_limit,
            pull_entity_types,
            include_hash=False,
        ))
    return body


def sync_pull(connection, cursor, payload):
    if not isinstance(payload, dict):
        raise SyncProtocolError(
            "sync_v2_pull payload must be an object.", code="invalid_payload"
        )
    cursor.execute("BEGIN")
    meta = _validate_generation(cursor, payload.get("generation_id"))
    cursor_value = payload.get("cursor")
    if not isinstance(cursor_value, int) or isinstance(cursor_value, bool) or cursor_value < 0:
        raise SyncProtocolError(
            "cursor must be a non-negative integer.", code="invalid_cursor"
        )
    if cursor_value < meta["min_available_revision"]:
        raise SyncProtocolError(
            "The requested cursor is no longer available.",
            status=409, code="cursor_expired", snapshot_required=True,
            min_available_revision=meta["min_available_revision"],
            generation_id=meta["generation_id"],
            current_revision=meta["current_revision"],
        )
    if cursor_value > meta["current_revision"]:
        raise SyncProtocolError(
            "The requested cursor is ahead of the server.",
            status=409, code="cursor_ahead", snapshot_required=True,
            current_revision=meta["current_revision"],
            generation_id=meta["generation_id"],
            min_available_revision=meta["min_available_revision"],
        )
    limit = payload.get("limit", MAX_PULL_CHANGES)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_PULL_CHANGES:
        raise SyncProtocolError(
            f"limit must be between 1 and {MAX_PULL_CHANGES}.",
            code="invalid_limit",
        )
    try:
        entity_types = _validate_entity_types(payload.get("entity_types"))
    except SyncProtocolError as error:
        error.code = "invalid_payload"
        raise
    include_hash = payload.get("include_hash", False)
    if not isinstance(include_hash, bool):
        raise SyncProtocolError(
            "include_hash must be a boolean.", code="invalid_payload"
        )
    body = {
        "status": "success",
        **_collect_sync_changes(
            cursor, cursor_value, limit, entity_types, include_hash=include_hash
        ),
    }
    connection.commit()
    return body


def _create_snapshot(connection, cursor, generation_id, entity_types):
    try:
        cursor.execute("BEGIN IMMEDIATE")
        meta = _meta(cursor)
        if generation_id is not None:
            _validate_generation(cursor, generation_id)
        now = int(time.time())
        cursor.execute("DELETE FROM sync_snapshot_sessions WHERE expires_at < ?", (now,))
        records = sorted(
            _iter_live_records(cursor, entity_types), key=_entity_sort_key
        )
        session_id = str(uuid.uuid4())
        digest = _dataset_hash_from_records(records)
        cursor.execute(
            """
            INSERT INTO sync_snapshot_sessions (
                session_id, generation_id, snapshot_revision,
                entity_types_json, dataset_hash, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id, meta["generation_id"], meta["current_revision"],
                _json_dump(entity_types), digest, now,
                now + SNAPSHOT_TTL_SECONDS,
            ),
        )
        cursor.executemany(
            """
            INSERT INTO sync_snapshot_records (
                session_id, position, entity_type, entity_id,
                record_revision, legacy_last_update_time, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    session_id, position, record["entity_type"], record["entity_id"],
                    record["record_revision"], record["legacy_last_update_time"],
                    _json_dump(record["data"]),
                )
                for position, record in enumerate(records)
            ],
        )
        connection.commit()
        return session_id
    except Exception:
        connection.rollback()
        raise


def sync_snapshot(connection, cursor, payload):
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise SyncProtocolError(
            "sync_v2_snapshot payload must be an object.", code="invalid_payload"
        )
    offset = payload.get("offset", 0)
    limit = payload.get("limit", MAX_SNAPSHOT_RECORDS)
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise SyncProtocolError(
            "offset must be a non-negative integer.", code="invalid_offset"
        )
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_SNAPSHOT_RECORDS:
        raise SyncProtocolError(
            f"limit must be between 1 and {MAX_SNAPSHOT_RECORDS}.",
            code="invalid_limit",
        )
    session_id = payload.get("session_id")
    if session_id is None:
        try:
            entity_types = _validate_entity_types(payload.get("entity_types"))
        except SyncProtocolError as error:
            error.code = "invalid_payload"
            raise
        session_id = _create_snapshot(
            connection, cursor, payload.get("generation_id"), entity_types,
        )
    elif not isinstance(session_id, str) or not session_id:
        raise SyncProtocolError(
            "session_id must be a non-empty string.", code="invalid_session"
        )

    try:
        # Keep session metadata and the corresponding record page on the same
        # SQLite read snapshot.  Otherwise a concurrent delete_all could remove
        # the records after the session row had already been accepted.
        cursor.execute("BEGIN")
        row = cursor.execute(
            "SELECT * FROM sync_snapshot_sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if row is None or row["expires_at"] < int(time.time()):
            meta = _meta(cursor)
            raise SyncProtocolError(
                "The snapshot session is missing or expired; start a new snapshot.",
                status=409, code="snapshot_expired", snapshot_required=True,
                generation_id=meta["generation_id"],
                current_revision=meta["current_revision"],
                min_available_revision=meta["min_available_revision"],
            )
        entity_types = json.loads(row["entity_types_json"])
        records = cursor.execute(
            """
            SELECT * FROM sync_snapshot_records
            WHERE session_id = ? AND position >= ?
            ORDER BY position LIMIT ?
            """,
            (session_id, offset, limit + 1),
        ).fetchall()
        page = records[:limit]
        has_more = len(records) > limit
        next_offset = offset + len(page)
        body = {
            "status": "success",
            "session_id": session_id,
            "generation_id": row["generation_id"],
            "snapshot_revision": row["snapshot_revision"],
            "records": [
                {
                    "entity_type": record["entity_type"],
                    "entity_id": record["entity_id"],
                    "record_revision": record["record_revision"],
                    "legacy_last_update_time": record["legacy_last_update_time"],
                    "data": _safe_json_object(record["record_json"]),
                }
                for record in page
            ],
            "next_offset": next_offset,
            "has_more": has_more,
            "hash_entity_types": entity_types,
            "dataset_hash": row["dataset_hash"],
        }
        connection.commit()
        return body
    except Exception:
        connection.rollback()
        raise


# === VINE SYNC CORE END =================================================


# --- V1 adapters ---------------------------------------------------------

def _legacy_rows(cursor, entity_type, entity_ids=None):
    config = GENERIC_ENTITY_CONFIG.get(entity_type)
    table = "entries" if entity_type == "product" else config["legacy_table"]
    source_id_field = "ASIN" if entity_type == "product" else "entity_id"
    response_id_field = "ASIN" if entity_type == "product" else config["id_field"]
    parameters = []
    where = ""
    if entity_ids is not None:
        parameters = [
            entity_id.upper() if entity_type == "product" else entity_id
            for entity_id in entity_ids
        ]
        if not parameters:
            return []
        placeholders = ",".join("?" for _ in parameters)
        collation = " COLLATE NOCASE" if entity_type == "product" else ""
        where = f"WHERE {source_id_field}{collation} IN ({placeholders})"
    rows = cursor.execute(
        f"""
        SELECT {source_id_field} AS entity_id, last_update_time, value
        FROM {table} {where}
        ORDER BY {source_id_field}
        """,
        parameters,
    ).fetchall()
    return [
        {
            response_id_field: row["entity_id"],
            "last_update_time": row["last_update_time"],
            "value": row["value"],
        }
        for row in rows
    ]


def _validate_v1_batch(payload, entity_type):
    if not isinstance(payload, list):
        request_name = "update_asin" if entity_type == "product" else f"update_{entity_type}"
        raise V1RequestError(
            f"Invalid payload for {request_name}. Expected a list of entry objects."
        )
    id_field = "ASIN" if entity_type == "product" else GENERIC_ENTITY_CONFIG[entity_type]["id_field"]
    validated = []
    for item in payload:
        if not isinstance(item, dict) or not all(key in item for key in (id_field, "timestamp", "value")):
            message = (
                "Invalid item structure in payload."
                if entity_type == "product"
                else f"Invalid item structure in update_{entity_type} payload."
            )
            raise V1RequestError(message)
        entity_id = item[id_field]
        if entity_type == "product":
            if not isinstance(entity_id, str) or len(entity_id) != 10:
                raise V1RequestError(f"Invalid ASIN format: {entity_id}")
            entity_id = entity_id.upper()
        elif not isinstance(entity_id, str) or not entity_id:
            raise V1RequestError(f"Invalid ID for {entity_type}: {entity_id}")
        timestamp = item["timestamp"]
        if not isinstance(timestamp, int) or isinstance(timestamp, bool):
            label = f"ASIN {entity_id}" if entity_type == "product" else entity_id
            raise V1RequestError(f"Invalid timestamp for {label}: must be an integer.")
        if abs(timestamp) > MAX_SAFE_JSON_INTEGER:
            label = f"ASIN {entity_id}" if entity_type == "product" else entity_id
            raise V1RequestError(
                f"Invalid timestamp for {label}: outside the safe integer range."
            )
        raw_value = item["value"]
        if not isinstance(raw_value, str):
            label = f"ASIN {entity_id}" if entity_type == "product" else entity_id
            raise V1RequestError(f"Invalid value for {label}: must be a string.")
        try:
            data = json.loads(raw_value)
        except json.JSONDecodeError:
            label = f"ASIN {entity_id}" if entity_type == "product" else entity_id
            raise V1RequestError(f"Invalid JSON in value for {label}.")
        if not isinstance(data, dict):
            label = f"ASIN {entity_id}" if entity_type == "product" else entity_id
            raise V1RequestError(f"Invalid JSON in value for {label}: expected an object.")
        try:
            canonical_json(data)
        except ValueError as error:
            label = f"ASIN {entity_id}" if entity_type == "product" else entity_id
            raise V1RequestError(
                f"Invalid JSON in value for {label}: {error}"
            ) from error
        validated.append((entity_id, timestamp, data))
    return validated


def _v1_update(connection, cursor, payload, entity_type):
    items = _validate_v1_batch(payload, entity_type)
    inserted = updated = skipped = 0
    try:
        cursor.execute("BEGIN IMMEDIATE")
        generation_id = _meta(cursor)["generation_id"]
        for entity_id, timestamp, incoming in items:
            existing = _read_record(cursor, entity_type, entity_id, include_deleted=True)
            # V1 has no base revision. Letting it recreate a V2 tombstone would
            # make an old client silently undo a deliberate V2 deletion.
            if existing is not None and existing["deleted"]:
                skipped += 1
                continue
            alive = existing is not None and not existing["deleted"]
            old_data = existing["data"] if alive else {}
            existing_timestamp = existing["legacy_last_update_time"] if alive else None
            should_write = False
            final_data = dict(old_data)
            if not alive:
                should_write = True
                final_data = incoming
                inserted += 1
            elif timestamp > existing_timestamp:
                should_write = True
                final_data = incoming
                updated += 1
            elif timestamp == 0:
                for key, value in incoming.items():
                    if key not in final_data or final_data[key] != value:
                        final_data[key] = value
                        should_write = True
                if should_write:
                    updated += 1
                else:
                    skipped += 1
            else:
                skipped += 1

            if not should_write:
                continue
            set_values = {
                key: value for key, value in final_data.items()
                if key not in old_data or old_data[key] != value
            }
            unset_fields = sorted(
                (key for key in old_data if key not in final_data),
                key=_utf16_sort_key,
            )
            changed_fields = sorted(
                set(set_values) | set(unset_fields), key=_utf16_sort_key
            )
            revision = (
                _next_revision(cursor)
                if changed_fields
                else (existing["record_revision"] if existing else 0)
            )
            legacy_timestamp = (
                timestamp if not alive or timestamp > existing_timestamp
                else existing_timestamp
            )
            _log_changes(
                cursor, entity_type, entity_id, int(time.time()), old_data, final_data
            )
            _write_record(
                cursor, entity_type, entity_id, final_data,
                legacy_timestamp, revision,
            )
            cursor.execute(
                "DELETE FROM tombstones WHERE entity_type = ? AND entity_id = ?",
                (entity_type, entity_id),
            )
            if changed_fields:
                _update_field_revisions(
                    cursor, entity_type, entity_id, changed_fields, revision,
                    int(time.time() * 1000) if entity_type == "product" else 0,
                )
                _record_change(
                    cursor, revision, generation_id, entity_type, entity_id,
                    "upsert", set_values, unset_fields, final_data,
                )
        _prune_change_log(cursor)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return {
        "status": "success",
        "message": "Update operation complete.",
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
    }


def _clear_legacy_history_file(history_path):
    """Ensure the established HISTORY_ file can join delete_all transaction."""
    connection = connect_sqlite(history_path)
    try:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ASIN TEXT NOT NULL,
                change_timestamp INTEGER NOT NULL,
                changed_key TEXT NOT NULL,
                new_value TEXT,
                old_value TEXT
            );
            CREATE TABLE IF NOT EXISTS entity_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                change_timestamp INTEGER NOT NULL,
                changed_key TEXT NOT NULL,
                new_value TEXT,
                old_value TEXT
            );
        """)
        connection.commit()
    finally:
        connection.close()


def _delete_all(token):
    history_path = get_history_db_path(token)
    _clear_legacy_history_file(history_path)
    connection = _open_database(token)
    cursor = connection.cursor()
    attachments = [("legacy_history", history_path)]
    backup_candidates = (
        ("legacy_main_backup", f"{get_db_path(token)}.pre-sync-v2.bak"),
        ("legacy_history_backup", f"{history_path}.pre-sync-v2.bak"),
    )
    attachments.extend(
        (alias, path) for alias, path in backup_candidates if os.path.exists(path)
    )
    attached_aliases = []
    try:
        for alias, path in attachments:
            cursor.execute(f"ATTACH DATABASE ? AS {alias}", (path,))
            attached_aliases.append(alias)
        cursor.execute("BEGIN IMMEDIATE")
        previous_generation = _meta(cursor)["generation_id"]
        generation = str(uuid.uuid4())
        for table in (
            "entries", "storage_locations", "procedure_docs", "products",
            "sync_entities", "field_revisions", "sync_changes",
            "mutation_receipts", "sync_conflicts", "tombstones",
            "history", "entity_audit_log",
            "sync_snapshot_records", "sync_snapshot_sessions",
        ):
            cursor.execute(f"DELETE FROM {table}")
        recovery_tables = (
            "entries", "storage_locations", "procedure_docs", "products",
            "sync_entities", "field_revisions", "sync_changes",
            "change_log", "mutation_receipts", "sync_conflicts", "tombstones",
            "history", "entity_audit_log", "sync_snapshot_records",
            "sync_snapshot_sessions", "snapshot_sessions",
        )
        for alias in attached_aliases:
            for table in recovery_tables:
                if _table_exists(connection, table, database=alias):
                    cursor.execute(f"DELETE FROM {alias}.{table}")
        cursor.execute(
            """
            UPDATE sync_meta SET generation_id = ?, current_revision = 1,
                min_available_revision = 0, last_pruned_at = 0, updated_at = ?
            WHERE singleton = 1
            """,
            (generation, int(time.time())),
        )
        cursor.execute(
            """
            INSERT INTO sync_changes (
                revision, generation_id, entity_type, entity_id, operation,
                record_revision, set_json, unset_json, record_json, created_at
            ) VALUES (1, ?, '__dataset__', '__all__', 'dataset_reset',
                      1, '{}', '[]', NULL, ?)
            """,
            (generation, int(time.time())),
        )
        cursor.execute(
            """
            INSERT INTO dataset_resets
                (previous_generation_id, generation_id, reset_at)
            VALUES (?, ?, ?)
            """,
            (previous_generation, generation, int(time.time())),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        for alias in reversed(attached_aliases):
            try:
                cursor.execute(f"DETACH DATABASE {alias}")
            except sqlite3.Error:
                pass
        cursor.close()
        connection.close()
    return {
        "status": "success",
        "message": "Database deleted. History database deleted.",
    }


def _error_response(error):
    body = {"status": "error", "message": error.message}
    if error.code is not None:
        body["code"] = error.code
    body.update(error.details)
    return jsonify(body), error.status


# --- API -----------------------------------------------------------------

@app.route("/data_operations", methods=["POST"])
def data_operations():
    if not request.is_json:
        return jsonify({"status": "error", "message": "Request must be JSON"}), 400
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not all(key in data for key in ("token", "request")):
        return jsonify({
            "status": "error",
            "message": "Missing 'token' or 'request' in JSON body",
        }), 400
    token = data.get("token")
    request_type = data.get("request")
    payload = data.get("payload")
    if token not in VALID_TOKENS:
        return jsonify({"status": "error", "message": "Invalid token"}), 401

    if request_type == "delete_all":
        try:
            return jsonify(_delete_all(token)), 200
        except sqlite3.Error:
            app.logger.error("SQLite delete_all operation failed.")
            return jsonify({"status": "error", "message": "Database error."}), 500
        except Exception:
            app.logger.error("Unexpected delete_all operation failure.")
            return jsonify({
                "status": "error", "message": "An unexpected server error occurred."
            }), 500

    connection = cursor = None
    try:
        connection = _open_database(token)
        cursor = connection.cursor()

        if request_type == "get_capabilities_v2":
            return jsonify(sync_capabilities(connection, cursor, payload)), 200
        if request_type == "sync_v2_push":
            return jsonify(sync_push(connection, cursor, payload)), 200
        if request_type == "sync_v2_pull":
            return jsonify(sync_pull(connection, cursor, payload)), 200
        if request_type == "sync_v2_snapshot":
            return jsonify(sync_snapshot(connection, cursor, payload)), 200

        if request_type == "get_asin":
            if not isinstance(payload, list) or not all(
                isinstance(asin, str) and len(asin) == 10 for asin in payload
            ):
                raise V1RequestError(
                    "Invalid payload for get_asin. Expected list of 10-char ASIN strings."
                )
            return jsonify({
                "status": "success", "data": _legacy_rows(cursor, "product", payload)
            }), 200

        if request_type == "get_all":
            return jsonify({
                "status": "success", "data": _legacy_rows(cursor, "product")
            }), 200

        if request_type == "update_asin":
            return jsonify(_v1_update(connection, cursor, payload, "product")), 200

        if request_type == "get_asin_history":
            if not isinstance(payload, dict) or "ASIN" not in payload:
                raise V1RequestError(
                    "Invalid payload for get_asin_history. Expected {'ASIN': '...'}"
                )
            rows = cursor.execute(
                """
                SELECT id, ASIN, change_timestamp, changed_key, new_value, old_value
                FROM history WHERE ASIN = ? COLLATE NOCASE
                ORDER BY change_timestamp DESC, id DESC
                """,
                (payload["ASIN"],),
            ).fetchall()
            return jsonify({"status": "success", "data": [dict(row) for row in rows]}), 200

        if request_type == "list_audited_asins":
            rows = cursor.execute(
                "SELECT DISTINCT ASIN FROM history ORDER BY ASIN ASC"
            ).fetchall()
            return jsonify({
                "status": "success", "data": [row["ASIN"] for row in rows]
            }), 200

        if request_type in {"get_storage_location", "get_procedure_doc"}:
            entity_type = (
                "storage_location" if request_type == "get_storage_location"
                else "procedure_doc"
            )
            if not isinstance(payload, list) or not all(
                isinstance(entity_id, str) and entity_id for entity_id in payload
            ):
                raise V1RequestError(
                    f"Invalid payload for {request_type}. Expected list of non-empty ID strings."
                )
            return jsonify({
                "status": "success",
                "data": _legacy_rows(cursor, entity_type, payload),
            }), 200

        if request_type in {"update_storage_location", "update_procedure_doc"}:
            entity_type = (
                "storage_location" if request_type == "update_storage_location"
                else "procedure_doc"
            )
            return jsonify(_v1_update(connection, cursor, payload, entity_type)), 200

        if request_type in {"get_storage_location_history", "get_procedure_doc_history"}:
            entity_type = (
                "storage_location"
                if request_type == "get_storage_location_history"
                else "procedure_doc"
            )
            id_field = GENERIC_ENTITY_CONFIG[entity_type]["id_field"]
            if not isinstance(payload, dict) or id_field not in payload:
                raise V1RequestError(
                    f"Invalid payload for {request_type}. Expected {{{id_field!r}: '...'}}"
                )
            entity_id = payload[id_field]
            if not isinstance(entity_id, str) or not entity_id:
                raise V1RequestError(f"Invalid ID for {entity_type}.")
            rows = cursor.execute(
                """
                SELECT id, entity_type, entity_id, change_timestamp,
                       changed_key, new_value, old_value
                FROM entity_audit_log
                WHERE entity_type = ? AND entity_id = ?
                ORDER BY change_timestamp DESC, id DESC
                """,
                (entity_type, entity_id),
            ).fetchall()
            return jsonify({"status": "success", "data": [dict(row) for row in rows]}), 200

        if request_type in {"list_storage_locations", "list_procedure_docs"}:
            entity_type = (
                "storage_location" if request_type == "list_storage_locations"
                else "procedure_doc"
            )
            return jsonify({
                "status": "success", "data": _legacy_rows(cursor, entity_type)
            }), 200

        return jsonify({
            "status": "error", "message": f"Unknown request type: {request_type}"
        }), 400

    except SyncProtocolError as error:
        if connection and connection.in_transaction:
            connection.rollback()
        return _error_response(error)
    except sqlite3.Error:
        if connection and connection.in_transaction:
            connection.rollback()
        app.logger.error("SQLite data operation failed.")
        return jsonify({"status": "error", "message": "Database error."}), 500
    except (TypeError, ValueError) as error:
        if connection and connection.in_transaction:
            connection.rollback()
        return _error_response(SyncProtocolError(str(error)))
    except Exception:
        if connection and connection.in_transaction:
            connection.rollback()
        app.logger.error("Unexpected data operation failure.")
        return jsonify({
            "status": "error", "message": "An unexpected server error occurred."
        }), 500
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()


def migrate_existing_self_hosted_databases():
    """Eager startup migration; lazy per-request migration remains the safety net."""
    if not os.path.isdir(DB_DIR):
        return
    prefix = "DATABASE_"
    suffix = ".sqlite"
    for file_name in os.listdir(DB_DIR):
        if not (file_name.startswith(prefix) and file_name.endswith(suffix)):
            continue
        token = file_name[len(prefix):-len(suffix)]
        if token not in VALID_TOKENS:
            continue
        connection = cursor = None
        try:
            connection, cursor = get_db_conn(token)
        except Exception:
            # Never include the token, path, ASIN or record content in logs.
            app.logger.error("Could not migrate an existing self-hosted sync database.")
        finally:
            if cursor is not None:
                cursor.close()
            if connection is not None:
                connection.close()


migrate_existing_self_hosted_databases()


if __name__ == "__main__":
    app.run(debug=True, port=5000)
