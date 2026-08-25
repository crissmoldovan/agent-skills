# Safe terminal entry patterns

## Two-stage interaction

The user first pastes a command into an ordinary shell prompt. The command then
prints a profile-specific prompt and disables terminal echo. Only after that
prompt appears does the user paste the secret.

Always state the sequence explicitly:

1. Paste the command once and press Enter.
2. Wait until `Paste the <PROFILE> key` appears.
3. Paste only the key and press Enter.
4. Confirm the non-secret success sentence.

This avoids storing the setup command itself as the secret.

## macOS Keychain

Use a distinct service per workspace:

```text
<provider>-api-key-<profile>
```

Write/update:

```bash
printf "Paste the <PROFILE> API key, then press Enter: "; stty -echo; IFS= read -r API_KEY; stty echo; printf '\n'; security add-generic-password -U -a "$USER" -s "<provider>-api-key-<profile>" -w "$API_KEY" >/dev/null; unset API_KEY; echo "<PROFILE> key saved in macOS Keychain."
```

Presence check:

```bash
security find-generic-password -a "$USER" -s "<provider>-api-key-<profile>" >/dev/null
```

Retrieve only inside the consuming helper or command. Do not export globally or
print it.

## Environment profiles

For CI, containers, or approved non-macOS secret injection:

```text
<PROVIDER>_API_KEY_<PROFILE>
```

Code must require a validated explicit profile and map it to one variable. It
must not try another profile as fallback.

## Linux and Windows

Prefer an available OS secret store. If none exists, propose a
permission-restricted environment file only after explicit user approval and
name its exact path and permissions. On Windows use Credential Manager or an
approved enterprise secret store.

## Safe verification

Report only:

- destination absent/present;
- provider HTTP status and documented non-secret error code/message;
- selected workspace/profile;
- whether authentication succeeded.

Never print secret value, prefix, suffix, length, hash, encoded value, or a raw
response that might echo credentials. If placement looks malformed, overwrite
the named entry instead of inspecting it.
