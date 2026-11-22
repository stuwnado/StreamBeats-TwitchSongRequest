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
- **Stream Deck** (Fifine, Elgato e outros): um atalho pra cada comando, é só arrastar pro botão.
- **Status sempre à vista:** dois cartões no canto mostram a Twitch (ao vivo, offline, desconectada) e o Spotify (tocando, pausado, desconectado).
- **Histórico das 3 últimas lives**, com botão pra criar uma playlist no Spotify com as músicas da live que você escolher.
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

Abra o app. Aparece só o **painel**, já na aba **Configuração**, com o quadro **Sincronização** em destaque:

1. **Conectar o Spotify (obrigatório):** crie um app grátis em developer.spotify.com. O painel mostra o passo a passo e o endereço exato pra colar (é só clicar nele pra copiar).
2. **Canal da Twitch (obrigatório):** escreva o nome do canal.
3. **Entrar na Twitch (recomendado):** faz o bot responder no chat e libera os pontos do canal (entre com **a conta do canal**). Sem isso, os pedidos funcionam, mas sem avisos no chat.
4. **Pontos do canal (opcional):** recompensas de pontos pra pedir música, furar a fila e earrape. Veja "Pontos do canal" mais abaixo.

Enquanto falta fazer, cada passo mostra uma etiqueta vermelha (obrigatório) ou amarela (recomendado/opcional). Quando fica pronto, vira um check verde.

Tudo salva sozinho. Depois de sincronizado, o quadro vira uma linha só.

**Antes da live:** abra o Spotify e dê play numa playlist. Quando os pedidos acabam, o Spotify volta pra ela sozinho.

- **Fechar o painel não desliga o app.** Os pedidos continuam funcionando. Pra ver o painel de novo, abra o app outra vez.
- **Para desligar de verdade:** botão **Desligar**, no topo do painel.
- **Status no canto esquerdo:** o cartão da Twitch fica verde (ao vivo), cinza (offline, lendo o chat) ou vermelho (desconectado). O do Spotify fica verde (tocando), amarelo (pausado) ou vermelho (fechado ou desconectado). Clique num deles pra conferir a conexão. Se o login não valer mais, abre a Sincronização. Pra saber se a live está no ar, o app precisa do passo 3 (entrar na Twitch).
- **A janela tem tamanho fixo** (900 × 650). Se alguém puxar a borda, ela volta sozinha pro tamanho certo.
- **Novidades:** quando o app abre numa versão nova, aparece uma vez uma janela com o que mudou. É só clicar em **Entendi**.

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
| `!voteskip` | todos | vota pra pular (3 votos, dá pra mudar) |
| `!volume` | todos | mostra o volume |
| `!volume 50`, `!vol+`, `!vol-` | mods (dá pra liberar) | muda o volume, até o máximo escolhido |
| `!furarfila música` | subs, VIPs e mods (dá pra mudar) | pede uma música na frente da fila |
| `!earrape` | subs, VIPs e mods (dá pra mudar) | volume no máximo por alguns segundos, depois volta sozinho |
| `!remover @fulano` | mods | tira o último pedido do fulano |
| `!skip` ou `!pular` | mods | pula a música atual |
| `!sroff` / `!sron` | mods | fecha / abre os pedidos |

Os nomes dos comandos mudam em **Configuração → Nomes dos comandos**. Quem pode pedir muda em **Moderação → Regras de pedidos**. Quem usa o volume, o `!furarfila` e o `!earrape` muda em **Moderação → Volume e Comandos Especiais**.

## Pontos do canal

Só existem em canal **Afiliado ou Parceiro** da Twitch (é a Twitch que libera).

**Jeito recomendado (o app cuida de tudo):**
1. Faça o passo 3 da Sincronização entrando com **a conta do canal**.
2. Em **Configuração → Sincronização → passo 4 (Pontos do canal)**, escolha os custos e clique em **Criar recompensas na Twitch**.
3. Cada recompensa ganha um botão de liga/desliga. Desligada, ela some do chat. Se um pedido falhar (música não encontrada, banida, fila cheia), **os pontos voltam sozinhos**.

**Recompensas criadas à mão:** também funcionam, pelo botão **Detectar**. Nesse modo, o app não consegue desligar a recompensa nem devolver os pontos.

## Overlay no OBS

1. Em **Configuração → Overlay no OBS**, escolha **"Só a música tocando"** ou **"Música tocando + próximas 3 da fila"** e clique em **Copiar**.
2. No OBS: **Fontes → + → Navegador**, cole o link e use o tamanho indicado do lado.

A caixinha **Alinhar à direita** muda os dois links.
Com a opção **Esconder o overlay quando a música estiver pausada** (ligada no começo), o overlay sai da tela uns segundos depois de pausar e volta sozinho quando der play (pelo painel, chat ou Stream Deck é na hora; pelo próprio Spotify pode levar até uns 20 segundos).
Quando o app muda de versão, o overlay se recarrega sozinho no OBS: não precisa apagar e criar a fonte de novo.
Também continua existindo o arquivo `tocando_agora.txt`, pra quem prefere uma fonte de texto simples.

**Dica pro earrape:** coloque um filtro **Limitador** na fonte de áudio do Spotify no OBS, pra não estourar o som da live.

## Stream Deck (Fifine, Elgato e outros)

1. Em **Configuração → Stream Deck**, clique em **Criar atalhos**. Abre uma pasta com um atalho pra cada comando: tocar/pausar, pular, voltar, banir a atual, abrir/fechar pedidos, volume +10, volume -10 e earrape.
2. No programa do Stream Deck (ex.: o da Fifine D6/AmpliGame), **arraste cada atalho pra um botão** (ou use a ação de abrir programa/arquivo e escolha o atalho).
3. Apertar o botão manda o comando pro StreamBeats que já está aberto, sem abrir janela.

O **Pular** daqui respeita a fila de pedidos. As teclas de mídia comuns pulam pra próxima da playlist do Spotify. Os atalhos só funcionam no próprio PC, com uma chave que o app guarda na pasta dele (`controle.chave`).

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
| `fila.json` | a fila, os pedidos esperando aprovação e o histórico das 3 últimas lives |
| `tokens.json` | os logins do Spotify e da Twitch. **Não mande para ninguém.** Se apagar, é só conectar de novo |
| `registro.log` | tudo que aconteceu. Mande esse arquivo quando for pedir ajuda com algum problema |
| `tocando_agora.txt` | a música atual, para o OBS |
| `config.json.bak` e `fila.json.bak` | cópias de segurança automáticas. Se o arquivo principal estragar (ex.: o PC desligou na hora de salvar), o app usa a cópia sozinho. Também não mande para ninguém |
| `controle.chave` | a chave dos atalhos do Stream Deck (troca sozinha toda vez que o app abre) |
| `Atalhos pro Stream Deck` | a pasta com os atalhos, criada pelo botão **Criar atalhos** |

## Bom saber

- **O login do Spotify se renova sozinho.** O acesso vale 1 hora e o app renova sem você perceber.
- **Chat caiu?** Ele reconecta sozinho, sem perder a fila. Os pontos do canal também reconectam sozinhos.
- **Histórico por live:** o app guarda as 3 últimas lives (a atual e as 2 anteriores). Escolha uma na lista e clique em **Criar playlist no Spotify**. A live nova começa sozinha quando a música volta a tocar depois de 4 horas parada. Com o login da Twitch, ela começa na hora em que você entra ao vivo (as músicas de "começando em breve" ficam na live nova), e uma pausa longa no meio da live não divide a live em duas. Quando entra uma 4ª live, a mais antiga sai da lista.
- **Pedidos fechados continuam fechados:** se o app reiniciar, os pedidos voltam do jeito que estavam (abertos ou fechados).
- **Login da Twitch vencido:** o app confere o login de hora em hora. Se vencer, o cartão da Twitch fica vermelho ("Login vencido") e o bot só lê o chat até você entrar de novo (passo 3 da Sincronização).
- **"O Spotify pediu para ir mais devagar":** o Spotify limita quantas vezes um app pode falar com ele. O Spotify não avisa quando a música troca, então o app precisa perguntar, mas pergunta o mínimo possível (modo econômico). Se aparecer esse aviso, ele espera sozinho (de 1 a 15 minutos) e volta. Todos os apps criados na mesma conta do site de desenvolvedor do Spotify dividem esse limite: se você tem outro app lá que ainda está rodando, ele gasta junto.
- **Erro inesperado** não derruba o app no meio da live: fica anotado no `registro.log` e o app continua.
- **O Client ID não é senha.** Os logins de verdade ficam no `tokens.json` e nunca aparecem no painel.
- **Segurança:** o painel só funciona no próprio PC, e outros sites não conseguem mexer nele.
- **Direitos autorais:** deixe o áudio do Spotify numa faixa do OBS que não vai pro VOD, pra evitar mutes e avisos de DMCA.
- Ícones baseados no Lucide (licença ISC). Veja `LICENCAS-DE-TERCEIROS.md`.
