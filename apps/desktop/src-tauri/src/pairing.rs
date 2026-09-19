//! Serving this machine's engine to a phone on the same network.
//!
//! The phone already knows how to talk to a Herald engine over HTTP, and this
//! machine already has one — it just happens to be running in the webview
//! rather than on a server. So rather than reimplement any of it in Rust, this
//! listens on the network and forwards each request to the webview, which
//! answers with the very same `LocalBackend` the desktop UI uses.
//!
//! That keeps one implementation of what a match is and how it is scored. The
//! alternative — a second copy of the logic here in Rust, or a merge protocol
//! between two independent databases — would mean two things that could
//! disagree about the same job.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// A request waiting for the webview to answer it.
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<BridgeReply>>>>;

/// How long to wait before deciding the webview is not going to answer.
/// Longer than any honest request; short enough that a phone gives up too.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct ServerState {
    app: AppHandle,
    pending: Pending,
    token: String,
}

/// Forwarded to the webview. Mirrors the shape of an HTTP request closely
/// enough that the TypeScript side can route it like one.
#[derive(Clone, Serialize)]
struct BridgeRequest {
    id: String,
    method: String,
    path: String,
    query: String,
    body: String,
}

/// What the webview sends back.
#[derive(Clone, Debug, Deserialize)]
pub struct BridgeReply {
    pub id: String,
    pub status: u16,
    pub body: String,
}

#[derive(Default)]
pub struct PairingState {
    inner: Mutex<Option<RunningServer>>,
}

struct RunningServer {
    token: String,
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Serialize)]
pub struct PairingInfo {
    /// What the phone should be pointed at.
    pub base_url: String,
    pub token: String,
    pub port: u16,
}

/// Starts serving, returning what the phone needs to connect.
#[tauri::command]
pub async fn start_pairing(
    app: AppHandle,
    state: tauri::State<'_, PairingState>,
    port: Option<u16>,
    token: String,
) -> Result<PairingInfo, String> {
    // Already running is not an error; hand back the details it is running with.
    {
        let running = state.inner.lock().map_err(|_| "pairing state is poisoned")?;
        if let Some(server) = running.as_ref() {
            return Ok(PairingInfo {
                base_url: local_address(server.port),
                token: server.token.clone(),
                port: server.port,
            });
        }
    }

    let port = port.unwrap_or(8787);
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let shared = ServerState { app: app.clone(), pending: pending.clone(), token: token.clone() };

    let router = axum::Router::new()
        .fallback(handle)
        .with_state(shared);

    // 0.0.0.0 rather than localhost: the whole point is that another device on
    // the network can reach it.
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|error| format!("Could not listen on port {port}: {error}"))?;

    let bound = listener.local_addr().map(|addr| addr.port()).unwrap_or(port);
    let (tx, rx) = oneshot::channel::<()>();

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async { let _ = rx.await; })
            .await;
    });

    {
        let mut running = state.inner.lock().map_err(|_| "pairing state is poisoned")?;
        *running = Some(RunningServer { token: token.clone(), port: bound, shutdown: Some(tx) });
    }

    app.manage_pending(pending);
    Ok(PairingInfo { base_url: local_address(bound), token, port: bound })
}

#[tauri::command]
pub fn stop_pairing(state: tauri::State<'_, PairingState>) -> Result<(), String> {
    let mut running = state.inner.lock().map_err(|_| "pairing state is poisoned")?;
    if let Some(mut server) = running.take() {
        if let Some(shutdown) = server.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pairing_status(state: tauri::State<'_, PairingState>) -> Option<PairingInfo> {
    let running = state.inner.lock().ok()?;
    running.as_ref().map(|server| PairingInfo {
        base_url: local_address(server.port),
        token: server.token.clone(),
        port: server.port,
    })
}

/// The webview answering a request it was handed.
#[tauri::command]
pub fn pairing_reply(
    app: AppHandle,
    reply: BridgeReply,
) -> Result<(), String> {
    let pending = app
        .try_state::<Pending>()
        .ok_or("pairing is not running")?;
    let sender = pending
        .lock()
        .map_err(|_| "pairing state is poisoned")?
        .remove(&reply.id);

    match sender {
        // A reply for a request that already timed out is not worth an error.
        None => Ok(()),
        Some(sender) => sender.send(reply).map_err(|_| "nobody was waiting".into()),
    }
}

async fn handle(State(state): State<ServerState>, request: Request) -> Response {
    let (parts, body) = request.into_parts();

    if !authorized(&parts.headers, &state.token) {
        return (StatusCode::UNAUTHORIZED, r#"{"code":"unauthorized"}"#).into_response();
    }

    let bytes = match axum::body::to_bytes(body, 8 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, r#"{"code":"too_large"}"#).into_response(),
    };

    let id = uuid();
    let (tx, rx) = oneshot::channel::<BridgeReply>();
    {
        let mut pending = match state.pending.lock() {
            Ok(pending) => pending,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        pending.insert(id.clone(), tx);
    }

    let forwarded = BridgeRequest {
        id: id.clone(),
        method: parts.method.to_string(),
        path: parts.uri.path().to_string(),
        query: parts.uri.query().unwrap_or_default().to_string(),
        body: String::from_utf8_lossy(&Bytes::from(bytes)).to_string(),
    };

    if state.app.emit("herald://pairing-request", forwarded).is_err() {
        state.pending.lock().ok().map(|mut pending| pending.remove(&id));
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
        Ok(Ok(reply)) => (
            StatusCode::from_u16(reply.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            [("content-type", "application/json")],
            reply.body,
        )
            .into_response(),
        // Either the webview never answered or it went away mid-request.
        _ => {
            state.pending.lock().ok().map(|mut pending| pending.remove(&id));
            (StatusCode::GATEWAY_TIMEOUT, r#"{"code":"no_reply"}"#).into_response()
        }
    }
}

fn authorized(headers: &HeaderMap, expected: &str) -> bool {
    // Health is the one thing the phone asks before it has been given a token,
    // so pairing can be verified without one.
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| constant_time_eq(value.as_bytes(), expected.as_bytes()))
        .unwrap_or(false)
}

/// Compares without leaking where two tokens first differ.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn local_address(port: u16) -> String {
    // The address the phone should use is whichever of this machine's addresses
    // is reachable from its network, which only the network knows. The webview
    // shows this alongside the machine's own addresses so the user can pick.
    format!("http://0.0.0.0:{port}")
}

fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    // Correlating a request with its reply only needs to be unique within this
    // process, not unguessable.
    format!("{nanos:x}-{:x}", std::process::id())
}

/// Lets the reply command find the same map the server is using.
trait ManagePending {
    fn manage_pending(&self, pending: Pending);
}

impl ManagePending for AppHandle {
    fn manage_pending(&self, pending: Pending) {
        if self.try_state::<Pending>().is_none() {
            self.manage(pending);
        }
    }
}
