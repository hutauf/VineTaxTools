import os
import re
import sqlite3
import time
import json
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# --- Configuration ---
# A set of valid tokens for accessing the service.
VALID_TOKENS = {
    "mydummytoken1",
    "mydummytoken2",
    "mydummytoken3"
}

# Directory to store individual SQLite database files for each token.
DB_DIR = "user_databases"

# Safe for filenames while still allowing the underscores and hyphens commonly
# used in configured API tokens.
TOKEN_FILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")

# Ensure the database directory exists upon application start.
os.makedirs(DB_DIR, exist_ok=True)


# --- Main Database Helper Functions ---

def get_db_path(token):
    """Generates the full path to a token's main database file."""
    # Basic sanitization to prevent directory traversal attacks.
    if not isinstance(token, str) or not TOKEN_FILE_NAME_PATTERN.fullmatch(token):
        raise ValueError("Invalid token format for database path.")
    return os.path.join(DB_DIR, f"DATABASE_{token}.sqlite")

def get_db_conn(token):
    """
    Establishes a connection to the token-specific SQLite database.
    Creates the main 'entries' table if it doesn't exist.
    """
    db_path = get_db_path(token)
    conn = sqlite3.connect(db_path)
    # Allows accessing columns by name (e.g., row['ASIN']) instead of index.
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            ASIN TEXT PRIMARY KEY,
            last_update_time INTEGER NOT NULL,
            value TEXT NOT NULL
        )
    ''')
    conn.commit()
    return conn, cursor


# --- History Database Helper Functions ---

def get_history_db_path(token):
    """Generates the full path to a token's history database file."""
    if not isinstance(token, str) or not TOKEN_FILE_NAME_PATTERN.fullmatch(token):
        raise ValueError("Invalid token format for database path.")
    return os.path.join(DB_DIR, f"HISTORY_{token}.sqlite")

def get_history_db_conn(token):
    """
    Establishes a connection to the token-specific history SQLite database.
    Creates the 'history' table and an index for performance if they don't exist.
    """
    db_path = get_history_db_path(token)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ASIN TEXT NOT NULL,
            change_timestamp INTEGER NOT NULL,
            changed_key TEXT NOT NULL,
            new_value TEXT,
            old_value TEXT
        )
    ''')
    # An index on ASIN significantly speeds up history lookups.
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_history_asin ON history (ASIN)')
    conn.commit()
    return conn, cursor

def log_changes(history_cursor, asin, timestamp, old_data, new_data):
    """
    Compares two dictionaries (old and new data) and logs the differences
    to the history database.
    """
    all_keys = set(old_data.keys()) | set(new_data.keys())

    for key in all_keys:
        old_value = old_data.get(key)
        new_value = new_data.get(key)

        # To ensure consistency, convert non-string JSON values to string representations.
        if not isinstance(old_value, str) and old_value is not None:
            old_value = json.dumps(old_value)
        if not isinstance(new_value, str) and new_value is not None:
            new_value = json.dumps(new_value)

        # Log an entry only if a value has actually changed.
        if old_value != new_value:
            history_cursor.execute("""
                INSERT INTO history (ASIN, change_timestamp, changed_key, new_value, old_value)
                VALUES (?, ?, ?, ?, ?)
            """, (asin, timestamp, key, new_value, old_value))


# --- Storage Location and Procedure Document Helper Functions ---

GENERIC_ENTITY_CONFIG = {
    "storage_location": {
        "table": "storage_locations",
        "id_field": "location_id"
    },
    "procedure_doc": {
        "table": "procedure_docs",
        "id_field": "doc_id"
    }
}


def ensure_generic_tables(conn):
    """Creates the tables used for storage locations and procedure documents."""
    cursor = conn.cursor()
    try:
        for config in GENERIC_ENTITY_CONFIG.values():
            cursor.execute(f"""
                CREATE TABLE IF NOT EXISTS {config['table']} (
                    entity_id TEXT PRIMARY KEY,
                    last_update_time INTEGER NOT NULL,
                    value TEXT NOT NULL
                )
            """)
        conn.commit()
    finally:
        cursor.close()


def ensure_entity_audit_table(history_conn):
    """Creates the shared audit log for non-ASIN entities."""
    cursor = history_conn.cursor()
    try:
        cursor.execute("""
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
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_entity_audit_lookup
            ON entity_audit_log (entity_type, entity_id, change_timestamp)
        """)
        history_conn.commit()
    finally:
        cursor.close()


def get_generic_entity_config(entity_type):
    config = GENERIC_ENTITY_CONFIG.get(entity_type)
    if not config:
        raise ValueError(f"Unknown entity type: {entity_type}")
    return config


def log_entity_changes(history_cursor, entity_type, entity_id, timestamp, old_data, new_data):
    """Logs field-level changes for storage locations and procedure documents."""
    all_keys = set(old_data.keys()) | set(new_data.keys())

    for key in all_keys:
        old_value = old_data.get(key)
        new_value = new_data.get(key)

        if not isinstance(old_value, str) and old_value is not None:
            old_value = json.dumps(old_value)
        if not isinstance(new_value, str) and new_value is not None:
            new_value = json.dumps(new_value)

        if old_value != new_value:
            history_cursor.execute("""
                INSERT INTO entity_audit_log
                    (entity_type, entity_id, change_timestamp, changed_key, new_value, old_value)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (entity_type, entity_id, timestamp, key, new_value, old_value))


# --- Main API Endpoint ---

@app.route('/data_operations', methods=['POST'])
def data_operations():
    """
    A single endpoint to handle all data operations based on the JSON request body.
    Supported requests: ASIN data and history, storage locations, procedure
    documents, their histories and lists, plus deletion of all token data.
    """
    if not request.is_json:
        return jsonify({"status": "error", "message": "Request must be JSON"}), 400

    data = request.get_json()

    # 1. Validate basic request structure
    if not all(key in data for key in ["token", "request"]):
        return jsonify({"status": "error", "message": "Missing 'token' or 'request' in JSON body"}), 400

    token = data.get("token")
    request_type = data.get("request")
    payload = data.get("payload")

    # 2. Validate token
    if token not in VALID_TOKENS:
        return jsonify({"status": "error", "message": "Invalid token"}), 401

    conn, cursor = None, None
    history_conn, history_cursor = None, None

    try:
        # 3. Process request based on its type
        if request_type == "get_asin":
            if not isinstance(payload, list) or not all(
                isinstance(asin, str) and len(asin) == 10 for asin in payload
            ):
                return jsonify({"status": "error", "message": "Invalid payload for get_asin. Expected list of 10-char ASIN strings."}), 400

            conn, cursor = get_db_conn(token)
            results = []
            for asin_to_fetch in payload:
                cursor.execute("SELECT ASIN, last_update_time, value FROM entries WHERE ASIN = ?", (asin_to_fetch,))
                row = cursor.fetchone()
                if row:
                    # Convert SQLite Row object to a standard dictionary
                    results.append(dict(row))
            return jsonify({"status": "success", "data": results}), 200

        elif request_type == "update_asin":
            if not isinstance(payload, list):
                return jsonify({"status": "error", "message": "Invalid payload for update_asin. Expected a list of entry objects."}), 400

            conn, cursor = get_db_conn(token)
            history_conn, history_cursor = get_history_db_conn(token)
            updated_count, inserted_count, skipped_count = 0, 0, 0
            current_unix_time = int(time.time())

            for item in payload:
                if not isinstance(item, dict) or not all(k in item for k in ["ASIN", "timestamp", "value"]):
                    return jsonify({"status": "error", "message": "Invalid item structure in payload."}), 400

                asin = item["ASIN"]
                new_timestamp = item["timestamp"]
                new_value_str = item["value"]

                if not (isinstance(asin, str) and len(asin) == 10):
                    return jsonify({"status": "error", "message": f"Invalid ASIN format: {asin}"}), 400
                if not isinstance(new_timestamp, int):
                    return jsonify({"status": "error", "message": f"Invalid timestamp for ASIN {asin}: must be an integer."}), 400
                if not isinstance(new_value_str, str):
                    return jsonify({"status": "error", "message": f"Invalid value for ASIN {asin}: must be a string."}), 400

                cursor.execute("SELECT last_update_time, value FROM entries WHERE ASIN = ?", (asin,))
                existing_entry = cursor.fetchone()

                try:
                    new_data_dict = json.loads(new_value_str)
                except json.JSONDecodeError:
                    return jsonify({"status": "error", "message": f"Invalid JSON in value for ASIN {asin}."}), 400

                if not isinstance(new_data_dict, dict):
                    return jsonify({"status": "error", "message": f"Invalid JSON in value for ASIN {asin}: expected an object."}), 400

                if existing_entry:
                    # Entry exists: update logic
                    existing_timestamp = existing_entry["last_update_time"]
                    try:
                        old_data_dict = json.loads(existing_entry["value"])
                    except json.JSONDecodeError:
                        old_data_dict = {}

                    if not isinstance(old_data_dict, dict):
                        old_data_dict = {}

                    perform_update = False
                    final_data_dict = old_data_dict.copy()

                    if new_timestamp > existing_timestamp:
                        # Full overwrite if new data is more recent
                        perform_update = True
                        final_data_dict = new_data_dict
                    elif new_timestamp == 0:
                        # Partial update: merge new fields into old data
                        has_changes = False
                        for key, value in new_data_dict.items():
                            if old_data_dict.get(key) != value:
                                final_data_dict[key] = value
                                has_changes = True
                        if has_changes:
                            perform_update = True

                    if perform_update:
                        log_changes(history_cursor, asin, current_unix_time, old_data_dict, final_data_dict)
                        final_value_str = json.dumps(final_data_dict)
                        ts_to_set = new_timestamp if new_timestamp > existing_timestamp else existing_timestamp
                        cursor.execute("UPDATE entries SET last_update_time = ?, value = ? WHERE ASIN = ?", (ts_to_set, final_value_str, asin))
                        updated_count += 1
                    else:
                        skipped_count += 1
                else:
                    # Entry is new: insert logic
                    log_changes(history_cursor, asin, current_unix_time, {}, new_data_dict)
                    cursor.execute("INSERT INTO entries (ASIN, last_update_time, value) VALUES (?, ?, ?)", (asin, new_timestamp, new_value_str))
                    inserted_count += 1

            conn.commit()
            history_conn.commit()
            return jsonify({
                "status": "success",
                "message": "Update operation complete.",
                "inserted": inserted_count,
                "updated": updated_count,
                "skipped": skipped_count
            }), 200

        elif request_type == "get_all":
            conn, cursor = get_db_conn(token)
            cursor.execute("SELECT ASIN, last_update_time, value FROM entries")
            all_entries = [dict(row) for row in cursor.fetchall()]
            return jsonify({"status": "success", "data": all_entries}), 200

        elif request_type == "get_asin_history":
            if not isinstance(payload, dict) or "ASIN" not in payload:
                 return jsonify({"status": "error", "message": "Invalid payload for get_asin_history. Expected {'ASIN': '...'}"}), 400

            history_conn, history_cursor = get_history_db_conn(token)
            history_cursor.execute("SELECT * FROM history WHERE ASIN = ? ORDER BY change_timestamp DESC, id DESC", (payload["ASIN"],))
            history_entries = [dict(row) for row in history_cursor.fetchall()]
            return jsonify({"status": "success", "data": history_entries}), 200

        elif request_type == "list_audited_asins":
            history_conn, history_cursor = get_history_db_conn(token)
            history_cursor.execute("SELECT DISTINCT ASIN FROM history ORDER BY ASIN ASC")
            asins = [row["ASIN"] for row in history_cursor.fetchall()]
            return jsonify({"status": "success", "data": asins}), 200

        elif request_type in {"get_storage_location", "get_procedure_doc"}:
            if not isinstance(payload, list) or not all(
                isinstance(entity_id, str) and entity_id for entity_id in payload
            ):
                return jsonify({
                    "status": "error",
                    "message": f"Invalid payload for {request_type}. Expected list of non-empty ID strings."
                }), 400

            entity_type = "storage_location" if request_type == "get_storage_location" else "procedure_doc"
            config = get_generic_entity_config(entity_type)
            conn, cursor = get_db_conn(token)
            ensure_generic_tables(conn)

            results = []
            for entity_id in payload:
                cursor.execute(
                    f"SELECT entity_id, last_update_time, value FROM {config['table']} WHERE entity_id = ?",
                    (entity_id,)
                )
                row = cursor.fetchone()
                if row:
                    row_dict = dict(row)
                    row_dict[config["id_field"]] = row_dict.pop("entity_id")
                    results.append(row_dict)
            return jsonify({"status": "success", "data": results}), 200

        elif request_type in {"update_storage_location", "update_procedure_doc"}:
            if not isinstance(payload, list):
                return jsonify({
                    "status": "error",
                    "message": f"Invalid payload for {request_type}. Expected a list of entry objects."
                }), 400

            entity_type = "storage_location" if request_type == "update_storage_location" else "procedure_doc"
            config = get_generic_entity_config(entity_type)
            conn, cursor = get_db_conn(token)
            ensure_generic_tables(conn)
            history_conn, history_cursor = get_history_db_conn(token)
            ensure_entity_audit_table(history_conn)

            updated_count, inserted_count, skipped_count = 0, 0, 0
            current_unix_time = int(time.time())

            for item in payload:
                required_fields = [config["id_field"], "timestamp", "value"]
                if not isinstance(item, dict) or not all(key in item for key in required_fields):
                    return jsonify({
                        "status": "error",
                        "message": f"Invalid item structure in {request_type} payload."
                    }), 400

                entity_id = item[config["id_field"]]
                new_timestamp = item["timestamp"]
                new_value_str = item["value"]

                if not isinstance(entity_id, str) or not entity_id:
                    return jsonify({"status": "error", "message": f"Invalid ID for {entity_type}: {entity_id}"}), 400
                if not isinstance(new_timestamp, int):
                    return jsonify({"status": "error", "message": f"Invalid timestamp for {entity_id}: must be an integer."}), 400
                if not isinstance(new_value_str, str):
                    return jsonify({"status": "error", "message": f"Invalid value for {entity_id}: must be a string."}), 400

                try:
                    new_data_dict = json.loads(new_value_str)
                except json.JSONDecodeError:
                    return jsonify({"status": "error", "message": f"Invalid JSON in value for {entity_id}."}), 400

                if not isinstance(new_data_dict, dict):
                    return jsonify({"status": "error", "message": f"Invalid JSON in value for {entity_id}: expected an object."}), 400

                cursor.execute(
                    f"SELECT last_update_time, value FROM {config['table']} WHERE entity_id = ?",
                    (entity_id,)
                )
                existing_entry = cursor.fetchone()

                if existing_entry:
                    existing_timestamp = existing_entry["last_update_time"]
                    try:
                        old_data_dict = json.loads(existing_entry["value"])
                    except json.JSONDecodeError:
                        old_data_dict = {}

                    if not isinstance(old_data_dict, dict):
                        old_data_dict = {}

                    perform_update = False
                    final_data_dict = old_data_dict.copy()

                    if new_timestamp > existing_timestamp:
                        perform_update = True
                        final_data_dict = new_data_dict
                    elif new_timestamp == 0:
                        has_changes = False
                        for key, value in new_data_dict.items():
                            if old_data_dict.get(key) != value:
                                final_data_dict[key] = value
                                has_changes = True
                        if has_changes:
                            perform_update = True

                    if perform_update:
                        log_entity_changes(
                            history_cursor, entity_type, entity_id,
                            current_unix_time, old_data_dict, final_data_dict
                        )
                        timestamp_to_set = (
                            new_timestamp if new_timestamp > existing_timestamp else existing_timestamp
                        )
                        cursor.execute(
                            f"UPDATE {config['table']} SET last_update_time = ?, value = ? WHERE entity_id = ?",
                            (timestamp_to_set, json.dumps(final_data_dict), entity_id)
                        )
                        updated_count += 1
                    else:
                        skipped_count += 1
                else:
                    log_entity_changes(
                        history_cursor, entity_type, entity_id,
                        current_unix_time, {}, new_data_dict
                    )
                    cursor.execute(
                        f"INSERT INTO {config['table']} (entity_id, last_update_time, value) VALUES (?, ?, ?)",
                        (entity_id, new_timestamp, new_value_str)
                    )
                    inserted_count += 1

            conn.commit()
            history_conn.commit()
            return jsonify({
                "status": "success",
                "message": "Update operation complete.",
                "inserted": inserted_count,
                "updated": updated_count,
                "skipped": skipped_count
            }), 200

        elif request_type in {"get_storage_location_history", "get_procedure_doc_history"}:
            entity_type = (
                "storage_location" if request_type == "get_storage_location_history" else "procedure_doc"
            )
            config = get_generic_entity_config(entity_type)

            if not isinstance(payload, dict) or config["id_field"] not in payload:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid payload for {request_type}. Expected {{{config['id_field']!r}: '...'}}"
                }), 400

            entity_id = payload[config["id_field"]]
            if not isinstance(entity_id, str) or not entity_id:
                return jsonify({"status": "error", "message": f"Invalid ID for {entity_type}."}), 400

            history_conn, history_cursor = get_history_db_conn(token)
            ensure_entity_audit_table(history_conn)
            history_cursor.execute("""
                SELECT id, entity_type, entity_id, change_timestamp, changed_key, new_value, old_value
                FROM entity_audit_log
                WHERE entity_type = ? AND entity_id = ?
                ORDER BY change_timestamp DESC, id DESC
            """, (entity_type, entity_id))
            history_entries = [dict(row) for row in history_cursor.fetchall()]
            return jsonify({"status": "success", "data": history_entries}), 200

        elif request_type in {"list_storage_locations", "list_procedure_docs"}:
            entity_type = "storage_location" if request_type == "list_storage_locations" else "procedure_doc"
            config = get_generic_entity_config(entity_type)
            conn, cursor = get_db_conn(token)
            ensure_generic_tables(conn)
            cursor.execute(
                f"SELECT entity_id, last_update_time, value FROM {config['table']} ORDER BY entity_id"
            )
            rows = []
            for row in cursor.fetchall():
                row_dict = dict(row)
                row_dict[config["id_field"]] = row_dict.pop("entity_id")
                rows.append(row_dict)
            return jsonify({"status": "success", "data": rows}), 200

        elif request_type == "delete_all":
            # Close connections before deleting files
            if conn: conn.close()
            if history_conn: history_conn.close()
            conn, cursor, history_conn, history_cursor = None, None, None, None

            db_path = get_db_path(token)
            history_db_path = get_history_db_path(token)
            msg = ""
            if os.path.exists(db_path):
                os.remove(db_path)
                msg += f"Database for token deleted. "
            if os.path.exists(history_db_path):
                os.remove(history_db_path)
                msg += f"History database for token deleted."

            return jsonify({"status": "success", "message": msg.strip() or "No databases found to delete."}), 200

        else:
            return jsonify({"status": "error", "message": f"Unknown request type: {request_type}"}), 400

    except sqlite3.Error as e:
        app.logger.error(f"SQLite error: {e}")
        return jsonify({"status": "error", "message": f"Database error: {e}"}), 500
    except ValueError as e:
        app.logger.error(f"Value error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception as e:
        app.logger.error(f"An unexpected error occurred: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500
    finally:
        # Ensure all database connections are closed at the end of the request
        if cursor: cursor.close()
        if conn: conn.close()
        if history_cursor: history_cursor.close()
        if history_conn: history_conn.close()


if __name__ == "__main__":
    # Runs the Flask app. debug=True enables auto-reloading on code changes.
    # In a production environment, use a proper WSGI server like Gunicorn or uWSGI.
    app.run(debug=True, port=5000)
