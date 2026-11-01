use std::collections::HashMap;
use std::sync::Arc;

pub struct GuardState {
    pub count: usize,
}

pub enum AlertLevel {
    Info,
    Warning,
    Error,
}

pub trait Monitor {
    fn check(&self) -> bool;
}

pub fn initialize_guard() -> GuardState {
    GuardState { count: 0 }
}

