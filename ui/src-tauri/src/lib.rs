mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Profile commands
            commands::list_profiles_cmd,
            commands::load_profile_cmd,
            commands::create_profile_cmd,
            commands::clone_profile_cmd,
            commands::diff_profiles_cmd,
            commands::add_mod_cmd,
            commands::add_resourcepack_cmd,
            commands::add_shaderpack_cmd,
            commands::remove_mod_cmd,
            commands::remove_resourcepack_cmd,
            commands::remove_shaderpack_cmd,
            commands::prepare_profile_cmd,
            commands::launch_profile_cmd,
            commands::instance_path_cmd,
            // Account commands
            commands::list_accounts_cmd,
            commands::set_active_account_cmd,
            commands::remove_account_cmd,
            commands::request_device_code_cmd,
            commands::finish_device_code_flow_cmd,
            // Account skin/cape commands
            commands::get_account_info_cmd,
            commands::upload_skin_cmd,
            commands::set_skin_url_cmd,
            commands::reset_skin_cmd,
            commands::set_cape_cmd,
            commands::hide_cape_cmd,
            // Config commands
            commands::get_config_cmd,
            commands::save_config_cmd,
            // Template commands
            commands::list_templates_cmd,
            commands::load_template_cmd,
            commands::create_profile_from_template_cmd,
            // Store commands
            commands::store_search_cmd,
            commands::store_get_project_cmd,
            commands::store_get_versions_cmd,
            commands::store_install_cmd,
            // Logs commands
            commands::list_log_files_cmd,
            commands::read_logs_cmd,
            commands::list_crash_reports_cmd,
            commands::read_crash_report_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
