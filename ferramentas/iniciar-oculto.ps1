# Abre o StreamBeats (versao com Node.js) sem a janela preta.
$pasta = Split-Path $PSScriptRoot -Parent
$script = Join-Path $pasta 'streambeats.js'
Start-Process -FilePath 'node' -ArgumentList @(('"' + $script + '"'), '--oculto') -WorkingDirectory $pasta -WindowStyle Hidden
