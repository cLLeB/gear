//! A small HTTP load test for servers under development: N requests at a fixed
//! concurrency, one timing per request. It only ever targets this machine or a
//! private network address, so it cannot be pointed at someone else's service.

use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;

const MAX_REQUESTS: u32 = 20_000;
const MAX_CONCURRENCY: u32 = 64;

static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug)]
pub struct Sample {
    /// Milliseconds from sending the request to the last byte of the body.
    pub ms: f64,
    /// 0 when the request failed before a status arrived.
    pub status: u16,
    pub bytes: u64,
    pub error: Option<String>,
    /// Milliseconds from the start of the run to the end of this request.
    pub at_ms: f64,
}

#[derive(Serialize)]
pub struct BenchResult {
    pub samples: Vec<Sample>,
    pub elapsed_ms: f64,
    pub cancelled: bool,
}

/// Loopback, RFC 1918 / link-local IPv4, and loopback / unique-local / link-local IPv6.
pub fn is_local_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return v4.is_loopback() || v4.is_private() || v4.is_link_local();
            }
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

/// Parses the target and refuses anything that does not resolve to a local address.
pub fn check_target(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("not a valid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("the URL must start with http:// or https://".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "the URL has no host".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(80);
    let addrs: Vec<IpAddr> = (host.trim_matches(['[', ']']), port)
        .to_socket_addrs()
        .map_err(|e| format!("could not resolve {host}: {e}"))?
        .map(|a| a.ip())
        .collect();
    if addrs.is_empty() {
        return Err(format!("could not resolve {host}"));
    }
    if !addrs.iter().all(|ip| is_local_address(*ip)) {
        return Err(format!(
            "{host} is not on this machine or a private network; the load test only runs against local servers"
        ));
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn http_bench(
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    total: u32,
    concurrency: u32,
    timeout_ms: Option<u64>,
) -> Result<BenchResult, String> {
    let target = {
        let url = url.clone();
        tauri::async_runtime::spawn_blocking(move || check_target(&url))
            .await
            .map_err(|e| e.to_string())??
    };
    let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("unknown method: {method}"))?;
    let total = total.clamp(1, MAX_REQUESTS);
    let concurrency = concurrency.clamp(1, MAX_CONCURRENCY);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(
            timeout_ms.unwrap_or(10_000).clamp(100, 120_000),
        ))
        .pool_max_idle_per_host(concurrency as usize)
        // A redirect could lead off the machine; report it as the response it is.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let headers = headers.unwrap_or_default();
    CANCEL.store(false, Ordering::SeqCst);
    let started = Instant::now();

    let one = |_: u32| {
        let client = client.clone();
        let target = target.clone();
        let method = method.clone();
        let headers = headers.clone();
        let body = body.clone();
        async move {
            if CANCEL.load(Ordering::SeqCst) {
                return None;
            }
            let mut req = client.request(method, target);
            for (k, v) in &headers {
                req = req.header(k, v);
            }
            if let Some(b) = body {
                req = req.body(b);
            }
            let t0 = Instant::now();
            let (status, bytes, error) = match req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    match resp.bytes().await {
                        Ok(b) => (status, b.len() as u64, None),
                        Err(e) => (status, 0, Some(e.to_string())),
                    }
                }
                Err(e) => (0, 0, Some(describe(&e))),
            };
            Some(Sample {
                ms: t0.elapsed().as_secs_f64() * 1000.0,
                status,
                bytes,
                error,
                at_ms: started.elapsed().as_secs_f64() * 1000.0,
            })
        }
    };
    let samples: Vec<Sample> = futures_util::stream::iter(0..total)
        .map(one)
        .buffer_unordered(concurrency as usize)
        .filter_map(|s| async move { s })
        .collect()
        .await;
    Ok(BenchResult {
        samples,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        cancelled: CANCEL.load(Ordering::SeqCst),
    })
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timed out".to_string()
    } else if e.is_connect() {
        "could not connect".to_string()
    } else {
        e.to_string()
    }
}

#[tauri::command]
pub fn http_bench_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_local_addresses() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.9",
            "192.168.1.20",
            "169.254.1.1",
            "::1",
            "fd12:3456::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(is_local_address(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "8.8.8.8",
            "172.32.0.1",
            "1.1.1.1",
            "2606:4700::1111",
            "::ffff:8.8.8.8",
        ] {
            assert!(!is_local_address(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn refuses_targets_that_are_not_local() {
        assert!(check_target("http://127.0.0.1:3000/health").is_ok());
        assert!(check_target("http://localhost:3000/").is_ok());
        assert!(check_target("http://[::1]:8080/").is_ok());
        assert!(check_target("http://8.8.8.8/")
            .unwrap_err()
            .contains("only runs against local servers"));
        assert!(check_target("ftp://127.0.0.1/").is_err());
        assert!(check_target("not a url").is_err());
    }
}
