import { Platform } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';

export type EditorStroke = {
  pathSvg: string;
  color: string;
  width: number;
};

export type EditorState = {
  originalUri: string;
  currentUri: string;
  noteText: string;
  strokes: EditorStroke[];
  canvas: { width: number; height: number };
};

export type SessionRow = {
  id: number;
  name: string;
  created_at: number;
  preview_uri: string | null;
  state_json: string;
};

const DB_NAME = 'chromaframe.db';
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  preview_uri TEXT,
  state_json TEXT NOT NULL
)`;

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLiteDatabase> {
  if (Platform.OS === 'web') {
    throw new Error('SQLite is not supported on web in this app.');
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await openDatabaseAsync(DB_NAME);
      await database.execAsync(TABLE_SQL);
      return database;
    })();
  }
  return dbPromise;
}

export async function ensurePreviewDir() {
  const dir = FileSystem.documentDirectory + 'previews/';
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export async function saveSession(name: string, state: EditorState, previewUri?: string | null) {
  if (Platform.OS === 'web') {
    throw new Error('Saving sessions is not supported on web.');
  }
  const database = await getDb();
  const createdAt = Date.now();
  const stateJson = JSON.stringify(state);
  const res = await database.runAsync(
    'INSERT INTO sessions (name, created_at, preview_uri, state_json) VALUES (?, ?, ?, ?)',
    [name, createdAt, previewUri ?? null, stateJson]
  );
  // runAsync returns an object with lastInsertRowId on native
  // @ts-ignore - type may vary across platforms
  return Number(res?.lastInsertRowId ?? 0);
}

export async function listSessions(): Promise<SessionRow[]> {
  if (Platform.OS === 'web') {
    return [];
  }
  const database = await getDb();
  const rows = await database.getAllAsync<SessionRow>(
    'SELECT id, name, created_at, preview_uri, state_json FROM sessions ORDER BY created_at DESC'
  );
  return rows ?? [];
}

export async function getSession(id: number): Promise<SessionRow | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const database = await getDb();
  const row = await database.getFirstAsync<SessionRow>(
    'SELECT id, name, created_at, preview_uri, state_json FROM sessions WHERE id = ? LIMIT 1',
    [id]
  );
  return row ?? null;
}

export async function updateSession(id: number, state: EditorState, previewUri?: string | null) {
  if (Platform.OS === 'web') {
    throw new Error('Updating sessions is not supported on web.');
  }
  const database = await getDb();
  const stateJson = JSON.stringify(state);

  // If previewUri is undefined, keep existing preview and only update state
  if (typeof previewUri === 'undefined') {
    await database.runAsync(
      'UPDATE sessions SET state_json = ? WHERE id = ?',
      [stateJson, id]
    );
    return;
  }

  // If a new preview path is provided, update it and clean up the old file
  if (previewUri) {
    const old = await database.getFirstAsync<{ preview_uri: string | null }>(
      'SELECT preview_uri FROM sessions WHERE id = ? LIMIT 1',
      [id]
    );
    await database.runAsync(
      'UPDATE sessions SET state_json = ?, preview_uri = ? WHERE id = ?',
      [stateJson, previewUri, id]
    );
    // Best-effort delete of the previous preview if it exists and differs
    const oldUri = old?.preview_uri;
    if (oldUri && oldUri !== previewUri) {
      try {
        const info = await FileSystem.getInfoAsync(oldUri);
        if (info.exists) {
          await FileSystem.deleteAsync(oldUri, { idempotent: true });
        }
      } catch {
        // ignore file delete errors
      }
    }
    return;
  }

  // If null explicitly passed, clear the preview
  await database.runAsync(
    'UPDATE sessions SET state_json = ?, preview_uri = NULL WHERE id = ?',
    [stateJson, id]
  );
}

export async function deleteSession(id: number) {
  if (Platform.OS === 'web') {
    throw new Error('Deleting sessions is not supported on web.');
  }
  const database = await getDb();
  // Get preview uri to delete the file if exists
  const row = await database.getFirstAsync<{ preview_uri: string | null }>(
    'SELECT preview_uri FROM sessions WHERE id = ? LIMIT 1',
    [id]
  );
  await database.runAsync('DELETE FROM sessions WHERE id = ?', [id]);
  const preview = row?.preview_uri;
  if (preview) {
    try {
      const info = await FileSystem.getInfoAsync(preview);
      if (info.exists) {
        await FileSystem.deleteAsync(preview, { idempotent: true });
      }
    } catch {
      // ignore file delete errors
    }
  }
}
