//! Output flow control. The webview pauses a pty while the terminal still has
//! a backlog to parse; the reader then stops reading, so the kernel pipe fills
//! and the producer blocks instead of the backlog growing without bound.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// A pause the webview never lifts (reload, disposed terminal) must not wedge
/// the shell, so every pause expires on its own.
pub(super) const MAX_PAUSE: Duration = Duration::from_secs(2);

#[derive(Default)]
pub(super) struct ReadGate {
    paused_since: Mutex<Option<Instant>>,
    changed: Condvar,
}

impl ReadGate {
    pub(super) fn set_paused(&self, paused: bool) {
        let mut since = self.paused_since.lock().unwrap();
        if paused {
            since.get_or_insert_with(Instant::now);
        } else {
            *since = None;
        }
        self.changed.notify_all();
    }

    /// Blocks while paused, for at most `max` from when the pause began.
    pub(super) fn wait(&self, max: Duration) {
        let mut since = self.paused_since.lock().unwrap();
        while let Some(started) = *since {
            let elapsed = started.elapsed();
            if elapsed >= max {
                *since = None;
                return;
            }
            since = self.changed.wait_timeout(since, max - elapsed).unwrap().0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ReadGate;
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn open_gate_does_not_block() {
        let gate = ReadGate::default();
        let started = Instant::now();
        gate.wait(Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn resume_wakes_a_waiting_reader() {
        let gate = Arc::new(ReadGate::default());
        gate.set_paused(true);
        let (send, receive) = mpsc::channel();
        let waiter = {
            let gate = gate.clone();
            thread::spawn(move || {
                gate.wait(Duration::from_secs(30));
                send.send(()).unwrap();
            })
        };
        assert!(receive.recv_timeout(Duration::from_millis(50)).is_err());
        gate.set_paused(false);
        receive.recv_timeout(Duration::from_secs(5)).unwrap();
        waiter.join().unwrap();
    }

    #[test]
    fn a_pause_expires_and_clears_itself() {
        let gate = ReadGate::default();
        gate.set_paused(true);
        let started = Instant::now();
        gate.wait(Duration::from_millis(40));
        assert!(started.elapsed() >= Duration::from_millis(40));
        // Cleared: the next wait returns at once.
        let again = Instant::now();
        gate.wait(Duration::from_secs(5));
        assert!(again.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn repeated_pause_does_not_extend_the_deadline() {
        let gate = ReadGate::default();
        gate.set_paused(true);
        thread::sleep(Duration::from_millis(30));
        gate.set_paused(true);
        let started = Instant::now();
        gate.wait(Duration::from_millis(40));
        assert!(started.elapsed() < Duration::from_millis(40));
    }
}
