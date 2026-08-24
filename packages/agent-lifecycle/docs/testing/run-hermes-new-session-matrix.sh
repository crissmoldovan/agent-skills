#!/bin/sh
set -eu

ROOT=${HOME}/.agents
ACTIVE=${ROOT}/model-routing-tiers.yaml
NAMED_DIR=${ROOT}/model-routing-profiles
NAMED=${NAMED_DIR}/acceptance-matrix.yaml
BACKUP=$(mktemp -d /tmp/agent-lifecycle-routing.XXXXXX)
OLD_MODEL=$(hermes config get model.default)
HAD_ACTIVE=0
HAD_NAMED=0

restore() {
  hermes config set model "$OLD_MODEL" >/dev/null 2>&1 || true
  if [ "$HAD_ACTIVE" -eq 1 ]; then cp "$BACKUP/active.yaml" "$ACTIVE"; else rm -f "$ACTIVE"; fi
  if [ "$HAD_NAMED" -eq 1 ]; then cp "$BACKUP/named.yaml" "$NAMED"; else rm -f "$NAMED"; fi
  rm -rf "$BACKUP"
}
trap restore EXIT HUP INT TERM

mkdir -p "$NAMED_DIR"
if [ -f "$ACTIVE" ]; then cp "$ACTIVE" "$BACKUP/active.yaml"; HAD_ACTIVE=1; fi
if [ -f "$NAMED" ]; then cp "$NAMED" "$BACKUP/named.yaml"; HAD_NAMED=1; fi

write_profile() {
  family=$1
  model=$2
  printf '%s\n' '# temporary acceptance profile' 'version: 1' 'active_profile: acceptance-matrix' 'harness: hermes' 'roles:' \
    "  driver: { family: $family, model: $model, effort: high }" \
    '  builder: { family: openai, model: openai/gpt-5.6-terra, effort: high }' \
    '  sweeper: { mode: fold-builder }' > "$ACTIVE"
  printf '%s\n' '# temporary acceptance profile' 'version: 1' 'harness: hermes' 'roles:' \
    "  driver: { family: $family, model: $model, effort: high }" \
    '  builder: { family: openai, model: openai/gpt-5.6-terra, effort: high }' \
    '  sweeper: { mode: fold-builder }' > "$NAMED"
}

run_case() {
  label=$1
  explicit=$2
  expected=$3
  provider=$4
  prompt="Load agent-lifecycle and model-routing. Inspect ~/.agents/model-routing-tiers.yaml and your actual runtime model. Do not mutate or delegate. Reply one line exactly: CASE=$label; lifecycle=<version>; routing=<MATCH|MISMATCH|UNPROFILED>; runtime=<exact model>; dispatch=<allowed|blocked>. Missing intent is UNPROFILED and blocked even if a runtime model is configured or explicit. Expected routing is $expected."
  if [ "$explicit" = '-' ]; then
    hermes chat -Q --provider "$provider" -s agent-lifecycle,model-routing --max-turns 4 -q "$prompt"
  else
    hermes chat -Q --provider "$provider" -m "$explicit" -s agent-lifecycle,model-routing --max-turns 4 -q "$prompt"
  fi
}

# Opus, explicit and implicit, with profile.
hermes config set model anthropic/claude-opus-5 >/dev/null
write_profile anthropic anthropic/claude-opus-5
run_case OPUS_EXPLICIT_PROFILE anthropic/claude-opus-5 MATCH openrouter
run_case OPUS_IMPLICIT_PROFILE - MATCH openrouter

# Opus, explicit and implicit, without profile.
rm -f "$ACTIVE" "$NAMED"
run_case OPUS_EXPLICIT_NO_PROFILE anthropic/claude-opus-5 UNPROFILED openrouter
run_case OPUS_IMPLICIT_NO_PROFILE - UNPROFILED openrouter

# GPT, explicit and implicit, with profile.
hermes config set model openai/gpt-5.6-sol >/dev/null
write_profile openai openai/gpt-5.6-sol
run_case GPT_EXPLICIT_PROFILE openai/gpt-5.6-sol MATCH routera
run_case GPT_IMPLICIT_PROFILE - MATCH routera

# Removal plus GPT explicit/implicit without profile.
rm -f "$ACTIVE" "$NAMED"
[ ! -e "$ACTIVE" ] && [ ! -e "$NAMED" ]
run_case GPT_EXPLICIT_NO_PROFILE openai/gpt-5.6-sol UNPROFILED routera
run_case GPT_IMPLICIT_NO_PROFILE - UNPROFILED routera

# Removal must preserve configured runtime and installed lifecycle skill.
[ "$(hermes config get model.default)" = 'openai/gpt-5.6-sol' ]
hermes skills list | grep 'agent-lifecycle'
echo 'REMOVAL_OK intent=absent named=absent runtime-binding=preserved skill=installed'
