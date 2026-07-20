use serde::Serialize;
use std::{fs, path::PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentCopy {
    absolute_path: String,
    relative_path: String,
    original_name: String,
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

#[tauri::command]
fn prepare_project_workspace(package_path: String) -> Result<String, String> {
    let package = PathBuf::from(package_path);
    let parent = package
        .parent()
        .ok_or_else(|| "프로젝트 파일의 상위 폴더를 찾을 수 없습니다.".to_string())?;
    let stem = package
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("project");
    let workspace = parent.join(format!(".{}-barun-work", clean_file_name(stem)));
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    Ok(workspace.to_string_lossy().to_string())
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
fn delete_file_if_exists(path: String) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            prepare_project_workspace,
            copy_attachment,
            read_binary_file,
            write_binary_file,
            delete_file_if_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running the accounting assistant");
}
