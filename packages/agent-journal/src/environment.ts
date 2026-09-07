export interface Environment {
  /** The RESOLVED interpreter path. Recording "node" would defeat the purpose:
   *  the class exists to distinguish the binary that ran from the name typed. */
  readonly interpreter: string;
  readonly version: string;
  readonly platform: string;
  readonly packageManager?: string;
  readonly flags?: string;
}

/**
 * Spec 2.1's anchor class. The canonical failure this design targets is an entry
 * that is perfectly anchored and worthless because the suite ran against the
 * wrong interpreter; this is what makes that premise checkable.
 *
 * `proc` is injectable so the capture is testable without spawning a process
 * under a different toolchain.
 */
export function captureEnvironment(proc: NodeJS.Process = process): Environment {
  const pm = proc.env?.npm_config_user_agent?.split(' ')[0]?.trim();
  const flags = proc.execArgv?.join(' ').trim();
  return {
    interpreter: proc.execPath,
    version: proc.version,
    platform: `${proc.platform}/${proc.arch}`,
    ...(pm ? { packageManager: pm } : {}),
    ...(flags ? { flags } : {}),
  };
}
