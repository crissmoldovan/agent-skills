/**
 * Which hooks in a Claude Code settings file a gate installer may call its own.
 *
 * Both gate installers recognised the hooks they wrote by a `describe` prefix until Claude Code was
 * observed removing `describe` from every hook whenever it writes a settings file — adding a plugin
 * marketplace, granting a permission, toggling a `/config` setting. Every such write kept each hook's
 * `command`, `matcher` and `timeout` byte for byte (adapters/HOOK-OUTPUT-NOTES.md, third and fourth
 * addenda of 2026-09-14). So ownership is read from the command here, the one field that survives.
 *
 * WHAT A HOOK IS, for a hook with a string command (`classifyHook`):
 *
 *   ours       It runs the gate, no `describe` somebody else wrote sits on it, and either its WHOLE command
 *              is the installer's exact shape with an interpreter that installer writes (`installerShape`),
 *              or it carries that installer's own `describe`. Taken with no flag.
 *   adoptable  It runs the gate and has no `describe`, in any other shape: the exact shape with any other
 *              interpreter, or a command that RUNS the gate (`gateUse`). Named and refused; taken only
 *              under `--adopt`.
 *   unclear    Outside the exact shape, it names the gate file where this reader cannot tell whether the
 *              gate runs. Named, and never taken, with or without a flag, with or without the installer's
 *              describe: over-reporting a hook is recoverable, and deleting one that is not the gate is not.
 *   foreign    It runs the gate, or may, under a `describe` somebody else wrote. Named, never taken.
 *   null       It does not run the gate: it never names the gate file, or only MENTIONS it — whatever
 *              `describe` it wears.
 *
 * THE INSTALLER'S OWN DESCRIBE. Claude Code drops `describe` when it rewrites the file, but where it has not,
 * a describe that starts with the installer's `describePrefix` is that installer's statement that it wrote
 * the hook. 0.19.0 took every hook wearing it with no flag, so a hook that still wears it and runs the gate,
 * in any shape, is the installer's own. A hook that only mentions the gate file is not taken under it (0.19.0
 * took one), and neither is one where whether the gate runs cannot be told.
 *
 * THE EXACT SHAPE. The command, read as blank-separated words made only of literal characters
 * (letters, digits and `_ . , : / @ % + = -`) and single-quoted runs joined by `\'` — the only quoting
 * either installer has emitted — is:
 *   1. one or more assignments, each to one of the installer's own `variables`, none twice, the
 *      arming `envFlag` among them, each value either literal characters or exactly single-quoted;
 *   2. ONE interpreter word, either literal characters or exactly single-quoted;
 *   3. the gate path: one single-quoted word whose basename is exactly `gateFile`;
 *   4. nothing more — no further word, operator, redirection, comment or expansion.
 * Everything in it is pinned but the interpreter, so a command in that shape is read by its interpreter alone,
 * and it is NEVER unclear:
 *   - it is the installer's own when the interpreter is written the way that installer writes one, as its
 *     `HOOK_IDENTITY.interpreter` says: `{ quoted: true, pattern, names }` is single-quoted with a basename that
 *     matches `pattern` or is exactly one of `names`; `{ quoted: false, names }` is exactly one of `names`, bare;
 *   - it is nobody's when the interpreter is a program in `MENTIONS`: `'/bin/echo' '<gate>'` prints a path;
 *   - it is adoptable otherwise. The interpreter is the one thing in it that differs from what the installer
 *     wrote, and a user who passes `--adopt` over it has made that call. What must not happen is what did: an
 *     installer run as `node-22` read the hooks it had written as `node-20` as unclear, which no flag takes,
 *     where 0.19.0 took them.
 * Claude Code keeps the command byte for byte, so the shape an installer emitted is the shape it finds again.
 *
 * RUNS THE GATE is structural, over the command's simple commands as `sh` splits them. In some simple
 * command, past its leading assignments, the reserved words `! { } if then else elif fi do done while
 * until time`, and the wrappers `exec`, `command`, `nohup` and `env` (only `env` takes assignments):
 *   - the program's basename is exactly the gate file; or
 *   - the program is an interpreter — a name matching `NODE_RUNTIME_NAME`, or `.` or `source` — or a shell
 *     in `SHELLS`, and the very next word's basename is exactly the gate file; or
 *   - the program is a shell given `-c`, and the gate runs in that script; or
 *   - the gate runs inside a `$(…)`, backtick or `<(…)` substitution.
 * A gate path that is an argument of a command that prints, reads, lists, tests, copies, moves or
 * deletes files — the programs in `MENTIONS`: `echo`, `cat`, `grep`, `ls`, `test`, `cp`, `rm`,
 * `shellcheck` and the like — is a MENTION, and that command runs nothing of the gate. Whatever else
 * names the gate file is UNCLEAR: an argument of any other program (`timeout`, `sudo`, `xargs`, a
 * wrapper script), a word after an interpreter's options (`node --check`), a mention whose output is
 * piped on, a variable's value, a here-document's body, a substitution the gate does not run in, and
 * every command in a text that defines a function.
 *
 * NAMING THE GATE FILE means a word, or a piece of one split at blanks, quotes, `= : ,`, `$`, parens,
 * braces and shell operators, whose basename is exactly the gate file. So
 * `install-report-progress-gate.mjs` and `report-progress-gate.mjs.bak` never name it.
 *
 * This reads shell text, and it is the kind of reading that has gone wrong in this repository before,
 * so its scope is small on purpose: whether a command runs a file, and whether it is exactly what an
 * installer wrote. It evaluates nothing. It never decides what a gate enforces — the level and mode are
 * read by `leadingAssignments` alone, and a value it cannot read literally is reported as unreadable
 * rather than guessed.
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
/** `(` followed only by blanks and `)`: the `name ()` of a function definition. */
const EMPTY_PARENS = /[ \t]*\)/y;
const ARRAY_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=$/;

function closingDoubleQuote(text, start) {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '"') return index;
  }
  return text.length;
}

/** The index of the `)` that closes a `(` whose content starts at `start`; the text's length when none does. */
function closingParen(text, start) {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
    } else if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close === -1) return text.length;
      index = close;
    } else if (char === '"') {
      index = closingDoubleQuote(text, index + 1);
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function closingBacktick(text, start) {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '`') return index;
  }
  return text.length;
}

/** Read the bodies of the here-documents whose delimiters are pending, from `start`; return where reading stopped. */
function readHeredocBodies(text, start, pending) {
  let cursor = start;
  while (pending.length > 0) {
    const { delimiter, stripTabs, owner } = pending.shift();
    const body = [];
    while (cursor < text.length) {
      const newline = text.indexOf('\n', cursor);
      const end = newline === -1 ? text.length : newline;
      const line = text.slice(cursor, end);
      cursor = end + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break;
      body.push(line);
    }
    owner.heredocs.push(body.join('\n'));
  }
  return Math.min(cursor, text.length);
}

/**
 * A command's simple commands, each with its words after quote removal, the text of every command
 * substitution in it, the bodies of its here-documents, and whether its output is piped on — the way
 * `sh` splits them, as far as that matters for telling what a command runs. Single quotes are literal;
 * double quotes honour `\"`, `\\`, `\$`, `` \` `` and a backslash-newline; an unquoted backslash escapes
 * one character; a `#` that begins a word starts a comment. A `$(…)`, backtick or `<(…)` substitution
 * stays in the word it belongs to, as the literal text it is written as, because nothing here evaluates
 * anything. `&>`, `>&`, `<&` and `>|` redirect; a here-document's body is data; `name=(…)` is one word.
 * An unbalanced quote or substitution runs to the end of the text.
 */
function parseShell(command) {
  const text = String(command);
  const commands = [];
  const pendingHeredocs = [];
  let definesFunction = false;
  let heredocDelimiter = null;
  const fresh = () => ({ words: [], substitutions: [], heredocs: [], pipesOut: false });
  let current = fresh();
  let word = null;

  const endWord = () => {
    if (word === null) return;
    if (heredocDelimiter) {
      pendingHeredocs.push({ delimiter: word, stripTabs: heredocDelimiter.stripTabs, owner: current });
      heredocDelimiter = null;
    }
    current.words.push(word);
    word = null;
  };
  const endCommand = (pipesOut = false) => {
    endWord();
    if (current.words.length > 0) {
      current.pipesOut = pipesOut;
      commands.push(current);
    }
    current = fresh();
  };
  const substitution = (open, close) => {
    current.substitutions.push(text.slice(open, close));
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
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
        } else if (text[cursor] === '$' && text[cursor + 1] === '(') {
          const close = closingParen(text, cursor + 2);
          substitution(cursor + 2, close);
          value += text.slice(cursor, close + 1);
          cursor = close + 1;
        } else if (text[cursor] === '`') {
          const close = closingBacktick(text, cursor + 1);
          substitution(cursor + 1, close);
          value += text.slice(cursor, close + 1);
          cursor = close + 1;
        } else {
          value += text[cursor];
          cursor += 1;
        }
      }
      word = (word ?? '') + value;
      index = cursor;
    } else if (char === '\\') {
      if (index + 1 < text.length && next !== '\n') word = (word ?? '') + next;
      index += 1;
    } else if (char === '$' && next === '(') {
      const close = closingParen(text, index + 2);
      substitution(index + 2, close);
      word = (word ?? '') + text.slice(index, close + 1);
      index = close;
    } else if (char === '`') {
      const close = closingBacktick(text, index + 1);
      substitution(index + 1, close);
      word = (word ?? '') + text.slice(index, close + 1);
      index = close;
    } else if (char === '(' && word !== null && ARRAY_ASSIGNMENT.test(word)) {
      const close = closingParen(text, index + 1);
      word += text.slice(index, close + 1);
      index = close;
    } else if ((char === '<' || char === '>') && next === '(') {
      // A process substitution: a word of its own, whose content is a command.
      endWord();
      const close = closingParen(text, index + 2);
      substitution(index + 2, close);
      word = text.slice(index, close + 1);
      endWord();
      index = close;
    } else if (char === '<' && next === '<' && text[index + 2] !== '<') {
      // A here-document: the next word is its delimiter, and its body starts after the next newline.
      endWord();
      const stripTabs = text[index + 2] === '-';
      heredocDelimiter = { stripTabs };
      index += stripTabs ? 2 : 1;
    } else if (char === '<' && next === '<') {
      // `<<<`, a here-string: the word after it is data, like any redirection's.
      endWord();
      index += 2;
    } else if (char === '#' && word === null) {
      const newline = text.indexOf('\n', index);
      if (newline === -1) break;
      index = newline - 1;
    } else if (BLANKS.has(char)) {
      endWord();
    } else if ((char === '&' || char === '|') && (text[index - 1] === '<' || text[index - 1] === '>')) {
      // `>&`, `<&` and `>|` are redirections, not a background job or a pipe.
      endWord();
    } else if (char === '&' && next === '>') {
      endWord();
    } else if (char === '|') {
      if (next === '|') {
        endCommand();
        index += 1;
      } else {
        endCommand(true);
        if (next === '&') index += 1;
      }
    } else if (char === '\n') {
      endCommand();
      if (pendingHeredocs.length > 0) index = readHeredocBodies(text, index + 1, pendingHeredocs) - 1;
    } else if (CONTROL.has(char)) {
      if (char === '(') {
        EMPTY_PARENS.lastIndex = index + 1;
        if (EMPTY_PARENS.test(text)) definesFunction = true;
      }
      endCommand();
    } else if (REDIRECTION.has(char)) {
      endWord();
    } else {
      word = (word ?? '') + char;
    }
  }
  endCommand();
  return { commands, definesFunction };
}

/** A command's simple commands, each as its words after quote removal (see `parseShell`). */
export function shellCommands(command) {
  return parseShell(command).commands.map((simple) => simple.words);
}

/** The last path segment, on either separator. Exact comparison happens at the caller. */
function basename(word) {
  const segments = String(word).split(/[\\/]/);
  return segments[segments.length - 1];
}

const NONE = 0;
const UNCLEAR = 1;
const RUNS = 2;

/**
 * The name of a binary that runs a Node ES module given as its first argument: `node`, `nodejs` or `bun`, then an
 * optional version (`-20`, `22`, `_22`, `-v22.11.0`), then an optional `.exe`, in any case.
 *
 * WHY A PATTERN, AND THIS ONE. The report-progress installer writes `process.execPath`, so the name in its hooks is
 * whatever the binary that ran it was called, on that machine, at that time, and the hooks outlive that binary. The
 * official builds, nvm, volta, asdf and Homebrew install `node`; Debian and Ubuntu's own package installs `nodejs`; a
 * side-by-side install is named after its version; Windows adds `.exe` and ignores case, as macOS does by default; and
 * bun, which runs both the installer and the gate, reports its own binary as `process.execPath`. A list of names grew
 * one measured miss at a time (`nodejs`, then `node-22`); a runtime stem, a version and an extension is that family
 * in one line. It stays narrow on purpose — `nodemon`, `node-gyp` and `bunx` are not runtimes — and a name outside it is
 * not refused: in an installer's exact shape it is adoptable, and under the installer's own describe its own.
 */
export const NODE_RUNTIME_NAME = /^(?:node|nodejs|bun)(?:[-_]?v?\d+(?:\.\d+)*)?(?:\.exe)?$/i;
/** Besides a Node-compatible runtime, the shell's own words for running a file in place. */
const SOURCING = new Set(['.', 'source']);
/** Programs whose next word is the script they run. */
const isInterpreter = (program) => SOURCING.has(program) || NODE_RUNTIME_NAME.test(program);
/** Shells: the next word is the script they run, and `-c` hands them a script as text. */
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'sh.exe', 'bash.exe']);
/** Programs that print, read, list, test, copy, move or delete a file and never run it. */
const MENTIONS = new Set([
  'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'wc',
  'ls', 'stat', 'file', 'test', '[', '[[', 'true', 'false', ':', 'cp', 'mv', 'ln', 'rm', 'touch',
  'chmod', 'chown', 'mkdir', 'diff', 'cmp', 'realpath', 'readlink', 'basename', 'dirname',
  'sha256sum', 'shasum', 'md5sum', 'shellcheck',
]);
/** Words that lead a program without being one. Only `env` takes assignments. */
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'time']);
const WRAPPERS = new Set(['exec', 'command', 'nohup', 'env']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_SCRIPT_OPTION = /^-[A-Za-z]*c[A-Za-z]*$/;
const PIECE_BOUNDARY = /[\s'"`$=:,(){}<>;|&]+/;
/** Substitutions and nested `-c` scripts deeper than this are not followed, only searched for the gate. */
const MAX_DEPTH = 8;

/** True when some piece of the text (see the header) has exactly the gate file as its basename. */
function namesGate(text, gateFile) {
  return String(text).split(PIECE_BOUNDARY).some((piece) => basename(piece) === gateFile);
}

/** RUNS, UNCLEAR or NONE for one simple command. */
function simpleCommandGateUse({ words, substitutions, heredocs, pipesOut }, gateFile, depth) {
  let use = NONE;
  for (const inner of substitutions) {
    use = Math.max(use, gateUse(inner, gateFile, depth + 1) === RUNS ? RUNS : namesGate(inner, gateFile) ? UNCLEAR : NONE);
  }
  if (heredocs.some((body) => namesGate(body, gateFile))) use = Math.max(use, UNCLEAR);
  const unclearIfNamed = (list) => Math.max(use, list.some((word) => namesGate(word, gateFile)) ? UNCLEAR : NONE);

  let index = 0;
  let assignmentsLead = true;
  for (;;) {
    while (assignmentsLead && index < words.length && ASSIGNMENT.test(words[index])) {
      // A variable holding the gate's path may run it later.
      if (namesGate(words[index], gateFile)) use = Math.max(use, UNCLEAR);
      index += 1;
    }
    assignmentsLead = true;
    if (index >= words.length) return use;
    if (RESERVED.has(words[index])) {
      index += 1;
    } else if (WRAPPERS.has(basename(words[index]))) {
      assignmentsLead = basename(words[index]) === 'env';
      index += 1;
      if (index < words.length && words[index].startsWith('-')) return unclearIfNamed(words.slice(index));
    } else {
      break;
    }
  }

  const program = basename(words[index]);
  const rest = words.slice(index + 1);
  if (program === gateFile) return RUNS;
  if (SHELLS.has(program)) {
    let at = 0;
    let script = false;
    while (at < rest.length && rest[at].startsWith('-') && rest[at] !== '-') {
      if (rest[at] === '--') {
        at += 1;
        break;
      }
      if (SHELL_SCRIPT_OPTION.test(rest[at])) script = true;
      at += 1;
    }
    if (script) {
      if (at >= rest.length) return use;
      const inner = gateUse(rest[at], gateFile, depth + 1);
      return Math.max(unclearIfNamed(rest.slice(at + 1)), inner);
    }
    if (at === 0 && rest.length > 0 && basename(rest[0]) === gateFile) return RUNS;
    return unclearIfNamed(rest);
  }
  if (isInterpreter(program)) {
    if (rest.length > 0 && basename(rest[0]) === gateFile) return RUNS;
    return unclearIfNamed(rest);
  }
  if (MENTIONS.has(program)) return pipesOut ? unclearIfNamed(rest) : use;
  return unclearIfNamed(rest);
}

/** RUNS when the text runs the gate, UNCLEAR when it names the gate file and whether it runs cannot be told, NONE otherwise. */
function gateUse(text, gateFile, depth = 0) {
  if (depth > MAX_DEPTH) return namesGate(text, gateFile) ? UNCLEAR : NONE;
  const { commands, definesFunction } = parseShell(text);
  let use = NONE;
  for (const simple of commands) use = Math.max(use, simpleCommandGateUse(simple, gateFile, depth));
  // A function body runs only if the function is called, which is not something to guess at.
  return definesFunction ? Math.min(use, UNCLEAR) : use;
}

const LITERAL = /[A-Za-z0-9_.,:\/@%+=-]/;
const LITERAL_RUN = /^[A-Za-z0-9_.,:\/@%+=-]*$/;
const ASSIGNMENT_NAME = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/** How both installers quote a word. */
function singleQuoted(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

/** The command's words, each as written (`raw`) and after quote removal (`value`); `null` for anything
 *  but literal characters and single-quoted runs joined by `\'`, separated by blanks. */
function installerWords(command) {
  const text = String(command);
  const words = [];
  let index = 0;
  while (index < text.length) {
    if (BLANKS.has(text[index])) {
      index += 1;
      continue;
    }
    let raw = '';
    let value = '';
    while (index < text.length && !BLANKS.has(text[index])) {
      const char = text[index];
      if (char === "'") {
        const close = text.indexOf("'", index + 1);
        if (close === -1) return null;
        raw += text.slice(index, close + 1);
        value += text.slice(index + 1, close);
        index = close + 1;
      } else if (char === '\\' && text[index + 1] === "'") {
        raw += "\\'";
        value += "'";
        index += 2;
      } else if (LITERAL.test(char)) {
        raw += char;
        value += char;
        index += 1;
      } else {
        return null;
      }
    }
    words.push({ raw, value });
  }
  return words;
}

/**
 * The command read as the installer's exact shape (THE EXACT SHAPE in the header): `null` when it is not in that
 * shape, and otherwise `{ owned, mention }` — `owned` when its interpreter is written the way this installer writes
 * one, `mention` when that word is a program that only prints, reads, lists, copies or deletes files.
 *
 * @param {string} command
 * @param {{ envFlag: string, gateFile: string, variables?: readonly string[], interpreter?: { quoted?: boolean, pattern?: RegExp, names?: readonly string[] } }} identity
 */
export function installerShape(command, { envFlag, gateFile, variables = [envFlag], interpreter } = {}) {
  const words = installerWords(command);
  if (words === null || !plainObject(interpreter)) return null;
  const assigned = new Set();
  let index = 0;
  for (; index < words.length; index += 1) {
    const match = ASSIGNMENT_NAME.exec(words[index].raw);
    if (!match) break;
    const [prefix, name] = match;
    if (!variables.includes(name) || assigned.has(name)) return null;
    const raw = words[index].raw.slice(prefix.length);
    if (!LITERAL_RUN.test(raw) && raw !== singleQuoted(words[index].value.slice(prefix.length))) return null;
    assigned.add(name);
  }
  if (!assigned.has(envFlag) || words.length - index !== 2) return null;
  const [program, gate] = words.slice(index);
  if (gate.raw !== singleQuoted(gate.value) || basename(gate.value) !== gateFile) return null;
  const quoted = program.raw === singleQuoted(program.value);
  if (!quoted && !LITERAL_RUN.test(program.raw)) return null;
  // Single-quoted, the installer wrote a path, and its basename is the name; bare, the word is the name.
  const name = quoted ? basename(program.value) : program.raw;
  const names = [interpreter.names].flat().filter((entry) => typeof entry === 'string' && entry !== '');
  const owned = quoted === (interpreter.quoted === true)
    && (names.includes(name) || (interpreter.pattern instanceof RegExp && interpreter.pattern.test(name)));
  return { owned, mention: MENTIONS.has(basename(program.value)) };
}

/**
 * `ours`, `adoptable`, `unclear`, `foreign`, or `null` for a hook that does not run the gate at all
 * (or is not a command hook with a string command). See the header for what each means. Never throws.
 *
 * @param {unknown} hook
 * @param {{ envFlag: string, gateFile: string, describePrefix: string, variables?: readonly string[], interpreter?: object }} identity
 */
export function classifyHook(hook, identity) {
  if (!plainObject(hook) || typeof hook.command !== 'string' || !plainObject(identity)) return null;
  // The exact shape is read by its interpreter alone, and is never unclear (THE EXACT SHAPE in the header).
  const shape = installerShape(hook.command, identity);
  const use = shape ? (shape.mention ? NONE : RUNS) : gateUse(hook.command, identity.gateFile);
  if (use === NONE) return null;
  if (Object.hasOwn(hook, 'describe')) {
    // A describe is a statement of ownership: somebody else's vetoes it, and this installer's own grants it to a
    // hook that runs the gate (THE INSTALLER'S OWN DESCRIBE in the header).
    const prefix = identity.describePrefix;
    const ownDescribe = typeof prefix === 'string' && prefix !== '' && typeof hook.describe === 'string' && hook.describe.startsWith(prefix);
    if (!ownDescribe) return 'foreign';
    return use === RUNS ? 'ours' : 'unclear';
  }
  if (use === UNCLEAR) return 'unclear';
  return shape?.owned ? 'ours' : 'adoptable';
}

/**
 * Why an installer leaves an unowned hook where it is, for the line that names it. `ownShape` says, in
 * a few words, what that installer's own command is made of.
 */
export function unownedReason(kind, ownShape) {
  if (kind === 'adoptable') {
    return `runs this gate, but its command is not exactly the command this installer writes — ${ownShape}, and nothing else — so it is not recognised as this installer's own. A hand-wiring looks like this, and so does a hook written under an interpreter this installer does not know by name.`;
  }
  if (kind === 'unclear') {
    return 'names this gate\'s file where this installer cannot tell whether the gate runs — an argument of a program it does not know, a word after an interpreter\'s options, a pipe, a substitution, a variable, a here-document or a function — so it is never adopted: removing a hook that is not the gate cannot be undone. If it does run the gate, remove it by hand.';
  }
  return 'runs this gate, or may, under a describe this installer did not write, so it is never adopted — remove it by hand, or with whatever wrote it.';
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

/** Every hook that runs the gate, or may, and is not the installer's own, with where it sits and which kind. */
export function findUnownedHooks(settings, identity) {
  const found = [];
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const kind = classifyHook(hook, identity);
        if (kind === 'adoptable' || kind === 'unclear' || kind === 'foreign') found.push({ event, matcher: group.matcher, kind });
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
