/**
 * Local JSON file storage. Zero-config: the app runs out of the box and
 * configuration survives restarts. Writes are atomic (temp file + rename).
 */
import fs from 'fs';
import path from 'path';
import { MockEnvironment } from '../../types';
import { StorageBackend, Touched } from './index';

const SCHEMA_VERSION = 1;

interface FileDocument {
  schemaVersion: number;
  savedAt: string;
  environments: MockEnvironment[];
}

export class FileStorage implements StorageBackend {
  readonly name = 'file';

  constructor(private readonly filePath: string) {}

  private readDocument(): FileDocument | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.environments)) {
        return {
          schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
          savedAt: parsed.savedAt ?? new Date().toISOString(),
          environments: parsed.environments,
        };
      }
      // Tolerate a bare array file.
      if (Array.isArray(parsed)) {
        return { schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), environments: parsed };
      }
      return null;
    } catch (err) {
      console.error(`[FileStorage] Failed to read ${this.filePath}:`, err);
      return null;
    }
  }

  async loadAll(): Promise<MockEnvironment[]> {
    const doc = this.readDocument();
    return doc ? doc.environments : [];
  }

  async save(snapshot: MockEnvironment[], _touched: Touched): Promise<void> {
    // The file backend keeps a single canonical document, so a full rewrite is
    // cheap and always consistent. (Touched paths matter for document-based
    // backends like Firestore.)
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const doc: FileDocument = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      environments: snapshot,
    };

    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}
