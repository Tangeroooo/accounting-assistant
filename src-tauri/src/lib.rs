use serde::Serialize;
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

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
    write_bytes_atomically(&target, content.as_bytes())
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

#[cfg(not(windows))]
fn replace_file(temporary: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(windows)]
fn replace_file(temporary: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let source = temporary
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn write_bytes_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "저장할 파일의 상위 폴더를 찾을 수 없습니다.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("barun-project");
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        clean_file_name(file_name),
        uuid::Uuid::new_v4()
    ));

    let result = (|| -> std::io::Result<()> {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        replace_file(&temporary, target)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

fn update_backup_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "프로젝트 파일의 상위 폴더를 찾을 수 없습니다.".to_string())?;
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("회계프로젝트");
    Ok(parent.join(format!("{}-업데이트전-백업.barun", clean_file_name(stem))))
}

#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(path);
    write_bytes_atomically(&target, &bytes)
}

#[tauri::command]
fn backup_project_file(path: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    let backup = update_backup_path(&target)?;
    let bytes = fs::read(&target).map_err(|error| error.to_string())?;
    write_bytes_atomically(&backup, &bytes)?;
    Ok(backup.to_string_lossy().to_string())
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            prepare_project_workspace,
            copy_attachment,
            read_binary_file,
            write_binary_file,
            backup_project_file,
            delete_file_if_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running the accounting assistant");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_complete_file_and_creates_update_backup() {
        let directory =
            std::env::temp_dir().join(format!("barun-save-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let project = directory.join("테스트.barun");

        write_bytes_atomically(&project, b"first").unwrap();
        write_bytes_atomically(&project, b"second-project").unwrap();
        assert_eq!(fs::read(&project).unwrap(), b"second-project");

        let backup = backup_project_file(project.to_string_lossy().to_string()).unwrap();
        assert_eq!(fs::read(backup).unwrap(), b"second-project");

        fs::remove_dir_all(directory).unwrap();
    }
}
