# Publica uma versao nova do StreamBeats no GitHub (para a atualizacao automatica).
#
# Uso (no PowerShell, dentro desta pasta):
#   .\publicar-versao.ps1 -Versao 1.0.1 -Notas "Corrigi o volume"
#
# Precisa: o GitHub CLI (gh) instalado e logado (gh auth login),
# e o GITHUB_REPO preenchido no streambeats.js (ex.: 'seuusuario/StreamBeats-TwitchSongRequest').
param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [string]$Notas = ''
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Versao -notmatch '^\d+\.\d+\.\d+$') { throw 'A versao precisa ser no formato 1.2.3' }
$arquivo = Join-Path $PSScriptRoot 'streambeats.js'
$utf8 = New-Object Text.UTF8Encoding $false
$codigo = [IO.File]::ReadAllText($arquivo, $utf8) # sempre UTF-8, senao os acentos estragam
$repo = ([regex]::Match($codigo, "const GITHUB_REPO = '([^']*)'")).Groups[1].Value
if (-not $repo) { throw "Preencha o GITHUB_REPO no streambeats.js (ex.: 'seuusuario/StreamBeats-TwitchSongRequest')." }
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh -and (Test-Path 'C:\Program Files\GitHub CLI\gh.exe')) { $gh = 'C:\Program Files\GitHub CLI\gh.exe' }
if (-not $gh) { throw 'Instale o GitHub CLI (https://cli.github.com) e rode: gh auth login' }

Write-Host "Mudando a versao do app para $Versao..."
$codigo = [regex]::Replace($codigo, "const VERSAO = '[0-9.]+'", "const VERSAO = '$Versao'")
$ruim = [string][char]0xC3 + '[' + [char]0xA0 + '-' + [char]0xBF + ']|' + [char]0xE2 + [char]0x20AC
if ($codigo -match $ruim) { throw 'Os acentos do streambeats.js parecem estragados. Nada foi publicado.' }
[IO.File]::WriteAllText($arquivo, $codigo, $utf8)

& (Join-Path $PSScriptRoot 'gerar-exe.ps1')

$origem = Join-Path $PSScriptRoot 'dist\StreamBeats - TwitchSongRequest.exe'
$envio = Join-Path $PSScriptRoot 'dist\StreamBeats-TwitchSongRequest.exe'
Copy-Item $origem $envio -Force
$hash = (Get-FileHash $envio -Algorithm SHA256).Hash.ToLower()
$sha = "$envio.sha256"
[IO.File]::WriteAllText($sha, "$hash  StreamBeats-TwitchSongRequest.exe`n")

Write-Host "Publicando v$Versao em $repo..."
if (-not $Notas) { $Notas = "StreamBeats v$Versao" }
& $gh release create "v$Versao" $envio $sha --repo $repo --title "StreamBeats v$Versao" --notes $Notas
if ($LASTEXITCODE -ne 0) { throw 'O gh nao conseguiu publicar a versao.' }
Write-Host ''
Write-Host "Pronto! Quem tem o StreamBeats vai ver o aviso de atualizacao para a v$Versao."
