---
name: secure-credential-setup
description: "Place and verify secrets without exposing their values."
license: MIT
compatibility: "macOS, Linux, or Windows with an approved secret store and a harmless provider authentication endpoint for verification."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Secure credential setup

Place API keys, tokens, and other secrets without asking the user to paste values
into chat. Request one credential at a time, give one exact terminal placement
command, wait for completion, then verify presence and authentication without
printing the secret. The domain skill decides which credential and harmless API
probe are required; this skill owns safe placement mechanics.

## When to Use

- A task needs an API key, token, password, or workspace-specific credential.
- Several accounts/workspaces require distinct credentials.
- The user asks where to put a secret or wants a copy-pasteable command.
- A previous setup may have stored the command or placeholder as the secret.

Never request a secret in chat. Do not use this workflow to transmit credentials
to another person, rotate/revoke keys, or scrape credentials from disk.

Read [safe terminal entry patterns](references/terminal-entry-patterns.md) before
composing a placement command.

## Procedure

1. **Identify scope first.** Name the provider, account/workspace, purpose, and
   exact destination. Use a neutral profile identifier; never let two trust
   boundaries share an ambiguous key.
2. **Ask for one credential only.** Do not batch multiple secret prompts.
3. **Give one complete command.** It must start from the normal shell prompt,
   request hidden input after launch, write/update one named secret-store entry,
   unset temporary state, and print only a non-secret success sentence.
4. **Explain the two stages.** Say explicitly: paste the command once and press
   Enter; wait for its prompt; then paste only the secret and press Enter.
5. **Wait for confirmation.** Do not provide the next credential command yet.
6. **Verify without disclosure.** Check entry presence and a harmless provider
   authentication endpoint. Never print value, prefix, suffix, length, hash, or
   encoded form.
7. **Diagnose safely.** Distinguish absent entry, malformed placement, wrong
   workspace, expired/revoked key, and insufficient scope. Overwrite a malformed
   entry; do not log or inspect its value.
8. **Repeat one profile at a time.** Each trust boundary gets a distinct variable
   or secret-store service.
9. **Require explicit profile selection.** Runtime code must not fall back from
   one workspace's credential to another.

## macOS Keychain

```bash
trap 'stty echo' INT TERM EXIT; printf "Paste the <PROFILE> API key, then press Enter: "; stty -echo; IFS= read -r API_KEY; stty echo; trap - INT TERM EXIT; printf '\n'; security add-generic-password -U -a "$USER" -s "<provider>-api-key-<profile>" -w "$API_KEY" >/dev/null; unset API_KEY; echo "<PROFILE> key saved in macOS Keychain."
```

Presence check only:

```bash
security find-generic-password -a "$USER" -s "<provider>-api-key-<profile>" >/dev/null 2>&1
```

Use the consuming provider's harmless authenticated read to prove validity.
Presence alone is not success.

## Usage Examples

```text
Set up the API key for this workspace safely. Give me one exact terminal command,
never ask for the key in chat, wait for me to place it, then verify authentication
without printing any secret metadata.
```

```text
Configure two workspace credentials. Request them one at a time, store them under
separate neutral profiles, verify each before asking for the next, and require an
explicit profile in runtime code.
```

## Pitfalls

- **Command stored as secret:** explain the two-stage paste before the command.
- **Placeholder stored as secret:** never ask users to edit `***` inside a command.
- **Shell history leakage:** never put a literal secret in command arguments.
- **Presence mistaken for validity:** always run a harmless auth probe.
- **Leaky diagnostics:** never print prefixes, lengths, hashes, or raw bodies that
  might echo request credentials.
- **Process-list exposure on macOS:** `security -w "$API_KEY"` briefly passes the
  value to the Keychain CLI. State this limitation where other local users can
  inspect process arguments; use an approved native/enterprise secret-store UI
  instead when that threat model applies.
- **Cross-workspace fallback:** authentication success does not prove the chosen
  workspace is intended.
- **Batching:** request and verify one credential before discussing the next.

## Verification

- [ ] Secret never appeared in chat, arguments, source, logs, or clipboard output.
- [ ] Destination identifies the intended provider/profile/trust boundary.
- [ ] User received one exact command at a time and understood the two stages.
- [ ] Presence check emitted no secret data.
- [ ] Harmless live authentication succeeded for each profile.
- [ ] Runtime selection requires an explicit profile when multiple keys exist.
- [ ] Temporary shell state was unset.
