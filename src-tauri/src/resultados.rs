//! Onde os resultados sao gravados, e o que se apaga sozinho.
//!
//! Tudo vai para `Downloads/PDF.GreenCodes`. Downloads porque e onde a pessoa
//! ja procura arquivo baixado; a subpasta porque a auto-exclusao varre por
//! tempo, e varrer a raiz de Downloads seria apagar coisa que nao e nossa.
//!
//! A auto-exclusao e opcional e por arquivo: quem marcou entra num registro
//! com a hora de morrer, e uma varredura periodica apaga o que passou do
//! prazo. O que nao foi marcado fica para sempre - e arquivo da pessoa, no
//! computador dela.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const UM_DIA: u64 = 24 * 60 * 60 * 1000;
const INTERVALO_DA_VARREDURA: Duration = Duration::from_secs(60 * 60);

#[derive(Serialize, Deserialize, Clone)]
struct Marcado {
    caminho: String,
    #[serde(rename = "apagarEm")]
    apagar_em: u64,
}

fn agora() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A pasta dos resultados, criada se ainda nao existir.
pub fn pasta(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| format!("nao achei a pasta de downloads: {e}"))?;
    let pasta = base.join("PDF.GreenCodes");
    fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    Ok(pasta)
}

fn registro(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("nao achei a pasta de dados: {e}"))?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join("auto-exclusao.json"))
}

/// Registro ausente ou estragado e o mesmo que registro vazio: nada para
/// apagar e sempre a resposta segura.
fn ler(app: &AppHandle) -> Vec<Marcado> {
    let Ok(arquivo) = registro(app) else {
        return Vec::new();
    };
    let Ok(texto) = fs::read_to_string(arquivo) else {
        return Vec::new();
    };
    serde_json::from_str(&texto).unwrap_or_default()
}

fn gravar(app: &AppHandle, itens: &[Marcado]) -> Result<(), String> {
    let arquivo = registro(app)?;
    let texto = serde_json::to_string_pretty(itens).map_err(|e| e.to_string())?;
    fs::write(arquivo, texto).map_err(|e| e.to_string())
}

/// Grava com o primeiro numero livre: 1.pdf, 2.pdf, 3.pdf.
///
/// Sem dialogo e sem sobrescrever nada. Quem processa varios documentos
/// seguidos nao quer decidir nome e pasta a cada um.
pub fn salvar(
    app: &AppHandle,
    nome: &str,
    bytes: &[u8],
    apagar_em_1_dia: bool,
) -> Result<PathBuf, String> {
    let pasta = pasta(app)?;
    let extensao = Path::new(nome)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_else(|| ".pdf".into());

    let mut numero = 1u32;
    let destino = loop {
        let tentativa = pasta.join(format!("{numero}{extensao}"));
        if !tentativa.exists() {
            break tentativa;
        }
        numero += 1;
        if numero > 1_000_000 {
            return Err("a pasta de resultados esta cheia demais".into());
        }
    };

    crate::arquivos::gravar(&destino, bytes)?;
    if apagar_em_1_dia {
        marcar(app, &destino.to_string_lossy())?;
    }
    Ok(destino)
}

pub fn marcar(app: &AppHandle, caminho: &str) -> Result<(), String> {
    let mut itens: Vec<Marcado> = ler(app)
        .into_iter()
        .filter(|item| item.caminho != caminho)
        .collect();
    itens.push(Marcado {
        caminho: caminho.to_string(),
        apagar_em: agora() + UM_DIA,
    });
    gravar(app, &itens)
}

/// Tira a marca sem apagar o arquivo.
pub fn manter(app: &AppHandle, caminho: &str) -> Result<(), String> {
    let itens: Vec<Marcado> = ler(app)
        .into_iter()
        .filter(|item| item.caminho != caminho)
        .collect();
    gravar(app, &itens)
}

/// Apaga o que passou do prazo e limpa o registro.
///
/// Some do registro tambem o que ja nao existe - arquivo que a pessoa moveu
/// ou apagou a mao nao deveria ficar sendo procurado para sempre.
pub fn varrer(app: &AppHandle) -> (usize, usize) {
    let itens = ler(app);
    if itens.is_empty() {
        return (0, 0);
    }
    let Ok(nossa) = pasta(app) else {
        return (0, itens.len());
    };

    let mut ficam = Vec::new();
    let mut apagados = 0usize;
    let agora = agora();

    for item in itens {
        // So mexe no que esta dentro da nossa pasta: uma entrada estragada
        // nao pode virar permissao para apagar arquivo em outro lugar.
        let alvo = PathBuf::from(&item.caminho);
        if !alvo.starts_with(&nossa) {
            continue;
        }

        if agora < item.apagar_em {
            if alvo.exists() {
                ficam.push(item);
            }
            continue;
        }

        // Arquivo aberto em outro programa nao apaga agora; fica para a
        // proxima varredura em vez de sumir do registro sem ter sido apagado.
        match fs::remove_file(&alvo) {
            Ok(()) => apagados += 1,
            Err(_) if !alvo.exists() => {}
            Err(_) => ficam.push(item),
        }
    }

    let restantes = ficam.len();
    let _ = gravar(app, &ficam);
    (apagados, restantes)
}

/// Varre agora e de hora em hora enquanto o aplicativo estiver aberto.
pub fn iniciar_varredura(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        varrer(&app);
        std::thread::sleep(INTERVALO_DA_VARREDURA);
    });
}
