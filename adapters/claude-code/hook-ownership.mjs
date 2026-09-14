/**
 * Which hooks in a Claude Code settings file a gate installer may call its own.
 *
 * Both gate installers recognised the hooks they wrote by a `describe` prefix until Claude Code was
 * observed removing `describe` from every hook whenever it writes a settings file — adding a plugin
 * marketplace, granting a permission, toggling a `/config` setting. Every such write kept each hook's
 * `command`, `matcher` and `timeout` byte for byte (adapters/HOOK-OUTPUT-NOTES.md, third and fourth
 * addenda of 2026-09-14). So ownership is read from the command here, the one field that survives.
 *
 * THE FINGERPRINT. A hook is an installer's own when its command has
 *   1. the gate's arming assignment (`AGENT_SKILLS_PROGRESS_GATE=…` or
 *      `AGENT_SKILLS_RELEASE_NOTES_GATE=…`) among the command's leading assignments, read only where
 *      the shell reads it literally; and
 *   2. an argument of that same simple command whose basename is EXACTLY the gate file.
 * Every command either installer has ever written has that shape, because the assignment is what arms
 * the gate. The basename is compared exactly: the substring check this replaced took
 * `install-report-progress-gate.mjs` and `report-progress-gate.mjs.bak` for the gate, and `--adopt`
 * would then have removed hooks that never ran it.
 *
 * THE VETO. A `describe` somebody else wrote — an empty one included — is a statement of ownership,
 * and a hook carrying one is `foreign`, whatever its command looks like. An absent `describe`, or the
 * installer's own, leaves the decision to the command. That includes a hook wearing the installer's
 * describe over a command without the fingerprint: no installer wrote one, so it is a hand-edit.
 *
 * WHAT IS LEFT. A hook that runs the gate without the fingerprint — no assignment, `env A=… node …`,
 * `cd … && …`, `export …;`, a nested `bash -c '…'` — is `adoptable`: named by `--remove` and by an
 * install's refusal, and taken only when the user passes `--adopt`.
 *
 * This reads shell text, and it is the kind of reading that has gone wrong in this repository before,
 * so its scope is small on purpose: it tells whether a command runs a file and what leads it. It never
 * decides what a gate enforces — the level and mode are read by `leadingAssignments` alone, and a
 * value it cannot read literally is reported as unreadable rather than guessed.
 */

export function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The leading `NAME=value` assignments of a command, as the shell reads them: it stops at the first
 * word that is not one. A value is read only where the shell reads it literally — bare characters with
 * no expansion or operator among them, single quotes, double quotes holding no `$`, backtick or
 * backslash, and a backslash-escaped character — and the first value that is anything else ends the
 * scan, exactly as the first command word does.
 */
export function leadingAssignments(command) {
  const assignments = [];
  const pattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)=((?:'[^']*'|"[^"$`\\]*"|\\[^\n]|[A-Za-z0-9_.,:\/@%+=-])*)(?=\s|$)/;
  let rest = String(command);
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    const [whole, name, raw] = match;
    const value = raw.replace(/'([^']*)'|"([^"]*)"|\\([^\n])/g, (_, single, double, escaped) => single ?? double ?? escaped);
    assignments.push({ name, value });
    rest = rest.slice(whole.length);
  }
  return assignments;
}

const BLANKS = new Set([' ', '\t']);
/** Each of these ends a simple command. `&&`, `||` and `;;` are two of them in a row, which is the same. */
const CONTROL = new Set([';', '&', '|', '(', ')', '\n']);
/** These end a word without ending the command. */
const REDIRECTION = new Set(['<', '>']);

/**
 * A command's simple commands, each as its words after quote removal — the way `sh` splits them, as
 * far as that matters for telling what a command runs. Single quotes are literal; double quotes honour
 * `\"`, `\\`, `\$`, `` \` `` and a backslash-newline; an unquoted backslash escapes one character; a
 * `#` that begins a word starts a comment. Expansions are left as the literal text they are written
 * as, because nothing here evaluates anything. An unbalanced quote runs to the end of the text.
 */
export function shellCommands(command) {
  const text = String(command);
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) {
      words.push(word);
      word = null;
    }
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) {
      commands.push(words);
      words = [];
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      const stop = close === -1 ? text.length : close;
      word = (word ?? '') + text.slice(index + 1, stop);
      index = stop;
    } else if (char === '"') {
      let value = '';
      let cursor = index + 1;
      while (cursor < text.length && text[cursor] !== '"') {
        if (text[cursor] === '\\' && cursor + 1 < text.length && '"\\$`\n'.includes(text[cursor + 1])) {
          if (text[cursor + 1] !== '\n') value += text[cursor + 1];
          cursor += 2;
        } else {
          value += text[cursor];
          cursor += 1;
        }
      }
      word = (word ?? '') + value;
      index = cursor;
    } else if (char === '\\') {
      if (index + 1 < text.length && text[index + 1] !== '\n') word = (word ?? '') + text[index + 1];
      index += 1;
    } else if (char === '#' && word === null) {
      const newline = text.indexOf('\n', index);
      if (newline === -1) break;
      index = newline - 1;
    } else if (BLANKS.has(char)) {
      endWord();
    } else if (CONTROL.has(char)) {
      endCommand();
    } else if (REDIRECTION.has(char)) {
      endWord();
    } else {
      word = (word ?? '') + char;
    }
  }
  endCommand();
  return commands;
}

/** The last path segment, on either separator. Exact comparison happens at the caller. */
function basename(word) {
  const segments = String(word).split(/[\\/]/);
  return segments[segments.length - 1];
}

/**
 * True when some word of the command — or some blank-separated piece of one, which is how a nested
 * `bash -c 'node …/gate.mjs --flag'` carries it — has exactly the gate file as its basename. Wide on
 * purpose: this decides whether a hook is REPORTED as running the gate, and a hook nobody reports is
 * a second gate stacked silently beside the first.
 */
function runsGate(commands, gateFile) {
  return commands.some((words) => words.some((word) => basename(word) === gateFile
    || word.split(/\s+/).some((piece) => basename(piece) === gateFile)));
}

/**
 * True when the gate's own assignment leads the command and an argument of that same simple command
 * — a whole word, not a piece of one — has exactly the gate file as its basename. Narrow on purpose:
 * this decides what an installer may rewrite or remove without being asked.
 */
function carriesFingerprint(command, commands, envFlag, gateFile) {
  if (!leadingAssignments(command).some((assignment) => assignment.name === envFlag)) return false;
  const first = commands[0] ?? [];
  let index = 0;
  while (index < first.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first[index])) index += 1;
  return first.slice(index).some((word) => basename(word) === gateFile);
}

/**
 * `ours`, `adoptable`, `foreign`, or `null` for a hook that does not run the gate at all (or is not a
 * command hook with a string command). See the header for what each means. Never throws.
 *
 * @param {unknown} hook
 * @param {{ envFlag: string, gateFile: string, describePrefix: string }} identity
 */
export function classifyHook(hook, { envFlag, gateFile, describePrefix }) {
  if (!plainObject(hook) || typeof hook.command !== 'string') return null;
  const commands = shellCommands(hook.command);
  if (!runsGate(commands, gateFile)) return null;
  const describedByAnother = Object.hasOwn(hook, 'describe')
    && !(typeof hook.describe === 'string' && hook.describe.startsWith(describePrefix));
  if (describedByAnother) return 'foreign';
  return carriesFingerprint(hook.command, commands, envFlag, gateFile) ? 'ours' : 'adoptable';
}

/**
 * The groups under one event key that are shaped the way an installer understands — GROUP BY GROUP,
 * never all-or-nothing.
 *
 * SCANNING is done over every key in `settings.hooks` rather than over an installer's own event list,
 * so it meets keys written by other tools, by other versions, and by hand. Refusing the whole run
 * because of somebody else's typo three keys away would make `--remove` fail exactly when a user is
 * trying to get rid of a gate.
 *
 * Skipping the whole KEY on one bad group is the same failure wearing a politer face, and it is worse
 * than failing loudly: with a malformed group beside it, the report-progress gate's own `Stop` hook in
 * the good group survived `--remove` while the run printed "Removed 1 … hook" (measured). A group
 * whose `hooks` is not an array holds no hook entries to find, so skipping just that group loses
 * nothing and reaches everything else.
 */
export function isReadableGroup(group) {
  return plainObject(group) && Array.isArray(group.hooks);
}

export function readableGroups(settings, event) {
  const value = settings.hooks?.[event];
  if (!Array.isArray(value)) return null;
  return value.filter(isReadableGroup);
}

/** Every event key present in the file. A snapshot, because the callers delete keys. */
export function eventKeys(settings) {
  if (!plainObject(settings) || !Object.hasOwn(settings, 'hooks')) return [];
  if (!plainObject(settings.hooks)) throw new Error('refusing to write: the settings "hooks" key is not an object');
  return Object.keys(settings.hooks);
}

/** Every hook that runs the gate but is not the installer's own, with where it sits and which kind. */
export function findUnownedHooks(settings, identity) {
  const found = [];
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const kind = classifyHook(hook, identity);
        if (kind === 'adoptable' || kind === 'foreign') found.push({ event, matcher: group.matcher, kind });
      }
    }
  }
  return found;
}

/** `Stop (matcher *)`: a hook named the way a user finds it in the file. */
export function hookLabel({ event, matcher }) {
  if (typeof matcher !== 'string') return `${event} (no matcher)`;
  return matcher === '' ? `${event} (matcher "")` : `${event} (matcher ${matcher})`;
}
