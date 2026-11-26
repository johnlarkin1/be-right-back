//! Cooperative cancellation for agent runs and streaming generation.

use std::sync::Arc;

use tokio::sync::watch;

/// A cloneable cancel flag that async code can also wait on.
///
/// One side calls [`cancel`](Self::cancel). The running work polls
/// [`is_cancelled`](Self::is_cancelled) between steps, or awaits
/// [`cancelled`](Self::cancelled) inside a `select!`. Clones share one flag.
#[derive(Clone, Debug)]
pub struct CancelToken {
    tx: Arc<watch::Sender<bool>>,
}

impl CancelToken {
    /// Create a token that is not cancelled.
    pub fn new() -> Self {
        let (tx, _rx) = watch::channel(false);
        Self { tx: Arc::new(tx) }
    }

    /// Request cancellation. Calling it again does nothing.
    pub fn cancel(&self) {
        self.tx.send_replace(true);
    }

    /// Whether cancellation was requested.
    pub fn is_cancelled(&self) -> bool {
        *self.tx.borrow()
    }

    /// Resolve once cancellation is requested. Resolves at once if it already was.
    pub async fn cancelled(&self) {
        let mut rx = self.tx.subscribe();
        // `wait_for` fails only when the sender drops, and `self` holds it.
        let _ = rx.wait_for(|cancelled| *cancelled).await;
    }

    /// Whether two tokens share the same flag.
    pub fn same_as(&self, other: &CancelToken) -> bool {
        Arc::ptr_eq(&self.tx, &other.tx)
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn starts_uncancelled() {
        assert!(!CancelToken::new().is_cancelled());
    }

    #[test]
    fn clones_share_the_flag() {
        let a = CancelToken::new();
        let b = a.clone();
        b.cancel();
        assert!(a.is_cancelled());
        assert!(a.same_as(&b));
        assert!(!a.same_as(&CancelToken::new()));
    }

    #[tokio::test]
    async fn cancelled_resolves_when_already_cancelled() {
        let token = CancelToken::new();
        token.cancel();
        tokio::time::timeout(Duration::from_millis(100), token.cancelled())
            .await
            .expect("cancelled() should resolve at once");
    }

    #[tokio::test]
    async fn cancelled_wakes_a_waiter() {
        let token = CancelToken::new();
        let waiter = {
            let token = token.clone();
            tokio::spawn(async move { token.cancelled().await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        token.cancel();
        tokio::time::timeout(Duration::from_millis(500), waiter)
            .await
            .expect("waiter should wake")
            .unwrap();
    }
}
