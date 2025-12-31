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
            commands::delete_profile_cmd,
            commands::rename_profile_cmd,
            commands::update_profile_version_cmd,
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
            commands::apply_library_skin_cmd,
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
            commands::read_crash_report_cmd,
            commands::start_log_watch,
            // Version fetching commands
            commands::fetch_minecraft_versions_cmd,
            commands::fetch_fabric_versions_cmd,
            // Java detection commands
            commands::detect_java_installations_cmd,
            commands::validate_java_path_cmd,
            commands::get_required_java_version_cmd,
            commands::check_java_compatibility_cmd,
            // Library commands
            commands::library_list_items_cmd,
            commands::library_get_item_cmd,
            commands::library_get_item_by_hash_cmd,
            commands::library_add_item_cmd,
            commands::library_update_item_cmd,
            commands::library_delete_item_cmd,
            commands::library_get_item_path_cmd,
            commands::library_import_file_cmd,
            commands::library_import_folder_cmd,
            commands::library_get_stats_cmd,
            commands::library_sync_cmd,
            commands::library_list_tags_cmd,
            commands::library_create_tag_cmd,
            commands::library_delete_tag_cmd,
            commands::library_set_item_tags_cmd,
            commands::library_add_to_profile_cmd,
            // Settings and storage commands
            commands::get_data_path_cmd,
            commands::get_storage_stats_cmd,
            commands::get_auto_update_enabled_cmd,
            commands::set_auto_update_enabled_cmd,
            // Update checking commands
            commands::check_all_updates_cmd,
            commands::check_profile_updates_cmd,
            commands::apply_content_update_cmd,
            commands::set_content_pinned_cmd,
            commands::set_content_enabled_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
