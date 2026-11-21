# Faz o .exe abrir sem a janela preta (muda o "subsistema" do .exe de Console para Janela).
# So mexe em 2 bytes do cabecalho do arquivo.
param([Parameter(Mandatory = $true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$caminho = (Resolve-Path $Exe).Path
$b = [IO.File]::ReadAllBytes($caminho)
$pe = [BitConverter]::ToInt32($b, 0x3C)
if ([Text.Encoding]::ASCII.GetString($b, $pe, 4) -ne "PE`0`0") { throw 'Isso nao parece um .exe valido.' }
$posicao = $pe + 24 + 68
$atual = [BitConverter]::ToUInt16($b, $posicao)
if ($atual -eq 2) { return }
if ($atual -ne 3) { throw "Subsistema inesperado ($atual)." }
$b[$posicao] = 2
$b[$posicao + 1] = 0
[IO.File]::WriteAllBytes($caminho, $b)
