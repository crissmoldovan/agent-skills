import { lstat, realpath } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";
import { GovernanceError, requireThat } from "./core.ts";

interface StablePathOptions {
  allowMissing?: boolean;
  code?: string;
}

const darwinSystemAliases = new Map([
  ["/etc", "/private/etc"],
  ["/tmp", "/private/tmp"],
  ["/var", "/private/var"],
]);

async function allowedDarwinSystemAlias(path: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const expected = darwinSystemAliases.get(path);
  if (expected === undefined) return false;
  try {
    return (await realpath(path)) === expected;
  } catch {
    return false;
  }
}

export async function requireStablePath(
  path: string,
  options: StablePathOptions = {},
): Promise<void> {
  const code = options.code ?? "INVALID_CONFIG";
  requireThat(
    typeof path === "string" &&
      path.length > 0 &&
      path.length <= 16_384 &&
      path === resolve(path),
    code,
  );
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const status = await lstat(cursor);
      if (status.isSymbolicLink() && !(await allowedDarwinSystemAlias(cursor)))
        throw new GovernanceError(code);
    } catch (error) {
      if (
        options.allowMissing === true &&
        (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ) return;
      if (error instanceof GovernanceError) throw error;
      throw new GovernanceError(code);
    }
  }
}
