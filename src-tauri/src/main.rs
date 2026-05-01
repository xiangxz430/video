// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // 在一切初始化之前设置 no_proxy，确保 reqwest 创建 client 时绕过系统代理
  std::env::set_var("NO_PROXY", "*");
  std::env::set_var("no_proxy", "*");

  app_lib::run();
}
