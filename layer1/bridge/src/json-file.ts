import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { FILE_BUSY_RETRY_MS, FILE_BUSY_STEP_MS, PRIVATE_FILE_MODE } from "./settings.ts";

/** Error codes Windows reports while another program has the file open. */
const BUSY_CODES: ReadonlySet<string> = new Set(["EBUSY", "EPERM", "EACCES"]);

/** A file that could not be read, parsed or written. The message starts with the path. */
export class JsonFileError extends Error {
  readonly filePath: string;
  readonly code: string | undefined;

  constructor(message: string, filePath: string, cause?: unknown) {
    super(message, { cause });
    this.name = "JsonFileError";
    this.filePath = filePath;
    this.code = errorCode(cause);
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `action`, retrying for up to FILE_BUSY_RETRY_MS while Windows reports the file busy. */
export async function retryWhileBusy<T>(action: () => Promise<T>): Promise<T> {
  const deadline = performance.now() + FILE_BUSY_RETRY_MS;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      if (!BUSY_CODES.has(errorCode(error) ?? "") || performance.now() >= deadline) {
        throw error;
      }
      await sleep(FILE_BUSY_STEP_MS);
    }
  }
}

/** Reads a whole file, retrying while Windows reports it busy. An error names the path. */
export async function readFileBytes(filePath: string): Promise<Buffer> {
  try {
    return await retryWhileBusy(() => readFile(filePath));
  } catch (error) {
    throw new JsonFileError(`${filePath}: ${errorMessage(error)}`, filePath, error);
  }
}

/** Reads a UTF-8 JSON file. Invalid JSON is reported by path only, since the text may be secret. */
export async function readJsonFile(filePath: string): Promise<unknown> {
  const text = (await readFileBytes(filePath)).toString("utf8");
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new JsonFileError(`${filePath}: not valid JSON`, filePath);
  }
}

/**
 * Writes `content` as the whole file, readable only by the user: to a temporary file in the same
 * folder, flushed to disk, then renamed over the target. With `exclusive` it is linked into place
 * instead, which fails with code EEXIST if the target exists. A failed write changes nothing.
 */
export async function writeFileWhole(
  filePath: string,
  content: string | Uint8Array,
  options: { readonly exclusive?: boolean } = {},
): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const place = options.exclusive === true ? link : rename;
  try {
    const handle = await open(tempPath, "wx", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(content, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await retryWhileBusy(() => place(tempPath, filePath));
  } catch (error) {
    await removeTemp(tempPath);
    throw new JsonFileError(`${filePath}: ${errorMessage(error)}`, filePath, error);
  }
  if (place === link) {
    await removeTemp(tempPath);
  }
}

/** Removes a file, or a folder and everything in it, retrying while Windows reports it busy. */
export function removePath(target: string): Promise<void> {
  return retryWhileBusy(() => rm(target, { recursive: true, force: true }));
}

/** A leftover temporary file is only clutter, so failing to remove one is logged, not thrown. */
async function removeTemp(tempPath: string): Promise<void> {
  try {
    await removePath(tempPath);
  } catch (error) {
    console.error(`L1 json-file: could not remove ${tempPath}: ${errorMessage(error)}`);
  }
}
