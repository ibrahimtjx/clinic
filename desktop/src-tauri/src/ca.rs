//! Trusting the clinic's internal certificate authority on first launch (SPEC 2 Rules, 3.3).
//!
//! The root certificate is downloaded over plain HTTP (it cannot be checked yet), so its SHA-256
//! fingerprint is shown for the person installing to compare with the one on the server.

use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
pub struct CaInfo {
    pub pem: String,
    pub fingerprint: String,
}

fn der_of(pem: &str) -> Result<Vec<u8>, String> {
    let body: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    decode_b64(body.trim()).ok_or_else(|| "ca_invalid".to_string())
}

/// Minimal standard base64 decoder (avoids another dependency for one use).
fn decode_b64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' => continue,
            _ => return None,
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

pub fn fingerprint(pem: &str) -> Result<String, String> {
    let der = der_of(pem)?;
    let digest = Sha256::digest(&der);
    Ok(digest
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

pub async fn fetch(server: &str) -> Result<CaInfo, String> {
    let host = server.trim_start_matches("https://");
    let host = host.split(':').next().unwrap_or(host);
    let url = format!("http://{host}/ca.crt");
    let pem = reqwest::get(&url)
        .await
        .map_err(|_| "server_unreachable".to_string())?
        .error_for_status()
        .map_err(|_| "ca_not_found".to_string())?
        .text()
        .await
        .map_err(|_| "ca_invalid".to_string())?;
    if !pem.contains("BEGIN CERTIFICATE") {
        return Err("ca_invalid".into());
    }
    let fingerprint = fingerprint(&pem)?;
    Ok(CaInfo { pem, fingerprint })
}

/// Adds the certificate to the current user's trusted roots. Windows asks the user to confirm.
#[cfg(windows)]
pub fn trust(pem: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let path = std::env::temp_dir().join("clinic-ca.crt");
    std::fs::write(&path, pem).map_err(|e| e.to_string())?;
    let out = std::process::Command::new("certutil")
        .args(["-user", "-addstore", "Root"])
        .arg(&path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    if out.status.success() {
        Ok(())
    } else {
        Err("ca_not_trusted".into())
    }
}

#[cfg(not(windows))]
pub fn trust(_pem: &str) -> Result<(), String> {
    Err("unsupported_platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_and_fingerprint() {
        assert_eq!(decode_b64("aGVsbG8=").unwrap(), b"hello");
        let pem = "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----\n";
        // SHA-256("hello")
        assert!(fingerprint(pem)
            .unwrap()
            .starts_with("2C:F2:4D:BA:5F:B0:A3:0E"));
    }
}
