param(
  [Parameter(Mandatory = $true)][string]$Origem,
  [Parameter(Mandatory = $true)][string]$Destino
)

$ErrorActionPreference = 'Stop'
$word = $null
$documento = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $documento = $word.Documents.Open($Origem, $false, $true, $false)
  $documento.ExportAsFixedFormat($Destino, 17)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $documento) {
    $documento.Close(0)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($documento)
  }
  if ($null -ne $word) {
    $word.Quit(0)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
  }
}
