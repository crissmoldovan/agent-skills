fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 2 && args[1] == "--help" {
        println!("workspacectl-init-trial-controller plan INSTALL_ROOT CANDIDATE INTENT\nworkspacectl-init-trial-controller issue INSTALL_ROOT CANDIDATE INTENT PLAN --approve DIGEST --operation-id ID\nworkspacectl-init-trial-controller issue-recovery INSTALL_ROOT --prior-trial-id ID --operation-id ID --approve DIGEST\nworkspacectl-init-trial-controller reserve INSTALL_ROOT TRIAL_ID --approve DIGEST\nworkspacectl-init-trial-controller launch INSTALL_ROOT TRIAL_ID --approve DIGEST\nLaunch supports initial absent-state manifest trials and same-candidate/environment completed recognition on a fresh recovery trial ID. Candidate-only and orphan repair remain unsupported. Trial success is not deployment qualification.");
    } else if args.get(1).is_some_and(|s| s == "plan") {
        match workspace_governance_setup_native::init::trial::controller::planning(&args[1..]) {
            Ok(bytes) => {
                use std::io::Write;
                if std::io::stdout().lock().write_all(&bytes).is_err() {
                    std::process::exit(3);
                }
            }
            Err(e) => {
                eprintln!("{:?}", e);
                std::process::exit(3);
            }
        }
    } else {
        let launching = args.get(1).is_some_and(|s| s == "launch");
        let reservation = args.get(1).is_some_and(|s| s == "reserve");
        let result = if launching {
            workspace_governance_setup_native::init::trial::controller::startup::launch(&args[1..])
        } else if reservation {
            workspace_governance_setup_native::init::trial::controller::reserve(&args[1..])
        } else {
            workspace_governance_setup_native::init::trial::controller::run(&args[1..])
        };
        match result {
            Ok(completion) => {
                let bytes = &completion.bytes;
                use std::io::Write;
                let mut out = std::io::stdout().lock();
                if out
                    .write_all(&bytes)
                    .and_then(|_| out.write_all(b"\n"))
                    .and_then(|_| out.flush())
                    .is_err()
                {
                    std::process::exit(3);
                }
                if reservation {
                    eprintln!("UNSUPPORTED_LAUNCH: attempt durably consumed; no child started");
                    std::process::exit(3);
                }
                if launching && !workspace_governance_setup_native::init::trial::controller::startup::launch_succeeded(bytes) {
                    std::process::exit(3);
                }
            }
            Err(e) => {
                eprintln!("{:?}", e);
                std::process::exit(3);
            }
        }
    }
}
