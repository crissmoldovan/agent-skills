#[derive(Debug, PartialEq, Eq)]
pub enum Field { Username, Password }
#[derive(Debug, PartialEq, Eq)]
pub struct Prompt { pub field: Field, pub url: String }

pub fn parse_prompt(input: &str) -> Option<Prompt> {
    if input.len() > 16384 || !input.is_ascii() { return None; }
    let (field, tail) = if let Some(tail) = input.strip_prefix("Username for 'https://") {
        (Field::Username, tail)
    } else {
        (Field::Password, input.strip_prefix("Password for 'https://x-access-token@")?)
    };
    let remote = tail.strip_suffix("': ")?;
    let path = remote.strip_prefix("github.com/")?;
    let (owner, name) = path.split_once('/')?;
    let repo = name.strip_suffix(".git")?;
    if owner.is_empty() || owner.len() > 39 || owner.split('-').any(|part|
        part.is_empty() || !part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())) {
        return None;
    }
    if repo.is_empty() || repo.len() > 100 || repo == "." || repo == ".." || repo.ends_with('.') ||
        !repo.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b)) {
        return None;
    }
    Some(Prompt { field, url: format!("https://{remote}") })
}
