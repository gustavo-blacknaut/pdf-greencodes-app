use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::{abrir_pasta_dos_resultados, mostrar_janela, sistema};

pub fn montar(app: &AppHandle) -> tauri::Result<()> {
    let nome = &app.config().product_name.clone().unwrap_or_else(|| "PDF.GreenCodes".into());
    let abrir = MenuItem::with_id(app, "abrir", format!("Abrir {nome}"), true, None::<&str>)?;
    let pasta = MenuItem::with_id(app, "pasta", "Abrir a pasta Downloads", true, None::<&str>)?;
    let inicio = CheckMenuItem::with_id(app, "inicio", "Iniciar com Windows", false, false, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &pasta, &inicio, &sair])?;
    let consulta = inicio.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = consulta.set_checked(sistema::inicio_ativo());
        let _ = consulta.set_enabled(true);
    });

    let mut construtor = TrayIconBuilder::with_id("principal")
        .tooltip(nome)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, evento| match evento.id().as_ref() {
            "abrir" => mostrar_janela(app),
            "pasta" => { abrir_pasta_dos_resultados(app.clone()); }
            "inicio" => {
                let item = inicio.clone();
                let app = app.clone();
                let _ = item.set_enabled(false);
                tauri::async_runtime::spawn_blocking(move || {
                    let ligado = !sistema::inicio_ativo();
                    let sucesso = sistema::definir_inicio(ligado);
                    let _ = item.set_checked(sistema::inicio_ativo());
                    let _ = item.set_enabled(true);
                    if !sucesso {
                        app.dialog().message("Não foi possível alterar a inicialização com o Windows. Tente novamente.").title("Iniciar com Windows").show(|_| {});
                    }
                });
            }
            "sair" => app.exit(0),
            _ => {}
        });
    if let Some(icone) = app.default_window_icon() {
        construtor = construtor.icon(icone.clone());
    }
    construtor.build(app)?;
    Ok(())
}
