import { randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { GovernanceError, canonicalJson, requireThat } from "./core.ts";
import {
  ABSENT_REVISION,
  MAX_DOCUMENT_BYTES,
  documentRevision,
  parseDataText,
  validateCatalogDocument,
  validateConfigDocument,
  validateLocalStateDocument,
} from "./v2-model.ts";
import type {
  CatalogDocument,
  LocalStateDocument,
  WorkspacesConfig,
} from "./v2-model.ts";
import { requireStablePath } from "./path-safety.ts";

export type CompareAndSwapCapability = "supported" | "read-only" | "unknown";
export type StoreFreshness = "current" | "stale" | "partial" | "offline" | "unknown";

export interface DocumentRead<T> {
  document: T | null;
  revision: string;
  capabilities: {
    read: true;
    compareAndSwap: CompareAndSwapCapability;
  };
  freshness: StoreFreshness;
}

interface DocumentStore<T> {
  read(): Promise<DocumentRead<T>>;
  compareAndSwap(
    expectedRevision: string,
    nextDocument: T,
  ): Promise<{ revision: string }>;
}

export function requireMutationAuthority<T>(read: DocumentRead<T>): void {
  requireThat(read.capabilities?.read === true, "UNTRUSTED_INPUT");
  if (read.capabilities.compareAndSwap === "read-only")
    throw new GovernanceError("UNSUPPORTED");
  requireThat(
    read.capabilities.compareAndSwap === "supported" && read.freshness === "current",
    "UNTRUSTED_INPUT",
  );
}

export interface CatalogStore extends DocumentStore<CatalogDocument> {}
export interface LocalStateStore extends DocumentStore<LocalStateDocument> {}
export interface ConfigStore extends DocumentStore<WorkspacesConfig> {}

const writableCapabilities = {
  read: true as const,
  compareAndSwap: "supported" as const,
};

type Validator<T> = (input: unknown) => T;

function validRevision(value: string): boolean {
  return value === ABSENT_REVISION || /^sha256:[a-f0-9]{64}$/.test(value);
}

class MemoryDocumentStore<T> implements DocumentStore<T> {
  #document: T | null;
  #validate: Validator<T>;

  constructor(validate: Validator<T>, initial: T | null = null) {
    this.#validate = validate;
    this.#document = initial === null ? null : validate(initial);
  }

  async read(): Promise<DocumentRead<T>> {
    return {
      document: this.#document === null ? null : structuredClone(this.#document),
      revision:
        this.#document === null
          ? ABSENT_REVISION
          : documentRevision(this.#document),
      capabilities: writableCapabilities,
      freshness: "current",
    };
  }

  async compareAndSwap(
    expectedRevision: string,
    nextDocument: T,
  ): Promise<{ revision: string }> {
    requireThat(validRevision(expectedRevision), "INVALID_CONFIG");
    const validated = this.#validate(nextDocument);
    const currentRevision =
      this.#document === null
        ? ABSENT_REVISION
        : documentRevision(this.#document);
    requireThat(currentRevision === expectedRevision, "CONFLICT");
    this.#document = validated;
    return { revision: documentRevision(validated) };
  }
}

export class MemoryCatalogStore
  extends MemoryDocumentStore<CatalogDocument>
  implements CatalogStore
{
  constructor(initial: CatalogDocument | null = null) {
    super(validateCatalogDocument, initial);
  }
}

export class MemoryLocalStateStore
  extends MemoryDocumentStore<LocalStateDocument>
  implements LocalStateStore
{
  constructor(initial: LocalStateDocument | null = null) {
    super(validateLocalStateDocument, initial);
  }
}

async function ensureRealDirectory(path: string): Promise<void> {
  try {
    await requireStablePath(path);
    const status = await lstat(path);
    requireThat(status.isDirectory() && !status.isSymbolicLink(), "INVALID_CONFIG");
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG");
  }
}

async function readRegularData<T>(
  path: string,
  validate: Validator<T>,
  format: "json" | "config",
): Promise<T | null> {
  let handle;
  try {
    await requireStablePath(path, { allowMissing: true });
    const status = await lstat(path);
    requireThat(status.isFile() && !status.isSymbolicLink(), "INVALID_CONFIG");
    handle = await open(path, "r");
    const openedStatus = await handle.stat();
    requireThat(
      openedStatus.isFile() && openedStatus.size <= MAX_DOCUMENT_BYTES,
      "INVALID_CONFIG",
    );
    const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    requireThat(length <= MAX_DOCUMENT_BYTES, "INVALID_CONFIG");
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes.subarray(0, length));
    const extension = extname(path).toLowerCase();
    const dataFormat =
      format === "json"
        ? "json"
        : extension === ".yaml" || extension === ".yml"
          ? "yaml"
          : extension === ".json"
            ? "json"
            : undefined;
    requireThat(dataFormat !== undefined, "INVALID_CONFIG");
    return validate(parseDataText(text, dataFormat, MAX_DOCUMENT_BYTES));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("INVALID_CONFIG");
  } finally {
    await handle?.close();
  }
}

class FileDocumentStore<T> implements DocumentStore<T> {
  readonly path: string;
  readonly lockPath: string;
  #validate: Validator<T>;
  #format: "json" | "config";

  constructor(
    path: string,
    validate: Validator<T>,
    format: "json" | "config" = "json",
  ) {
    requireThat(
      typeof path === "string" && path.length > 0 && path.length <= 16_384,
      "INVALID_CONFIG",
    );
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.#validate = validate;
    this.#format = format;
  }

  async read(): Promise<DocumentRead<T>> {
    const document = await readRegularData(this.path, this.#validate, this.#format);
    return {
      document: document === null ? null : structuredClone(document),
      revision:
        document === null ? ABSENT_REVISION : documentRevision(document),
      capabilities: writableCapabilities,
      freshness: "current",
    };
  }

  async compareAndSwap(
    expectedRevision: string,
    nextDocument: T,
  ): Promise<{ revision: string }> {
    requireThat(validRevision(expectedRevision), "INVALID_CONFIG");
    const validated = this.#validate(nextDocument);
    const nextRevision = documentRevision(validated);
    const directory = dirname(this.path);
    await ensureRealDirectory(directory);

    const nonce = randomUUID();
    const lockText =
      JSON.stringify({
        schemaVersion: 1,
        nonce,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }) + "\n";
    let lock;
    try {
      lock = await open(this.lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
        throw new GovernanceError("BUSY");
      throw new GovernanceError("ACTION_FAILED");
    }

    const temporary = join(directory, `.${basename(this.path)}.${nonce}.tmp`);
    let temporaryCreated = false;
    try {
      await lock.writeFile(lockText, { encoding: "utf8" });
      await lock.sync();
      const current = await this.read();
      requireThat(current.revision === expectedRevision, "CONFLICT");

      const output = JSON.stringify(validated, null, 2) + "\n";
      const candidate = await open(temporary, "wx", 0o600);
      temporaryCreated = true;
      try {
        await candidate.writeFile(output, { encoding: "utf8" });
        await candidate.sync();
      } finally {
        await candidate.close();
      }
      await rename(temporary, this.path);
      temporaryCreated = false;
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
      return { revision: nextRevision };
    } catch (error) {
      if (error instanceof GovernanceError) throw error;
      throw new GovernanceError("ACTION_FAILED");
    } finally {
      if (temporaryCreated) {
        try {
          await unlink(temporary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
            // The private candidate is non-authoritative; never broaden cleanup.
          }
        }
      }
      await lock.close();
      try {
        if ((await readFile(this.lockPath, "utf8")) === lockText)
          await unlink(this.lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          // A replaced or unreadable lock is not ours to remove.
        }
      }
    }
  }
}

export class FileCatalogStore
  extends FileDocumentStore<CatalogDocument>
  implements CatalogStore
{
  constructor(path: string) {
    super(path, validateCatalogDocument);
  }
}

export class FileLocalStateStore
  extends FileDocumentStore<LocalStateDocument>
  implements LocalStateStore
{
  constructor(path: string) {
    super(path, validateLocalStateDocument);
  }
}

/**
 * Installed only to exercise the async extension boundary. This adapter uses local
 * files, carries no authentication or remote-storage claim, and is not a production
 * backend.
 */
class AsyncTestStore<T> implements DocumentStore<T> {
  readonly #store: DocumentStore<T>;

  constructor(store: DocumentStore<T>) {
    this.#store = store;
  }

  async #tick(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async read(): Promise<DocumentRead<T>> {
    await this.#tick();
    return this.#store.read();
  }

  async compareAndSwap(
    expectedRevision: string,
    nextDocument: T,
  ): Promise<{ revision: string }> {
    await this.#tick();
    return this.#store.compareAndSwap(expectedRevision, nextDocument);
  }
}

export class AsyncTestCatalogStore
  extends AsyncTestStore<CatalogDocument>
  implements CatalogStore
{
  constructor(path: string) {
    super(new FileCatalogStore(path));
  }
}

export class AsyncTestLocalStateStore
  extends AsyncTestStore<LocalStateDocument>
  implements LocalStateStore
{
  constructor(path: string) {
    super(new FileLocalStateStore(path));
  }
}

export class FileConfigStore
  extends FileDocumentStore<WorkspacesConfig>
  implements ConfigStore
{
  constructor(path: string) {
    super(path, validateConfigDocument, "config");
  }
}

async function writeVerified<T>(
  store: DocumentStore<T>,
  expectedRevision: string,
  nextDocument: T,
  validate: Validator<T>,
): Promise<DocumentRead<T>> {
  requireThat(validRevision(expectedRevision), "INVALID_CONFIG");
  const validated = validate(nextDocument);
  const before = await store.read();
  requireMutationAuthority(before);
  requireThat(before.revision === expectedRevision, "CONFLICT");
  const expectedNextRevision = documentRevision(validated);
  let written: { revision: string };
  try {
    written = await store.compareAndSwap(expectedRevision, validated);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (
      typeof code === "string" &&
      [
        "CONFLICT",
        "BUSY",
        "UNSUPPORTED",
        "UNTRUSTED_INPUT",
        "INVALID_CONFIG",
        "ACTION_FAILED",
      ].includes(code)
    ) throw error;
    throw new GovernanceError("ACTION_FAILED");
  }
  requireThat(written.revision === expectedNextRevision, "ACTION_FAILED");
  const after = await store.read();
  requireThat(
    after.freshness === "current" &&
      after.revision === expectedNextRevision &&
      after.document !== null &&
      canonicalJson(after.document) === canonicalJson(validated),
    "ACTION_FAILED",
  );
  return after;
}

export async function writeCatalogDocument(
  store: CatalogStore,
  expectedRevision: string,
  nextDocument: CatalogDocument,
): Promise<DocumentRead<CatalogDocument>> {
  return writeVerified(
    store,
    expectedRevision,
    nextDocument,
    validateCatalogDocument,
  );
}

export async function writeLocalStateDocument(
  store: LocalStateStore,
  expectedRevision: string,
  nextDocument: LocalStateDocument,
): Promise<DocumentRead<LocalStateDocument>> {
  return writeVerified(
    store,
    expectedRevision,
    nextDocument,
    validateLocalStateDocument,
  );
}

export async function writeConfigDocument(
  store: ConfigStore,
  expectedRevision: string,
  nextDocument: WorkspacesConfig,
): Promise<DocumentRead<WorkspacesConfig>> {
  return writeVerified(
    store,
    expectedRevision,
    nextDocument,
    validateConfigDocument,
  );
}

type CatalogFactory = (location: string) => CatalogStore;
type LocalStateFactory = (location: string) => LocalStateStore;

function adapterName(name: string): void {
  requireThat(/^[a-z][a-z0-9-]{0,63}$/.test(name), "UNSUPPORTED");
}

export class StoreAdapterRegistry {
  #catalog = new Map<string, CatalogFactory>();
  #localState = new Map<string, LocalStateFactory>();

  registerCatalog(name: string, factory: CatalogFactory): void {
    adapterName(name);
    requireThat(typeof factory === "function" && !this.#catalog.has(name), "CONFLICT");
    this.#catalog.set(name, factory);
  }

  registerLocalState(name: string, factory: LocalStateFactory): void {
    adapterName(name);
    requireThat(
      typeof factory === "function" && !this.#localState.has(name),
      "CONFLICT",
    );
    this.#localState.set(name, factory);
  }

  createCatalog(name: string, location: string): CatalogStore {
    adapterName(name);
    const factory = this.#catalog.get(name);
    requireThat(factory, "UNSUPPORTED");
    return factory(location);
  }

  createLocalState(name: string, location: string): LocalStateStore {
    adapterName(name);
    const factory = this.#localState.get(name);
    requireThat(factory, "UNSUPPORTED");
    return factory(location);
  }
}

export function createBuiltinStoreRegistry(): StoreAdapterRegistry {
  const registry = new StoreAdapterRegistry();
  registry.registerCatalog("file", (path) => new FileCatalogStore(path));
  registry.registerLocalState("file", (path) => new FileLocalStateStore(path));
  registry.registerCatalog("test-async-file", (path) => new AsyncTestCatalogStore(path));
  registry.registerLocalState("test-async-file", (path) => new AsyncTestLocalStateStore(path));
  return registry;
}
