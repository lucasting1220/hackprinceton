/**
 * Check this laptop: CPU cores, memory, free disk and operating system, shown on the welcome page
 * before Create a home or Join a home. Its findings are warnings; they never block a choice.
 */
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Html, html } from "./html.ts";
import * as settings from "./settings.ts";

/** What Check this laptop reads. `freeDiskBytes` is undefined when the disk can't be read. */
export type LaptopFacts = Readonly<{
  cores: number;
  memoryBytes: number;
  freeDiskBytes: number | undefined;
  platform: string;
  osName: string;
}>;

const GIB = 1024 ** 3;
const SUPPORTED_PLATFORMS: Readonly<Record<string, string>> = { darwin: "macOS", win32: "Windows" };

/** Free space for the disk holding `dir`, or its nearest folder that exists. */
async function freeDisk(dir: string): Promise<number | undefined> {
  let at = path.resolve(dir);
  for (;;) {
    try {
      const disk = await statfs(at);
      return disk.bavail * disk.bsize;
    } catch (error) {
      // A system error (no such folder, no access) means unknown, which the page says.
      if (!(error instanceof Error && "code" in error)) throw error;
      const parent = path.dirname(at);
      if (error.code !== "ENOENT" || parent === at) return undefined;
      at = parent;
    }
  }
}

/** This laptop's facts; the disk is the one holding the bridge's state folder. */
export async function readLaptopFacts(stateDir: string): Promise<LaptopFacts> {
  const platform = process.platform;
  const named = SUPPORTED_PLATFORMS[platform] ?? os.type();
  return {
    cores: os.availableParallelism(),
    memoryBytes: os.totalmem(),
    freeDiskBytes: await freeDisk(stateDir),
    platform,
    osName: `${named} ${os.release()}`,
  };
}

const gib = (bytes: number) => Math.round((bytes / GIB) * 10) / 10;

/** The warnings for these facts: memory for a worker, low disk, and an untested system. */
export function laptopWarnings(facts: LaptopFacts): string[] {
  const warnings: string[] = [];
  if (gib(facts.memoryBytes) < settings.WORKER_MIN_MEMORY_GB) {
    warnings.push(
      `This laptop has ${gib(facts.memoryBytes)} GB of memory. Layer 2 needs at least ${settings.WORKER_MIN_MEMORY_GB} GB on a worker, so it may not run well if it joins a home.`,
    );
  }
  if (facts.freeDiskBytes === undefined) {
    warnings.push("This laptop's free disk space couldn't be read.");
  } else if (gib(facts.freeDiskBytes) < settings.LAPTOP_LOW_DISK_GB) {
    warnings.push(
      `Only ${gib(facts.freeDiskBytes)} GB of disk is free. Layers 2 to 4 need room for their Python packages and models: free at least ${settings.LAPTOP_LOW_DISK_GB} GB.`,
    );
  }
  if (SUPPORTED_PLATFORMS[facts.platform] === undefined) {
    warnings.push(`Debbie is built for macOS and Windows; this laptop runs ${facts.osName}.`);
  }
  return warnings;
}

/** The Check this laptop section: the facts, then each warning. Nothing here blocks. */
export function laptopCheckSection(facts: LaptopFacts): Html {
  const disk = facts.freeDiskBytes === undefined ? "unknown" : `${gib(facts.freeDiskBytes)} GB`;
  const warnings = laptopWarnings(facts).map((line) => html`<li>Warning: ${line}</li>`);
  const list = warnings.length === 0 ? html`<p>No warnings.</p>` : html`<ul>${warnings}</ul>`;
  return html`<h2>Check this laptop</h2>
<p>CPU cores: ${facts.cores}. Memory: ${gib(facts.memoryBytes)} GB. Free disk: ${disk}. Operating system: ${facts.osName}.</p>
${list}`;
}
