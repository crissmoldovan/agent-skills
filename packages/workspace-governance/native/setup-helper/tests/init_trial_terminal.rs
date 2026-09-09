//! Pure serialized terminal decision tests: no filesystem authority or FT claim.
use workspace_governance_setup_native::init::trial_protocol::{Terminal, Decision};
#[test]
fn accepted_early_cancel_prevents_terminal_success(){
 let mut t=Terminal::new(); t.cancel(); assert!(!t.enter_terminal());
 assert_eq!(t.finish(false),Decision::Error);
 assert_eq!(t.finalize_reply(),Some(Decision::Error));assert_eq!(t.finalize_reply(),None);
}
#[test]
fn terminal_section_queues_cancel_and_success_wins(){
 let mut t=Terminal::new(); assert!(t.enter_terminal()); t.cancel();
 assert_eq!(t.finish(true),Decision::Success);
 assert_eq!(t.finalize_reply(),Some(Decision::Success)); t.cancel();assert_eq!(t.finalize_reply(),None);
}
#[test]
fn visible_complete_failure_cannot_become_success(){
 let mut t=Terminal::new(); assert!(t.enter_terminal()); t.cancel();
 assert_eq!(t.finish(false),Decision::Error);
 assert_eq!(t.finish(true),Decision::Error);
 assert_eq!(t.finalize_reply(),Some(Decision::Error));
}
#[test]
fn cannot_finalize_before_a_durable_decision(){
 let mut t=Terminal::new(); assert_eq!(t.finalize_reply(),None);
 assert!(t.enter_terminal()); assert_eq!(t.finalize_reply(),None);
 assert_eq!(t.finish(true),Decision::Success);assert_eq!(t.finalize_reply(),Some(Decision::Success));
}
