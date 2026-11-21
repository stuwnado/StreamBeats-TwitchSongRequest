# Gera o dist\StreamBeats - TwitchSongRequest.exe usando o Node.js oficial (nodejs.org).
# Baixa o Node uma vez, confere a assinatura SHA-256 oficial e monta o .exe:
# com o icone, o nome certo no Windows e sem a janela preta.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$versao = 'v26.13.1'
$pasta = Join-Path $env:TEMP "streambeats-node-$versao"
$zip = Join-Path $pasta 'node.zip'
$nodeExe = Join-Path $pasta "node-$versao-win-x64\node.exe"

if (-not (Test-Path $nodeExe)) {
  New-Item -ItemType Directory -Force $pasta | Out-Null
  Write-Host "Baixando o Node.js $versao oficial de nodejs.org (uns 30 MB)..."
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest "https://nodejs.org/dist/$versao/node-$versao-win-x64.zip" -OutFile $zip -UseBasicParsing
  Invoke-WebRequest "https://nodejs.org/dist/$versao/SHASUMS256.txt" -OutFile (Join-Path $pasta 'SHASUMS256.txt') -UseBasicParsing
  $linha = Select-String -Path (Join-Path $pasta 'SHASUMS256.txt') -Pattern "node-$versao-win-x64.zip"
  $esperado = ($linha.Line -split '\s+')[0]
  $real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($esperado -ne $real) {
    Remove-Item $zip -Force
    throw 'O arquivo baixado NAO confere com a assinatura oficial. Por seguranca, nao vou usar.'
  }
  Write-Host 'Assinatura oficial conferida.'
  Expand-Archive $zip $pasta -Force
}

$nome = 'StreamBeats - TwitchSongRequest'
$exe = Join-Path $PSScriptRoot "dist\$nome.exe"
$codigoApp = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'streambeats.js'), (New-Object Text.UTF8Encoding $false))
$ruim = [string][char]0xC3 + '[' + [char]0xA0 + '-' + [char]0xBF + ']|' + [char]0xE2 + [char]0x20AC
if ($codigoApp -match $ruim) { throw 'Os acentos do streambeats.js parecem estragados. O .exe nao foi gerado.' }
$versaoApp = ([regex]::Match($codigoApp, "const VERSAO = '([0-9.]+)'")).Groups[1].Value
if (-not $versaoApp) { $versaoApp = '1.0.0' }

function Test-Programa {
  # Abre o .exe em modo de teste: ele so confere os arquivos, escreve "AUTOTESTE OK" num arquivo e fecha.
  $marca = Join-Path $env:TEMP ("streambeats-teste-" + [guid]::NewGuid() + '.txt')
  $psi = New-Object System.Diagnostics.ProcessStartInfo $exe
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['STREAMBEATS_AUTOTESTE'] = '1'
  $psi.EnvironmentVariables['STREAMBEATS_AUTOTESTE_ARQ'] = $marca
  $p = [System.Diagnostics.Process]::Start($psi)
  if (-not $p.WaitForExit(30000)) { $p.Kill(); return $false }
  $ok = (Test-Path $marca) -and ((Get-Content $marca -Raw) -match 'AUTOTESTE OK')
  Remove-Item $marca -Force -ErrorAction SilentlyContinue
  return $ok
}
function New-Programa {
  New-Item -ItemType Directory -Force 'dist' | Out-Null
  if (Test-Path $exe) { Remove-Item $exe -Force }
  & $nodeExe --build-sea sea-config.json
  if ($LASTEXITCODE -ne 0 -or -not (Test-Programa)) { throw 'Nao consegui gerar o .exe.' }
}

Write-Host "Gerando o $nome.exe (versao $versaoApp)..."
New-Programa

Write-Host 'Colocando o icone e o nome do app no .exe...'
try {
  & (Join-Path $PSScriptRoot 'ferramentas\icone-exe.ps1') -Exe $exe -Ico (Join-Path $PSScriptRoot 'assets\streambeats.ico') -Nome $nome -Versao $versaoApp
  if (-not (Test-Programa)) { throw 'o .exe com icone nao passou no teste' }
  Write-Host 'Icone colocado.'
} catch {
  Write-Warning "Nao consegui colocar o icone ($_). Vou gerar o .exe sem icone, ele funciona igual."
  New-Programa
}

Write-Host 'Tirando a janela preta...'
$copia = "$exe.copia"
Copy-Item $exe $copia -Force
try {
  & (Join-Path $PSScriptRoot 'ferramentas\janela-oculta.ps1') -Exe $exe
  if (-not (Test-Programa)) { throw 'o .exe sem janela nao passou no teste' }
  Remove-Item $copia -Force
  Write-Host 'Pronto: o app abre so com o painel.'
} catch {
  Move-Item $copia $exe -Force
  Write-Warning "Nao consegui tirar a janela preta ($_). O .exe funciona igual, so com a janela preta."
}
Write-Host ''
Write-Host "Pronto! O app esta em: $PSScriptRoot\dist\$nome.exe"
