import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

/** The layer1/ folder, where the checks run. */
export const layer1 = path.join(import.meta.dirname, "..");

/** How long git may take to list Layer 1's files. */
const GIT_LIST_TIMEOUT_MS = 10_000;

/**
 * Every file under layer1/ that git tracks or does not ignore, as a sorted path relative to it.
 * Like Biome, which reads .gitignore, it leaves out ignored files, such as node_modules, .plans and
 * each person's local files, and keeps dot files. It throws if git cannot list the files: these
 * checks need a git checkout, with git on PATH.
 */
export function layer1Files(): string[] {
  const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: layer1,
    encoding: "utf8",
    timeout: GIT_LIST_TIMEOUT_MS,
  });
  if (git.error !== undefined || git.status !== 0) {
    const cause = git.error?.message ?? `exit ${git.status ?? git.signal}: ${git.stderr.trim()}`;
    throw new Error(
      `git ls-files could not list Layer 1's files (${cause}): these checks need a git checkout, with git on PATH`,
    );
  }
  // The output ends with a NUL. git also lists a tracked file that was deleted from the folder, and
  // an untracked nested repository as a folder: keep only the files that are there.
  return git.stdout
    .split("\0")
    .filter((file) => file !== "" && isFile(file))
    .map((file) => path.normalize(file))
    .sort();
}

function isFile(file: string): boolean {
  return statSync(path.join(layer1, file), { throwIfNoEntry: false })?.isFile() === true;
}
