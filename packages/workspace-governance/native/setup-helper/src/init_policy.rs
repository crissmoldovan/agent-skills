//! Closed init-only policy semantics. No legacy authorization enum is extended,
//! and allowed:true never authenticates a principal or authorizes an effect.
use super::*;

pub(super) fn policy_value(request: &[u8]) -> Result<Value> {
    let manifest = parse(&derive_manifest(request)?)?;
    let Value::Array(nodes) = get(&manifest, "nodes")? else { return invalid(); };
    let root_id = get(&nodes[0], "id")?.clone();
    let resolution = object(vec![
        ("values", object(vec![])),
        ("provenance", Value::Array(vec![])),
        ("constraints", Value::Array(vec![])),
        ("ancestry", Value::Array(vec![root_id.clone()])),
        // Intentionally not the LF-terminated output file's SHA256.
        ("revision", string(&sha256(&canonical(&manifest)?))),
        ("authorization", string("explicit-local-administration")),
        ("workflow", Value::Null),
    ]);
    let fingerprint = sha256(&canonical(&object(vec![
        ("checker", string("init-policy-v1")),
        ("operation", string("manifest-init")),
        ("authorityId", get(&manifest, "authorityId")?.clone()),
        ("resolution", resolution.clone()),
    ]))?);
    Ok(object(vec![
        ("checker", string("init-policy-v1")),
        ("checks", Value::Array(vec![object(vec![
            ("nodeId", root_id),
            ("operation", string("manifest-init")),
            ("allowed", Value::Bool(true)),
            ("resolutionFingerprint", string(&fingerprint)),
        ])])),
        ("resolution", resolution),
    ]))
}
/// Canonical policy JSON, without LF. Pure semantics shared by preview and future
/// complete init/trial rederivation; not a substitute for that enclosing validator.
pub fn derive_policy(request: &[u8]) -> Result<Vec<u8>> {
    canonical(&policy_value(request)?)
}
