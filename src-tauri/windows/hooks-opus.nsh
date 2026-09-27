!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OPUS"
    DeleteRegKey HKCU "Software\OPUS"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\OpusPdfAbrir"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\OpusPdfJuntar"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\OpusPdfImagem"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\OpusPdfImagem"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\OpusPdfImagem"
  ${EndIf}
!macroend
