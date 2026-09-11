; Ganchos do instalador do Tauri.
;
; Tira a versao antiga, feita em Electron, antes de instalar esta. As duas
; moram em pastas diferentes, entao sem isto a maquina da loja ficava com dois
; "PDF.GreenCodes" instalados, dois atalhos e o menu do botao direito
; apontando para o velho.
;
; A chave e a mesma em toda maquina: o electron-builder gera o identificador
; a partir do appId (br.com.greencodes.pdf), e nao ao acaso.

!define CHAVE_DO_ELECTRON "Software\Microsoft\Windows\CurrentVersion\Uninstall\471b61d6-db8f-5de8-aa78-e3633a94fece"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "${CHAVE_DO_ELECTRON}" "QuietUninstallString"
  ${If} $0 != ""
    DetailPrint "Removendo a versao antiga do PDF.GreenCodes (Electron)..."
    ExecWait '$0'
    ; O desinstalador do NSIS se copia para a pasta temporaria e devolve na
    ; hora. Esperar um tempo fixo nao bastava: numa maquina lenta ele ainda
    ; estava apagando quando os atalhos novos nasciam - e os atalhos tem o
    ; mesmo nome, entao ele levava os novos junto. A chave de desinstalacao
    ; e a ultima coisa que ele apaga: quando ela some, ele terminou.
    StrCpy $1 0
    ${Do}
      Sleep 500
      IntOp $1 $1 + 1
      ReadRegStr $0 HKCU "${CHAVE_DO_ELECTRON}" "UninstallString"
      ${IfThen} $1 >= 240 ${|} ${ExitDo} ${|}
    ${LoopUntil} $0 == ""
    DetailPrint "Versao antiga removida."
  ${EndIf}
!macroend
