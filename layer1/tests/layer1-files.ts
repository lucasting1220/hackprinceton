import { readdirSync } from "node:fs";
import path from "node:path";

/** The layer1/ folder, where the checks run. */
export const layer1 = path.join(import.meta.dirname, "..");

/**
 * Every file under layer1/, as a sorted path relative to it, except installed packages (any
 * node_modules folder) and the gitignored .plans folder at the top, neither of which Biome reads.
 * Unlike fs.globSync, it includes dot files and dot folders, which Biome reads too.
 */
export function layer1Files(): string[] {
  const files: string[] = [];
  const visit = (folder: string): void => {
    for (const entry of readdirSync(path.join(layer1, folder), { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && file !== ".plans") {
        visit(file);
      } else if (entry.isFile()) {
        files.push(file);
      }
    }
  };
  visit("");
  return files.sort();
}
