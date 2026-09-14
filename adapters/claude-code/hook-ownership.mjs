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
 *   adoptable  It runs the gate and has no `describe`, in any other shape: the exact shape with another program
 *              known to run that gate's file, or a command that RUNS the gate (`gateUse`). Named and refused; taken
 *              only under `--adopt`.
 *   unclear    It names the gate file where this reader cannot tell whether the gate runs: outside the exact
 *              shape, anywhere the structural reading below cannot follow; in it, a program in the interpreter's
 *              place that this reader does not know runs the gate. Or it carries the installer's own `describe`
 *              over a command that never names the gate file, which a script of the user's may still run. Named,
 *              and never taken by a run without `--adopt`, with or without the installer's describe: over-reporting
 *              a hook is recoverable, and deleting one that is not the gate is not. `--adopt` takes one over by THE
 *              OVERRIDE, below, and the installer says so.
 *   foreign    It runs the gate, or may, under a `describe` somebody else wrote. Named, never taken (NEVER TAKEN, below).
 *   null       It does not run the gate, as this reader judges it (KNOWN MISREADS, below): it never names the gate
 *              file, or it is a MENTION, a WRITE TARGET or a
 *              DIFFERENT FILE (NEVER TAKEN, below) — whatever `describe` it wears. No flag takes it, and
 *              `findHooksNamingGate` says which of those it is, and which kind, so that `--remove` names it (LEFT ALONE).
 *
 * THE INSTALLER'S OWN DESCRIBE. Claude Code drops `describe` when it rewrites the file, but where it has not,
 * a describe that starts with the installer's `describePrefix` is that installer's statement that it wrote
 * the hook. 0.19.0 took every hook wearing it with no flag, whatever its command, so a hook that still wears it
 * and runs the gate, in any shape, is the installer's own. A hook that only mentions the gate file, only writes to
 * it or names a different file is not taken under it (0.19.0 took each), and neither is one where whether the gate
 * runs cannot be told, nor one whose command never names the gate file: those two need `--adopt`.
 *
 * THE EXACT SHAPE. The command, read as blank-separated words made only of literal characters
 * (letters, digits and `_ . , : / @ % + = -`) and single-quoted runs joined by `\'` — the only quoting
 * either installer has emitted — is:
 *   1. one or more assignments, each to one of the installer's own `variables`, none twice, the
 *      arming `envFlag` among them, each value either literal characters or exactly single-quoted;
 *   2. ONE interpreter word, either literal characters or exactly single-quoted;
 *   3. the gate path: one single-quoted word, not an option (it does not start with `-`), whose basename is exactly
 *      `gateFile`;
 *   4. nothing more — no further word, operator, redirection, comment or expansion.
 * Everything in it is pinned but the interpreter, so a command in that shape is read by its interpreter alone:
 *   - it is the installer's own when the interpreter is written the way that installer writes one, as its
 *     `HOOK_IDENTITY.interpreter` says: `{ quoted: true, pattern, names }` is single-quoted with a basename that
 *     matches `pattern` or is exactly one of `names`; `{ quoted: false, names }` is exactly one of `names`, bare;
 *   - it runs the gate, and is adoptable, when the interpreter's basename is a program that runs that gate's kind of
 *     file, as `interpreter.runs` says — a Node-compatible runtime (`NODE_RUNTIME_NAME`) for the report-progress
 *     gate, a shell (`SHELL_SCRIPT_RUNNER`) for the release-notes gate — written any other way, or is the gate itself;
 *   - it is nobody's when the interpreter is a program in `MENTIONS`: `'/bin/echo' '<gate>'` prints a path, and
 *     `'/bin/unlink' '<gate>'` deletes it;
 *   - it is UNCLEAR otherwise. `unlink`, `xxd` and `du` in that place were once read as running the gate, so the
 *     installer's own describe made a plain re-run take them silently: a program this reader does not know runs the
 *     gate is not one it may say does. What must not happen either is what did before: an installer run as `node-22`
 *     read the hooks it had written as `node-20` as a hook no flag takes, where 0.19.0 took them. `node-20` is a
 *     Node-compatible runtime's name, and `--adopt` takes over any unclear hook (THE OVERRIDE).
 * Claude Code keeps the command byte for byte, so the shape an installer emitted is the shape it finds again.
 *
 * RUNS THE GATE is structural, over the command's simple commands as `sh` splits them. In some simple
 * command, past its leading assignments, the reserved words `! { } if then else elif fi do done while
 * until`, and every WRAPPER (below) with the options and operands it takes:
 *   - the program's basename is exactly the gate file; or
 *   - the program is an interpreter — a name matching `NODE_RUNTIME_NAME`, or `.` or `source` — or a shell
 *     in `SHELLS`, and the very next word is not an option and its basename is exactly the gate file
 *     (`node --gate=<gate>` names the gate in an option, which node refuses, and runs nothing); or
 *   - the program is a shell given `-c`, and the gate runs in that script; or
 *   - the gate runs inside a `$(…)`, backtick or `<(…)` substitution.
 * ONE CONSUMER ANALYSIS decides whether a place the gate file is named is a MENTION. The gate file may be named as an argument, on a
 * program's stdin — a pipe, a here-string, a here-document, or a `<` redirection — or as a substitution's output that feeds a
 * program. In every one of these the CONSUMER is the program that takes it. It is a MENTION when every consumer is a program the
 * reader knows does not run it — the programs in `MENTIONS`: `echo`, `cat`, `grep`, `ls`, `test`, `cp`, `rm`, `unlink`, `wc`, `xxd`,
 * `od`, `du`, `shellcheck` and the like, and not `rg`, which runs the file its `--pre` names — and nothing that consumer prints flows
 * on into anything else (`outputInert`). So `cat '<gate>' | grep x`, `echo "$(cat '<gate>')"`, `wc -l < '<gate>'`, `cat <<< '<gate>'`
 * and a here-document into `cat` are mentions, the same data flow spelled four ways. Any consumer that is an interpreter, a shell, or
 * a program the reader does not know is UNCLEAR: `node <<< '<gate>'`, `bash < '<gate>'` and `cat '<gate>' | node` all stay unclear,
 * takeable only by `--adopt`. UNCLEAR also covers the program word itself where the gate file's name is joined to a glob or a
 * parameter (`/pack/*release-notes-gate.sh`), an option before a shell's `-c` script (`bash --rcfile='<gate>' -c true`), a wrapper
 * form the table below does not pin, a word after an interpreter's options (`node --check`), a variable's value, a substitution the
 * gate does not run in, and every command in a text that defines a function. A file a redirection WRITES to is not a word of the command and runs nothing:
 * `timeout 5 >'<gate>' node x` runs `node x` and truncates the gate, so it is nobody's hook. And a command that
 * WRITES TO THE GATE FILE is never read as running it, only as UNCLEAR — through a redirection of its own or of a
 * substitution in it, `>`, `>>`, `>|`, `&>`, `>&` and `<>` alike: the shell opens `>'<gate>'` before the program
 * starts, so `bash '<gate>' >'<gate>'` runs an empty file, and `>>`, `<>` or a later `: >'<gate>'` change the gate
 * around the run.
 *
 * WRAPPERS are commands whose documented form is `wrapper [options] [operands] COMMAND [args]` and which
 * execute COMMAND. The reader strips each by the grammar pinned for it in `WRAPPER_GRAMMARS`, as many times
 * as they nest (`sudo -u x timeout 5 node <gate>`), and reads what is left by the rules above. Each grammar
 * is the part of the manual that macOS and Linux (GNU coreutils; sudo, the same 1.9.13 on both) share, and
 * every form was run under macOS 14's /bin/sh and zsh and under dash with coreutils 9.1 and 9.4 before it
 * went in — all but sudo's, which needs a password here and was run as root under Debian 12's dash with sudo 1.9.13p3
 * instead, and caffeinate's, which only macOS has:
 *   command     `-p`, `--` — only first in the command, where the shell reads it (`-v` and `-V` print)
 *   exec        no option, not even `--`, which dash refuses — only first in the command
 *   nohup       `--`
 *   nice        `-n N` for an integer N from -2147483648 to 2147483647, `--`: BSD nice refuses any other N
 *               ("invalid nice value", macOS 14) and runs nothing, where GNU nice takes it
 *   env         `-i`, `-`, `-v`, `-u NAME`, `-S` with a string of plain words, which it splits and reads as
 *               if written out, `--`, then `NAME=value` words
 *   timeout     `-v`, `-k DURATION`, `-s SIGNAL`, `--verbose`, `--foreground`, `--preserve-status`,
 *               `--kill-after`, `--signal`, `--`, then DURATION, a decimal number with an optional s, m, h or
 *               d: the options coreutils 9.1, 9.4 and 9.11 share
 *   caffeinate  `-d -i -m -s -u`, `-t N`, `-w N`, `--`
 *   sudo        `-B -H -n -P`, `-u USER`, `-g GROUP`, `-p PROMPT` and their long names, each value once, `--`,
 *               then `NAME=value` words before any `--`; a value with `$`, a backtick or `* ? [ ] { } ~` in it is
 *               refused, because the shell may split it, glob it or make it vanish, and then the option takes the
 *               next word: `sudo -n -u $U node <gate>` with U unset, as it is in a hook, runs nothing (sudo 1.9.13p3)
 * Short options cluster and take a value attached or as the next word, as getopt reads them. ANY OTHER
 * OPTION OR FORM IS UNCLEAR, and the reader never guesses past it: an abbreviated long option, `timeout -p`
 * (coreutils 9.11 only), `env -C` (GNU only), `nice -10`, `sudo -i`, `-s`, `-E`, `-b`, `-S`, `-A` or `-D`, a
 * shell's own wrapper after another wrapper, and a value that does not read as its type — measured, such a
 * value makes the wrapper exit without running anything. Left out, and so unclear wherever they name the
 * gate: `time`, a keyword in bash and zsh but a program under dash that Debian and Ubuntu do not install;
 * `stdbuf`, which on macOS dyld kills at load for some commands; `ionice`, `chrt` and `taskset`, which run
 * nothing when the kernel refuses what they ask; and `xargs`, `watch` and `parallel`, which change how or
 * whether the command runs. An over-refusal is recoverable; deleting a hook the reader misread is not.
 *
 * THE OVERRIDE (`takenAs`). A reader that never guesses always refuses some hook that does run the gate — a
 * wrapper form nobody pinned (`nice -10`, `timeout -p 5`, `sudo -i`), the gate read on stdin — and 0.19.0 took
 * such hooks, by its describe with no flag or under the report-progress installer's `--adopt`, wherever the gate
 * file's name appeared in the command, option values (`--gate=<gate>`) included. Pinning one more form at a time
 * never ends, so `--adopt` is the explicit override: it takes over every `unclear` hook, describe or not, except one
 * that WRITES TO THE GATE FILE — through any of its redirections or one in a substitution in it, `<>` included —
 * which may empty the gate or change it around the run. It asks nothing of what leads the command and nothing of
 * where the gate path sits: an unclear hook names the gate file, as a word, inside a quoted argument or inside an
 * option value, or carries the installer's own describe. What it never reaches is NEVER TAKEN, below, and nothing
 * else. The installer names every hook it took this way, by event and matcher,
 * on a line of its own (`tookOverLine`): a silent override is the defect this replaced. Without `--adopt` nothing
 * changes.
 *
 * NAMING THE GATE FILE means a word, or a piece of one split at blanks, quotes, `= : ,`, `$`, parens,
 * braces and shell operators, whose basename is exactly the gate file — or may expand to it: the gate file's name
 * joined only to a `*`, or to the parameter a `$` names just before it (`"$D"report-progress-gate.mjs` reads
 * `$Dreport-progress-gate.mjs` once its quotes are removed, and runs the gate wherever D holds its directory). So
 * `install-report-progress-gate.mjs`, `report-progress-gate.mjs.bak` and `report-progress-gate.mjs/index.mjs` never
 * name it: each is a DIFFERENT FILE, which 0.19.0's substring match took and nothing here takes.
 *
 * NEVER TAKEN (`neverTakenReason`; the release bar's point 2, which beats every other rule here). A hook is never taken,
 * with any flag and whatever `describe` it wears, for one of four reasons, and for no other: nothing else in this
 * file keeps a hook from `--adopt`. Each reason is applied as this reader judges the command, and it can misjudge complex,
 * hand-written shell (KNOWN MISREADS, below): a reason is this reader's verdict, not proof that the hook cannot run the gate.
 *   mention          Every place this reader finds the gate file named reaches, as it reads the command, only a program it knows
 *                    does not run it (`MENTIONS`) —
 *                    as its argument, on its stdin (a pipe, a here-string, a here-document or a `<` redirection), or in a shell
 *                    comment — and nothing that consumer prints flows on into anything else (`outputInert`), and nowhere else
 *                    in the command. `wc -l < '<gate>'` and `cat <<< '<gate>'` are mentions; a comment never downgrades a run
 *                    elsewhere: `node '<gate>' # note` runs the gate.
 *   writeTarget      The command writes to the gate file through a redirection, inside `sh -c`, `eval`, a here-document or a
 *                    substitution too (`writesToGate`), whether or not it also runs the gate.
 *   differentFile    Every path that contains the gate file's name refers to another file: its final component is not
 *                    exactly the gate file's name. A lookalike (`install-report-progress-gate.mjs`), and the gate file's
 *                    name only as a directory (`/x/report-progress-gate.mjs/index.mjs`). A name joined to a glob or a
 *                    parameter may be the gate (NAMING THE GATE FILE), so it is never a different file.
 *   foreignDescribe  A `describe` somebody else wrote, over a hook that runs the gate or may. 0.19.0 never took one either.
 * CERTAINTY (`certainlyLiteral`). A mention or a different file is returned only when the command holds no expansion this reader
 * does not resolve — a parameter expansion with an operator (`${V%x}`, `${V#x}`, `${V/a/b}`, `${V:=x}`, `${V:-x}`), indirection,
 * brace expansion or arithmetic, looked for anywhere in the command and not only in the words naming the gate — and no command
 * substitution whose output feeds an executing consumer. Either may turn a lookalike into the gate (`G=<gate>.bak; node "${G%.bak}"`
 * runs the gate) or the gate into another file, so a command that holds one is left `unclear`, never a reason: refused with no flag,
 * `--adopt` takes it, `--remove` exits 1.
 * Every other hook that names the gate file, `--adopt` takes.
 *
 * KNOWN MISREADS. This reader reads shell text and runs none of it, and some complex, hand-written hooks that run the gate read as
 * a MENTION. For such a hook `--remove` exits 0, says no hook runs the gate as it reads it, and lists the hook as left alone, and no
 * flag takes it over: it has to be removed by hand. The families observed:
 *   - a here-document body that runs the gate through `$(…)` or backticks (`cat <<EOF`, `$(node '<gate>')`, `EOF`): a body is
 *     kept as data whether or not its delimiter is quoted;
 *   - the output of a group or compound command piped into a shell or interpreter (`{ cat '<gate>'; } | bash`,
 *     `(cat '<gate>') | bash`, `if …; then cat '<gate>'; fi | bash`, a loop): a pipe after `)`, `}`, `fi` or `done` is not tied
 *     to the commands inside;
 *   - ANSI-C quoting, `$'…'`, which is not lexed and can hide a later command;
 *   - `$_` carrying a mentioned argument into the next command (`test -f '<gate>' && node "$_"`);
 *   - arithmetic that bash evaluates inside `[[`;
 *   - zsh process substitution (`cat '<gate>' > >(bash)`, `exec > >(bash)`);
 *   - a launcher or a copy written to another file and run (`cp '<gate>' x && node x`, `tee`): this reader does not follow copies.
 * KNOWN LIMITS of this reading, none of them a reason above:
 *   - the gate file's name not written out literally — a glob that matches it (`[r]eport-progress-gate.mjs`), a path read from a
 *     file, a symlink under another name — does not name it, so without the installer's own describe no flag takes such a hook
 *     and `--remove` does not name it;
 *   - a group whose `hooks` is not an array is not read (0.19.0 the same);
 *   - control flow is read by structure (`false && node '<gate>'` reads as running it);
 *   - a write through a program's argument (`sed -i`, `dd of=`, `curl -o`) is not a write target, so `--adopt` may take it;
 *   - under `--adopt` a hook this installer did not write and cannot fully read is taken, and named, as 0.19.0 took it;
 *   - CERTAINTY is command-wide, so a plain mention beside an unrelated expansion (`X=${Y%.foo}; cat '<gate>'`) is unclear;
 *   - `printf -v`, which captures into a variable, is handled only as unclear wherever the gate file is named with it.
 * adapters/claude-code/README.md lists both for the installers' users, under "Known limits of the reading".
 *
 * LEFT ALONE (`findHooksNamingGate`, `leftAloneReport`). `--remove` never reports the gate gone while a hook this reader reads as
 * running it, or possibly running it, is left (`findUnownedHooks`), and it never says no gate was installed while any hook in the file
 * still names the gate file: each `null` hook whose command names the gate file, or contains its name, is found
 * with its reason and which kind of it — a mention as an argument or in a comment, a write target through a
 * redirection, a different file by its name or with the gate file's name as a directory — and named, as in
 * `left alone: only mentions the gate file (comment): …`. A mention that copies the gate
 * and runs the copy (`cp '<gate>' x && bash x`) is still a mention: this reader does not follow copies, and the
 * installer says it left the hook rather than calling the file clean. A hook in KNOWN MISREADS is left the same way, with
 * exit 0, although it runs the gate.
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
 * one character; a `#` that begins a word starts a comment, whose text is kept apart. A `$(…)`, backtick or `<(…)` substitution
 * stays in the word it belongs to, as the literal text it is written as, because nothing here evaluates
 * anything. A redirection's target is not a word of the command: it is kept apart as a file the command
 * reads from (`<`, `<&`, `<<<`, a here-document's delimiter), writes to (`>`, `>>`, `>|`, `>&`, `&>`) or
 * both (`<>`), and an unquoted run of digits right against `<` or `>` is the descriptor it redirects, not a word
 * either — so `timeout 5>/dev/null node x` is `timeout node x`. A here-document's body is data; `name=(…)`
 * is one word. An unbalanced quote or substitution runs to the end of the text.
 */
function parseShell(command) {
  const text = String(command);
  const commands = [];
  const pendingHeredocs = [];
  const comments = [];
  let definesFunction = false;
  let heredocDelimiter = null;
  const fresh = () => ({ words: [], substitutions: [], heredocs: [], redirections: [], pipesOut: false });
  let current = fresh();
  let word = null;
  // Whether any of the word so far was quoted, escaped or substituted: `2>x` redirects descriptor 2, `'2'>x` does not.
  let wordQuoted = false;
  // `in`, `out` or `both` while the next word is a redirection's target: a file, not a word of the command.
  let redirection = null;

  const endWord = () => {
    if (word === null) return;
    if (heredocDelimiter) {
      pendingHeredocs.push({ delimiter: word, stripTabs: heredocDelimiter.stripTabs, owner: current });
      heredocDelimiter = null;
      current.redirections.push({ direction: 'in', target: word });
    } else if (redirection) {
      current.redirections.push({ direction: redirection, target: word });
    } else {
      current.words.push(word);
    }
    redirection = null;
    word = null;
    wordQuoted = false;
  };
  /** At a redirection operator: an unquoted run of digits right against it is the descriptor it redirects. */
  const startRedirection = (direction) => {
    if (word !== null && !wordQuoted && /^\d+$/.test(word)) {
      word = null;
      wordQuoted = false;
    }
    endWord();
    redirection = direction;
  };
  const endCommand = (pipesOut = false) => {
    endWord();
    redirection = null;
    // A command of redirections alone is kept: a substitution in a target still runs.
    const { words, substitutions, heredocs, redirections } = current;
    if (words.length > 0 || substitutions.length > 0 || heredocs.length > 0 || redirections.length > 0) {
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
      wordQuoted = true;
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
      wordQuoted = true;
      index = cursor;
    } else if (char === '\\') {
      if (index + 1 < text.length && next !== '\n') {
        word = (word ?? '') + next;
        wordQuoted = true;
      }
      index += 1;
    } else if (char === '$' && next === '(') {
      const close = closingParen(text, index + 2);
      substitution(index + 2, close);
      word = (word ?? '') + text.slice(index, close + 1);
      wordQuoted = true;
      index = close;
    } else if (char === '`') {
      const close = closingBacktick(text, index + 1);
      substitution(index + 1, close);
      word = (word ?? '') + text.slice(index, close + 1);
      wordQuoted = true;
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
      startRedirection('in');
      const stripTabs = text[index + 2] === '-';
      heredocDelimiter = { stripTabs };
      index += stripTabs ? 2 : 1;
    } else if (char === '<' && next === '<') {
      // `<<<`, a here-string: the word after it is what the command reads on stdin.
      startRedirection('in');
      index += 2;
    } else if (char === '#' && word === null) {
      // A comment runs nothing. Its text is kept apart, so that a gate file named only there reads as a mention (NEVER TAKEN).
      const newline = text.indexOf('\n', index);
      comments.push(text.slice(index + 1, newline === -1 ? text.length : newline));
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
        // A pipe into a subshell hands what it carries to every command in it, not only the first.
        const piped = commands.at(-1);
        const empty = word === null && current.words.length + current.substitutions.length + current.heredocs.length + current.redirections.length === 0;
        if (empty && piped?.pipesOut) piped.pipesIntoGroup = true;
      }
      endCommand();
    } else if (REDIRECTION.has(char)) {
      // `<>` opens its file for reading and for writing.
      startRedirection(char === '<' ? 'in' : text[index - 1] === '<' ? 'both' : 'out');
    } else {
      word = (word ?? '') + char;
    }
  }
  endCommand();
  return { commands, definesFunction, comments };
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

/**
 * The final component of a script path as a Node runtime resolves it before loading it: a trailing separator is
 * dropped, a `.` segment is skipped, and a `..` segment pops the one before it — so `x/report-progress-gate.mjs/`,
 * `x/report-progress-gate.mjs/.` and `x/report-progress-gate.mjs/y/..` all load `report-progress-gate.mjs`, while
 * `x/report-progress-gate.mjs/index.mjs` loads a different file. Node's module loader normalises the specifier this
 * way (measured on Node 24: each of those forms runs the gate); a shell running the same path through `execve` does
 * NOT (`bash x/release-notes-gate.sh/` fails with ENOTDIR and runs nothing), so this is used only for a Node runtime's
 * script argument — never for a shell, for `.`/`source`, or for a program word the shell hands to `execve`. Read as a
 * different file, each of these ran the gate while no flag took it and `--remove` exited 0 calling the file clean.
 */
function nodeModuleBasename(word) {
  const resolved = [];
  for (const segment of String(word).split(/[\\/]/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') resolved.pop();
      else resolved.push(segment);
      continue;
    }
    resolved.push(segment);
  }
  return resolved.length > 0 ? resolved[resolved.length - 1] : '';
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
/**
 * The name of a program that runs a shell script given as its first argument: a shell in `SHELLS`, or `.` or `source`. In the
 * release-notes installer's exact shape these are the programs that run its gate, as `NODE_RUNTIME_NAME` is for the
 * report-progress gate's; any other program there is one this reader does not know runs the gate (THE EXACT SHAPE in the header).
 */
export const SHELL_SCRIPT_RUNNER = /^(?:sh|bash|dash|zsh|ksh|sh\.exe|bash\.exe|\.|source)$/;
/**
 * Programs that print, read, list, test, copy, move or delete a file and never run it. Not `rg`: `rg --pre <file>` runs that file
 * on every file it searches.
 */
const MENTIONS = new Set([
  'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'wc',
  'ls', 'stat', 'file', 'test', '[', '[[', 'true', 'false', ':', 'cp', 'mv', 'ln', 'rm', 'unlink', 'touch',
  'truncate', 'tee', 'chmod', 'chown', 'mkdir', 'diff', 'cmp', 'realpath', 'readlink', 'basename', 'dirname',
  'sha256sum', 'sha1sum', 'sha512sum', 'shasum', 'md5sum', 'b2sum', 'cksum', 'xxd', 'od', 'hexdump', 'strings', 'du',
  'shellcheck',
]);
/** Words that lead a program without being one, where the shell reads them: never after a wrapper, which hands the
 *  word after it to the system as the name of a program. `time` is not one of them (WRAPPERS in the header). */
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTEGER = /^[+-]?\d+$/;
const DIGITS = /^\d+$/;
/** timeout's DURATION: a decimal number, then an optional unit. */
const DURATION = /^(?:\d+(?:\.\d*)?|\.\d+)[smhd]?$/;
/** env -S's value, where it is only plain words: anything its own quoting, escapes or `${}` would change is not. */
const PLAIN_WORDS = /^[A-Za-z0-9_.,:\/@%+=\t -]*$/;
/** The signals Linux and macOS both name. timeout reads a name in any case, with or without `SIG`, or a number. */
const SIGNALS = new Set(['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'IO', 'SYS']);
const matches = (pattern) => (value) => pattern.test(value);
const isSignal = (value) => /^(?:[1-9]|[12]\d|3[01])$/.test(value) || SIGNALS.has(value.toUpperCase().replace(/^SIG/, ''));
/** A value the wrapper receives as written: nothing the shell could expand, split, glob or make vanish. The reader sees words
 *  after quote removal, so a quoted `$` is refused as well: an over-refusal, never a guess. Measured under Debian 12's dash
 *  with sudo 1.9.13p3: `sudo -n -u $U node <gate>` with U unset runs nothing, and neither does `sudo -u x* node <gate>`. */
const LITERAL_VALUE = /^[^$`*?[\]{}~]*$/;
const literal = (value) => LITERAL_VALUE.test(value);
const literalNonEmpty = (value) => value !== '' && literal(value);
/** nice's adjustment, as BSD nice reads it into a C int: macOS 14's nice refuses 2147483648 and runs nothing. */
const isNiceAdjustment = (value) => INTEGER.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647;

/**
 * The grammar of each wrapper the reader strips (WRAPPERS in the header).
 *   options       each short letter and each `--long` name it takes: `null` for a flag, or a test its value must pass
 *   aliases       a long name that is the same option as a short letter, for `once`
 *   once          a value option may be given only once
 *   lone          a lone `-` is an option (env's `-i`)
 *   endOfOptions  `--` ends the options
 *   operands      a test for each word it reads after its options and before the command
 *   assignments   `NAME=value` words before the command: `always`, or `before --`
 *   split         the option whose value it splits into words and reads as if they had been written out
 *   shell         the shell's own: a word the shell reads only first in the command, and not a program on every system
 */
const WRAPPER_GRAMMARS = Object.freeze({
  command: Object.freeze({ options: { p: null }, endOfOptions: true, shell: true }),
  exec: Object.freeze({ options: {}, shell: true }),
  nohup: Object.freeze({ options: {}, endOfOptions: true }),
  nice: Object.freeze({ options: { n: isNiceAdjustment }, endOfOptions: true }),
  env: Object.freeze({
    options: { i: null, v: null, u: matches(VARIABLE_NAME), S: matches(PLAIN_WORDS) },
    lone: true,
    endOfOptions: true,
    assignments: 'always',
    split: 'S',
  }),
  timeout: Object.freeze({
    options: {
      v: null,
      k: matches(DURATION),
      s: isSignal,
      '--verbose': null,
      '--foreground': null,
      '--preserve-status': null,
      '--kill-after': matches(DURATION),
      '--signal': isSignal,
    },
    endOfOptions: true,
    operands: [matches(DURATION)],
  }),
  caffeinate: Object.freeze({ options: { d: null, i: null, m: null, s: null, u: null, t: matches(DIGITS), w: matches(DIGITS) }, endOfOptions: true }),
  sudo: Object.freeze({
    options: {
      B: null,
      H: null,
      n: null,
      P: null,
      u: literalNonEmpty,
      g: literalNonEmpty,
      p: literal,
      '--bell': null,
      '--set-home': null,
      '--non-interactive': null,
      '--preserve-groups': null,
      '--user': literalNonEmpty,
      '--group': literalNonEmpty,
      '--prompt': literal,
    },
    aliases: { '--user': 'u', '--group': 'g', '--prompt': 'p' },
    once: true,
    endOfOptions: true,
    assignments: 'before --',
  }),
});

/** The grammar for a word in a program's place, or null. A shell's own wrapper is its bare word, and only before any
 *  other wrapper; any other is a program, known by its name or by a path to it. */
function wrapperGrammar(word, wrapped) {
  const grammar = Object.hasOwn(WRAPPER_GRAMMARS, word) ? WRAPPER_GRAMMARS[word] : null;
  if (grammar?.shell) return wrapped ? null : grammar;
  const name = basename(word);
  const program = Object.hasOwn(WRAPPER_GRAMMARS, name) ? WRAPPER_GRAMMARS[name] : null;
  return program && !program.shell ? program : null;
}

/**
 * One wrapper's arguments read by its grammar, from `start`: `{ words, index, values }` — the command's words (env -S
 * puts words in), where the command the wrapper runs begins, and every word it took as a value, operand or assignment —
 * or null for any word the grammar does not account for.
 */
function unwrap(grammar, source, start) {
  let words = source;
  let index = start;
  let ended = false;
  const values = [];
  const given = new Set();
  const take = (name, test, value) => {
    if (value === undefined || !test(value)) return false;
    const key = grammar.aliases?.[name] ?? name;
    if (grammar.once && given.has(key)) return false;
    given.add(key);
    values.push(value);
    return true;
  };

  while (index < words.length) {
    const word = words[index];
    if (word === '--') {
      if (!grammar.endOfOptions) return null;
      index += 1;
      ended = true;
      break;
    }
    if (word === '-' && grammar.lone) {
      index += 1;
      continue;
    }
    if (!word.startsWith('-') || word === '-') break;
    let next = index + 1;
    let split = null;
    if (word.startsWith('--')) {
      const equals = word.indexOf('=');
      const name = equals === -1 ? word : word.slice(0, equals);
      if (!Object.hasOwn(grammar.options, name)) return null;
      const test = grammar.options[name];
      if (test === null) {
        if (equals !== -1) return null;
      } else if (equals !== -1) {
        if (!take(name, test, word.slice(equals + 1))) return null;
      } else {
        if (!take(name, test, words[next])) return null;
        next += 1;
      }
    } else {
      for (let at = 1; at < word.length; at += 1) {
        const letter = word[at];
        if (!Object.hasOwn(grammar.options, letter)) return null;
        const test = grammar.options[letter];
        if (test === null) continue;
        const attached = word.slice(at + 1);
        const value = attached === '' ? words[next] : attached;
        if (!take(letter, test, value)) return null;
        if (attached === '') next += 1;
        if (letter === grammar.split) split = value;
        break;
      }
    }
    index = next;
    if (split !== null) words = [...words.slice(0, index), ...split.split(/[ \t]+/).filter((piece) => piece !== ''), ...words.slice(index)];
  }

  for (const test of grammar.operands ?? []) {
    if (index >= words.length || !test(words[index])) return null;
    values.push(words[index]);
    index += 1;
  }
  if (grammar.assignments) {
    for (; index < words.length && words[index].includes('='); index += 1) {
      if ((ended && grammar.assignments !== 'always') || !ASSIGNMENT.test(words[index])) return null;
      values.push(words[index]);
    }
  }
  return { words, index, values };
}
const SHELL_SCRIPT_OPTION = /^-[A-Za-z]*c[A-Za-z]*$/;
/** A piece: a run of text between blanks, quotes, `= : ,`, `$`, parens, braces and shell operators. */
const PIECE = /[^\s'"`$=:,(){}<>;|&]+/g;
/** The parameter a `$` names when a piece follows it: `$D`, `$1`, `$@`. */
const JOINED_PARAMETER = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?!-])/;
const STARS = /^\**$/;
/** Substitutions and nested `-c` scripts deeper than this are not followed, only searched for the gate. */
const MAX_DEPTH = 8;

/**
 * True when some piece of the text (see the header) has exactly the gate file as its basename, or may expand to it: its basename is
 * the gate file's name joined only to `*` on either side, or, where the piece follows a `$`, to that parameter's name before it.
 * `"$D"report-progress-gate.mjs` reads `$Dreport-progress-gate.mjs` once its quotes are removed and runs the gate wherever D holds its
 * directory; `*report-progress-gate.mjs` and `report-progress-gate.mjs*` match it. Read as a mention or a different file, each ran
 * the gate while no flag took it and `--remove` exited 0 (measured). `install-report-progress-gate.mjs` is still a different file.
 */
function namesGate(text, gateFile) {
  const source = String(text);
  for (const { 0: piece, index } of source.matchAll(PIECE)) {
    const name = basename(piece);
    if (name === gateFile) return true;
    for (let at = name.indexOf(gateFile); at !== -1; at = name.indexOf(gateFile, at + 1)) {
      const joined = name === piece && source[index - 1] === '$';
      const prefix = joined ? name.slice(0, at).replace(JOINED_PARAMETER, '') : name.slice(0, at);
      if (STARS.test(prefix) && STARS.test(name.slice(at + gateFile.length))) return true;
    }
  }
  return false;
}

/**
 * Every text in a simple command that the shell may run as a script: its substitutions, its here-documents' bodies, the script a
 * shell's `-c` is given — wherever that shell sits, past wrappers this reader pins or not — and what `eval` is given. Searched
 * for writes to the gate whatever runs them: a write this reader could see and did not look for is a write it would take over.
 */
function scriptsIn({ words, substitutions, heredocs }) {
  const scripts = [...substitutions, ...heredocs];
  for (let index = 0; index < words.length; index += 1) {
    const name = basename(words[index]);
    if (name === 'eval') scripts.push(words.slice(index + 1).join(' '));
    if (!SHELLS.has(name)) continue;
    let at = index + 1;
    let script = false;
    for (; at < words.length && words[at].startsWith('-') && words[at] !== '-'; at += 1) {
      if (words[at] === '--') {
        at += 1;
        break;
      }
      if (SHELL_SCRIPT_OPTION.test(words[at])) script = true;
    }
    if (script && at < words.length) scripts.push(words[at]);
  }
  return scripts;
}

/** True when a redirection in these simple commands, or in a script they may run (`scriptsIn`), writes to a file named like the gate. */
function writesToGate(commands, gateFile, depth = 0) {
  return commands.some((simple) => simple.redirections.some(({ direction, target }) => direction !== 'in' && namesGate(target, gateFile))
    || (depth < MAX_DEPTH && scriptsIn(simple).some((inner) => writesToGate(parseShell(inner).commands, gateFile, depth + 1))));
}

/**
 * The program a simple command runs, past its leading assignments and every wrapper the reader pins, as a basename; null where it runs
 * none, or a wrapper form the reader does not pin stands in front of it. A reserved word is returned as itself: what follows `{`, `if`
 * or `while` is not one program.
 */
function programOf(parsed) {
  let words = parsed;
  let index = 0;
  let wrapped = false;
  for (;;) {
    while (!wrapped && index < words.length && ASSIGNMENT.test(words[index])) index += 1;
    if (index >= words.length) return null;
    const grammar = wrapperGrammar(words[index], wrapped);
    if (!grammar) return basename(words[index]);
    const inner = unwrap(grammar, words, index + 1);
    if (inner === null) return null;
    ({ words, index } = inner);
    wrapped = true;
  }
}

/**
 * Whether what one simple command prints reaches nothing that may run it: it is not piped on, or every command down its pipeline is a
 * program in `MENTIONS`, past wrappers the reader pins, with no substitution or here-document of its own, and not a subshell, which
 * hands the pipe to every command in it (`cat '<gate>' | (grep x; sh)`). `cat '<gate>' | grep x` runs nothing of the gate, and was
 * read as unclear, so `--adopt` took it (measured).
 */
function outputInert(commands, index) {
  for (let at = index; commands[at].pipesOut; at += 1) {
    const next = commands[at + 1];
    if (!next || commands[at].pipesIntoGroup || next.substitutions.length > 0 || next.heredocs.length > 0) return false;
    const program = programOf(next.words);
    if (program === null || !MENTIONS.has(program)) return false;
  }
  return true;
}

/** RUNS, UNCLEAR or NONE for one simple command; `inert` is whether what it prints reaches nothing that may run it (`outputInert`). */
function simpleCommandGateUse({ words: parsed, substitutions, heredocs, redirections }, gateFile, depth, inert) {
  let words = parsed;
  // `plain` is this command's reading apart from substitutions that only mention the gate file; `substituted` is those, which leave
  // a mention a mention while what it prints reaches nothing that may run it, and are unclear anywhere else.
  let plain = NONE;
  let substituted = NONE;
  const raise = (level) => {
    plain = Math.max(plain, level);
  };
  const use = () => Math.max(plain, substituted);
  for (const inner of substitutions) {
    // A substitution runs its own text and feeds its OUTPUT on to the command around it. The gate runs when the text runs it; when
    // the text only names the gate the verdict waits on the consumer of the output (`substituted`), which the return below decides —
    // a mention where that consumer only prints or reads, unclear anywhere else. The name may sit where `namesGate` does not see it
    // (`dirname '<gate>/y'` prints the gate's own path), so any appearance of the gate file's name inside the substitution counts.
    const innerUse = gateUse(inner, gateFile, depth + 1);
    if (innerUse === RUNS) raise(RUNS);
    else if (String(inner).includes(gateFile)) {
      if (innerUse === NONE) substituted = UNCLEAR;
      else raise(UNCLEAR);
    }
  }
  // A here-document body, a here-string and a `<` redirection all put the gate on the program's stdin: one consumer, worked out with
  // the rest of the command below (`stdinNamesGate`). A `<>` opens the gate for writing too, so it is a write target, unclear here.
  const stdinNamesGate = heredocs.some((body) => namesGate(body, gateFile))
    || redirections.some(({ direction, target }) => direction === 'in' && namesGate(target, gateFile));
  if (redirections.some(({ direction, target }) => direction === 'both' && namesGate(target, gateFile))) raise(UNCLEAR);
  const unclearIfNamed = (list) => Math.max(use(), list.some((word) => namesGate(word, gateFile)) ? UNCLEAR : NONE);

  let index = 0;
  // Past a wrapper, the next word is the program it runs: no reserved word or assignment leads it any more, and a wrapper
  // takes its own assignments by its grammar.
  let wrapped = false;
  for (;;) {
    while (!wrapped && index < words.length && ASSIGNMENT.test(words[index])) {
      // A variable holding the gate's path may run it later.
      if (namesGate(words[index], gateFile)) raise(UNCLEAR);
      index += 1;
    }
    // The command is only assignments, or leads a wrapper form the grammar does not pin — no program to read the stdin, so a gate
    // named there could be run by whatever the reader could not follow.
    if (index >= words.length) return Math.max(use(), stdinNamesGate ? UNCLEAR : NONE);
    const grammar = wrapperGrammar(words[index], wrapped);
    if (!wrapped && RESERVED.has(words[index])) {
      index += 1;
    } else if (grammar) {
      const inner = unwrap(grammar, words, index + 1);
      // A form the grammar does not pin: never guess what runs past it.
      if (inner === null) return Math.max(unclearIfNamed(words.slice(index)), stdinNamesGate ? UNCLEAR : NONE);
      // A value the wrapper took that names the gate file is somewhere the gate may run from.
      if (inner.values.some((value) => namesGate(value, gateFile))) raise(UNCLEAR);
      words = inner.words;
      index = inner.index;
      wrapped = true;
    } else {
      break;
    }
  }

  const program = basename(words[index]);
  const rest = words.slice(index + 1);
  // The consumer of what a command reads on stdin is its program: an interpreter, a shell, or a program this reader does not know
  // may run it, while a program it knows only prints, reads, lists, copies or deletes files runs nothing of it — so long as its
  // output reaches nothing that may run it. The same rule the pipe already used: `node <<< '<gate>'` is unclear, `wc -l < '<gate>'`
  // a mention.
  if (stdinNamesGate && !(inert && MENTIONS.has(program))) raise(UNCLEAR);
  if (program === gateFile) return RUNS;
  // A program word that may expand to the gate file — its name joined to a glob or a parameter — may run it: `/pack/*release-notes-gate.sh`
  // runs the gate, and was read as a mention that no flag took.
  if (namesGate(words[index], gateFile)) raise(UNCLEAR);
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
      // An option before the script is a word of the command like any other (`bash --rcfile='<gate>' -c true`), read as unclear where
      // it names the gate file; it was read as a mention that no flag took.
      if (at >= rest.length) return unclearIfNamed(rest);
      const inner = gateUse(rest[at], gateFile, depth + 1);
      // A script that only mentions the gate prints it: piped on into anything that may run it, it is as unclear as `cat '<gate>' | sh`.
      const printed = !inert && inner === NONE && namesGate(rest[at], gateFile) ? UNCLEAR : NONE;
      return Math.max(unclearIfNamed([...rest.slice(0, at), ...rest.slice(at + 1)]), inner, printed);
    }
    if (at === 0 && rest.length > 0 && basename(rest[0]) === gateFile) return RUNS;
    return unclearIfNamed(rest);
  }
  if (isInterpreter(program)) {
    // Its script is a word that is not an option: `node --gate=<gate>` names the gate in an option, which node refuses.
    // A Node runtime normalises the path before loading it, so `node '<gate>/'`, `node '<gate>/.'` and `node '<gate>/y/..'`
    // all run the gate; `.` and `source` open the path as written and do not, so only a Node runtime's argument is normalised.
    if (rest.length > 0 && !rest[0].startsWith('-')) {
      const scriptName = NODE_RUNTIME_NAME.test(program) ? nodeModuleBasename(rest[0]) : basename(rest[0]);
      if (scriptName === gateFile) return RUNS;
    }
    return unclearIfNamed(rest);
  }
  // `printf -v VAR` (bash, and macOS /bin/sh) does not print its output: it captures it into a shell
  // variable, which a later `eval "$VAR"` or `$VAR` may run — `printf -v C 'node %q' '<gate>'; eval "$C"`
  // runs the gate. So printf reading the gate under `-v` is not the inert mention its stdout would be; it
  // is a capture, like `read` (which is not in MENTIONS), and is unclear wherever it names the gate. Any
  // leading `-v`, attached (`-vC`) or not, before the format ends the options (`--`); `printf %s '<gate>'`,
  // which prints, keeps being a mention.
  if (program === 'printf') {
    for (let at = 0; at < rest.length && rest[at].startsWith('-') && rest[at] !== '-'; at += 1) {
      if (rest[at] === '--') break;
      if (rest[at] === '-v' || rest[at].startsWith('-v')) return unclearIfNamed(rest);
    }
  }
  if (MENTIONS.has(program)) return inert ? plain : unclearIfNamed(rest);
  return unclearIfNamed(rest);
}

/** RUNS when the text runs the gate, UNCLEAR when it names the gate file and whether it runs cannot be told, NONE otherwise. */
function gateUse(text, gateFile, depth = 0) {
  if (depth > MAX_DEPTH) return namesGate(text, gateFile) ? UNCLEAR : NONE;
  const { commands, definesFunction } = parseShell(text);
  let use = NONE;
  for (const [index, simple] of commands.entries()) use = Math.max(use, simpleCommandGateUse(simple, gateFile, depth, outputInert(commands, index)));
  // A command that writes to the gate file may empty it before the gate runs, or change it around the run (the header).
  if (use === RUNS && writesToGate(commands, gateFile, depth)) use = UNCLEAR;
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
 * shape, and otherwise `{ owned, runs, mention }` — `owned` when its interpreter is written the way this installer writes
 * one; `runs` when that word is also, or instead, a program that runs this gate's kind of file (`interpreter.runs`) or the
 * gate itself; `mention` when it is a program that only prints, reads, lists, copies or deletes files. A word that is
 * neither is a program this reader does not know runs the gate.
 *
 * @param {string} command
 * @param {{ envFlag: string, gateFile: string, variables?: readonly string[], interpreter?: { quoted?: boolean, pattern?: RegExp, names?: readonly string[], runs?: RegExp } }} identity
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
  // An option is not the script: `'--gate=<gate>'` after node, or `'--rcfile=<gate>'` after bash, runs nothing of the gate.
  if (gate.raw !== singleQuoted(gate.value) || gate.value.startsWith('-') || basename(gate.value) !== gateFile) return null;
  const quoted = program.raw === singleQuoted(program.value);
  if (!quoted && !LITERAL_RUN.test(program.raw)) return null;
  // Single-quoted, the installer wrote a path, and its basename is the name; bare, the word is the name.
  const name = quoted ? basename(program.value) : program.raw;
  const names = [interpreter.names].flat().filter((entry) => typeof entry === 'string' && entry !== '');
  const owned = quoted === (interpreter.quoted === true)
    && (names.includes(name) || (interpreter.pattern instanceof RegExp && interpreter.pattern.test(name)));
  // Whatever way it is written, the program is its basename: `'/bin/bash'`, `bash` and `'bash'` all run bash.
  const programName = basename(program.value);
  const runs = owned || programName === gateFile || (interpreter.runs instanceof RegExp && interpreter.runs.test(programName));
  return { owned, runs, mention: !runs && MENTIONS.has(programName) };
}

/** Whether a hook carries this installer's own describe (THE INSTALLER'S OWN DESCRIBE in the header). */
function wearsOwnDescribe(hook, { describePrefix }) {
  return typeof describePrefix === 'string' && describePrefix !== '' && typeof hook.describe === 'string' && hook.describe.startsWith(describePrefix);
}

/** Point 2's four reasons, and the only ones: what `neverTakenReason` returns for a hook no flag takes (NEVER TAKEN in the header). */
export const NEVER_TAKEN_REASONS = Object.freeze(['mention', 'writeTarget', 'differentFile', 'foreignDescribe']);

/**
 * An expansion this reader does not resolve, so a word that goes through it is not plain literal text: a parameter expansion with an
 * operator (`${V%x}`, `${V#x}`, `${V/a/b}`, `${V:=x}`, `${V:-x}`, `${V:1}`, `${V^^}`), indirection (`${!V}`) or length (`${#V}`) —
 * anything inside `${…}` but a plain `${name}`, `${1}` or `${@}`; arithmetic (`$((…))`); or brace expansion (`{a,b}`, `{1..3}`). A
 * command substitution `$(…)` or backtick is read where its output is consumed (`simpleCommandGateUse`), so it is not here.
 */
const EXPANSION_OPERATOR = /\$\{(?![A-Za-z_][A-Za-z0-9_]*\})(?![0-9]+\})(?![-@*#?$!]\})[^}]*\}|\$\(\(|(?<!\$)\{[^{}]*(?:,|\.\.)[^{}]*\}/;

/**
 * THE CERTAINTY RULE (the release bar's point 2). A never-taken reason (a mention or a different file) may be returned only when
 * the command holds no expansion the reader does not resolve. The check is over the whole command, which is stricter than a check of
 * the words naming the gate alone: a plain mention beside an unrelated `${…}` is unclear too (KNOWN LIMITS in the header). An
 * expansion the reader does not resolve may turn a lookalike into the gate
 * (`G=<gate>.bak; node "${G%.bak}"` runs the gate) or the gate into another file, so a command that holds one is never called a
 * mention or a different file — it stays unclear, which --adopt takes and --remove exits 1 over. A write target still wins, because
 * it keeps a hook from --adopt whatever the expansions around it.
 */
function certainlyLiteral(command) {
  return !EXPANSION_OPERATOR.test(String(command));
}

/**
 * NEVER TAKEN, the closed set (in the header): `{ reason, detail }` for a hook no flag takes, or null. `use` is what the reader made
 * of the command. `reason` is one of `NEVER_TAKEN_REASONS`, and `detail` which kind, for the line `--remove` prints: a mention as an
 * `argument` or in a `comment`, a write target through a `redirection`, a different file by its `name` or with the gate file's name
 * as a `directory`.
 *
 * Over a command that runs nothing of the gate — every place the reader found the gate file named is one where it does not run — in
 * this order:
 *   writeTarget    a redirection writes to the gate file, in a script the command may run too (`writesToGate`);
 *   mention        a word, a redirection's file or a here-document's body names the gate file (`namesGate`): each is a place the
 *                  reader read as running nothing — an argument of a program in `MENTIONS`, or what reaches only such programs;
 *   mention        only a comment names it;
 *   differentFile  the gate file's name is only inside other names: every piece of the command that holds it ends in something
 *                  else, as `install-report-progress-gate.mjs` and `report-progress-gate.mjs/index.mjs` do.
 * Over a command that runs the gate, or may: foreignDescribe, a describe somebody else wrote; then writeTarget, as above. Anything
 * else is null, and `--adopt` takes it.
 */
function neverTaken(hook, own, use, gateFile) {
  const { commands, comments } = parseShell(hook.command);
  if (use !== NONE) {
    if (Object.hasOwn(hook, 'describe') && !own) return { reason: 'foreignDescribe', detail: null };
    return writesToGate(commands, gateFile) ? { reason: 'writeTarget', detail: 'redirection' } : null;
  }
  if (writesToGate(commands, gateFile)) return { reason: 'writeTarget', detail: 'redirection' };
  // CERTAINTY: no mention or different file for a command an unresolved expansion could turn into the gate (or the gate into
  // another file); it is left unclear instead (THE CERTAINTY RULE, above).
  if (!certainlyLiteral(hook.command)) return null;
  const texts = commands.flatMap(({ words, redirections, heredocs }) => [...words, ...redirections.map(({ target }) => target), ...heredocs]);
  if (texts.some((text) => namesGate(text, gateFile))) return { reason: 'mention', detail: 'argument' };
  if (comments.some((text) => namesGate(text, gateFile))) return { reason: 'mention', detail: 'comment' };
  const pieces = [...texts, ...comments].flatMap((text) => String(text).match(PIECE) ?? []).filter((piece) => piece.includes(gateFile));
  if (pieces.length === 0) return null;
  return { reason: 'differentFile', detail: pieces.some((piece) => basename(piece).includes(gateFile)) ? 'name' : 'directory' };
}

/**
 * `{ kind, why, detail, never }` for one hook, or null for a hook that is nothing to the gate. `kind` is what WHAT A HOOK IS (in the
 * header) calls it — `ours`, `adoptable`, `unclear`, `foreign`, or null for one that does not run the gate — and `why` says which case
 * of it: `runs` for an adoptable hook; `unreadable`, `writes` (it also writes to the gate file) or `describe only` (the installer's
 * own describe over a command that never names the gate file) for an unclear one; `describe` for a foreign one; the closed set's
 * reason for a hook that does not run the gate, with `detail`. `never` is the closed set's reason, or null (NEVER TAKEN in the
 * header). Never throws.
 */
function readHook(hook, identity) {
  if (!plainObject(hook) || !plainObject(identity)) return null;
  const own = wearsOwnDescribe(hook, identity);
  // 0.19.0 took a hook under its describe whatever its command; this reader cannot tell whether such a hook runs the gate.
  if (typeof hook.command !== 'string') return own ? { kind: 'unclear', why: 'describe only', detail: null, never: null } : null;
  const { gateFile } = identity;
  // The exact shape is read by its interpreter alone (THE EXACT SHAPE in the header).
  const shape = installerShape(hook.command, identity);
  const use = shape ? (shape.runs ? RUNS : shape.mention ? NONE : UNCLEAR) : gateUse(hook.command, gateFile);
  const never = neverTaken(hook, own, use, gateFile);
  if (use === NONE) {
    if (never !== null) return { kind: null, why: never.reason, detail: never.detail, never: never.reason };
    // Not reached: a command with the gate file's name in it holds it in a word, a redirection, a here-document or a comment, and
    // `neverTaken` names each. Were it reached, the hook would be one this reader cannot fully read, which --adopt takes — never one
    // kept from --adopt for a reason outside the closed set.
    if (typeof gateFile === 'string' && gateFile !== '' && hook.command.includes(gateFile)) return { kind: 'unclear', why: 'unreadable', detail: null, never: null };
    return own ? { kind: 'unclear', why: 'describe only', detail: null, never: null } : null;
  }
  // A describe is a statement of ownership: somebody else's vetoes it.
  if (never?.reason === 'foreignDescribe') return { kind: 'foreign', why: 'describe', detail: null, never: never.reason };
  if (never?.reason === 'writeTarget') return { kind: 'unclear', why: 'writes', detail: never.detail, never: never.reason };
  if (use === UNCLEAR) return { kind: 'unclear', why: 'unreadable', detail: null, never: null };
  // This installer's own describe grants ownership to a hook that runs the gate (THE INSTALLER'S OWN DESCRIBE in the header).
  if (own || shape?.owned) return { kind: 'ours', why: null, detail: null, never: null };
  return { kind: 'adoptable', why: 'runs', detail: null, never: null };
}

/** Whether `--adopt` takes over a hook this reader read as `readHook` did (THE OVERRIDE in the header): one it cannot fully read that
 *  the closed set does not name. */
const overridable = (read) => read?.kind === 'unclear' && read.never === null;

/**
 * Point 2's reason no flag takes this hook — `mention`, `writeTarget`, `differentFile` or `foreignDescribe` — or null. It is the one
 * reading that keeps a hook from `--adopt` (NEVER TAKEN in the header). Never throws.
 *
 * @param {unknown} hook
 * @param {{ envFlag: string, gateFile: string, describePrefix: string, variables?: readonly string[], interpreter?: object }} identity
 */
export function neverTakenReason(hook, identity) {
  return readHook(hook, identity)?.never ?? null;
}

/**
 * `ours`, `adoptable`, `unclear`, `foreign`, or `null` for a hook that does not run the gate at all
 * (or is nothing to it). See the header for what each means. Never throws.
 *
 * @param {unknown} hook
 * @param {{ envFlag: string, gateFile: string, describePrefix: string, variables?: readonly string[], interpreter?: object }} identity
 */
export function classifyHook(hook, identity) {
  return readHook(hook, identity)?.kind ?? null;
}

/**
 * How a run treats one hook: `own`, taken with no flag; with `adopt`, `adopted` for a hook that runs the gate in a shape the
 * installer never writes, and `override` for a hook this reader cannot fully read that THE OVERRIDE (in the header) takes;
 * null for a hook the run leaves where it is. Never throws.
 *
 * @param {unknown} hook
 * @param {{ envFlag: string, gateFile: string, describePrefix: string, variables?: readonly string[], interpreter?: object }} identity
 * @param {{ adopt?: boolean }} [options]
 */
export function takenAs(hook, identity, { adopt = false } = {}) {
  const read = readHook(hook, identity);
  // Point 2 beats point 3, and the closed set is the only reading that does: no flag takes a hook it names.
  if (read === null || read.never !== null) return null;
  if (read.kind === 'ours') return 'own';
  if (!adopt) return null;
  return read.kind === 'adoptable' ? 'adopted' : 'override';
}

/**
 * Why an installer leaves an unowned hook where it is, for the line that names it. `ownShape` says, in
 * a few words, what that installer's own command is made of; `why` is the case `findUnownedHooks` found.
 */
export function unownedReason(kind, ownShape, { why = null } = {}) {
  if (kind === 'adoptable') {
    return `runs this gate, but its command is not exactly the command this installer writes — ${ownShape}, and nothing else — so it is not recognised as this installer's own. A hand-wiring looks like this, and so does a hook written under an interpreter this installer does not know by name.`;
  }
  if (kind === 'unclear') {
    const check = '--adopt takes it over and says so: check first that it is the gate, because removing a hook that is not the gate cannot be undone.';
    if (why === 'describe only') {
      return `carries this installer's own describe, but its command never names the gate file, so this installer cannot tell whether it runs the gate, and no run without --adopt takes it. ${check}`;
    }
    const where = 'names this gate\'s file where this installer cannot tell whether the gate runs — an argument of a program it does not know, a wrapper form it does not recognise, its own command shape run by a program it does not know, an option\'s value, a word after an interpreter\'s options, what a command reads on stdin, a pipe, a substitution, a variable, a glob, a here-document or a function';
    if (why === 'writes') {
      return `${where} — and it also writes to the gate file, which may empty the gate or change it around the run, so no flag takes it: --adopt never takes a hook that writes to the gate file. If it does run the gate, remove it by hand.`;
    }
    return `${where} — so no run without --adopt takes it. ${check}`;
  }
  return 'runs this gate, or may, under a describe this installer did not write, so it is never adopted — remove it by hand, or with whatever wrote it.';
}

/** The line for each reason a hook that does not run the gate was left alone, by kind (LEFT ALONE in the header). */
const LEFT_ALONE_LINES = Object.freeze({
  mention: Object.freeze({
    argument: 'left alone: only mentions the gate file (argument): it names the gate file only as an argument of a program that does not run it, such as echo, cat, rm or unlink, or in what reaches only such programs, so no flag takes it. A copy of the gate that such a hook makes and runs is not something this installer follows.',
    comment: 'left alone: only mentions the gate file (comment): it names the gate file only in a shell comment, which runs nothing, so no flag takes it.',
  }),
  writeTarget: Object.freeze({
    redirection: 'left alone: only writes to the gate file (redirection): a redirection writes to it, and nothing in it runs the gate, so no flag takes it.',
  }),
  differentFile: Object.freeze({
    name: "left alone: names a different file (name): a path in it ends in a file whose name only contains the gate file's, and no path in it ends in the gate file, so no flag takes it.",
    directory: "left alone: names a different file (directory): the gate file's name is only a directory in its paths, and no path in it ends in the gate file, so no flag takes it.",
  }),
});

/** Why a hook that names the gate file and does not run it was left alone, for the line that names it: `why` is the closed set's
 *  reason and `detail` which kind of it (LEFT ALONE in the header). */
export function leftAloneReason(why, detail) {
  const lines = LEFT_ALONE_LINES[why] ?? LEFT_ALONE_LINES.mention;
  return lines[detail] ?? Object.values(lines)[0];
}

/**
 * The lines `--remove` prints for the hooks it left alone that name the gate file (LEFT ALONE in the header): a heading, then
 * one line per hook, with why. `removed` is how many hooks the run removed, or null where the heading follows the list of hooks
 * that still run the gate, or may. No lines when there are no such hooks.
 */
export function leftAloneReport(hooks, { removed = null, settingsPath = 'this file' } = {}) {
  if (hooks.length === 0) return [];
  const one = hooks.length === 1;
  const counted = `${hooks.length} hook${one ? '' : 's'}`;
  const check = 'check each, because a hook that runs a copy of the gate is not one this installer follows';
  let heading;
  if (removed === null) {
    heading = `Also left alone: ${counted} that ${one ? 'names' : 'name'} the gate file and, as this installer reads ${one ? 'it' : 'them'}, ${one ? 'does' : 'do'} not run it — ${check}:`;
  } else if (removed > 0) {
    heading = `No hook left in ${settingsPath} runs this gate, as this installer reads it, but ${counted} in it still ${one ? 'names' : 'name'} the gate file and ${one ? 'was' : 'were'} left alone — ${check}:`;
  } else {
    heading = `Nothing was removed from ${settingsPath}, and nothing changed: no hook in it runs this gate, as this installer reads it, but ${counted} in it ${one ? 'names' : 'name'} the gate file and ${one ? 'was' : 'were'} left alone — ${check}:`;
  }
  return [heading, ...hooks.map((hook) => `  - ${hookLabel(hook)}: ${leftAloneReason(hook.why, hook.detail)}`)];
}

/** The line a run prints, on its own, naming each hook `--adopt` took over although this reader could not fully read it. */
export function tookOverLine(hooks) {
  return `Took over ${hooks.length} hook${hooks.length === 1 ? '' : 's'} this installer could not fully read: ${hooks.map(hookLabel).join(', ')}.`;
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

/** Every hook that runs the gate, or may, and is not the installer's own, with where it sits, which kind, why (`readHook`), and
 *  whether `--adopt` takes it over although this reader cannot fully read it (`overridable`, THE OVERRIDE in the header). */
export function findUnownedHooks(settings, identity) {
  const found = [];
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const read = readHook(hook, identity);
        if (read?.kind === 'adoptable' || read?.kind === 'unclear' || read?.kind === 'foreign') {
          found.push({ event, matcher: group.matcher, kind: read.kind, why: read.why, overridable: overridable(read) });
        }
      }
    }
  }
  return found;
}

/** Every hook that names the gate file, or contains its name, and that this reader reads as not running the gate, with where it
 *  sits and why it is left alone: `mention`, `writeTarget` or `differentFile`, and which kind of it (LEFT ALONE in the header). */
export function findHooksNamingGate(settings, identity) {
  const found = [];
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const read = readHook(hook, identity);
        if (read !== null && read.kind === null) found.push({ event, matcher: group.matcher, kind: null, why: read.why, detail: read.detail });
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
