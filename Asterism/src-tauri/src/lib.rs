use std::process::Command;

use serde::Serialize;

const POWERSHELL_UTF8_PREFIX: &str =
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding;";

#[derive(Serialize)]
struct RunningApp {
    name: String,
    path: String,
    title: String,
    #[serde(rename = "iconData")]
    icon_data: Option<String>,
}

#[tauri::command]
fn launch_target(target: String, kind: String) -> Result<(), String> {
    match kind.as_str() {
        "url" | "file" | "folder" | "scheme" => open::that(&target).map_err(|err| err.to_string()),
        "exe" => {
            let mut command = Command::new(&target);
            if let Some(parent) = std::path::Path::new(&target).parent() {
                command.current_dir(parent);
            }
            command.spawn().map_err(|err| err.to_string())?;
            Ok(())
        }
        "command" => {
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/C", "start", "", &target])
                    .spawn()
                    .map_err(|err| err.to_string())?;
            }

            #[cfg(not(target_os = "windows"))]
            {
                Command::new("sh")
                    .args(["-lc", &target])
                    .spawn()
                    .map_err(|err| err.to_string())?;
            }

            Ok(())
        }
        _ => Err(format!("Unsupported launch kind: {kind}")),
    }
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn executable_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Application")
        .to_string()
}

#[tauri::command]
fn extract_executable_icon(path: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let quoted_path = powershell_quote(&path);
        let script = format!(
            r#"
            {POWERSHELL_UTF8_PREFIX}
            Add-Type -AssemblyName System.Drawing
            $path = {quoted_path}
            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
            if ($null -eq $icon) {{ exit 0 }}
            $bitmap = $icon.ToBitmap()
            $stream = New-Object System.IO.MemoryStream
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            "data:image/png;base64," + [Convert]::ToBase64String($stream.ToArray())
            $stream.Dispose()
            $bitmap.Dispose()
            $icon.Dispose()
        "#
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|err| err.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Ok(String::new())
    }
}

#[tauri::command]
fn pick_executable() -> Result<Option<RunningApp>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"
            {POWERSHELL_UTF8_PREFIX}
            Add-Type -AssemblyName System.Windows.Forms
            $dialog = New-Object System.Windows.Forms.OpenFileDialog
            $dialog.Filter = "Applications (*.exe)|*.exe|All files (*.*)|*.*"
            $dialog.Title = "Choose an application executable"
            if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
              $dialog.FileName
            }}
        "#
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|err| err.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return Ok(None);
        }

        let icon_data = extract_executable_icon(path.clone()).ok().filter(|value| !value.is_empty());
        Ok(Some(RunningApp {
            name: executable_name(&path),
            path,
            title: "Chosen executable".to_string(),
            icon_data,
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn list_running_apps() -> Result<Vec<RunningApp>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"
            {POWERSHELL_UTF8_PREFIX}
            Get-Process |
              Where-Object {{ $_.MainWindowTitle -and $_.Path }} |
              Sort-Object ProcessName -Unique |
              ForEach-Object {{ "{{0}}`t{{1}}`t{{2}}" -f $_.ProcessName, $_.Path, $_.MainWindowTitle }}
        "#
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|err| err.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let apps = stdout
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(3, '\t');
                let name = parts.next()?.trim();
                let path = parts.next()?.trim();
                let title = parts.next().unwrap_or("").trim();
                if name.is_empty() || path.is_empty() {
                    return None;
                }

                Some(RunningApp {
                    name: name.to_string(),
                    path: path.to_string(),
                    title: title.to_string(),
                    icon_data: None,
                })
            })
            .collect();

        Ok(apps)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launch_target,
            list_running_apps,
            pick_executable,
            extract_executable_icon
        ])
        .run(tauri::generate_context!())
        .expect("error while running Asterism");
}
