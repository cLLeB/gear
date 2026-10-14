//! TLS handshake with a server to see its certificate chain. The chain is
//! checked against the bundled Mozilla roots, but the handshake goes ahead
//! when that check fails, so an expired, self-signed or mismatched
//! certificate can still be shown and explained. Nothing is sent after the
//! handshake.

use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::Serialize;

const TIMEOUT: Duration = Duration::from_secs(8);

/// Verifies like a browser would, records the verdict, and lets the handshake continue either way.
#[derive(Debug)]
struct Recorder {
    inner: Arc<WebPkiServerVerifier>,
    verdict: Mutex<Option<Result<(), String>>>,
}

impl ServerCertVerifier for Recorder {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let r = self
            .inner
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
            .map(|_| ())
            .map_err(|e| e.to_string());
        if let Ok(mut v) = self.verdict.lock() {
            *v = Some(r);
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

#[derive(Serialize, Debug)]
pub struct TlsReport {
    pub address: String,
    pub protocol: String,
    pub cipher: String,
    pub alpn: Option<String>,
    /// DER bytes of each certificate, leaf first, as the server sent them.
    pub chain: Vec<Vec<u8>>,
    pub trusted: bool,
    pub trust_error: Option<String>,
    pub connect_ms: f64,
    pub handshake_ms: f64,
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// Splits `host`, `host:port`, `[v6]:port` or a URL into host and port.
pub fn split_target(input: &str, default_port: u16) -> Result<(String, u16), String> {
    let mut s = input.trim();
    if let Some(rest) = s.split_once("://").map(|(_, r)| r) {
        s = rest;
    }
    let s = s.split(['/', '?', '#']).next().unwrap_or("");
    let s = s.rsplit_once('@').map(|(_, h)| h).unwrap_or(s);
    if s.is_empty() {
        return Err("Enter a host name, like example.com".into());
    }
    if let Some(rest) = s.strip_prefix('[') {
        let (host, after) = rest
            .split_once(']')
            .ok_or("Missing ] in the IPv6 address")?;
        let port = match after.strip_prefix(':') {
            Some(p) => p
                .parse()
                .map_err(|_| format!("“{p}” is not a port number"))?,
            None => default_port,
        };
        return Ok((host.to_string(), port));
    }
    match s.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => Ok((
            h.to_string(),
            p.parse()
                .map_err(|_| format!("“{p}” is not a port number"))?,
        )),
        _ => Ok((s.to_string(), default_port)),
    }
}

fn inspect(target: &str, sni: Option<&str>) -> Result<TlsReport, String> {
    let (host, port) = split_target(target, 443)?;
    let started = Instant::now();
    let addrs: Vec<SocketAddr> = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("Could not find {host}: {e}"))?
        .collect();
    let mut last_err = String::from("no address");
    let mut tcp = None;
    for a in &addrs {
        match TcpStream::connect_timeout(a, TIMEOUT) {
            Ok(s) => {
                tcp = Some((s, *a));
                break;
            }
            Err(e) => last_err = format!("{a}: {e}"),
        }
    }
    let (mut tcp, addr) =
        tcp.ok_or_else(|| format!("Could not connect to {host}:{port} ({last_err})"))?;
    let connect_ms = started.elapsed().as_secs_f64() * 1000.0;
    tcp.set_read_timeout(Some(TIMEOUT)).ok();
    tcp.set_write_timeout(Some(TIMEOUT)).ok();

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let inner = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider())
        .build()
        .map_err(|e| e.to_string())?;
    let recorder = Arc::new(Recorder {
        inner,
        verdict: Mutex::new(None),
    });
    let mut config = rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(recorder.clone())
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    let name = sni
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&host)
        .trim()
        .to_string();
    let server_name = ServerName::try_from(name.clone())
        .map_err(|_| format!("“{name}” is not a valid server name"))?;
    let mut conn =
        rustls::ClientConnection::new(Arc::new(config), server_name).map_err(|e| e.to_string())?;
    let hs = Instant::now();
    while conn.is_handshaking() {
        match conn.complete_io(&mut tcp) {
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {
                return Err(format!(
                    "{host}:{port} did not finish the TLS handshake in time — is it a TLS port?"
                ))
            }
            Err(e) => {
                return Err(match e.kind() {
                    ErrorKind::UnexpectedEof | ErrorKind::ConnectionReset => {
                        format!("{host}:{port} closed the connection during the TLS handshake — it may not speak TLS on this port")
                    }
                    _ => format!("TLS handshake failed: {e}"),
                })
            }
        }
    }
    let handshake_ms = hs.elapsed().as_secs_f64() * 1000.0;
    let chain = conn
        .peer_certificates()
        .map(|c| c.iter().map(|d| d.as_ref().to_vec()).collect())
        .unwrap_or_default();
    let protocol = conn
        .protocol_version()
        .map(|v| format!("{v:?}").replace("TLSv1_", "TLS 1."))
        .unwrap_or_default();
    let cipher = conn
        .negotiated_cipher_suite()
        .map(|c| format!("{:?}", c.suite()))
        .unwrap_or_default();
    let alpn = conn
        .alpn_protocol()
        .map(|p| String::from_utf8_lossy(p).into_owned());
    // Close politely; errors here do not matter.
    conn.send_close_notify();
    let _ = conn.complete_io(&mut tcp);
    let _ = tcp.flush();
    let mut sink = [0u8; 1];
    let _ = tcp.set_read_timeout(Some(Duration::from_millis(50)));
    let _ = tcp.read(&mut sink);

    let verdict = recorder.verdict.lock().ok().and_then(|v| v.clone());
    let (trusted, trust_error) = match verdict {
        Some(Ok(())) => (true, None),
        Some(Err(e)) => (false, Some(e)),
        None => (false, Some("The server sent no certificate".into())),
    };
    Ok(TlsReport {
        address: addr.to_string(),
        protocol,
        cipher,
        alpn,
        chain,
        trusted,
        trust_error,
        connect_ms,
        handshake_ms,
    })
}

#[tauri::command]
pub async fn tls_inspect(target: String, server_name: Option<String>) -> Result<TlsReport, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(&target, server_name.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_targets() {
        assert_eq!(
            split_target("example.com", 443).unwrap(),
            ("example.com".into(), 443)
        );
        assert_eq!(
            split_target("example.com:8443", 443).unwrap(),
            ("example.com".into(), 8443)
        );
        assert_eq!(
            split_target("https://user@example.com:444/path?q#x", 443).unwrap(),
            ("example.com".into(), 444)
        );
        assert_eq!(
            split_target("[::1]:9443", 443).unwrap(),
            ("::1".into(), 9443)
        );
        assert_eq!(split_target("[::1]", 443).unwrap(), ("::1".into(), 443));
        assert_eq!(split_target("::1", 443).unwrap(), ("::1".into(), 443));
        assert!(split_target("", 443).is_err());
        assert!(split_target("host:port", 443).is_err());
    }

    #[test]
    fn reports_a_closed_port_plainly() {
        // Port 9 (discard) on loopback is almost never open.
        let err = inspect("127.0.0.1:9", None).unwrap_err();
        assert!(
            err.contains("Could not connect") || err.contains("closed the connection"),
            "{err}"
        );
    }
}
