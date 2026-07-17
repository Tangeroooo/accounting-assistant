use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
};

const KEYRING_SERVICE: &str = "org.onnuri.accounting-assistant.clova";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentCopy {
    absolute_path: String,
    relative_path: String,
    original_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClovaStatus {
    configured: bool,
    invoke_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ClovaCredentials {
    invoke_url: String,
    secret: String,
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, "default").map_err(|error| error.to_string())
}

fn read_credentials() -> Result<Option<ClovaCredentials>, String> {
    let entry = credential_entry()?;
    match entry.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|error| format!("저장된 CLOVA 설정을 읽지 못했습니다: {error}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_project(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = target.with_extension("tmp");
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

fn clean_file_name(file_name: &str) -> String {
    file_name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => character,
        })
        .collect()
}

#[tauri::command]
fn copy_attachment(source_path: String, project_dir: String) -> Result<AttachmentCopy, String> {
    let source = PathBuf::from(&source_path);
    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "첨부파일 이름을 확인할 수 없습니다.".to_string())?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("receipt");
    let unique_name = format!(
        "{}-{}{}",
        clean_file_name(stem),
        uuid::Uuid::new_v4(),
        extension
    );
    let attachment_dir = PathBuf::from(&project_dir).join("attachments");
    fs::create_dir_all(&attachment_dir).map_err(|error| error.to_string())?;
    let target = attachment_dir.join(&unique_name);
    fs::copy(&source, &target).map_err(|error| error.to_string())?;
    Ok(AttachmentCopy {
        absolute_path: target.to_string_lossy().to_string(),
        relative_path: format!("attachments/{unique_name}"),
        original_name: original_name.to_string(),
    })
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(target, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_clova_config(invoke_url: String, secret: String) -> Result<(), String> {
    let credentials = ClovaCredentials {
        invoke_url: invoke_url.trim().to_string(),
        secret: secret.trim().to_string(),
    };
    if credentials.invoke_url.is_empty() || credentials.secret.is_empty() {
        return Err("Invoke URL과 Secret Key를 모두 입력해 주세요.".to_string());
    }
    let serialized = serde_json::to_string(&credentials).map_err(|error| error.to_string())?;
    credential_entry()?
        .set_password(&serialized)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_clova_config() -> Result<(), String> {
    let entry = credential_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn clova_status() -> Result<ClovaStatus, String> {
    let credentials = read_credentials()?;
    Ok(ClovaStatus {
        configured: credentials.is_some(),
        invoke_url: credentials.map(|value| value.invoke_url),
    })
}

#[tauri::command]
async fn clova_ocr(file_path: String) -> Result<serde_json::Value, String> {
    let credentials = read_credentials()?
        .ok_or_else(|| "CLOVA OCR 설정이 없어 오픈소스 OCR을 사용해야 합니다.".to_string())?;
    let path = Path::new(&file_path);
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let format = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    let request_id = uuid::Uuid::new_v4().to_string();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    let payload = json!({
        "version": "V2",
        "requestId": request_id,
        "timestamp": timestamp,
        "images": [{
            "format": format,
            "data": BASE64.encode(bytes),
            "name": "receipt"
        }]
    });
    let response = reqwest::Client::new()
        .post(credentials.invoke_url)
        .header("X-OCR-SECRET", credentials.secret)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("CLOVA OCR 연결에 실패했습니다: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("CLOVA OCR 응답을 읽지 못했습니다: {error}"))?;
    if !status.is_success() {
        return Err(format!("CLOVA OCR 오류({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|error| format!("CLOVA OCR 응답 형식 오류: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            copy_attachment,
            read_binary_file,
            write_binary_file,
            save_clova_config,
            clear_clova_config,
            clova_status,
            clova_ocr
        ])
        .run(tauri::generate_context!())
        .expect("error while running the accounting assistant");
}
