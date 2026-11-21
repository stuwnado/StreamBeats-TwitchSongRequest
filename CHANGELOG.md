# Histórico de versões

## v1.0.1 (2026-11-21)

Painel mais compacto.

- Topo numa linha só: Spotify e chat viram bolinhas de status, e o texto aparece ao passar o mouse.
- As abas ficam presas no topo quando você rola a tela.
- Moderação e Configurar voltam a mostrar tudo aberto. Só o quadro de Sincronização continua minimizável.
- A janela do painel abre no tamanho 640 × 820.
- Os scripts de build sempre leem o código em UTF-8, pra não estragar os acentos.

## v1.0.0 (2026-11-21)

Primeira versão pública.

- Pedidos de música do chat da Twitch (`!sr`) direto no Spotify, com fila própria: arrastar, topo, tocar agora, tirar da fila.
- Aprovação manual de pedidos, bandeira vermelha, banir/desbanir, bloqueios, limites por pessoa e mais pedidos pra subs e VIPs.
- Busca tolerante a erro de digitação, que recusa texto sem sentido e links que não são de música.
- Comandos `!song`, `!fila`, `!wrongsong`, `!voteskip`, volume pelo chat, `!furarfila` e `!earrape`.
- Pontos do canal criados e controlados pelo app, com devolução automática dos pontos quando o pedido falha.
- Overlay pro OBS, histórico da live e criação de playlist no Spotify.
- Painel sem janela preta, que reconecta sozinho, e fila salva em disco.
- Atualização automática pelos Releases do GitHub, com conferência SHA-256.
