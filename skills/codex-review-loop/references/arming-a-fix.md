# Arming a fix

A check written for a fix and green from its first run proves that the check runs. It does not prove
that it would notice the fix going missing. Arming is how that is proven: break the fix on purpose,
watch the check fail, put the fix back, watch it pass. It takes a minute, and it is the difference
between a guard and a decoration.

## The procedure

```bash
# 1. Byte-copy the fixed file before touching it. The fix is usually uncommitted.
cp path/to/file.ext "$SCRATCH/file.ext.fixed"

# 2. Break the fix on purpose: invert the condition, delete the guard, return the old value.
#    Edit one thing, so the failure can only come from that.

# 3. Run the check. It must FAIL, and for the right reason.
<check command>

# 4. Restore from the byte copy, never from version control.
cp "$SCRATCH/file.ext.fixed" path/to/file.ext

# 5. Prove the restore by content before believing any test result.
cmp path/to/file.ext "$SCRATCH/file.ext.fixed"
grep -c '<an identifier that only the fix introduces>' path/to/file.ext

# 6. Run the check again. It must PASS.
<check command>
```

Record the mutation, the failing output (the line that says why it failed), and the passing run in
the round's review record.

## Failing for the right reason

Read the failure. A mutation that leaves a syntax error, a missing import or a renamed symbol makes
almost any test fail, and that failure says nothing about whether the test checks the behaviour.
The failure should be the assertion that names the behaviour the fix restored: the expected value,
the refused input, the row that should not be written.

If the check passes with the fix broken, the check is not guarding the fix. Rewrite it until it
fails, or record that the fix is unguarded and why.

## Why not version control

`git checkout -- <file>`, `git restore <file>` and `git stash` all put back the last committed
version of the file. The fix being armed is usually uncommitted, in that same file, so each of them
removes the mutation and the fix together. Nothing reports it: the command exits zero and prints
nothing. The next test run passes too, either because the fix's own test went with it or because
nothing else calls the code. The only sign is the fix's absence, and nobody looks for an absence
after a green run. That is why step 5 checks content, not test results.

The byte copy has one more advantage: it restores exactly the state you armed, including other
uncommitted edits in the file that belong to the same round.

## Checks that are not tests

Not every fix lives in code a test can reach. A data correction, a configuration value or a
document can be armed the same way with a self-check: a script, query or assertion that reads the
artefact and fails when the fix is absent. Break the artefact from a byte copy, watch the self-check
fail, restore, watch it pass.

## Arming the other side

Some checks compare two things: code against a seed file, a registry against what it registers, a
manifest against the files it lists. Mutating one side proves the check notices that side moving.
It proves nothing about the other side. Arm both: break the code and watch it fail; restore; break
the data and watch it fail; restore.
