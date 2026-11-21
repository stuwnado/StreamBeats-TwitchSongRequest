# StreamBeats - TwitchSongRequest

O chat digita `!sr dynamite - BTS` e a música entra na fila do Spotify do streamer.
Roda no PC dele, de graça, sem limite de pedidos e sem mandar dados para sites de terceiros.

**O que o app faz:**
- **Fila própria:** arrastar pra reordenar, furar fila, tocar na hora, tirar da fila de verdade.
- **Aprovação manual** de pedidos (opcional).
- **Moderação:**
  - bandeira vermelha pra músicas suspeitas
  - pular e banir separados
  - lista de músicas banidas e bloqueios
  - limites por pessoa (com mais pedidos pra subs e VIPs)
- **Busca esperta:** aceita erro de digitação, mas recusa texto sem sentido, emoji solto e link de playlist ou álbum.
- **Comandos de chat:** `!voteskip`, volume (`!volume`, `!vol+`, `!vol-`), `!furarfila` e `!earrape`, cada um com quem pode usar e tempo de espera.
- **Pontos do canal:** o app cria as recompensas na Twitch (Pedir música, Furar fila, Earrape), liga e desliga cada uma e **devolve os pontos sozinho** quando um pedido falha.
- **Overlay pro OBS**, com capa, nome, barra de tempo, quem pediu e as próximas músicas.
- **Controles do Spotify no painel:** voltar, play/pausa, pular e volume.
- **Histórico da live**, com botão pra criar uma playlist no Spotify com tudo que tocou.
- A fila fica **salva no PC**, e o app roda **sem janela preta**.
- **Atualização pelo GitHub** com um clique (depois de configurada).

## O que precisa

- **Spotify Premium.** É uma regra do próprio Spotify: só conta Premium pode adicionar músicas na fila por um app.
- **Windows 10 ou 11.**

## Gerar o app (.exe)

1. Dê dois cliques em **`gerar-exe.bat`**.
2. Ele baixa o Node.js oficial do site nodejs.org (uns 30 MB) e confere a assinatura oficial do arquivo.
3. Depois cria **`dist\StreamBeats - TwitchSongRequest.exe`**, já com o ícone, o nome certo no Windows e **sem a janela preta**. Tudo isso é feito por scripts da pasta `ferramentas`, que usam só funções do próprio Windows.
4. Esse `.exe` é o app inteiro. Coloque ele numa pasta própria, porque ele cria os arquivos de configuração do lado.

> O .exe é grande (uns 80 a 100 MB) porque leva o Node.js dentro. Assim ninguém precisa instalar nada.
> Como o app não tem "assinatura digital" (custa caro), na primeira vez o Windows pode mostrar
> "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**.

**Alternativa sem .exe:** com o Node.js instalado (nodejs.org, versão LTS), dê dois cliques em `iniciar.bat`.
O `iniciar-com-janela.bat` faz o mesmo, mas mostra a janela preta com tudo que acontece. É bom pra achar problemas.

## Primeira vez usando (5 minutos)

Abra o app. Aparece só o **painel**, já na aba **Configurar**, com o quadro **Sincronização** em destaque:

1. **Conectar o Spotify (obrigatório):** crie um app grátis em developer.spotify.com. O painel mostra o passo a passo e o endereço exato pra colar (é só clicar nele pra copiar).
2. **Canal da Twitch (obrigatório):** escreva o nome do canal.
3. **Entrar na Twitch (recomendado):** serve pro bot responder no chat. Entrando com **a conta do canal**, também libera os pontos do canal.

Tudo salva sozinho. Depois de sincronizado, o quadro vira uma linha só.

**Antes da live:** abra o Spotify e dê play numa playlist. Quando os pedidos acabam, o Spotify volta pra ela sozinho.

- **Fechar o painel não desliga o app.** Os pedidos continuam funcionando. Pra ver o painel de novo, abra o app outra vez.
- **Para desligar de verdade:** botão **Desligar**, no topo do painel.

## Como a fila funciona

O Spotify não deixa um app mexer na fila dele. Por isso o StreamBeats guarda a fila com ele e manda **uma música por vez** pro Spotify, uns 15 segundos antes da atual acabar. A que já foi mandada aparece como **"a seguir no Spotify"**.

Se o streamer adicionar músicas direto pelo app do Spotify, elas tocam do jeito do Spotify. Isso é de propósito, pra ele ter liberdade.

## Comandos do chat

| Comando | Quem pode | O que faz |
|---|---|---|
| `!sr música - artista` (ou `!música`, `!musica`, `!songrequest`) | todos | pede uma música. Também aceita link de música do Spotify |
| `!song` ou `!tocando` | todos | mostra o que está tocando, quem pediu e o link |
| `!fila` | todos | mostra as próximas 3 e a posição do seu pedido |
| `!remover`, `!wrongsong` ou `!errada` | todos | tira o seu último pedido |
| `!voteskip` | todos | vota pra pular (5 votos, dá pra mudar) |
| `!volume` | todos | mostra o volume |
| `!volume 50`, `!vol+`, `!vol-` | mods (dá pra liberar) | muda o volume, até o máximo escolhido |
| `!furarfila música` | mods (dá pra liberar) | pede uma música na frente da fila |
| `!earrape` | mods (dá pra liberar) | volume no máximo por alguns segundos, depois volta sozinho |
| `!remover @fulano` | mods | tira o último pedido do fulano |
| `!skip` ou `!pular` | mods | pula a música atual |
| `!sroff` / `!sron` | mods | fecha / abre os pedidos |

Os nomes dos comandos mudam em **Configurar → Nomes dos comandos**. Quem pode usar cada um muda em **Moderação**.

## Pontos do canal

Só existem em canal **Afiliado ou Parceiro** da Twitch (é a Twitch que libera).

**Jeito recomendado (o app cuida de tudo):**
1. Faça o passo 3 da Sincronização entrando com **a conta do canal**.
2. Em **Configurar → Pontos do canal**, escolha os custos e clique em **Criar recompensas na Twitch**.
3. Cada recompensa ganha um botão de liga/desliga. Desligada, ela some do chat. Se um pedido falhar (música não encontrada, banida, fila cheia), **os pontos voltam sozinhos**.

**Recompensas criadas à mão:** também funcionam, pelo botão **Detectar**. Nesse modo, o app não consegue desligar a recompensa nem devolver os pontos.

## Overlay no OBS

1. Em **Configurar → Overlay no OBS**, escolha **"Só a música tocando"** ou **"Música tocando + próximas 3 da fila"** e clique em **Copiar**.
2. No OBS: **Fontes → + → Navegador**, cole o link e use o tamanho indicado do lado.

A caixinha **Alinhar à direita** muda os dois links.
Também continua existindo o arquivo `tocando_agora.txt`, pra quem prefere uma fonte de texto simples.

**Dica pro earrape:** coloque um filtro **Limitador** na fonte de áudio do Spotify no OBS, pra não estourar o som da live.

## Atualizações (para quem publica o app no GitHub)

1. No `streambeats.js`, preencha `GITHUB_REPO` com `seuusuario/StreamBeats-TwitchSongRequest`.
2. Gere e publique uma versão com `.\publicar-versao.ps1 -Versao 1.0.1 -Notas "o que mudou"`. Precisa do GitHub CLI (`gh`) instalado e logado.
3. Quem usa o `.exe` vê o aviso **"Atualização"** no topo do painel e atualiza com um clique.

O app só baixa do repositório configurado e confere a assinatura SHA-256 antes de trocar o arquivo. As configurações, os logins e a fila continuam iguais depois de atualizar.

O `.gitignore` já impede que `tokens.json`, `config.json`, `fila.json` e `registro.log` subam pro GitHub.

## Arquivos que o app cria do lado dele

| Arquivo | O que é |
|---|---|
| `config.json` | as configurações do painel |
| `fila.json` | a fila, os pedidos esperando aprovação e o histórico da live |
| `tokens.json` | os logins do Spotify e da Twitch. **Não mande para ninguém.** Se apagar, é só conectar de novo |
| `registro.log` | tudo que aconteceu. Mande esse arquivo quando for pedir ajuda com algum problema |
| `tocando_agora.txt` | a música atual, para o OBS |

## Bom saber

- **O login do Spotify se renova sozinho.** O acesso vale 1 hora e o app renova sem você perceber.
- **Chat caiu?** Ele reconecta sozinho, sem perder a fila. Os pontos do canal também reconectam sozinhos.
- **Erro inesperado** não derruba o app no meio da live: fica anotado no `registro.log` e o app continua.
- **O Client ID não é senha.** Os logins de verdade ficam no `tokens.json` e nunca aparecem no painel.
- **Segurança:** o painel só funciona no próprio PC, e outros sites não conseguem mexer nele.
- **Direitos autorais:** deixe o áudio do Spotify numa faixa do OBS que não vai pro VOD, pra evitar mutes e avisos de DMCA.
- Ícones baseados no Lucide (licença ISC). Veja `LICENCAS-DE-TERCEIROS.md`.
