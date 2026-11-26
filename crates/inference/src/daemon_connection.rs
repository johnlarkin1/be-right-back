//! Async Unix domain socket connection wrapper for the inference daemon.
//!
//! Provides a connection abstraction over `tokio::net::UnixStream` that speaks
//! the same JSON-lines protocol as the pipe-based transport. Each command gets
//! a request id, and reads skip frames stamped with any other id.

use std::path::Path;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tracing::{debug, warn};

/// Timeout for a single socket read (per-token during generation).
/// 60s is conservative — a single token should never take this long,
/// but GPU stalls or OOM conditions could cause indefinite hangs without this.
const SOCKET_READ_TIMEOUT: Duration = Duration::from_secs(60);

use crate::cancel::CancelToken;
use crate::engines::mlx_python::protocol::{RequestIds, ResponseFrame, check_protocol, encode_command};
use crate::engines::mlx_python::{DaemonCommand, DaemonResponse};
use crate::error::{InferenceError, Result};

/// An async connection to a daemon over a Unix domain socket.
pub struct DaemonConnection {
    reader: BufReader<tokio::net::unix::OwnedReadHalf>,
    writer: tokio::net::unix::OwnedWriteHalf,
    ids: RequestIds,
}

impl DaemonConnection {
    /// Connect to a daemon at the given socket path.
    pub async fn connect(socket_path: &Path) -> Result<Self> {
        let stream = UnixStream::connect(socket_path).await.map_err(|e| {
            InferenceError::BackendError(format!(
                "failed to connect to daemon socket {}: {e}",
                socket_path.display()
            ))
        })?;

        let (read_half, write_half) = stream.into_split();

        Ok(Self {
            reader: BufReader::new(read_half),
            writer: write_half,
            ids: RequestIds::default(),
        })
    }

    /// Send a command with a new request id and return that id.
    ///
    /// Later reads return only frames for this id.
    pub async fn send_command(&mut self, cmd: &DaemonCommand) -> Result<u64> {
        let id = self.ids.start();
        Self::write_command(&mut self.writer, cmd, id).await?;
        Ok(id)
    }

    /// Serialize `cmd` with request id `id` as one JSON line and write it.
    ///
    /// Takes the write half alone so a reader can send `Cancel` while a read
    /// on the other half is still pending.
    async fn write_command(writer: &mut tokio::net::unix::OwnedWriteHalf, cmd: &DaemonCommand, id: u64) -> Result<()> {
        let json = encode_command(cmd, id)
            .map_err(|e| InferenceError::BackendError(format!("failed to serialize command: {e}")))?;

        debug!(command = %json, "sending command to daemon via socket");

        let mut buf = json.into_bytes();
        buf.push(b'\n');

        writer
            .write_all(&buf)
            .await
            .map_err(|e| InferenceError::BackendError(format!("failed to write to daemon socket: {e}")))?;

        writer
            .flush()
            .await
            .map_err(|e| InferenceError::BackendError(format!("failed to flush daemon socket: {e}")))?;

        Ok(())
    }

    /// Read the next response for the current request.
    ///
    /// Each line read has a 60s timeout. During generation the daemon sends
    /// one frame per token, so the timeout applies per token. On a timeout
    /// this sends `Cancel` for the request, so a slow generation stops
    /// instead of finishing into a socket nobody reads.
    pub async fn read_response(&mut self) -> Result<DaemonResponse> {
        let mut cancel_sent = false;
        self.next_response(None, &mut cancel_sent).await
    }

    /// Read frames until one belongs to the current request.
    ///
    /// When `cancel` fires, this sends `Cancel` for the current request once
    /// and keeps reading. The pending read is never dropped, so no partial
    /// line is lost. `cancel_sent` records that the `Cancel` went out.
    async fn next_response(&mut self, cancel: Option<&CancelToken>, cancel_sent: &mut bool) -> Result<DaemonResponse> {
        loop {
            let mut line = String::new();
            let deadline = tokio::time::Instant::now() + SOCKET_READ_TIMEOUT;

            let bytes_read = {
                let read = self.reader.read_line(&mut line);
                tokio::pin!(read);
                loop {
                    tokio::select! {
                        res = &mut read => {
                            break res.map_err(|e| {
                                InferenceError::BackendError(format!("failed to read from daemon socket: {e}"))
                            })?;
                        }
                        _ = tokio::time::sleep_until(deadline) => {
                            if !*cancel_sent && let Some(id) = self.ids.awaiting() {
                                // Best effort: the read already failed.
                                let _ = Self::write_command(&mut self.writer, &DaemonCommand::Cancel, id).await;
                            }
                            return Err(InferenceError::BackendError("daemon read timed out after 60s".into()));
                        }
                        _ = wait_for_cancel(cancel), if !*cancel_sent => {
                            *cancel_sent = true;
                            if let Some(id) = self.ids.awaiting() {
                                debug!(id, "sending cancel to daemon");
                                Self::write_command(&mut self.writer, &DaemonCommand::Cancel, id).await?;
                            }
                        }
                    }
                }
            };

            let frame = Self::parse_line(bytes_read, &line)?;
            if let Some(response) = self.ids.accept(frame) {
                return Ok(response);
            }
        }
    }

    /// Parse one frame. `bytes_read == 0` means the daemon closed the socket.
    fn parse_line(bytes_read: usize, line: &str) -> Result<ResponseFrame> {
        if bytes_read == 0 {
            return Err(InferenceError::BackendError(
                "daemon closed socket unexpectedly".to_string(),
            ));
        }

        debug!(response = %line.trim(), "received response from daemon via socket");

        serde_json::from_str(line)
            .map_err(|e| InferenceError::BackendError(format!("failed to parse daemon response: {e}. Raw: {line}")))
    }

    /// Run a `Generate` command and pass each streamed token to `on_token`.
    ///
    /// `cmd` should be a `Generate` with `stream: true`. Returns the text of
    /// the `Complete` frame, which is the cleaned, authoritative response.
    ///
    /// When `cancel` fires, this sends `Cancel`, stops calling `on_token`, and
    /// keeps reading until the daemon ends the generation. The result is then
    /// `InferenceError::Cancelled`, even if the generation finished first.
    /// If the read fails instead, the next command's id makes any late
    /// frames from this generation harmless.
    pub async fn generate_with_tokens<F: FnMut(&str)>(
        &mut self,
        cmd: &DaemonCommand,
        mut on_token: F,
        cancel: &CancelToken,
    ) -> Result<String> {
        self.send_command(cmd).await?;

        let mut cancel_sent = false;
        loop {
            match self.next_response(Some(cancel), &mut cancel_sent).await? {
                DaemonResponse::Token { text, .. } => {
                    if !cancel_sent {
                        on_token(&text);
                    }
                }
                DaemonResponse::Complete { text } => {
                    return if cancel_sent {
                        Err(InferenceError::Cancelled)
                    } else {
                        Ok(text)
                    };
                }
                DaemonResponse::Cancelled => return Err(InferenceError::Cancelled),
                DaemonResponse::Error { message } => return Err(InferenceError::GenerationFailed(message)),
                DaemonResponse::Log { level, message } => {
                    debug!(level = %level, message = %message, "daemon log during streaming generation");
                }
                other => {
                    return Err(InferenceError::BackendError(format!(
                        "unexpected response during generation: {other:?}"
                    )));
                }
            }
        }
    }

    /// Read responses, skipping any log messages.
    pub async fn read_response_skip_logs(&mut self) -> Result<DaemonResponse> {
        loop {
            let response = self.read_response().await?;
            match &response {
                DaemonResponse::Log { level, message } => {
                    debug!(level = %level, message = %message, "daemon log (socket)");
                    continue;
                }
                _ => return Ok(response),
            }
        }
    }

    /// Wait for the `Ready` frame the daemon sends to each new connection.
    ///
    /// Fails with `InferenceError::ProtocolMismatch` when the daemon runs a
    /// script with another protocol version.
    pub async fn wait_for_ready(&mut self) -> Result<()> {
        debug!("waiting for daemon ready signal via socket");

        match self.read_response_skip_logs().await? {
            DaemonResponse::Ready { protocol } => check_protocol(protocol),
            DaemonResponse::Error { message } => Err(InferenceError::BackendError(format!(
                "daemon startup failed: {message}"
            ))),
            other => {
                warn!(response = ?other, "unexpected response while waiting for ready");
                Err(InferenceError::BackendError(format!(
                    "unexpected response while waiting for ready: {other:?}"
                )))
            }
        }
    }
}

/// Resolve when `cancel` fires. Never resolves without a token.
async fn wait_for_cancel(cancel: Option<&CancelToken>) {
    match cancel {
        Some(cancel) => cancel.cancelled().await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use tokio::io::BufReader as TokioBufReader;
    use tokio::net::UnixListener;

    /// Start a mock daemon that speaks JSON-lines protocol over a Unix socket.
    /// Sends Ready on connect, responds to Ping/Shutdown/Load/EmbedQuery/Rerank/Generate.
    async fn start_mock_daemon(socket_path: &std::path::Path) -> tokio::task::JoinHandle<()> {
        let listener = UnixListener::bind(socket_path).expect("failed to bind mock socket");

        tokio::spawn(async move {
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(conn) => conn,
                    Err(_) => break,
                };
                tokio::spawn(async move {
                    let (reader, mut writer) = stream.into_split();
                    let mut reader = TokioBufReader::new(reader);

                    // Send Ready
                    let _ = writer.write_all(b"{\"type\":\"ready\",\"protocol\":2}\n").await;
                    let _ = writer.flush().await;

                    loop {
                        let mut line = String::new();
                        match reader.read_line(&mut line).await {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }

                        let data: serde_json::Value = match serde_json::from_str(&line) {
                            Ok(v) => v,
                            Err(_) => {
                                let _ = writer
                                    .write_all(b"{\"type\":\"error\",\"message\":\"bad json\"}\n")
                                    .await;
                                let _ = writer.flush().await;
                                continue;
                            }
                        };

                        let cmd = data["cmd"].as_str().unwrap_or("");
                        let resp = match cmd {
                            "ping" => "{\"type\":\"pong\"}\n".to_string(),
                            "shutdown" => {
                                let resp = serde_json::json!({"type": "shutting_down", "id": data["id"]});
                                let _ = writer.write_all(format!("{resp}\n").as_bytes()).await;
                                let _ = writer.flush().await;
                                break;
                            }
                            "load" => {
                                let pid = data["persona_id"].as_str().unwrap_or("unknown");
                                format!("{{\"type\":\"loaded\",\"persona_id\":\"{pid}\"}}\n")
                            }
                            "embed_query" => {
                                let fake: Vec<f32> = (0..768).map(|i| i as f32 * 0.001).collect();
                                let v = serde_json::json!({"type":"embedding","vector":fake,"dims":768});
                                format!("{v}\n")
                            }
                            "rerank" => {
                                let n = data["passages"].as_array().map(|a| a.len()).unwrap_or(0);
                                let scores: Vec<f32> = (0..n).map(|i| 1.0 - i as f32 * 0.1).collect();
                                let v = serde_json::json!({"type":"rerank_result","scores":scores});
                                format!("{v}\n")
                            }
                            "generate" => "{\"type\":\"complete\",\"text\":\"mock response\"}\n".to_string(),
                            other => {
                                format!("{{\"type\":\"error\",\"message\":\"unknown: {other}\"}}\n")
                            }
                        };

                        // Echo the request id, as the real daemon does.
                        let mut resp: serde_json::Value = serde_json::from_str(&resp).unwrap();
                        resp["id"] = data["id"].clone();
                        let resp = format!("{resp}\n");

                        if writer.write_all(resp.as_bytes()).await.is_err() {
                            break;
                        }
                        let _ = writer.flush().await;
                    }
                });
            }
        })
    }

    /// Helper to create a temp dir and socket path.
    fn temp_socket() -> (tempfile::TempDir, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let sock = tmp.path().join("test.sock");
        (tmp, sock)
    }

    #[tokio::test]
    async fn connect_and_ready() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();
    }

    #[tokio::test]
    async fn ping_pong() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        conn.send_command(&DaemonCommand::Ping).await.unwrap();
        let resp = conn.read_response().await.unwrap();
        assert!(matches!(resp, DaemonResponse::Pong));
    }

    #[tokio::test]
    async fn load_persona() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cmd = DaemonCommand::Load {
            persona_id: "alice".to_string(),
            base_model: "test-model".to_string(),
        };
        conn.send_command(&cmd).await.unwrap();

        match conn.read_response().await.unwrap() {
            DaemonResponse::Loaded { persona_id } => assert_eq!(persona_id, "alice"),
            other => panic!("expected Loaded, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn embed_query() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cmd = DaemonCommand::EmbedQuery {
            text: "hello".to_string(),
        };
        conn.send_command(&cmd).await.unwrap();

        match conn.read_response().await.unwrap() {
            DaemonResponse::Embedding { vector, dims } => {
                assert_eq!(dims, 768);
                assert_eq!(vector.len(), 768);
            }
            other => panic!("expected Embedding, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn rerank() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cmd = DaemonCommand::Rerank {
            query: "query".to_string(),
            passages: vec!["a".into(), "b".into(), "c".into()],
        };
        conn.send_command(&cmd).await.unwrap();

        match conn.read_response().await.unwrap() {
            DaemonResponse::RerankResult { scores } => assert_eq!(scores.len(), 3),
            other => panic!("expected RerankResult, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn generate_complete() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cmd = DaemonCommand::Generate {
            messages: vec![],
            config: crate::engines::mlx_python::protocol::GenerationConfigForPython {
                max_tokens: 256,
                temperature: 0.7,
                top_p: 0.9,
                top_k: 0,
                repetition_penalty: 1.1,
                repetition_context_size: 50,
                stop_sequences: vec![],
                use_default_stops: true,
                enable_thinking: false,
            },
            stream: false,
        };
        conn.send_command(&cmd).await.unwrap();

        match conn.read_response().await.unwrap() {
            DaemonResponse::Complete { text } => assert_eq!(text, "mock response"),
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn shutdown_command() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        conn.send_command(&DaemonCommand::Shutdown).await.unwrap();
        let resp = conn.read_response().await.unwrap();
        assert!(matches!(resp, DaemonResponse::ShuttingDown));
    }

    #[tokio::test]
    async fn skip_log_messages() {
        let (_tmp, sock) = temp_socket();

        // Custom server that sends log messages before pong
        let listener = UnixListener::bind(&sock).unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            let mut reader = TokioBufReader::new(reader);

            writer
                .write_all(b"{\"type\":\"ready\",\"protocol\":2}\n")
                .await
                .unwrap();
            writer.flush().await.unwrap();

            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();

            // Two log messages then pong
            writer
                .write_all(b"{\"type\":\"log\",\"level\":\"info\",\"message\":\"loading\"}\n")
                .await
                .unwrap();
            writer
                .write_all(b"{\"type\":\"log\",\"level\":\"debug\",\"message\":\"gpu init\"}\n")
                .await
                .unwrap();
            writer.write_all(b"{\"type\":\"pong\",\"id\":1}\n").await.unwrap();
            writer.flush().await.unwrap();
        });

        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        conn.send_command(&DaemonCommand::Ping).await.unwrap();
        let resp = conn.read_response_skip_logs().await.unwrap();
        assert!(matches!(resp, DaemonResponse::Pong));
    }

    #[tokio::test]
    async fn multi_client_connections() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Connect 3 clients simultaneously
        let mut clients = Vec::new();
        for _ in 0..3 {
            let mut conn = DaemonConnection::connect(&sock).await.unwrap();
            conn.wait_for_ready().await.unwrap();
            clients.push(conn);
        }

        // Each client pings independently
        for (i, conn) in clients.iter_mut().enumerate() {
            conn.send_command(&DaemonCommand::Ping).await.unwrap();
            let resp = conn.read_response().await.unwrap();
            assert!(matches!(resp, DaemonResponse::Pong), "client {i} didn't get Pong");
        }
    }

    #[tokio::test]
    async fn client_disconnect_server_survives() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Client 1 connects and disconnects
        {
            let mut conn = DaemonConnection::connect(&sock).await.unwrap();
            conn.wait_for_ready().await.unwrap();
            conn.send_command(&DaemonCommand::Ping).await.unwrap();
            assert!(matches!(conn.read_response().await.unwrap(), DaemonResponse::Pong));
        }

        tokio::time::sleep(Duration::from_millis(50)).await;

        // Client 2 connects -- server survived client 1's disconnect
        {
            let mut conn = DaemonConnection::connect(&sock).await.unwrap();
            conn.wait_for_ready().await.unwrap();
            conn.send_command(&DaemonCommand::Ping).await.unwrap();
            assert!(matches!(conn.read_response().await.unwrap(), DaemonResponse::Pong));
        }
    }

    #[tokio::test]
    async fn connect_nonexistent_socket_fails() {
        let result = DaemonConnection::connect(std::path::Path::new("/tmp/nonexistent-brb-test.sock")).await;
        assert!(result.is_err());
    }

    // ── Latency tests (Criteria 4) ──────────────────────────────

    #[tokio::test]
    async fn warm_ping_roundtrip_under_5ms() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        // Warm up
        conn.send_command(&DaemonCommand::Ping).await.unwrap();
        let _ = conn.read_response().await.unwrap();

        // Measure 100 round-trips
        let iterations = 100u128;
        let start = Instant::now();

        for _ in 0..iterations {
            conn.send_command(&DaemonCommand::Ping).await.unwrap();
            let resp = conn.read_response().await.unwrap();
            assert!(matches!(resp, DaemonResponse::Pong));
        }

        let elapsed = start.elapsed();
        let avg_us = elapsed.as_micros() / iterations;

        eprintln!(
            "Warm ping round-trip: {avg_us}us avg over {iterations} iterations (total: {}ms)",
            elapsed.as_millis()
        );

        // IPC overhead should be well under 5ms per round-trip.
        // The 200ms criteria 4 budget is for inference (GPU time), so the
        // transport layer must add negligible overhead.
        assert!(avg_us < 5000, "average round-trip {avg_us}us exceeds 5ms threshold");
    }

    #[tokio::test]
    async fn four_command_sequence_under_50ms() {
        let (_tmp, sock) = temp_socket();
        let _server = start_mock_daemon(&sock).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        // Simulate realistic sequence: load -> generate -> embed -> rerank
        let start = Instant::now();

        // Load
        conn.send_command(&DaemonCommand::Load {
            persona_id: "__base__".to_string(),
            base_model: "test".to_string(),
        })
        .await
        .unwrap();
        assert!(matches!(
            conn.read_response().await.unwrap(),
            DaemonResponse::Loaded { .. }
        ));

        // Generate
        conn.send_command(&DaemonCommand::Generate {
            messages: vec![],
            config: crate::engines::mlx_python::protocol::GenerationConfigForPython {
                max_tokens: 256,
                temperature: 0.7,
                top_p: 0.9,
                top_k: 0,
                repetition_penalty: 1.1,
                repetition_context_size: 50,
                stop_sequences: vec![],
                use_default_stops: true,
                enable_thinking: false,
            },
            stream: false,
        })
        .await
        .unwrap();
        assert!(matches!(
            conn.read_response().await.unwrap(),
            DaemonResponse::Complete { .. }
        ));

        // Embed
        conn.send_command(&DaemonCommand::EmbedQuery {
            text: "query".to_string(),
        })
        .await
        .unwrap();
        assert!(matches!(
            conn.read_response().await.unwrap(),
            DaemonResponse::Embedding { .. }
        ));

        // Rerank
        conn.send_command(&DaemonCommand::Rerank {
            query: "q".to_string(),
            passages: vec!["a".into(), "b".into()],
        })
        .await
        .unwrap();
        assert!(matches!(
            conn.read_response().await.unwrap(),
            DaemonResponse::RerankResult { .. }
        ));

        let elapsed = start.elapsed();
        eprintln!("4-command sequence: {}us total", elapsed.as_micros());

        assert!(
            elapsed.as_millis() < 50,
            "4-command sequence took {}ms, expected <50ms",
            elapsed.as_millis()
        );
    }

    /// A `Generate` command with `stream: true` and default settings.
    fn streaming_generate_cmd() -> DaemonCommand {
        DaemonCommand::Generate {
            messages: vec![],
            config: crate::engines::mlx_python::protocol::GenerationConfigForPython::from(
                &crate::config::GenerationConfig::default(),
            ),
            stream: true,
        }
    }

    /// Start a one-client mock daemon. `script` gets the reader and writer
    /// after Ready is sent and plays out one exchange.
    async fn start_scripted_daemon<F, Fut>(socket_path: &std::path::Path, script: F)
    where
        F: FnOnce(TokioBufReader<tokio::net::unix::OwnedReadHalf>, tokio::net::unix::OwnedWriteHalf) -> Fut
            + Send
            + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let listener = UnixListener::bind(socket_path).expect("failed to bind mock socket");
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            writer
                .write_all(b"{\"type\":\"ready\",\"protocol\":2}\n")
                .await
                .unwrap();
            writer.flush().await.unwrap();
            script(TokioBufReader::new(reader), writer).await;
        });
    }

    async fn read_cmd(reader: &mut TokioBufReader<tokio::net::unix::OwnedReadHalf>) -> serde_json::Value {
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[tokio::test]
    async fn generate_with_tokens_streams_then_returns_complete_text() {
        let (_tmp, sock) = temp_socket();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            let cmd = read_cmd(&mut reader).await;
            assert_eq!(cmd["cmd"], "generate");
            assert_eq!(cmd["stream"], true);
            writer
                .write_all(
                    b"{\"type\":\"token\",\"id\":1,\"text\":\"Hel\",\"done\":false}\n\
                      {\"type\":\"log\",\"level\":\"info\",\"message\":\"x\"}\n\
                      {\"type\":\"token\",\"id\":1,\"text\":\"lo \",\"done\":false}\n\
                      {\"type\":\"complete\",\"id\":1,\"text\":\"Hello\"}\n",
                )
                .await
                .unwrap();
            writer.flush().await.unwrap();
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let mut tokens = Vec::new();
        let text = conn
            .generate_with_tokens(
                &streaming_generate_cmd(),
                |t| tokens.push(t.to_string()),
                &CancelToken::new(),
            )
            .await
            .unwrap();

        assert_eq!(tokens, vec!["Hel", "lo "]);
        assert_eq!(text, "Hello");
    }

    #[tokio::test]
    async fn generate_with_tokens_sends_cancel_and_drains_to_cancelled() {
        let (_tmp, sock) = temp_socket();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            read_cmd(&mut reader).await;
            writer
                .write_all(b"{\"type\":\"token\",\"id\":1,\"text\":\"partial\",\"done\":false}\n")
                .await
                .unwrap();
            writer.flush().await.unwrap();

            // The real daemon keeps generating until it sees the cancel.
            let cmd = read_cmd(&mut reader).await;
            assert_eq!(cmd["cmd"], "cancel");
            assert_eq!(cmd["id"], 1, "the cancel names the generation it stops");
            writer
                .write_all(
                    b"{\"type\":\"token\",\"id\":1,\"text\":\"late\",\"done\":false}\n\
                      {\"type\":\"cancelled\",\"id\":1}\n",
                )
                .await
                .unwrap();
            writer.flush().await.unwrap();

            // The connection stays usable after a cancel.
            let cmd = read_cmd(&mut reader).await;
            assert_eq!(cmd["cmd"], "ping");
            assert_eq!(cmd["id"], 2);
            writer.write_all(b"{\"type\":\"pong\",\"id\":2}\n").await.unwrap();
            writer.flush().await.unwrap();
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cancel = CancelToken::new();
        let mut tokens = Vec::new();
        let result = conn
            .generate_with_tokens(
                &streaming_generate_cmd(),
                |t| {
                    tokens.push(t.to_string());
                    cancel.cancel();
                },
                &cancel,
            )
            .await;

        assert!(matches!(result, Err(InferenceError::Cancelled)), "got {result:?}");
        assert_eq!(tokens, vec!["partial"], "no tokens after the cancel");

        conn.send_command(&DaemonCommand::Ping).await.unwrap();
        assert!(matches!(conn.read_response().await.unwrap(), DaemonResponse::Pong));
    }

    #[tokio::test]
    async fn generate_with_tokens_reports_cancelled_when_complete_wins_the_race() {
        let (_tmp, sock) = temp_socket();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            read_cmd(&mut reader).await;
            // Wait for the cancel, then answer as if the generation had
            // already finished before the daemon read it.
            let cmd = read_cmd(&mut reader).await;
            assert_eq!(cmd["cmd"], "cancel");
            writer
                .write_all(b"{\"type\":\"complete\",\"id\":1,\"text\":\"done\"}\n")
                .await
                .unwrap();
            writer.flush().await.unwrap();
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cancel = CancelToken::new();
        let canceller = {
            let cancel = cancel.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                cancel.cancel();
            })
        };

        let result = conn
            .generate_with_tokens(&streaming_generate_cmd(), |_| {}, &cancel)
            .await;
        canceller.await.unwrap();

        assert!(matches!(result, Err(InferenceError::Cancelled)), "got {result:?}");
    }

    // ── Request ids ─────────────────────────────────────────────

    async fn write_lines(writer: &mut tokio::net::unix::OwnedWriteHalf, lines: &[&str]) {
        for line in lines {
            writer.write_all(line.as_bytes()).await.unwrap();
            writer.write_all(b"\n").await.unwrap();
        }
        writer.flush().await.unwrap();
    }

    #[tokio::test]
    async fn discards_the_reply_to_an_abandoned_request() {
        let (_tmp, sock) = temp_socket();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            assert_eq!(read_cmd(&mut reader).await["id"], 1);
            assert_eq!(read_cmd(&mut reader).await["id"], 2);
            // The reply to request 1 arrives after the client moved on.
            write_lines(
                &mut writer,
                &[
                    r#"{"type":"complete","text":"stale answer","id":1}"#,
                    r#"{"type":"pong","id":2}"#,
                ],
            )
            .await;
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        // Request 1 is never read, as after a timeout or a swallowed error.
        conn.send_command(&streaming_generate_cmd()).await.unwrap();
        conn.send_command(&DaemonCommand::Ping).await.unwrap();

        let resp = conn.read_response().await.unwrap();
        assert!(matches!(resp, DaemonResponse::Pong), "got {resp:?}");
    }

    #[tokio::test]
    async fn streaming_skips_tokens_from_an_abandoned_generation() {
        let (_tmp, sock) = temp_socket();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            read_cmd(&mut reader).await;
            read_cmd(&mut reader).await;
            write_lines(
                &mut writer,
                &[
                    r#"{"type":"token","text":"old","done":false,"id":1}"#,
                    r#"{"type":"token","text":"new","done":false,"id":2}"#,
                    r#"{"type":"complete","text":"old answer","id":1}"#,
                    r#"{"type":"complete","text":"new answer","id":2}"#,
                ],
            )
            .await;
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();
        conn.send_command(&streaming_generate_cmd()).await.unwrap();

        let mut tokens = Vec::new();
        let text = conn
            .generate_with_tokens(
                &streaming_generate_cmd(),
                |t| tokens.push(t.to_string()),
                &CancelToken::new(),
            )
            .await
            .unwrap();

        assert_eq!(tokens, vec!["new"]);
        assert_eq!(text, "new answer");
    }

    #[tokio::test]
    async fn late_cancelled_frame_does_not_end_the_next_generation() {
        let (_tmp, sock) = temp_socket();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            read_cmd(&mut reader).await;
            write_lines(&mut writer, &[r#"{"type":"token","text":"a","done":false,"id":1}"#]).await;
            assert_eq!(read_cmd(&mut reader).await["cmd"], "cancel");
            // The client sends the next generation before request 1 ends.
            write_lines(&mut writer, &[r#"{"type":"cancelled","id":1}"#]).await;
            let cmd = read_cmd(&mut reader).await;
            assert_eq!((cmd["cmd"].as_str(), cmd["id"].as_u64()), (Some("generate"), Some(2)));
            write_lines(&mut writer, &[r#"{"type":"complete","text":"second","id":2}"#]).await;
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        let cancel = CancelToken::new();
        let first = conn
            .generate_with_tokens(&streaming_generate_cmd(), |_| cancel.cancel(), &cancel)
            .await;
        assert!(matches!(first, Err(InferenceError::Cancelled)), "got {first:?}");

        let second = conn
            .generate_with_tokens(&streaming_generate_cmd(), |_| {}, &CancelToken::new())
            .await
            .unwrap();
        assert_eq!(second, "second");
    }

    #[tokio::test(start_paused = true)]
    async fn read_timeout_cancels_the_abandoned_generation() {
        let (_tmp, sock) = temp_socket();
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        start_scripted_daemon(&sock, |mut reader, mut writer| async move {
            assert_eq!(read_cmd(&mut reader).await["cmd"], "generate");
            // A slow prefill: no frame until the client gives up and cancels.
            let cmd = read_cmd(&mut reader).await;
            assert_eq!((cmd["cmd"].as_str(), cmd["id"].as_u64()), (Some("cancel"), Some(1)));
            write_lines(&mut writer, &[r#"{"type":"cancelled","id":1}"#]).await;
            assert_eq!(read_cmd(&mut reader).await["id"], 2);
            write_lines(&mut writer, &[r#"{"type":"pong","id":2}"#]).await;
            let _ = done_tx.send(());
        })
        .await;

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        conn.wait_for_ready().await.unwrap();

        conn.send_command(&streaming_generate_cmd()).await.unwrap();
        let err = conn.read_response().await.unwrap_err();
        assert!(err.to_string().contains("timed out"), "got {err}");

        conn.send_command(&DaemonCommand::Ping).await.unwrap();
        assert!(matches!(conn.read_response().await.unwrap(), DaemonResponse::Pong));
        done_rx.await.unwrap();
    }

    #[tokio::test]
    async fn wait_for_ready_rejects_a_daemon_without_request_ids() {
        let (_tmp, sock) = temp_socket();
        let listener = UnixListener::bind(&sock).unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (_reader, mut writer) = stream.into_split();
            // An old daemon script: no protocol version.
            write_lines(&mut writer, &[r#"{"type":"ready"}"#]).await;
            tokio::time::sleep(Duration::from_secs(1)).await;
        });

        let mut conn = DaemonConnection::connect(&sock).await.unwrap();
        let err = conn.wait_for_ready().await.unwrap_err();
        assert!(
            matches!(err, InferenceError::ProtocolMismatch { daemon: 0, client: 2 }),
            "got {err:?}"
        );
    }
}
