use workspace_governance_setup_native::prompt::{parse_prompt, Field};

#[test]
fn hostile_prompts_and_noncanonical_transports_refuse() {
    for url in ["http://github.com/example/service.git", "https://evil.invalid/example/service.git",
        "https://github.com:443/example/service.git", "https://github.com/example/service.git?x",
        "https://github.com/example/service.git#x", "https://github.com/example/%73ervice.git",
        "https://github.com/example/service.git/", "https://user@github.com/example/service.git",
        "https://github.com/Example/service.git", "https://github.com/a--b/service.git",
        "https://github.com/example/../service.git", "https://github.com/example/service", "https://github.com/example/.git"] {
        assert!(parse_prompt(&format!("Username for '{url}': ")).is_none(), "{url}");
    }
    for prompt in ["Username for 'https://github.com/example/service.git':", "Password for 'https://github.com/example/service.git': ",
        "Password for 'https://other@github.com/example/service.git': ", "Username for 'https://github.com/example/service.git': \n", ""] {
        assert!(parse_prompt(prompt).is_none());
    }
    assert!(parse_prompt(&"a".repeat(16385)).is_none());
}

#[test]
fn exact_github_prompts_preserve_only_the_canonical_transport() {
    let user = parse_prompt("Username for 'https://github.com/example/service.git': ").unwrap();
    assert_eq!(user.field, Field::Username);
    assert_eq!(user.url, "https://github.com/example/service.git");
    let password = parse_prompt("Password for 'https://x-access-token@github.com/example/service.git': ").unwrap();
    assert_eq!(password.field, Field::Password);
    assert_eq!(password.url, user.url);
}
