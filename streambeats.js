'use strict';
/*
 * StreamBeats - TwitchSongRequest
 * Song request grátis: chat da Twitch  ->  Spotify
 * ---------------------------------------------------------
 * Sem dependências externas. Abre um painel (janela) no próprio PC.
 * O app fala apenas com a Twitch, com o Spotify e (para procurar
 * atualizações) com o GitHub do projeto.
 *
 * Como a fila funciona: o StreamBeats guarda a fila de pedidos com ele
 * e manda UMA música por vez para o Spotify, quando a atual está acabando.
 * Assim dá para reordenar, remover de verdade, furar fila e aprovar pedidos
 * (coisas que o Spotify não deixa fazer direto na fila dele).
 */
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

let sea = null;
try { sea = require('node:sea'); } catch { /* Node antigo */ }
const EH_EXE = !!(sea && sea.isSea && sea.isSea());

const VERSAO = '1.1.3';
// Repositório do GitHub de onde o app baixa atualizações ("usuario/repositorio").
// Vazio = atualização automática desligada.
const GITHUB_REPO = 'stuwnado/StreamBeats-TwitchSongRequest';

// --pasta= e --porta= servem pros atalhos do Stream Deck acharem o StreamBeats certo
const argumento = (nome) => { const a = process.argv.find((x) => x.startsWith(`--${nome}=`)); return a ? a.slice(nome.length + 3) : null; };
const PASTA = argumento('pasta') || process.env.STREAMBEATS_PASTA || (EH_EXE ? path.dirname(process.execPath) : __dirname);
const ARQ_CONFIG = path.join(PASTA, 'config.json');
const ARQ_TOKENS = path.join(PASTA, 'tokens.json');
const ARQ_FILA = path.join(PASTA, 'fila.json');
const ARQ_TOCANDO = path.join(PASTA, 'tocando_agora.txt');
const ARQ_LOG = path.join(PASTA, 'registro.log');
const ARQ_CONTROLE = path.join(PASTA, 'controle.chave'); // chave dos atalhos do Stream Deck
const PORTA = Number(argumento('porta')) || Number(process.env.STREAMBEATS_PORTA) || 8888; // outra porta só para testes
const URL_PAINEL = `http://127.0.0.1:${PORTA}/`;
const URL_OVERLAY = `http://127.0.0.1:${PORTA}/overlay`;
const SPOTIFY_REDIRECT = `http://127.0.0.1:${PORTA}/spotify`;
const TWITCH_REDIRECT = `http://localhost:${PORTA}/twitch`;
const SPOTIFY_SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');
const TWITCH_ESCOPOS_CHAT = ['chat:read', 'chat:edit'];
const TWITCH_ESCOPOS_PONTOS = ['channel:read:redemptions', 'channel:manage:redemptions'];
const CHAVE = crypto.randomBytes(18).toString('hex'); // protege o painel contra outros sites
const CHAVE_CONTROLE = crypto.randomBytes(18).toString('hex'); // protege os comandos do Stream Deck
// Comandos que um Stream Deck (Fifine, Elgato...) pode mandar: id -> [nome do atalho, ícone]
const COMANDOS_DECK = {
  'tocar-pausar': ['Tocar ou pausar', 'play'],
  pular: ['Pular música', 'pular'],
  voltar: ['Voltar música', 'voltar'],
  banir: ['Banir a música atual', 'ban'],
  pedidos: ['Abrir ou fechar pedidos', 'lista'],
  'volume-mais': ['Volume +10', 'volume'],
  'volume-menos': ['Volume -10', 'volume'],
  earrape: ['Earrape', 'volume'],
};
const ENVIAR_QUANDO_FALTAR_MS = 15000; // manda o próximo pedido pro Spotify 15s antes da música acabar
// Modo econômico: o Spotify não avisa quando a música troca, então o app pergunta, mas o mínimo possível.
// Desde julho de 2026 o Spotify limita bem mais os apps em modo de desenvolvimento. Com a música tocando,
// o app já sabe quanto falta: pergunta na hora de mandar o próximo pedido, logo depois que a música acaba,
// e no meio dela só uma conferência de vez em quando (pra quem pausa ou pula pelo próprio Spotify).
// Comandos do painel, do chat e do Stream Deck conferem logo depois, sem esperar.
const INTERVALO_TOCANDO_MS = 20000; // conferência no meio da música
const INTERVALO_PAUSADO_MS = 20000; // pausado ou sem aparelho ativo
const INTERVALO_TOCANDO_OFFLINE_MS = 60000; // tocando com a live fora do ar
const INTERVALO_PAUSADO_OFFLINE_MS = 120000; // pausado com a live fora do ar
const ESPERAS_BLOQUEIO_SEG = [60, 120, 300, 600, 900]; // bloqueio sem prazo do Spotify: espera cada vez mais
const TIPOS_RECOMPENSA = ['pedido', 'prioridade', 'earrape'];
const NOMES_RECOMPENSA = { pedido: 'Pedir música', prioridade: 'Furar fila', earrape: 'Earrape' };
const NIVEIS = ['desligado', 'mods', 'vips', 'subs', 'todos'];

let TEM_TERMINAL = false;
try { TEM_TERMINAL = !!(process.stdout && process.stdout.isTTY) && !process.argv.includes('--oculto'); } catch { /* sem janela */ }

const CONFIG_PADRAO = {
  canal_twitch: '',
  spotify_client_id: '',
  responder_no_chat: false,
  twitch_client_id: '',
  // Padrões de quem instala pela primeira vez. Quem já usa o app não é afetado:
  // o config.json dele já guarda todos os valores, e eles sempre ganham destes.
  cooldown_segundos: 5,
  max_pedidos_por_pessoa: 1,
  max_pedidos_subs: 5,
  max_fila_total: 30,
  duracao_maxima_minutos: 8,
  votos_para_pular: 3,
  bloquear_explicitas: false,
  somente_subs_e_vips: false,
  aprovar_pedidos: false,
  esconder_overlay_pausado: true,
  pedidos_abertos: true, // fica salvo: se o app reiniciar, os pedidos continuam abertos ou fechados como estavam
  palavras_bloqueadas: [],
  palavras_alerta: [],
  usuarios_bloqueados: [],
  musicas_banidas: [],
  permissao_volume: 'mods',
  volume_max_chat: 80,
  permissao_extras: 'subs',
  earrape_segundos: 3,
  earrape_espera_minutos: 5,
  furarfila_espera_minutos: 0,
  ultima_versao_vista: '', // última versão cuja janela de "Novidades" o streamer já viu
  recompensa_pedido_id: '',
  recompensa_prioridade_id: '',
  recompensa_earrape_id: '',
  recompensas_api: { pedido: null, prioridade: null, earrape: null },
  custos: { pedido: 500, prioridade: 2000, earrape: 5000 },
  comandos: {
    pedir: ['!sr', '!songrequest', '!música', '!musica'],
    tocando: ['!song', '!tocando'],
    fila: ['!fila', '!queue'],
    remover: ['!remover', '!wrongsong', '!errada'],
    voteskip: ['!voteskip', '!votarpular'],
    pular: ['!skip', '!pular'],
    abrir: ['!sron'],
    fechar: ['!sroff'],
    volume: ['!volume', '!vol'],
    volmais: ['!vol+'],
    volmenos: ['!vol-'],
    furarfila: ['!furarfila'],
    earrape: ['!earrape'],
  },
};

let cfg = null;
let tokens = {};
let irc = null;
let eventsub = null;
let proximoId = 1;
// A fila do StreamBeats. O primeiro item pode estar "enviado" (já na fila do Spotify, tocando a seguir).
let pedidos = []; // {id, uri, titulo, nome, artistas, imagem, duracao, explicita, album, usuario, pedidoPor, quando, prioridade, alerta, enviado, enviadoEm, pular}
let pendentes = []; // esperando aprovação do streamer
let historico = { desde: null, faixas: [] }; // a live atual: tudo que tocou {uri, titulo, pedidoPor, quando}
let livesAnteriores = []; // lives guardadas, a mais recente primeiro: { desde, faixas }
const MAX_LIVES_GUARDADAS = 2; // + a atual = as 3 últimas lives
const ultimoPedidoDe = new Map();
const ultimoFurarFilaDe = new Map();
const votosPular = new Set();
let pedidosAbertos = true;
let tocandoAgora = null;
let ultimaUri;
let aprendendoRecompensa = null; // 'pedido' | 'prioridade' | 'earrape'
let pausaSpotifyAte = 0;
let bloqueiosSeguidos = 0; // quantas vezes seguidas o Spotify pediu pra ir mais devagar
let avisarQuandoVoltar = false;
let ultimaTentativaEnvio = 0;
let earrapeAte = 0;
let volumeAntesEarrape = null;
let ultimoEarrapeChat = 0;
const esperandoLogin = {};
const logs = [];
const estado = {
  spotify: { conectado: false, usuario: null, premium: null, aparelho: null, volume: null, suportaVolume: false, erro: null },
  chat: { conectado: false, canal: null, respondendoComo: null },
  twitch: null, // {login, userId, scopes}
  aoVivo: null, // true = live no ar · false = offline · null = não dá pra saber (sem login da Twitch)
  twitchLoginVencido: false, // o login da Twitch venceu ou foi revogado (o cartão do painel avisa)
  eventsub: false,
  player: null, // {tocando, progresso, duracao, quando}
  atualizacao: null, // {versao, nova, notas, urlExe, urlSha, pagina, erro}
};

// ---------------------------------------------------------------- registro (tela + arquivo)
let bytesLog = 0;
function gravarLog(linha) {
  try {
    fs.appendFileSync(ARQ_LOG, linha);
    bytesLog += linha.length;
    if (bytesLog > 300000) {
      bytesLog = 0;
      if (fs.statSync(ARQ_LOG).size > 1000000) fs.writeFileSync(ARQ_LOG, fs.readFileSync(ARQ_LOG, 'utf8').slice(-500000));
    }
  } catch { /* sem permissão de escrita: segue sem arquivo */ }
}
function imprimir(texto) {
  try { console.log(texto); } catch { /* app rodando sem janela */ }
}
function log(...a) {
  const h = new Date().toLocaleTimeString('pt-BR');
  const t = a.join(' ');
  imprimir(`[${h}] ${t}`);
  logs.push({ h, t });
  if (logs.length > 200) logs.shift();
  gravarLog(`[${new Date().toLocaleString('pt-BR')}] ${t}\n`);
}

// ---------------------------------------------------------------- utilidades
const norm = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().trim();
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const inteiro = (v, padrao, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
const lista = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,]/));
const linkSpotify = (uri) => 'https://open.spotify.com/track/' + String(uri).split(':').pop();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ID_RECOMPENSA = /^[0-9a-f-]{20,40}$/i;

// Nenhuma chamada ao Spotify ou à Twitch espera mais que isso. Sem esse limite, uma API travada
// segurava a fila de comandos do chat e o player por até 5 minutos.
const TEMPO_LIMITE_API_MS = 12000;
async function buscarComTempo(url, opcoes, quem) {
  try {
    return await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE_API_MS) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      const erro = new Error(`${quem} não respondeu a tempo (internet lenta ou fora do ar).`);
      erro.semResposta = true;
      throw erro;
    }
    throw e;
  }
}

function lerJson(arq) {
  return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, ''));
}

// ---------------------------------------------------------------- grava\u00E7\u00E3o segura (config.json e fila.json)
// No Windows, antiv\u00EDrus e OneDrive \u00E0s vezes seguram um arquivo por um instante: tenta de novo algumas vezes.
const ARQUIVO_OCUPADO = ['EBUSY', 'EPERM', 'EACCES'];
const pausaCurta = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* sem pausa */ } };
function tentarVariasVezes(fn) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return fn();
    } catch (e) {
      if (tentativa >= 5 || !ARQUIVO_OCUPADO.includes(e.code)) throw e;
      pausaCurta(40 * tentativa);
    }
  }
}
// Escreve num .tmp e s\u00F3 no fim troca pelo arquivo de verdade: se o PC desligar no meio, o arquivo antigo continua inteiro.
// De quebra, guarda uma c\u00F3pia de seguran\u00E7a (.bak) do arquivo anterior, no m\u00E1ximo uma vez por minuto.
const ultimoBackup = new Map();
function gravarSeguro(arq, texto) {
  const tmp = arq + '.tmp';
  tentarVariasVezes(() => fs.writeFileSync(tmp, texto));
  if (Date.now() - (ultimoBackup.get(arq) || 0) > 60000) {
    ultimoBackup.set(arq, Date.now());
    try {
      lerJson(arq); // s\u00F3 copia se o atual estiver bom (nunca troca uma c\u00F3pia boa por um arquivo estragado)
      fs.copyFileSync(arq, arq + '.bak');
    } catch { /* ainda n\u00E3o existe, est\u00E1 estragado ou em uso: fica a c\u00F3pia anterior */ }
  }
  try {
    tentarVariasVezes(() => fs.renameSync(tmp, arq));
  } catch (e) {
    if (!ARQUIVO_OCUPADO.includes(e.code)) throw e;
    // o Windows n\u00E3o deixou trocar o nome: grava direto (como antes), pra n\u00E3o perder a mudan\u00E7a
    tentarVariasVezes(() => fs.writeFileSync(arq, texto));
    try { fs.rmSync(tmp, { force: true }); } catch { /* fica pra pr\u00F3xima */ }
  }
}
// L\u00EA config.json ou fila.json. Se estiver estragado, guarda uma c\u00F3pia dele (.corrompido) e usa a c\u00F3pia de seguran\u00E7a (.bak),
// em vez de trocar tudo pelos valores padr\u00E3o. Se estiver travado por outro programa e n\u00E3o houver c\u00F3pia, avisa o erro sem mexer nele.
function lerJsonComBackup(arq, nome) {
  const valido = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
  let erroLeitura = null;
  try {
    const d = JSON.parse(tentarVariasVezes(() => fs.readFileSync(arq, 'utf8')).replace(/^\uFEFF/, ''));
    if (valido(d)) return { dados: d, doBackup: false };
    throw new SyntaxError('conte\u00FAdo inv\u00E1lido');
  } catch (e) {
    if (e instanceof SyntaxError) {
      log(`\u26A0\uFE0F O ${nome} estava estragado. Uma c\u00F3pia dele ficou guardada como ${nome}.corrompido.`);
      try { fs.copyFileSync(arq, arq + '.corrompido'); } catch { /* segue mesmo assim */ }
    } else {
      erroLeitura = e;
    }
  }
  try {
    const d = lerJson(arq + '.bak');
    if (valido(d)) {
      log(`\u267B\uFE0F Usei a c\u00F3pia de seguran\u00E7a (${nome}.bak). Pode faltar s\u00F3 alguma mudan\u00E7a do \u00FAltimo minuto.`);
      return { dados: d, doBackup: true };
    }
  } catch { /* sem c\u00F3pia boa */ }
  if (erroLeitura) {
    throw new Error(`N\u00E3o consegui abrir o ${nome} (${erroLeitura.code || erroLeitura.message}). Feche programas que possam estar usando esse arquivo e abra o StreamBeats de novo.`);
  }
  log(`\u26A0\uFE0F N\u00E3o havia c\u00F3pia de seguran\u00E7a do ${nome}: come\u00E7ando com os valores padr\u00E3o.`);
  return null;
}
function salvarTokens() {
  fs.writeFileSync(ARQ_TOKENS, JSON.stringify(tokens, null, 2));
}
function abrirNavegador(url) {
  if (process.platform === 'win32') exec(`start "" "${url}"`, { windowsHide: true });
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}
function abrirPainel() {
  if (process.platform === 'win32') {
    const edge = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find((p) => fs.existsSync(p));
    if (edge) {
      // modo "app": abre como uma janela de programa, sem barra de endereço.
      // Tamanho fixo de 900 x 650: o próprio painel puxa a janela de volta se alguém mudar o tamanho.
      spawn(edge, ['--app=' + URL_PAINEL, '--window-size=900,650'], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  abrirNavegador(URL_PAINEL);
}
function tituloDe(t) {
  const artistas = (t.artists || []).map((a) => a.name).join(', ');
  return artistas ? `${t.name} - ${artistas}` : t.name;
}
function imagemDe(t) {
  const imgs = (t && ((t.album && t.album.images) || t.images)) || [];
  return imgs.length ? imgs[imgs.length > 1 ? imgs.length - 2 : 0].url : null;
}
function infoFaixa(t) {
  return {
    uri: t.uri,
    titulo: tituloDe(t),
    nome: t.name,
    artistas: (t.artists || []).map((a) => a.name).join(', '),
    imagem: imagemDe(t),
    duracao: t.duration_ms || 0,
    explicita: !!t.explicit,
    album: (t.album && t.album.name) || '',
  };
}
function alertaDe(f) {
  const texto = norm(f.titulo + ' ' + (f.album || ''));
  return cfg.palavras_alerta.find((p) => texto.includes(p)) || null;
}
// Moderador Líder (2025) tem selo próprio, "lead_moderator", no lugar do "moderator".
const ehMod = (msg) => !!msg.mod || ['broadcaster', 'moderator', 'lead_moderator'].some((b) => msg.badges.has(b));
const ehSubOuVip = (msg) => ['subscriber', 'founder', 'vip'].some((b) => msg.badges.has(b));
function temPermissao(msg, nivel) {
  if (nivel === 'desligado') return false;
  if (ehMod(msg) || nivel === 'todos') return true;
  if (nivel === 'subs') return ehSubOuVip(msg);
  if (nivel === 'vips') return msg.badges.has('vip');
  return false;
}
const QUEM_PODE = { mods: 'mods', vips: 'VIPs e mods', subs: 'subs, VIPs e mods', todos: 'todos' };

// ---------------------------------------------------------------- config
function normalizarConfig(c) {
  const n = { ...CONFIG_PADRAO, ...c };
  n.comandos = { ...CONFIG_PADRAO.comandos };
  for (const k of Object.keys(CONFIG_PADRAO.comandos)) {
    const l = lista((c.comandos || {})[k] || CONFIG_PADRAO.comandos[k])
      .map(norm).filter(Boolean).map((x) => (x.startsWith('!') ? x : '!' + x));
    n.comandos[k] = l.length ? [...new Set(l)] : CONFIG_PADRAO.comandos[k];
  }
  n.canal_twitch = norm(n.canal_twitch).replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/^[#@]/, '').replace(/[/?].*$/, '');
  if (!/^[a-z0-9_]{2,25}$/.test(n.canal_twitch)) n.canal_twitch = '';
  n.spotify_client_id = String(n.spotify_client_id || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(n.spotify_client_id)) n.spotify_client_id = '';
  n.twitch_client_id = String(n.twitch_client_id || '').trim();
  if (!/^[0-9a-z]{20,40}$/i.test(n.twitch_client_id)) n.twitch_client_id = '';
  for (const k of ['responder_no_chat', 'bloquear_explicitas', 'somente_subs_e_vips', 'aprovar_pedidos', 'esconder_overlay_pausado', 'pedidos_abertos']) n[k] = !!n[k];
  const P = CONFIG_PADRAO; // valor inválido volta pro padrão
  n.cooldown_segundos = inteiro(n.cooldown_segundos, P.cooldown_segundos, 0, 3600);
  n.max_pedidos_por_pessoa = inteiro(n.max_pedidos_por_pessoa, P.max_pedidos_por_pessoa, 1, 100);
  n.max_pedidos_subs = inteiro(n.max_pedidos_subs, P.max_pedidos_subs, 1, 100);
  n.max_fila_total = inteiro(n.max_fila_total, P.max_fila_total, 1, 500);
  n.duracao_maxima_minutos = inteiro(n.duracao_maxima_minutos, P.duracao_maxima_minutos, 0, 120);
  n.votos_para_pular = inteiro(n.votos_para_pular, P.votos_para_pular, 0, 1000);
  n.volume_max_chat = inteiro(n.volume_max_chat, P.volume_max_chat, 0, 100);
  n.earrape_segundos = inteiro(n.earrape_segundos, P.earrape_segundos, 1, 60);
  n.earrape_espera_minutos = inteiro(n.earrape_espera_minutos, P.earrape_espera_minutos, 0, 1440);
  n.furarfila_espera_minutos = inteiro(n.furarfila_espera_minutos, P.furarfila_espera_minutos, 0, 1440);
  n.permissao_volume = ['mods', 'subs', 'todos'].includes(n.permissao_volume) ? n.permissao_volume : P.permissao_volume;
  n.permissao_extras = NIVEIS.includes(n.permissao_extras) ? n.permissao_extras : P.permissao_extras;
  n.ultima_versao_vista = /^\d+\.\d+\.\d+$/.test(String(n.ultima_versao_vista || '')) ? String(n.ultima_versao_vista) : '';
  n.palavras_bloqueadas = [...new Set(lista(n.palavras_bloqueadas).map(norm).filter(Boolean))];
  n.palavras_alerta = [...new Set(lista(n.palavras_alerta).map(norm).filter(Boolean))];
  n.usuarios_bloqueados = [...new Set(lista(n.usuarios_bloqueados).map((u) => norm(u).replace(/^@/, '')).filter(Boolean))];
  const vistas = new Set();
  n.musicas_banidas = (Array.isArray(n.musicas_banidas) ? n.musicas_banidas : [])
    .filter((m) => m && /^spotify:track:[A-Za-z0-9]{22}$/.test(m.uri) && !vistas.has(m.uri) && vistas.add(m.uri))
    .map((m) => ({ uri: m.uri, titulo: String(m.titulo || m.uri).slice(0, 200) }));
  for (const k of ['recompensa_pedido_id', 'recompensa_prioridade_id', 'recompensa_earrape_id']) {
    n[k] = ID_RECOMPENSA.test(String(n[k] || '')) ? String(n[k]) : '';
  }
  const rc = n.recompensas_api && typeof n.recompensas_api === 'object' ? n.recompensas_api : {};
  n.recompensas_api = {};
  for (const k of TIPOS_RECOMPENSA) {
    const r = rc[k];
    n.recompensas_api[k] = r && ID_RECOMPENSA.test(String(r.id || '')) ? { id: String(r.id), ligada: r.ligada !== false } : null;
  }
  const cu = n.custos && typeof n.custos === 'object' ? n.custos : {};
  n.custos = {
    pedido: inteiro(cu.pedido, 500, 1, 10000000),
    prioridade: inteiro(cu.prioridade, 2000, 1, 10000000),
    earrape: inteiro(cu.earrape, 5000, 1, 10000000),
  };
  return n;
}

function carregarConfig() {
  const existia = fs.existsSync(ARQ_CONFIG);
  // estragado: usa a cópia de segurança; travado sem cópia: o app para com um aviso, sem apagar as configurações
  const lido = existia ? lerJsonComBackup(ARQ_CONFIG, 'config.json') : null;
  cfg = normalizarConfig(lido ? lido.dados : {});
  // instalação nova: tudo é novidade, então a janela de "Novidades" só aparece na próxima versão
  if (!existia) cfg.ultima_versao_vista = VERSAO;
  salvarConfig();
  pedidosAbertos = cfg.pedidos_abertos;
  if (!pedidosAbertos) log('🔒 Os pedidos continuam fechados, como estavam antes de o app fechar.');
}
function salvarConfig() {
  gravarSeguro(ARQ_CONFIG, JSON.stringify(cfg, null, 2));
}
// Abre ou fecha os pedidos e guarda no config.json (vale pelo painel, pelo chat e pelo Stream Deck).
function definirPedidosAbertos(abertos) {
  pedidosAbertos = !!abertos;
  if (cfg.pedidos_abertos === pedidosAbertos) return;
  cfg.pedidos_abertos = pedidosAbertos;
  try { salvarConfig(); } catch (e) { log('⚠️ Não consegui salvar se os pedidos estão abertos: ' + e.message); }
}

async function aplicarConfig(novo) {
  const antes = cfg;
  // estes campos só mudam pelos botões do painel, nunca pelo formulário
  const { recompensas_api: _r, custos: _c, musicas_banidas: _m, ...doFormulario } = novo;
  cfg = normalizarConfig({ ...cfg, ...doFormulario });
  salvarConfig();
  for (const p of [...pedidos, ...pendentes]) p.alerta = alertaDe(p);
  if (antes.spotify_client_id !== cfg.spotify_client_id) {
    estado.spotify = { ...estado.spotify, conectado: false, usuario: null, premium: null, aparelho: null, erro: null };
    if (spotifyConectado()) verificarSpotify();
  }
  if (antes.canal_twitch !== cfg.canal_twitch || antes.responder_no_chat !== cfg.responder_no_chat
    || antes.twitch_client_id !== cfg.twitch_client_id) {
    await reconectarChat();
  }
}

// ---------------------------------------------------------------- fila salva no disco
function salvarFila() {
  adiantarPlayer();
  try {
    gravarSeguro(ARQ_FILA, JSON.stringify({ pedidos, pendentes, historico, livesAnteriores }, null, 2));
  } catch (e) {
    log('⚠️ Não consegui salvar a fila: ' + e.message);
  }
}
function carregarFila() {
  if (!fs.existsSync(ARQ_FILA)) return;
  let lido;
  try {
    lido = lerJsonComBackup(ARQ_FILA, 'fila.json');
  } catch (e) {
    log('⚠️ ' + e.message);
    return;
  }
  if (!lido) return;
  try {
    const d = lido.dados;
    const ok = (p) => p && typeof p.uri === 'string' && typeof p.titulo === 'string';
    pedidos = (Array.isArray(d.pedidos) ? d.pedidos : []).filter(ok);
    pendentes = (Array.isArray(d.pendentes) ? d.pendentes : []).filter(ok);
    if (d.historico && Array.isArray(d.historico.faixas)) historico = { desde: d.historico.desde || null, faixas: d.historico.faixas.filter(ok) };
    if (Array.isArray(d.livesAnteriores)) {
      livesAnteriores = d.livesAnteriores
        .filter((l) => l && Array.isArray(l.faixas))
        .map((l) => { const faixas = l.faixas.filter(ok); return { desde: horaValida(l.desde) || horaValida(faixas[0] && faixas[0].quando) || Date.now(), faixas }; })
        .filter((l) => l.faixas.length)
        .slice(0, MAX_LIVES_GUARDADAS);
    }
    proximoId = Math.max(0, ...[...pedidos, ...pendentes].map((p) => Number(p.id) || 0)) + 1;
    if (pedidos.length || pendentes.length) log(`📂 Fila recuperada: ${pedidos.length} pedido(s)` + (pendentes.length ? ` e ${pendentes.length} esperando aprovação` : '') + '.');
    if (lido.doBackup) salvarFila(); // o fila.json estava estragado: grava ele de novo a partir da cópia de segurança
  } catch (e) {
    log('⚠️ O fila.json estava com erro e foi ignorado: ' + e.message);
  }
}

// ---------------------------------------------------------------- Spotify
function spotifyConectado() {
  const t = tokens.spotify;
  return !!(cfg.spotify_client_id && t && t.client_id === cfg.spotify_client_id && t.refresh_token);
}
function podeCriarPlaylist() {
  const s = (tokens.spotify && tokens.spotify.scope) || '';
  return s.includes('playlist-modify-private');
}

function linkLoginSpotify() {
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(12));
  esperandoLogin.spotify = { verifier, state };
  return 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: cfg.spotify_client_id,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT,
    code_challenge_method: 'S256',
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    scope: SPOTIFY_SCOPES,
    state,
    show_dialog: 'true',
  });
}

async function pedirTokenSpotify(params) {
  const r = await buscarComTempo('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }, 'O Spotify');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error_description || d.error || `HTTP ${r.status}`);
    e.codigo = d.error;
    throw e;
  }
  return d;
}

function guardarTokenSpotify(d) {
  const antes = tokens.spotify || {};
  tokens.spotify = {
    access_token: d.access_token,
    refresh_token: d.refresh_token || antes.refresh_token,
    expires_at: Date.now() + (d.expires_in - 60) * 1000,
    scope: d.scope || antes.scope || '',
    client_id: cfg.spotify_client_id,
  };
  salvarTokens();
}

function desconectarSpotify(motivo) {
  delete tokens.spotify;
  salvarTokens();
  estado.spotify = { conectado: false, usuario: null, premium: null, aparelho: null, volume: null, suportaVolume: false, erro: motivo || null };
  estado.player = null;
}

// O acesso do Spotify vale 1 hora: aqui ele é renovado sozinho, sem precisar logar de novo.
let renovandoSpotify = null;
function garantirTokenSpotify() {
  if (!spotifyConectado()) {
    const e = new Error('O Spotify não está conectado (clique em "Conectar Spotify" no painel).');
    e.semLogin = true;
    return Promise.reject(e);
  }
  if (Date.now() < tokens.spotify.expires_at) return Promise.resolve();
  if (!renovandoSpotify) {
    renovandoSpotify = pedirTokenSpotify({
      grant_type: 'refresh_token',
      refresh_token: tokens.spotify.refresh_token,
      client_id: cfg.spotify_client_id,
    }).then(guardarTokenSpotify).catch((e) => {
      if (e.codigo === 'invalid_grant' || e.codigo === 'invalid_client') {
        log('⚠️ O login do Spotify expirou. Clique em "Conectar Spotify" de novo.');
        desconectarSpotify('O login expirou, conecte de novo.');
      }
      throw e;
    }).finally(() => { renovandoSpotify = null; });
  }
  return renovandoSpotify;
}

function tempoAte(quando) {
  const seg = Math.max(1, Math.ceil((quando - Date.now()) / 1000));
  if (seg < 60) return `${seg} seg`;
  return `${Math.ceil(seg / 60)} min`;
}

async function spotify(metodo, rota, opcoes, jaTentou) {
  const { params, json: corpo } = opcoes || {};
  // Durante a espera que o Spotify pediu, nada vai pra ele (insistir só aumenta o bloqueio).
  if (Date.now() < pausaSpotifyAte) {
    const e = new Error(`O Spotify pediu para ir mais devagar. Voltando em ${tempoAte(pausaSpotifyAte)}`);
    e.status = 429;
    e.emEspera = true;
    throw e;
  }
  await garantirTokenSpotify();
  const url = new URL('https://api.spotify.com/v1' + rota);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const headers = { Authorization: 'Bearer ' + tokens.spotify.access_token };
  if (corpo) headers['Content-Type'] = 'application/json';
  const r = await buscarComTempo(url, {
    method: metodo,
    headers,
    body: metodo === 'GET' ? undefined : (corpo ? JSON.stringify(corpo) : ''),
  }, 'O Spotify');
  if (r.status === 401 && !jaTentou) {
    tokens.spotify.expires_at = 0;
    return spotify(metodo, rota, opcoes, true);
  }
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  if (r.status === 429) {
    // Com prazo (Retry-After), espera o que o Spotify mandou. Sem prazo, ou se for o limite total
    // da conta de desenvolvedor (reason QUOTA_EXCEEDED), espera cada vez mais: 1, 2, 5, 10, 15 min.
    const prazo = Number(r.headers.get('retry-after'));
    const cota = !!(dados && dados.error && dados.error.reason === 'QUOTA_EXCEEDED');
    bloqueiosSeguidos++;
    const escada = ESPERAS_BLOQUEIO_SEG[Math.min(bloqueiosSeguidos, ESPERAS_BLOQUEIO_SEG.length) - 1];
    const seg = prazo > 0 && !cota ? prazo : Math.max(prazo > 0 ? prazo : 0, escada);
    pausaSpotifyAte = Date.now() + seg * 1000;
    avisarQuandoVoltar = true;
    const motivo = cota ? 'o app chegou no limite de uso do Spotify' : 'muitos pedidos seguidos';
    log(`⚠️ O Spotify pediu para ir mais devagar (${motivo}). O app espera ${tempoAte(pausaSpotifyAte)} e tenta de novo sozinho.`);
    const e = new Error(`O Spotify pediu para ir mais devagar (${motivo}). Voltando em ${tempoAte(pausaSpotifyAte)}`);
    e.status = 429;
    e.cota = cota;
    throw e;
  }
  if (r.ok) {
    bloqueiosSeguidos = 0;
    if (avisarQuandoVoltar) { avisarQuandoVoltar = false; log('✅ O Spotify voltou a responder.'); }
  }
  if (!r.ok) {
    const msg = (dados && dados.error && (dados.error.message || dados.error)) || texto || `HTTP ${r.status}`;
    const e = new Error(String(msg));
    e.status = r.status;
    throw e;
  }
  return dados;
}

async function verificarSpotify() {
  try {
    const eu = await spotify('GET', '/me');
    estado.spotify.conectado = true;
    estado.spotify.erro = null;
    estado.spotify.usuario = eu.display_name || eu.id;
    estado.spotify.premium = eu.product ? eu.product === 'premium' : null;
    log(`✅ Spotify conectado: ${estado.spotify.usuario}`);
    if (estado.spotify.premium === false) log('⚠️ Essa conta não é Premium. O Spotify só deixa adicionar na fila com Premium.');
    await atualizarPlayer();
  } catch (e) {
    estado.spotify.conectado = false;
    estado.spotify.erro = e.message;
    if (!e.semLogin && e.status !== 429) log('⚠️ Problema com o Spotify: ' + e.message); // o 429 já foi avisado
  }
}

async function definirVolume(v) {
  const valor = inteiro(v, 50, 0, 100);
  await spotify('PUT', '/me/player/volume', { params: { volume_percent: valor } });
  estado.spotify.volume = valor;
  return valor;
}

// ---------------------------------------------------------------- busca de músicas
function extrairIdSpotify(texto) {
  const m = texto.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/i)
    || texto.match(/spotify:track:([A-Za-z0-9]{22})/i);
  return m ? m[1] : null;
}
const LINK_NAO_MUSICA = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:playlist|album|artist|show|episode|user|collection)\b|spotify:(?:playlist|album|artist|show|episode|user):/i;

function textoDeBusca(texto) {
  // "dynamite - BTS" -> "dynamite BTS" (o Spotify entende melhor assim)
  return texto.replace(/\s+[-–—|]\s+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Links curtos do app do Spotify (spotify.link/...): descobre para onde eles apontam.
async function resolverLinkCurto(texto) {
  const m = texto.match(/https?:\/\/(?:spotify\.link|spoti\.fi)\/[A-Za-z0-9_-]+/i);
  if (!m) return texto;
  try {
    const r = await fetch(m[0], { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (/open\.spotify\.com/.test(r.url)) return r.url;
    const achou = (await r.text()).match(/https?:\/\/open\.spotify\.com\/[^"'\s<>]+/);
    if (achou) return achou[0].replace(/&amp;/g, '&');
  } catch { /* sem internet ou link quebrado */ }
  return texto;
}

const PALAVRAS_VAZIAS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'and', 'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'os', 'as',
  'um', 'uma', 'la', 'el', 'los', 'las', 'y', 'feat', 'ft', 'com', 'musica', 'song', 'by', 'por']);
const semAcento = (s) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const palavras = (s) => semAcento(s).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length >= 1);

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    ant = atual;
  }
  return ant[b.length];
}
// Tolerante a erro de digitação: "rapsody" ~ "rhapsody", "quen" ~ "queen".
function parecida(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return distancia(a, b) <= Math.floor(Math.max(a.length, b.length) / 4);
}
// Nota de 0 a 1,5: quanto do que a pessoa digitou aparece (mesmo com erro) na música encontrada.
function relevancia(busca, t) {
  const q = palavras(busca).filter((w) => !PALAVRAS_VAZIAS.has(w));
  if (!q.length) return 0;
  const titulo = palavras(t.name + ' ' + ((t.album && t.album.name) || ''));
  const artistas = palavras((t.artists || []).map((a) => a.name).join(' '));
  let achou = 0;
  let artista = false;
  for (const w of q) {
    if (artistas.some((a) => parecida(w, a))) { achou++; artista = true; } else if (titulo.some((a) => parecida(w, a))) achou++;
  }
  return achou / q.length + (artista ? 0.5 : 0);
}

async function buscarMusica(texto) {
  const id = extrairIdSpotify(texto);
  if (id) {
    try {
      return await spotify('GET', '/tracks/' + id, { params: { market: 'from_token' } });
    } catch (e) {
      if (e.status === 404 || e.status === 400) return null;
      throw e;
    }
  }
  const res = await spotify('GET', '/search', { params: { q: textoDeBusca(texto), type: 'track', limit: '5', market: 'from_token' } });
  let itens = ((res && res.tracks && res.tracks.items) || []).filter((t) => t && t.is_playable !== false);
  if (cfg.bloquear_explicitas) {
    const limpas = itens.filter((t) => !t.explicit);
    if (limpas.length) itens = limpas;
  }
  // Escolhe a mais parecida com o que foi digitado (empate: a ordem do Spotify).
  let melhor = null;
  let nota = 0;
  for (const t of itens) {
    const n = relevancia(texto, t);
    if (n > nota + 0.001) { melhor = t; nota = n; }
  }
  return nota >= 0.5 ? melhor : null;
}

// ---------------------------------------------------------------- fila própria
const naFila = () => pedidos.filter((p) => !p.pular);
const totalAtivos = () => naFila().length + pendentes.length;
const primeiraPosicaoLivre = () => pedidos.filter((p) => p.enviado).length;

function inserirNaFila(p) {
  if (p.prioridade) {
    // furar fila: entra depois do que já foi enviado e dos outros que também furaram
    let i = pedidos.findIndex((x) => !x.enviado && !x.prioridade);
    if (i < 0) i = pedidos.length;
    pedidos.splice(i, 0, p);
  } else {
    pedidos.push(p);
  }
  salvarFila();
  return naFila().indexOf(p) + 1;
}

function acharPedido(id) {
  return pedidos.find((p) => p.id === id) || pendentes.find((p) => p.id === id) || null;
}

function removerPedido(p) {
  const ip = pendentes.indexOf(p);
  if (ip >= 0) pendentes.splice(ip, 1);
  const i = pedidos.indexOf(p);
  if (i >= 0) {
    if (p.enviado) p.pular = true; // já está na fila do Spotify: vai ser pulada quando começar
    else pedidos.splice(i, 1);
  }
  ultimoPedidoDe.delete(p.usuario);
  salvarFila();
}

function moverPara(id, para) {
  const i = pedidos.findIndex((p) => p.id === id);
  if (i < 0 || pedidos[i].enviado) return;
  const [p] = pedidos.splice(i, 1);
  const j = Math.max(primeiraPosicaoLivre(), Math.min(pedidos.length, inteiro(para, pedidos.length, 0, 10000)));
  pedidos.splice(j, 0, p);
  salvarFila();
}

function banir(uri, titulo) {
  if (!cfg.musicas_banidas.some((m) => m.uri === uri)) {
    cfg.musicas_banidas.push({ uri, titulo });
    salvarConfig();
  }
  for (const p of [...pedidos, ...pendentes]) if (p.uri === uri) removerPedido(p);
  log(`🚫 Banida: ${titulo}`);
}

// Manda o próximo pedido para a fila do Spotify quando a música atual está acabando.
let alimentando = false;
async function alimentarSpotify(agora) {
  if (alimentando || !spotifyConectado()) return;
  alimentando = true;
  try {
    const enviado = pedidos.find((p) => p.enviado);
    if (enviado) {
      if (Date.now() - enviado.enviadoEm > 20 * 60000) {
        log(`⚠️ "${enviado.titulo}" foi mandada pro Spotify mas não tocou. Tirando da fila.`);
        pedidos.splice(pedidos.indexOf(enviado), 1);
        salvarFila();
      }
      return;
    }
    const prox = pedidos[0];
    if (!prox) return;
    if (!agora) {
      const pl = estado.player;
      if (!pl || !pl.tocando) return;
      const resta = pl.duracao - (pl.progresso + (Date.now() - pl.quando));
      if (resta > ENVIAR_QUANDO_FALTAR_MS) return;
    }
    ultimaTentativaEnvio = Date.now(); // se falhar, não fica tentando de segundo em segundo
    await spotify('POST', '/me/player/queue', { params: { uri: prox.uri } });
    prox.enviado = true;
    prox.enviadoEm = Date.now();
    salvarFila();
    log(`➡️ Próxima no Spotify: ${prox.titulo}` + (prox.pedidoPor ? ` (pedida por ${prox.pedidoPor})` : ''));
  } catch (e) {
    if (e.status === 404) {
      estado.spotify.aparelho = null;
      log('⚠️ Nenhum aparelho do Spotify está ativo. Abra o Spotify e dê play em qualquer música.');
    } else if (e.status === 403) {
      log('⚠️ O Spotify recusou adicionar na fila (' + e.message + '). A conta precisa ser Premium.');
    } else if (!e.semLogin) {
      log('❗ Não consegui mandar a música pro Spotify: ' + e.message);
    }
    if (agora) throw e;
  } finally {
    alimentando = false;
  }
}

async function pular() {
  // se tem pedido esperando, manda ele antes de pular, pra ele tocar na hora
  if (!pedidos.some((p) => p.enviado) && pedidos.length) await alimentarSpotify(true);
  await spotify('POST', '/me/player/next');
  conferirPlayerEm(700);
}

async function tocarAgora(id) {
  const p = pedidos.find((x) => x.id === id);
  if (!p || p.enviado) return 'Essa já é a próxima.';
  moverPara(id, primeiraPosicaoLivre());
  if (pedidos.some((x) => x.enviado)) return 'Vai tocar logo depois da que já está a caminho no Spotify.';
  await pular();
  return null;
}

// Músicas (sem repetir) que dá pra pôr numa playlist do Spotify
const urisDaLive = (live) => [...new Set(live.faixas.map((f) => f.uri))].filter((u) => u.startsWith('spotify:track:'));
// qual: "atual" (ou nada) = a live atual; senão o início ("desde") de uma live guardada
function acharLive(qual) {
  if (qual == null || qual === '' || qual === 'atual') return historico;
  return livesAnteriores.find((l) => String(l.desde) === String(qual)) || null;
}

async function criarPlaylist(qual) {
  const live = acharLive(qual);
  if (!live) throw new Error('Essa live não está mais guardada (o app guarda só as 3 últimas).');
  const uris = urisDaLive(live);
  if (!uris.length) throw new Error('Ainda não tocou nenhuma música nessa live.');
  if (!podeCriarPlaylist()) throw new Error('Clique em "Conectar outra conta" no Spotify (Configuração → Sincronização) e autorize de novo para liberar a criação de playlist.');
  const dia = new Date(live.desde || Date.now()).toLocaleDateString('pt-BR');
  const corpo = { name: `StreamBeats - Live ${dia}`, description: 'Músicas que tocaram na live (feita pelo StreamBeats).', public: false };
  let pl;
  try {
    pl = await spotify('POST', '/me/playlists', { json: corpo });
  } catch (e) {
    if (e.status !== 404 && e.status !== 405) throw e;
    const eu = await spotify('GET', '/me');
    pl = await spotify('POST', `/users/${encodeURIComponent(eu.id)}/playlists`, { json: corpo });
  }
  for (let i = 0; i < uris.length; i += 100) {
    const parte = { uris: uris.slice(i, i + 100) };
    try {
      await spotify('POST', `/playlists/${pl.id}/items`, { json: parte });
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) throw e;
      await spotify('POST', `/playlists/${pl.id}/tracks`, { json: parte });
    }
  }
  log(`📀 Playlist criada no Spotify com ${uris.length} música(s): ${corpo.name}`);
  return (pl.external_urls && pl.external_urls.spotify) || null;
}

// ---------------------------------------------------------------- earrape
async function earrape(nome) {
  if (!spotifyConectado()) return 'O StreamBeats não está conectado ao Spotify agora.';
  if (Date.now() < earrapeAte) return '🔊 Já tem um earrape tocando, espera acabar!';
  if (!estado.player || !estado.player.tocando) return 'Não tem música tocando agora.';
  if (!estado.spotify.suportaVolume) return 'O Spotify desse PC não deixa mudar o volume.';
  const antes = estado.spotify.volume == null ? 50 : estado.spotify.volume;
  const ms = cfg.earrape_segundos * 1000;
  earrapeAte = Date.now() + ms;
  try {
    await definirVolume(100);
  } catch (e) {
    earrapeAte = 0;
    throw e;
  }
  volumeAntesEarrape = antes;
  log(`🔊 Earrape de ${nome} (${cfg.earrape_segundos}s, depois volta para ${antes}%)`);
  falarNoChat(`🔊 EARRAPE de ${nome}! (${cfg.earrape_segundos}s)`);
  setTimeout(async () => {
    try {
      await definirVolume(antes);
      log(`🔉 Volume voltou para ${antes}%`);
    } catch (e) {
      log('⚠️ Não consegui voltar o volume depois do earrape: ' + e.message);
    } finally {
      earrapeAte = 0;
      volumeAntesEarrape = null;
    }
  }, ms);
  return null;
}

// ---------------------------------------------------------------- acompanha o que está tocando
function escreverTocando() {
  const txt = tocandoAgora ? tocandoAgora.titulo + (tocandoAgora.pedidoPor ? `  (pedida por ${tocandoAgora.pedidoPor})` : '') : '';
  try { fs.writeFileSync(ARQ_TOCANDO, txt); } catch { /* arquivo aberto em outro programa */ }
}

async function aoTrocarMusica(item) {
  votosPular.clear();
  const uri = item ? item.uri : null;
  const idx = uri ? pedidos.findIndex((p) => p.enviado && p.uri === uri) : -1;
  const pedido = idx >= 0 ? pedidos.splice(idx, 1)[0] : null;
  if (pedido && pedido.pular) {
    log(`⏭️ Pulando "${pedido.titulo}" (foi tirada da fila)`);
    salvarFila();
    ultimaUri = undefined;
    try { await pular(); } catch { /* tenta de novo na próxima volta */ }
    return;
  }
  if (item) {
    const f = infoFaixa(item);
    let pedidoPor = pedido ? pedido.pedidoPor : null;
    let usuario = pedido ? pedido.usuario : null;
    if (!pedido) {
      // voltou pra uma música que alguém tinha pedido? mostra quem pediu de novo
      for (let i = historico.faixas.length - 1; i >= Math.max(0, historico.faixas.length - 50); i--) {
        if (historico.faixas[i].uri === f.uri) { pedidoPor = historico.faixas[i].pedidoPor || null; break; }
      }
    }
    tocandoAgora = { ...f, pedidoPor, usuario, alerta: pedido ? pedido.alerta : alertaDe(f) };
    separarSeFoiOutraLive();
    if (!historico.desde) historico.desde = Date.now();
    if (item.type !== 'episode') historico.faixas.push({ uri: f.uri, titulo: f.titulo, pedidoPor, quando: Date.now() });
    if (historico.faixas.length > 3000) historico.faixas.shift();
    log(`▶️ Tocando: ${f.titulo}` + (pedidoPor ? ` (pedida por ${pedidoPor})` : ''));
  } else {
    tocandoAgora = null;
  }
  escreverTocando();
  salvarFila();
}

let atualizando = false;
let ultimaReconferenciaSpotify = 0;
async function atualizarPlayer() {
  if (!spotifyConectado() || atualizando || Date.now() < pausaSpotifyAte) return;
  atualizando = true;
  try {
    let player;
    try {
      player = await spotify('GET', '/me/player', { params: { market: 'from_token' } });
    } catch {
      return;
    }
    // O app abriu sem internet (ou o Spotify estava fora do ar) e o player voltou a responder:
    // confere a conta de novo pro painel sair de "Desconectado" sozinho (no máximo uma vez a cada 30s).
    if (!estado.spotify.conectado && Date.now() - ultimaReconferenciaSpotify > 30000) {
      ultimaReconferenciaSpotify = Date.now();
      await verificarSpotify();
    }
    const dev = player && player.device;
    estado.spotify.aparelho = dev ? dev.name : null;
    estado.spotify.volume = dev && typeof dev.volume_percent === 'number' ? dev.volume_percent : null;
    estado.spotify.suportaVolume = !!(dev && dev.supports_volume !== false && typeof dev.volume_percent === 'number');
    const item = player && player.item;
    estado.player = item
      ? { tocando: !!player.is_playing, progresso: player.progress_ms || 0, duracao: item.duration_ms || 0, quando: Date.now() }
      : null;
    const uri = item ? item.uri : null;
    if (uri !== ultimaUri) {
      ultimaUri = uri;
      await aoTrocarMusica(item);
    }
    await alimentarSpotify();
  } finally {
    atualizando = false;
  }
}

// Quanto esperar até a próxima pergunta ao Spotify: rápido só quando a música está tocando,
// e acordando na hora certa de mandar o próximo pedido e logo depois que a música acaba.
function proximaConsultaMs() {
  const offline = estado.aoVivo === false;
  const pl = estado.player;
  if (!pl || !pl.tocando) return offline ? INTERVALO_PAUSADO_OFFLINE_MS : INTERVALO_PAUSADO_MS;
  let ms = offline ? INTERVALO_TOCANDO_OFFLINE_MS : INTERVALO_TOCANDO_MS;
  if (!(pl.duracao > 0)) return ms; // sem duração (ex.: alguns podcasts): só a conferência de vez em quando
  const resta = pl.duracao - (pl.progresso + (Date.now() - pl.quando));
  if (resta <= 0) {
    // já devia ter acabado: o Spotify às vezes demora um pouco pra trocar (no máximo 5 conferências rápidas)
    consultasNoFim++;
    return consultasNoFim <= 5 ? 2000 : ms;
  }
  consultasNoFim = 0;
  const temPraMandar = pedidos.length > 0 && !pedidos.some((p) => p.enviado);
  if (temPraMandar && resta > ENVIAR_QUANDO_FALTAR_MS) ms = Math.min(ms, resta - ENVIAR_QUANDO_FALTAR_MS + 300);
  else if (temPraMandar && Date.now() - ultimaTentativaEnvio > 10000) ms = 1000; // já está na hora de mandar
  ms = Math.min(ms, resta + 800);
  return Math.max(1000, ms);
}
let consultasNoFim = 0;

let timerPlayer = null;
let proximaConsultaEm = 0;
let cicloLigado = false; // só no app de verdade (nos testes, cada conferência é chamada na mão)
function agendarPlayer(ms) {
  clearTimeout(timerPlayer);
  proximaConsultaEm = Date.now() + ms;
  timerPlayer = setTimeout(cicloDoPlayer, ms);
}
async function cicloDoPlayer() {
  cicloLigado = true;
  try { await atualizarPlayer(); } catch { /* o próximo ciclo tenta de novo */ }
  const espera = pausaSpotifyAte - Date.now();
  agendarPlayer(espera > 0 ? espera + 500 : proximaConsultaMs());
}
// Confere daqui a pouco (depois de um comando) e segue o ciclo a partir dali.
function conferirPlayerEm(ms) {
  if (!cicloLigado) { setTimeout(atualizarPlayer, ms); return; }
  agendarPlayer(ms);
}
// A fila ou a live mudou: se a próxima conferência precisar ser antes, adianta (nunca atrasa).
function adiantarPlayer() {
  if (!cicloLigado || Date.now() < pausaSpotifyAte) return;
  const ms = proximaConsultaMs();
  if (Date.now() + ms < proximaConsultaEm - 200) agendarPlayer(ms);
}

// ---------------------------------------------------------------- Twitch: login (opcional)
function linkLoginTwitch() {
  const state = b64url(crypto.randomBytes(12));
  esperandoLogin.twitch = { state };
  return 'https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({
    response_type: 'token',
    client_id: cfg.twitch_client_id,
    redirect_uri: TWITCH_REDIRECT,
    scope: [...TWITCH_ESCOPOS_CHAT, ...TWITCH_ESCOPOS_PONTOS].join(' '),
    state,
    force_verify: 'true',
  });
}

async function infoTwitch() {
  const t = tokens.twitch;
  if (!t || !t.access_token || t.client_id !== cfg.twitch_client_id) return null;
  try {
    const r = await buscarComTempo('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + t.access_token } }, 'A Twitch');
    if (r.status === 401) {
      delete tokens.twitch;
      salvarTokens();
      estado.twitchLoginVencido = true;
      log('⚠️ O login da Twitch venceu. Entre de novo no painel (Configuração → Sincronização, passo 3).');
      return null;
    }
    if (!r.ok) return null;
    const d = await r.json();
    if (d.login) estado.twitchLoginVencido = false;
    return d.login ? { login: d.login, userId: d.user_id, scopes: d.scopes || [] } : null;
  } catch {
    return null;
  }
}

const ehDonoDoCanal = () => !!(estado.twitch && estado.twitch.login === cfg.canal_twitch);
const temEscoposPontos = () => !!(estado.twitch && TWITCH_ESCOPOS_PONTOS.every((s) => estado.twitch.scopes.includes(s)));
const podeUsarApiPontos = () => ehDonoDoCanal() && temEscoposPontos();
const temRecompensasApi = () => TIPOS_RECOMPENSA.some((k) => cfg.recompensas_api[k]);

async function helix(metodo, rota, params, corpo) {
  const url = new URL('https://api.twitch.tv/helix' + rota);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await buscarComTempo(url, {
    method: metodo,
    headers: { 'Client-Id': cfg.twitch_client_id, Authorization: 'Bearer ' + tokens.twitch.access_token, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }, 'A Twitch');
  const texto = await r.text();
  let d = null;
  try { d = texto ? JSON.parse(texto) : null; } catch { /* sem JSON */ }
  if (!r.ok) {
    const e = new Error((d && d.message) || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return d;
}

// ---------------------------------------------------------------- pontos do canal criados pelo app
function corpoRecompensa(qual) {
  const base = {
    title: { pedido: '🎵 Pedir música', prioridade: '⚡ Furar fila (música)', earrape: '🔊 Earrape' }[qual],
    cost: cfg.custos[qual],
    is_enabled: true,
    should_redemptions_skip_request_queue: false,
  };
  if (qual === 'earrape') {
    const c = { ...base, prompt: `Coloca a música no volume máximo por ${cfg.earrape_segundos} segundos!`, is_user_input_required: false, background_color: '#FF4F6B' };
    if (cfg.earrape_espera_minutos > 0) { c.is_global_cooldown_enabled = true; c.global_cooldown_seconds = cfg.earrape_espera_minutos * 60; }
    return c;
  }
  return { ...base, prompt: 'Nome da música - artista (ou link do Spotify)', is_user_input_required: true, background_color: qual === 'pedido' ? '#9147FF' : '#FFB31A' };
}
function traduzirErroRecompensa(e) {
  if (e.semResposta) return e; // "a Twitch não respondeu a tempo" já está claro
  const m = String(e.message || '');
  if (/partner|affiliate/i.test(m)) return new Error('O canal precisa ser Afiliado ou Parceiro da Twitch para ter pontos do canal.');
  if (/duplicate/i.test(m)) return new Error('Já existe uma recompensa com esse nome no canal. Apague ou renomeie ela na Twitch e tente de novo.');
  if (e.status === 401) return new Error('O login da Twitch venceu. Entre na Twitch de novo (Configurar → Sincronização).');
  return new Error('A Twitch recusou: ' + m);
}
async function criarRecompensas() {
  if (!podeUsarApiPontos()) throw new Error(`Entre na Twitch (Configurar → Sincronização, passo 3) com a conta do canal #${cfg.canal_twitch}.`);
  for (const qual of TIPOS_RECOMPENSA) {
    if (cfg.recompensas_api[qual]) continue;
    let d;
    try {
      d = await helix('POST', '/channel_points/custom_rewards', { broadcaster_id: estado.twitch.userId }, corpoRecompensa(qual));
    } catch (e) {
      throw traduzirErroRecompensa(e);
    }
    cfg.recompensas_api[qual] = { id: d.data[0].id, ligada: true };
    salvarConfig();
    log(`🎁 Recompensa criada na Twitch: ${NOMES_RECOMPENSA[qual]}`);
  }
  atualizarEventSub();
}
async function mudarRecompensa(qual, mudanca) {
  const r = cfg.recompensas_api[qual];
  if (!r) return;
  if (!podeUsarApiPontos()) throw new Error(`Entre na Twitch com a conta do canal #${cfg.canal_twitch} para mexer nas recompensas.`);
  try {
    await helix('PATCH', '/channel_points/custom_rewards', { broadcaster_id: estado.twitch.userId, id: r.id }, mudanca);
  } catch (e) {
    if (e.status === 404) {
      cfg.recompensas_api[qual] = null;
      salvarConfig();
      throw new Error(`A recompensa "${NOMES_RECOMPENSA[qual]}" foi apagada na Twitch. Clique em "Criar recompensas" para criar de novo.`);
    }
    throw traduzirErroRecompensa(e);
  }
}
async function removerRecompensas() {
  for (const qual of TIPOS_RECOMPENSA) {
    const r = cfg.recompensas_api[qual];
    if (!r) continue;
    if (podeUsarApiPontos()) {
      try {
        await helix('DELETE', '/channel_points/custom_rewards', { broadcaster_id: estado.twitch.userId, id: r.id });
      } catch (e) {
        if (e.status !== 404) throw traduzirErroRecompensa(e);
      }
    }
    cfg.recompensas_api[qual] = null;
  }
  salvarConfig();
  log('🎁 Recompensas do app removidas da Twitch.');
  atualizarEventSub();
}

// Recebe os resgates em tempo real (EventSub). É assim que o app vê o Earrape (que não tem texto)
// e consegue devolver os pontos quando um pedido falha.
function atualizarEventSub() {
  const quer = podeUsarApiPontos() && temRecompensasApi();
  if (!quer) {
    if (eventsub) { eventsub.parar(); eventsub = null; }
    estado.eventsub = false;
    return;
  }
  if (!eventsub) eventsub = conectarEventSub();
}
function conectarEventSub() {
  let parado = false;
  let ws = null;
  let tentativa = 0;
  function agendar() {
    if (parado) return;
    tentativa++;
    setTimeout(() => abrir(), Math.min(60000, 5000 * tentativa));
  }
  function abrir(url, ehReconexao) {
    if (parado) return;
    let sock;
    try {
      sock = new WebSocket(url || 'wss://eventsub.wss.twitch.tv/ws');
    } catch (e) {
      log('⚠️ Não consegui conectar aos pontos do canal: ' + e.message);
      agendar();
      return;
    }
    sock.ultimo = Date.now();
    sock.onmessage = async (ev) => {
      sock.ultimo = Date.now();
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      const tipo = m.metadata && m.metadata.message_type;
      if (tipo === 'session_welcome') {
        const antigo = ws;
        ws = sock;
        tentativa = 0;
        if (antigo && antigo !== sock) { antigo.fechadoDeProposito = true; try { antigo.close(); } catch { /* já fechado */ } }
        if (ehReconexao) { estado.eventsub = true; return; }
        try {
          await helix('POST', '/eventsub/subscriptions', null, {
            type: 'channel.channel_points_custom_reward_redemption.add',
            version: '1',
            condition: { broadcaster_user_id: estado.twitch.userId },
            transport: { method: 'websocket', session_id: m.payload.session.id },
          });
          estado.eventsub = true;
          log('🎁 Recebendo os resgates de pontos do canal.');
        } catch (e) {
          estado.eventsub = false;
          log('⚠️ Não consegui receber os resgates de pontos: ' + e.message);
        }
      } else if (tipo === 'notification') {
        if (m.payload && m.payload.event) enfileirarResgate(m.payload.event);
      } else if (tipo === 'session_reconnect') {
        abrir(m.payload.session.reconnect_url, true);
      } else if (tipo === 'revocation') {
        estado.eventsub = false;
        log('⚠️ A Twitch parou de mandar os resgates. Entre na Twitch de novo (Configurar → Sincronização).');
      }
    };
    sock.onerror = () => { /* o onclose cuida */ };
    sock.onclose = () => {
      if (sock.fechadoDeProposito || parado) return;
      if (ws && sock !== ws) return; // era uma conexão velha
      ws = null;
      estado.eventsub = false;
      agendar();
    };
  }
  const vigia = setInterval(() => {
    // a Twitch manda um "estou aqui" a cada ~10s; se sumir, reconecta
    if (ws && Date.now() - ws.ultimo > 40000) { try { ws.close(); } catch { /* já fechado */ } }
  }, 15000);
  abrir();
  return {
    parar() {
      parado = true;
      clearInterval(vigia);
      if (ws) { ws.fechadoDeProposito = true; try { ws.close(); } catch { /* já fechado */ } }
    },
  };
}

function tirarComandoDoTexto(texto) {
  const t = String(texto || '').trim();
  const i = t.search(/\s/);
  if (t.startsWith('!') && [...cfg.comandos.pedir, ...cfg.comandos.furarfila].includes(norm(i < 0 ? t : t.slice(0, i)))) return i < 0 ? '' : t.slice(i).trim();
  return t;
}

function enfileirarResgate(ev) {
  filaDeMensagens = filaDeMensagens.then(() => tratarResgate(ev)).catch((e) => log('❗ ' + e.message));
}
async function tratarResgate(ev) {
  const qual = TIPOS_RECOMPENSA.find((k) => cfg.recompensas_api[k] && cfg.recompensas_api[k].id === (ev.reward && ev.reward.id));
  if (!qual) return;
  const msg = { usuario: norm(ev.user_login), nome: ev.user_name || ev.user_login, texto: ev.user_input || '', id: null, badges: new Set(), recompensa: ev.reward.id };
  log(`🎁 ${msg.nome} resgatou "${NOMES_RECOMPENSA[qual]}"` + (msg.texto ? `: ${msg.texto}` : ''));
  let ok = false;
  try {
    if (cfg.usuarios_bloqueados.includes(msg.usuario)) ok = false;
    else if (qual === 'earrape') {
      const aviso = await earrape(msg.nome);
      if (aviso) responder(msg, aviso);
      ok = !aviso;
    } else {
      ok = await cmdPedir(msg, tirarComandoDoTexto(msg.texto), false, { recompensa: true, prioridade: qual === 'prioridade' });
    }
  } catch (e) {
    log('❗ Erro: ' + e.message);
    ok = false;
  }
  try {
    await helix('PATCH', '/channel_points/custom_rewards/redemptions',
      { broadcaster_id: estado.twitch.userId, reward_id: ev.reward.id, id: ev.id },
      { status: ok ? 'FULFILLED' : 'CANCELED' });
    if (!ok) {
      log(`↩️ Pontos devolvidos para ${msg.nome}.`);
      falarNoChat(`↩️ @${msg.nome} seus pontos foram devolvidos.`);
    }
  } catch (e) {
    log('⚠️ Não consegui marcar o resgate na Twitch: ' + e.message);
  }
}

// ---------------------------------------------------------------- chat da Twitch (IRC)
function parseIrc(linha) {
  const tags = {};
  let resto = linha;
  if (resto.startsWith('@')) {
    const i = resto.indexOf(' ');
    for (const kv of resto.slice(1, i).split(';')) {
      const j = kv.indexOf('=');
      const v = j < 0 ? '' : kv.slice(j + 1);
      tags[j < 0 ? kv : kv.slice(0, j)] = v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
    }
    resto = resto.slice(i + 1);
  }
  let prefixo = '';
  if (resto.startsWith(':')) {
    const i = resto.indexOf(' ');
    prefixo = resto.slice(1, i);
    resto = resto.slice(i + 1);
  }
  let final = null;
  const ti = resto.indexOf(' :');
  if (ti >= 0) {
    final = resto.slice(ti + 2);
    resto = resto.slice(0, ti);
  } else if (resto.startsWith(':')) {
    final = resto.slice(1);
    resto = '';
  }
  const partes = resto.split(' ').filter(Boolean);
  const comando = partes.shift() || '';
  return { tags, prefixo, comando, params: partes, final };
}

// Vigia do chat: se nada chegar por 1 minuto, o app pergunta "está aí?" (PING);
// se ficar 2,5 minutos sem nada, a conexão morreu sem avisar (roteador reiniciou, internet caiu e voltou) e é refeita.
const CHAT_PING_MS = 60000;
const CHAT_MORTO_MS = 150000;
// Controle de taxa das respostas do bot: no máximo 18 a cada 30s (a Twitch bloqueia contas comuns acima de 20).
const CHAT_LIMITE_MSGS = 18;
const CHAT_JANELA_MS = 30000;
const CHAT_MAX_ESPERANDO = 15; // em raid, guarda até 15 respostas esperando a vez; as que passarem disso são puladas
const CHAT_VALIDADE_MS = 60000; // resposta que esperou mais de 1 minuto já não faz sentido: é descartada
const CHAT_RESPIRO_MS = 350; // espaço mínimo entre uma resposta e outra

function conectarTwitch(canal, aoMensagem, login, token, aoStatus) {
  let sock = null;
  let parado = false;
  let buffer = '';
  let conectado = false;
  let ultimoDado = 0; // quando chegou a última coisa do chat (mensagem, PING, PONG...)
  const status = (v) => { conectado = v; if (aoStatus) aoStatus(v, login); };
  const enviar = (l) => { if (sock && !sock.destroyed) sock.write(l + '\r\n'); };

  function conectar() {
    if (parado) return;
    buffer = '';
    ultimoDado = Date.now();
    const este = tls.connect({ host: 'irc.chat.twitch.tv', port: 6697, servername: 'irc.chat.twitch.tv' });
    sock = este;
    este.setEncoding('utf8');
    este.setKeepAlive(true, 60000);
    este.on('secureConnect', () => {
      enviar('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (login && token) {
        enviar('PASS oauth:' + token);
        enviar('NICK ' + login);
      } else {
        enviar('NICK justinfan' + Math.floor(10000 + Math.random() * 80000)); // leitura anônima
      }
      enviar('JOIN #' + canal);
    });
    este.on('data', (pedaco) => {
      ultimoDado = Date.now();
      buffer += pedaco;
      const linhas = buffer.split('\r\n');
      buffer = linhas.pop();
      for (const l of linhas) if (l) tratar(l);
    });
    este.on('error', (e) => log('Erro na conexão com o chat da Twitch: ' + e.message));
    este.on('close', () => {
      if (parado || este !== sock) return; // conexão velha: só a atual pode agendar a reconexão (nunca duas ao mesmo tempo)
      if (conectado) log('🔌 Desconectado do chat. Tentando de novo em 5 segundos...');
      status(false);
      setTimeout(conectar, 5000);
    });
  }

  const vigia = setInterval(() => {
    if (parado || !sock || sock.destroyed) return; // já está reconectando
    const mudo = Date.now() - ultimoDado;
    if (mudo >= CHAT_MORTO_MS) {
      log('🔌 O chat da Twitch parou de responder. Reconectando...');
      sock.destroy(); // o 'close' acima agenda a reconexão (uma só)
    } else if (conectado && mudo >= CHAT_PING_MS) {
      enviar('PING :tmi.twitch.tv'); // a Twitch responde PONG, e isso conta como "está vivo"
    }
  }, 30000);

  // Respostas do bot esperando a vez (controle de taxa)
  const esperando = []; // { linha, quando }
  const enviadas = []; // horário das últimas respostas mandadas
  let timerEnvio = null;
  let ultimoEnvio = 0;
  let ultimoAvisoCheio = 0;
  function despachar() {
    timerEnvio = null;
    if (parado || !login) { esperando.length = 0; return; }
    const agora = Date.now();
    while (esperando.length && agora - esperando[0].quando > CHAT_VALIDADE_MS) esperando.shift();
    if (!esperando.length) return;
    while (enviadas.length && agora - enviadas[0] >= CHAT_JANELA_MS) enviadas.shift();
    let espera = 0;
    if (!conectado || !sock || sock.destroyed) espera = 2000; // reconectando: manda quando voltar
    else if (enviadas.length >= CHAT_LIMITE_MSGS) espera = CHAT_JANELA_MS - (agora - enviadas[0]) + 50; // limite: espera abrir vaga
    else if (agora - ultimoEnvio < CHAT_RESPIRO_MS) espera = CHAT_RESPIRO_MS - (agora - ultimoEnvio); // um respiro entre respostas
    else {
      enviar(esperando.shift().linha);
      enviadas.push(agora);
      ultimoEnvio = agora;
      if (esperando.length) espera = CHAT_RESPIRO_MS;
    }
    if (espera) timerEnvio = setTimeout(despachar, espera);
  }

  function tratar(linha) {
    const m = parseIrc(linha);
    switch (m.comando) {
      case 'PING':
        enviar('PONG :' + (m.final || 'tmi.twitch.tv'));
        break;
      case 'RECONNECT':
        sock.destroy();
        break;
      case 'ROOMSTATE':
        if (!conectado) {
          log(`💬 Lendo o chat de #${canal}` + (login ? ` (respondendo como ${login})` : ''));
          status(true);
        }
        break;
      case 'NOTICE':
        if (/authentication failed|improperly formatted|invalid nick/i.test(m.final || '')) {
          log('⚠️ O login da Twitch foi recusado. Continuando só lendo o chat.');
          login = null;
          token = null;
          sock.destroy();
        } else if (m.final) {
          log('Twitch avisou: ' + m.final);
        }
        break;
      case 'PRIVMSG': {
        const usuario = m.prefixo.split('!')[0];
        const badges = new Set((m.tags.badges || '').split(',').filter(Boolean).map((b) => b.split('/')[0]));
        aoMensagem({
          usuario,
          nome: m.tags['display-name'] || usuario,
          texto: m.final || '',
          id: m.tags.id,
          badges,
          mod: m.tags.mod === '1',
          recompensa: m.tags['custom-reward-id'] || null,
        });
        break;
      }
      default:
        break;
    }
  }

  conectar();
  return {
    get podeFalar() { return !!login; },
    falar(texto, idResposta) {
      if (!login) return;
      if (esperando.length >= CHAT_MAX_ESPERANDO) {
        if (Date.now() - ultimoAvisoCheio > CHAT_JANELA_MS) {
          ultimoAvisoCheio = Date.now();
          log('⚠️ Muitas respostas pro chat ao mesmo tempo (raid?): algumas foram puladas pra não estourar o limite da Twitch.');
        }
        return;
      }
      const limpo = String(texto).replace(/[\r\n]+/g, ' ').slice(0, 450);
      esperando.push({ linha: (idResposta ? `@reply-parent-msg-id=${idResposta} ` : '') + `PRIVMSG #${canal} :${limpo}`, quando: Date.now() });
      if (!timerEnvio) despachar();
    },
    parar() {
      parado = true;
      clearInterval(vigia);
      clearTimeout(timerEnvio);
      timerEnvio = null;
      esperando.length = 0;
      if (sock) sock.destroy();
    },
  };
}

let filaDeMensagens = Promise.resolve();
function enfileirarMensagem(m) {
  // uma mensagem por vez, para os limites (cooldown, fila cheia) funcionarem certinho
  filaDeMensagens = filaDeMensagens.then(() => aoMensagem(m)).catch((e) => log('❗ ' + e.message));
}

let geracaoChat = 0; // cada reconexão ganha um número; se outra começar no meio, só a mais nova conecta
async function reconectarChat() {
  const minha = ++geracaoChat;
  if (irc) { irc.parar(); irc = null; }
  estado.chat = { conectado: false, canal: cfg.canal_twitch || null, respondendoComo: null };
  estado.aoVivo = null;
  const info = cfg.twitch_client_id ? await infoTwitch() : null;
  // outra reconexão começou enquanto esta esperava a Twitch: ela é que conecta (nunca dois chats ao mesmo tempo)
  if (minha !== geracaoChat) return;
  estado.twitch = info;
  atualizarEventSub();
  if (!cfg.canal_twitch) return;
  const login = cfg.responder_no_chat && estado.twitch ? estado.twitch.login : null;
  estado.chat.respondendoComo = login;
  irc = conectarTwitch(cfg.canal_twitch, enfileirarMensagem, login, login ? tokens.twitch.access_token : null,
    (ok, quem) => { estado.chat.conectado = ok; estado.chat.respondendoComo = quem; });
  verificarAoVivo();
}

// Histórico por live: o app guarda as 3 últimas lives (a atual + 2 anteriores).
// Um intervalo de 4 horas sem música separa uma live da outra.
const NOVA_LIVE_APOS_MS = 4 * 3600000;
// Hora de uma música; 0 se estiver estragada (antes de 2001 não existia o app)
const horaValida = (q) => (Number(q) > 1e12 ? Number(q) : 0);
// Separa músicas em lives (da mais antiga pra mais nova), cortando onde houve 4h ou mais sem música.
// desdePadrao: início da lista, usado quando a primeira música não tem uma hora válida.
function separarEmLives(faixas, desdePadrao) {
  const lives = [];
  for (const f of faixas) {
    const ultima = lives[lives.length - 1];
    const quando = horaValida(f.quando);
    const fimUltima = ultima ? horaValida(ultima.faixas[ultima.faixas.length - 1].quando) : 0;
    // sem hora válida não dá pra medir o intervalo: a música fica junto com a anterior
    if (ultima && (!quando || !fimUltima || quando - fimUltima < NOVA_LIVE_APOS_MS)) ultima.faixas.push(f);
    else lives.push({ desde: quando || horaValida(desdePadrao) || Date.now(), faixas: [f] });
  }
  return lives;
}
// Guarda lives (da mais antiga pra mais nova) e mantém só as 2 mais recentes entre as anteriores.
function arquivarLives(lives) {
  for (const l of lives) if (l.faixas.length) livesAnteriores.unshift(l);
  livesAnteriores = livesAnteriores.slice(0, MAX_LIVES_GUARDADAS);
}

// Quando a live começa, o que tocou antes do último intervalo de 4h sem música é de lives anteriores:
// vai pra lista de lives guardadas (a playlist não mistura dias e a live atual começa limpa).
// As músicas tocadas logo antes de abrir a live (tela de "começando em breve") continuam na atual.
function comecarHistoricoDeLiveNova() {
  const f = historico.faixas;
  const quando = (i) => Number(f[i].quando) || 0;
  let corte = f.length; // posição da primeira música desta live (f.length = nenhuma: tudo é antigo)
  if (f.length && Date.now() - quando(f.length - 1) < NOVA_LIVE_APOS_MS) {
    corte = f.length - 1;
    while (corte > 0 && quando(corte) - quando(corte - 1) < NOVA_LIVE_APOS_MS) corte--;
  }
  if (corte === 0) return false; // tudo é desta live (ou o histórico está vazio)
  arquivarLives(separarEmLives(f.slice(0, corte), historico.desde));
  historico = { desde: corte < f.length ? quando(corte) : null, faixas: f.slice(corte) };
  salvarFila();
  log(`📀 Live nova: a lista anterior (${corte} música(s)) foi guardada e a contagem desta live começou.`);
  return true;
}

// Sem o login da Twitch o app não sabe quando a live começa. Então, fora da live (ou sem saber),
// depois de 4 horas sem música a próxima música começa uma live nova e a lista anterior fica guardada.
// Durante a live (com o login), uma pausa longa não divide a live em duas.
function separarSeFoiOutraLive() {
  if (estado.aoVivo === true) return false;
  const ultima = historico.faixas[historico.faixas.length - 1];
  const quando = ultima ? horaValida(ultima.quando) : 0;
  if (!quando || Date.now() - quando < NOVA_LIVE_APOS_MS) return false;
  const n = historico.faixas.length;
  arquivarLives(separarEmLives(historico.faixas, historico.desde));
  historico = { desde: null, faixas: [] };
  log(`📀 Live nova: depois de 4 horas sem música, a lista anterior (${n} música(s)) foi guardada.`);
  return true;
}

// A live está no ar? Só dá pra saber com o login da Twitch (passo 3); sem ele fica "não sei" (null).
async function verificarAoVivo() {
  const t = tokens.twitch;
  if (!cfg.canal_twitch || !estado.twitch || !t || t.client_id !== cfg.twitch_client_id) { estado.aoVivo = null; return; }
  try {
    const d = await helix('GET', '/streams', { user_login: cfg.canal_twitch });
    const estava = estado.aoVivo;
    estado.aoVivo = !!(d && Array.isArray(d.data) && d.data.some((s) => s.type === 'live'));
    // a live acabou de começar (ou o app abriu com ela no ar): se for uma live nova, o histórico recomeça
    if (estado.aoVivo && estava !== true) comecarHistoricoDeLiveNova();
    if (estado.aoVivo !== estava) adiantarPlayer();
  } catch {
    // sem internet ou a Twitch não respondeu: fica como estava e tenta de novo daqui a pouco
  }
}

// O app abriu sem internet (ou a Twitch estava fora do ar): o chat volta sozinho, mas só lendo.
// Quando a Twitch voltar a responder, entra de novo com o login salvo (respostas, pontos e "ao vivo" voltam).
let recuperandoTwitch = false;
async function recuperarTwitch() {
  const t = tokens.twitch;
  if (recuperandoTwitch || estado.twitch || !cfg.twitch_client_id || !t || t.client_id !== cfg.twitch_client_id) return false;
  recuperandoTwitch = true;
  try {
    if (!(await infoTwitch())) return false; // ainda sem resposta (ou o login venceu): tenta de novo depois
    log('🔄 A Twitch voltou a responder. Entrando de novo com o seu login...');
    await reconectarChat();
    return true;
  } finally {
    recuperandoTwitch = false;
  }
}

// A Twitch exige que apps com login confiram o login ao abrir (feito ao conectar o chat) e depois de hora em hora.
// Se ele venceu ou foi revogado, o bot passa a só ler o chat e o cartão da Twitch no painel avisa "Login vencido".
async function conferirLoginTwitch() {
  const t = tokens.twitch;
  if (!t || !cfg.twitch_client_id || t.client_id !== cfg.twitch_client_id) return;
  if (!estado.twitch) { await recuperarTwitch(); return; } // ainda não entrou com o login (ex.: abriu sem internet)
  const info = await infoTwitch();
  if (info) { estado.twitch = info; return; }
  if (!tokens.twitch) await reconectarChat(); // venceu: reconecta só lendo (sem respostas nem pontos até entrar de novo)
  // sem resposta (internet): confere de novo daqui a uma hora
}

// Clique no cartão de status do painel: confere a conexão usando o login que já está salvo.
// Se o login não valer mais, o painel abre a Sincronização pra conectar de novo.
async function reverificarSpotify() {
  if (!spotifyConectado()) return { conectado: false, mensagem: 'O Spotify não está conectado. Conecte na Sincronização.' };
  try {
    const eu = await spotify('GET', '/me'); // o acesso é renovado sozinho aqui, como sempre
    estado.spotify.conectado = true;
    estado.spotify.erro = null;
    estado.spotify.usuario = eu.display_name || eu.id;
    estado.spotify.premium = eu.product ? eu.product === 'premium' : null;
  } catch (e) {
    if (e.semLogin || !spotifyConectado() || e.status === 401 || e.status === 403) {
      return { conectado: false, mensagem: 'O login do Spotify não vale mais. Conecte de novo na Sincronização.' };
    }
    return { conectado: true, mensagem: '⚠️ Não consegui falar com o Spotify agora. Confira a internet e tente de novo.' };
  }
  await atualizarPlayer();
  log('🔄 Spotify conferido pelo painel.');
  if (!estado.spotify.aparelho) return { conectado: true, mensagem: 'Spotify conectado, mas fechado no PC: abra o Spotify e dê play.' };
  return { conectado: true, mensagem: '✅ Spotify funcionando.' };
}

async function reverificarTwitch() {
  if (!cfg.canal_twitch) return { conectado: false, mensagem: 'Falta colocar o canal da Twitch na Sincronização.' };
  if (estado.twitchLoginVencido) return { conectado: false, mensagem: 'O login da Twitch venceu. Entre de novo na Sincronização (passo 3).' };
  const tinhaLogin = !!(tokens.twitch && tokens.twitch.client_id === cfg.twitch_client_id);
  if (estado.chat.conectado) {
    // o chat já está funcionando: só confere o login, sem derrubar a conexão
    if (tinhaLogin) {
      if (!estado.twitch) {
        // o app abriu sem internet e ficou só lendo o chat: entra com o login agora
        await recuperarTwitch();
        for (let i = 0; i < 24 && !estado.chat.conectado; i++) await esperar(250);
      } else {
        const info = await infoTwitch();
        if (info) estado.twitch = info;
      }
      if (!tokens.twitch) { await reconectarChat(); return { conectado: false, mensagem: 'O login da Twitch não vale mais. Entre de novo na Sincronização.' }; }
      if (!estado.twitch) return { conectado: true, mensagem: '⚠️ O chat está conectado, mas a Twitch não confirmou o seu login agora (internet?). O app tenta de novo sozinho.' };
    }
  } else {
    await reconectarChat();
    if (tinhaLogin && !tokens.twitch) return { conectado: false, mensagem: 'O login da Twitch não vale mais. Entre de novo na Sincronização.' };
    for (let i = 0; i < 24 && !estado.chat.conectado; i++) await esperar(250);
  }
  await verificarAoVivo();
  log('🔄 Twitch conferida pelo painel.');
  if (!estado.chat.conectado) return { conectado: false, mensagem: `Não consegui entrar no chat de #${cfg.canal_twitch}. Confira o nome do canal e a internet.` };
  return { conectado: true, mensagem: `✅ Chat de #${cfg.canal_twitch} conectado${estado.aoVivo ? ' · a live está no ar!' : '.'}` };
}

// ---------------------------------------------------------------- comandos do chat
// Viewer mandou !skip: explica que é só pra mods (no máximo 1 vez por minuto pra cada viewer, pra não virar spam).
const avisoSkipPara = new Map();
function avisarSkipSoMods(msg, cmd) {
  const agora = Date.now();
  if (agora - (avisoSkipPara.get(msg.usuario) || 0) < 60000) return;
  avisoSkipPara.set(msg.usuario, agora);
  const votar = cfg.votos_para_pular > 0 && cfg.comandos.voteskip[0];
  responder(msg, votar ? `O ${cmd} é só pra mods. Use ${votar} pra votar pra pular.` : `O ${cmd} é só pra mods.`);
}

function responder(msg, texto) {
  log(`   ↳ ${msg.teste ? '(teste) ' : '@' + msg.nome + ': '}${texto}`);
  if (msg.teste || !irc || !irc.podeFalar) return;
  // resposta a uma mensagem do chat vira "respondendo a"; resgate de pontos vira "@nome ..."
  irc.falar(msg.id ? texto : `@${msg.nome} ${texto}`, msg.id || null);
}
function falarNoChat(texto) {
  log('   ↳ ' + texto);
  if (irc && irc.podeFalar) irc.falar(texto);
}

// Devolve true se o pedido entrou (ou foi pra aprovação), false se foi recusado.
async function cmdPedir(msg, arg, mod, opcoes) {
  const { recompensa = false, prioridade = false } = opcoes || {};
  const nao = (t) => { responder(msg, t); return false; };
  const u = msg.usuario;
  const especial = mod || recompensa; // mods e quem gastou pontos não esperam cooldown
  if (!pedidosAbertos && !especial) return nao('🔒 Os pedidos de música estão fechados agora.');
  if (!arg) return nao(`Use: ${cfg.comandos.pedir[0]} nome da música - artista (ou link do Spotify)`);
  if (!/[\p{L}\p{N}]/u.test(arg)) return nao('✍️ Escreva o nome da música (e o artista, se souber).');
  if (cfg.somente_subs_e_vips && !especial && !ehSubOuVip(msg)) return nao('Agora só subs e VIPs podem pedir música.');
  if (!especial) {
    const falta = Math.ceil(((ultimoPedidoDe.get(u) || 0) + cfg.cooldown_segundos * 1000 - Date.now()) / 1000);
    if (falta > 0) return nao(`⏳ Espere ${falta}s para pedir outra música.`);
    const meus = [...naFila(), ...pendentes].filter((p) => p.usuario === u).length;
    const limite = ehSubOuVip(msg) ? cfg.max_pedidos_subs : cfg.max_pedidos_por_pessoa;
    if (meus >= limite) return nao(`Você já tem ${meus} música(s) na fila. Espere tocar!`);
  }
  if (!mod && totalAtivos() >= cfg.max_fila_total) return nao('📛 A fila está cheia, tente daqui a pouco.');

  const busca = await resolverLinkCurto(arg);
  if (LINK_NAO_MUSICA.test(busca)) return nao('🎵 Só dá pra pedir música (não playlist, álbum ou artista). Mande o link de uma música.');
  if (/https?:\/\//i.test(busca) && !extrairIdSpotify(busca)) return nao('🔗 Só aceito link de música do Spotify. Ou escreva o nome da música.');

  const t = await buscarMusica(busca);
  if (!t) return nao(`🔍 Não achei "${arg.slice(0, 60)}". Tente nome da música + artista.`);
  const f = infoFaixa(t);

  if (cfg.musicas_banidas.some((m) => m.uri === f.uri)) return nao('🚫 Essa música foi banida aqui.');
  if (cfg.bloquear_explicitas && f.explicita) return nao(`🚫 "${f.titulo}" é explícita e não é permitida.`);
  if (cfg.duracao_maxima_minutos > 0 && f.duracao > cfg.duracao_maxima_minutos * 60000) {
    return nao(`🚫 "${f.titulo}" passa de ${cfg.duracao_maxima_minutos} minutos.`);
  }
  if (cfg.palavras_bloqueadas.some((p) => norm(f.titulo + ' ' + f.album).includes(p))) return nao('🚫 Essa música não é permitida aqui.');
  if (tocandoAgora && tocandoAgora.uri === f.uri) return nao(`🎶 "${f.titulo}" já está tocando agora!`);
  if ([...naFila(), ...pendentes].some((p) => p.uri === f.uri)) return nao(`"${f.titulo}" já está na fila!`);

  const p = {
    id: proximoId++, ...f, usuario: u, pedidoPor: msg.nome, quando: Date.now(),
    prioridade: !!prioridade, alerta: alertaDe(f), enviado: false, enviadoEm: 0, pular: false, idMensagem: msg.id || null,
  };
  if (p.alerta) log(`🚩 Atenção: "${f.titulo}" tem o termo "${p.alerta}"`);
  ultimoPedidoDe.set(u, Date.now());

  if (cfg.aprovar_pedidos && !especial) {
    pendentes.push(p);
    salvarFila();
    responder(msg, `⏳ "${f.titulo}" está esperando a aprovação do streamer.`);
    return true;
  }
  const pos = inserirNaFila(p);
  responder(msg, `🎵 "${f.titulo}" entrou na fila (posição ${pos}).` + (prioridade ? ' ⚡ Furou a fila!' : ''));
  await alimentarSpotify();
  return true;
}

function cmdTocando(msg) {
  const t = tocandoAgora;
  if (!t) return responder(msg, 'Nada tocando no momento.');
  return responder(msg, `🎶 Tocando agora: ${t.titulo}` + (t.pedidoPor ? ` (pedida por ${t.pedidoPor})` : '') + ` → ${linkSpotify(t.uri)}`);
}

function cmdFila(msg) {
  const l = naFila();
  const meuIdx = l.findIndex((p) => p.usuario === msg.usuario);
  const minhaPendente = pendentes.some((p) => p.usuario === msg.usuario);
  const minha = meuIdx >= 0 ? ` | Sua música está na posição ${meuIdx + 1}.` : (minhaPendente ? ' | Sua música está esperando aprovação.' : '');
  if (!l.length) return responder(msg, `A fila está vazia. Peça com ${cfg.comandos.pedir[0]} música - artista` + minha);
  const txt = l.slice(0, 3).map((p, i) => `${i + 1}. ${p.titulo} (${p.pedidoPor})`).join(' | ');
  return responder(msg, `📜 ${txt}` + (l.length > 3 ? ` ...e mais ${l.length - 3}` : '') + minha);
}

function cmdRemover(msg, arg, mod) {
  const alvo = mod && arg ? norm(arg).replace(/^@/, '').split(/\s/)[0] : msg.usuario;
  const doAlvo = [...naFila(), ...pendentes].filter((p) => p.usuario === alvo).sort((a, b) => a.quando - b.quando);
  if (!doAlvo.length) return responder(msg, alvo === msg.usuario ? 'Você não tem música na fila.' : `${alvo} não tem música na fila.`);
  const p = doAlvo[doAlvo.length - 1];
  removerPedido(p);
  return responder(msg, `❌ "${p.titulo}" foi tirada da fila.`);
}

async function cmdVoteskip(msg) {
  const precisa = cfg.votos_para_pular;
  if (!precisa) return responder(msg, 'A votação para pular está desligada.');
  if (!tocandoAgora) return responder(msg, 'Nada tocando no momento.');
  votosPular.add(msg.usuario);
  if (votosPular.size >= precisa) {
    votosPular.clear();
    const titulo = tocandoAgora.titulo;
    await pular();
    return responder(msg, `⏭️ O chat votou e "${titulo}" foi pulada!`);
  }
  return responder(msg, `🗳️ Voto contado: ${votosPular.size}/${precisa} para pular.`);
}

async function cmdVolume(msg, tipo, arg) {
  if (!spotifyConectado()) return responder(msg, '⚠️ O StreamBeats não está conectado ao Spotify agora.');
  const atual = estado.spotify.volume;
  if (tipo === 'volume' && !arg) return responder(msg, atual == null ? 'Não consegui ver o volume agora.' : `🔊 Volume: ${atual}%`);
  if (!temPermissao(msg, cfg.permissao_volume)) return responder(msg, `Só ${QUEM_PODE[cfg.permissao_volume]} podem mudar o volume.`);
  if (!estado.spotify.suportaVolume) return responder(msg, 'O Spotify desse PC não deixa mudar o volume.');
  if (Date.now() < earrapeAte) return responder(msg, 'Espera o earrape acabar 😅');
  let novo;
  if (tipo === 'volmais') novo = (atual == null ? 50 : atual) + 10;
  else if (tipo === 'volmenos') novo = (atual == null ? 50 : atual) - 10;
  else {
    novo = parseInt(String(arg).replace('%', ''), 10);
    if (!Number.isFinite(novo)) return responder(msg, `Use: ${cfg.comandos.volume[0]} 50`);
  }
  const max = msg.badges.has('broadcaster') ? 100 : cfg.volume_max_chat;
  novo = Math.max(0, Math.min(max, novo));
  await definirVolume(novo);
  return responder(msg, `🔊 Volume: ${novo}%` + (novo === max && max < 100 ? ' (máximo pelo chat)' : ''));
}

async function cmdEarrape(msg) {
  if (!temPermissao(msg, cfg.permissao_extras)) {
    return responder(msg, cfg.permissao_extras === 'desligado' ? 'O earrape pelo chat está desligado.' : `Só ${QUEM_PODE[cfg.permissao_extras]} podem usar o earrape.`);
  }
  const espera = cfg.earrape_espera_minutos * 60000;
  if (!ehMod(msg) && Date.now() < ultimoEarrapeChat + espera) {
    return responder(msg, `⏳ Próximo earrape em ${Math.ceil((ultimoEarrapeChat + espera - Date.now()) / 60000)} min.`);
  }
  const aviso = await earrape(msg.nome);
  if (aviso) return responder(msg, aviso);
  ultimoEarrapeChat = Date.now();
  return undefined;
}

async function cmdFurarFila(msg, arg) {
  if (!temPermissao(msg, cfg.permissao_extras)) {
    return responder(msg, cfg.permissao_extras === 'desligado' ? 'O furar fila pelo chat está desligado.' : `Só ${QUEM_PODE[cfg.permissao_extras]} podem furar a fila.`);
  }
  const mod = ehMod(msg);
  if (!mod && !pedidosAbertos) return responder(msg, '🔒 Os pedidos de música estão fechados agora.');
  const espera = cfg.furarfila_espera_minutos * 60000;
  const ultimo = ultimoFurarFilaDe.get(msg.usuario) || 0;
  if (!mod && Date.now() < ultimo + espera) {
    return responder(msg, `⏳ Você pode furar a fila de novo em ${Math.ceil((ultimo + espera - Date.now()) / 60000)} min.`);
  }
  const ok = await cmdPedir(msg, arg, mod, { recompensa: true, prioridade: true });
  if (ok) ultimoFurarFilaDe.set(msg.usuario, Date.now());
  return undefined;
}

async function aoMensagem(msg) {
  let texto = msg.texto.trim();
  const mod = ehMod(msg);
  const c = cfg.comandos;

  // Pontos do canal (recompensas com texto chegam pelo chat)
  if (msg.recompensa) {
    // as recompensas criadas pelo app chegam pelo EventSub; aqui ignora pra não contar duas vezes
    if (TIPOS_RECOMPENSA.some((k) => cfg.recompensas_api[k] && cfg.recompensas_api[k].id === msg.recompensa)) return;
    if (aprendendoRecompensa) {
      cfg[`recompensa_${aprendendoRecompensa}_id`] = msg.recompensa;
      salvarConfig();
      log(`🎁 Recompensa de "${NOMES_RECOMPENSA[aprendendoRecompensa]}" detectada e salva!`);
      aprendendoRecompensa = null;
      return;
    }
    const qual = TIPOS_RECOMPENSA.find((k) => cfg[`recompensa_${k}_id`] === msg.recompensa);
    if (qual) {
      if (cfg.usuarios_bloqueados.includes(msg.usuario)) return;
      log(`🎁 ${msg.nome} resgatou "${NOMES_RECOMPENSA[qual]}"` + (texto ? `: ${texto}` : ''));
      try {
        if (qual === 'earrape') {
          const aviso = await earrape(msg.nome);
          if (aviso) responder(msg, aviso);
        } else {
          texto = tirarComandoDoTexto(texto);
          const ok = await cmdPedir(msg, texto, mod, { recompensa: true, prioridade: qual === 'prioridade' });
          if (!ok) responder(msg, 'O streamer pode devolver seus pontos pela Twitch.');
        }
      } catch (e) {
        log('❗ Erro: ' + e.message);
        responder(msg, '⚠️ Deu um erro ao falar com o Spotify, o streamer pode devolver seus pontos.');
      }
      return;
    }
  }

  if (!texto.startsWith('!')) return;
  const i = texto.search(/\s/);
  const cmd = norm(i < 0 ? texto : texto.slice(0, i));
  const arg = i < 0 ? '' : texto.slice(i).trim();
  if (!Object.values(c).some((l) => l.includes(cmd))) return;
  if (cfg.usuarios_bloqueados.includes(msg.usuario)) return;

  log(`💬 ${msg.nome}: ${texto}`);
  try {
    if (c.pedir.includes(cmd)) await cmdPedir(msg, arg, mod);
    else if (c.tocando.includes(cmd)) cmdTocando(msg);
    else if (c.fila.includes(cmd)) cmdFila(msg);
    else if (c.remover.includes(cmd)) cmdRemover(msg, arg, mod);
    else if (c.voteskip.includes(cmd)) await cmdVoteskip(msg);
    else if (c.volume.includes(cmd)) await cmdVolume(msg, 'volume', arg);
    else if (c.volmais.includes(cmd)) await cmdVolume(msg, 'volmais', arg);
    else if (c.volmenos.includes(cmd)) await cmdVolume(msg, 'volmenos', arg);
    else if (c.earrape.includes(cmd)) await cmdEarrape(msg);
    else if (c.furarfila.includes(cmd)) await cmdFurarFila(msg, arg);
    else if (c.pular.includes(cmd) && mod) { await pular(); responder(msg, '⏭️ Pulando a música.'); }
    else if (c.pular.includes(cmd)) avisarSkipSoMods(msg, cmd);
    else if (c.abrir.includes(cmd) && mod) { definirPedidosAbertos(true); responder(msg, '🔓 Pedidos de música abertos!'); }
    else if (c.fechar.includes(cmd) && mod) { definirPedidosAbertos(false); responder(msg, '🔒 Pedidos de música fechados.'); }
  } catch (e) {
    log('❗ Erro: ' + e.message);
    responder(msg, e.semLogin ? '⚠️ O StreamBeats não está conectado ao Spotify agora.' : '⚠️ Deu um erro ao falar com o Spotify, tenta de novo daqui a pouco.');
  }
}

// ---------------------------------------------------------------- atualização pelo GitHub
function compararVersao(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}
async function procurarAtualizacao(avisar) {
  if (!GITHUB_REPO) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamBeats-app' },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404) { estado.atualizacao = { versao: VERSAO, nova: false }; return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const versao = String(d.tag_name || '').replace(/^v/i, '');
    const exe = (d.assets || []).find((a) => /\.exe$/i.test(a.name));
    const sha = (d.assets || []).find((a) => /\.sha256$/i.test(a.name));
    estado.atualizacao = {
      versao, nova: compararVersao(versao, VERSAO) > 0, notas: String(d.body || '').slice(0, 1500),
      urlExe: exe ? exe.browser_download_url : null, urlSha: sha ? sha.browser_download_url : null, pagina: d.html_url,
    };
    if (estado.atualizacao.nova && avisar !== false) log(`⬆️ Nova versão do StreamBeats disponível: v${versao}`);
  } catch (e) {
    estado.atualizacao = { ...(estado.atualizacao || {}), erro: 'Não consegui procurar atualizações agora.' };
    log('⚠️ Não consegui procurar atualizações: ' + e.message);
  }
}
async function aplicarAtualizacao() {
  if (!EH_EXE) throw new Error('A atualização automática só funciona no .exe. Pelo "iniciar", baixe a versão nova no GitHub.');
  const a = estado.atualizacao;
  if (!a || !a.nova || !a.urlExe || !a.urlSha) throw new Error('Não tem atualização pronta para baixar.');
  const prefixo = `https://github.com/${GITHUB_REPO}/releases/download/`;
  if (!a.urlExe.startsWith(prefixo) || !a.urlSha.startsWith(prefixo)) throw new Error('O endereço do download não é do GitHub do projeto. Atualização cancelada.');
  log(`⬇️ Baixando a versão ${a.versao}...`);
  const cab = { 'User-Agent': 'StreamBeats-app' };
  const esperado = ((await (await fetch(a.urlSha, { headers: cab })).text()).match(/\b[0-9a-f]{64}\b/i) || [])[0];
  if (!esperado) throw new Error('A assinatura da atualização não veio certa. Atualização cancelada.');
  const r = await fetch(a.urlExe, { headers: cab });
  if (!r.ok) throw new Error(`O download falhou (HTTP ${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (crypto.createHash('sha256').update(buf).digest('hex') !== esperado.toLowerCase()) {
    throw new Error('O arquivo baixado não confere com a assinatura. Atualização cancelada por segurança.');
  }
  const exe = process.execPath;
  const novo = exe + '.novo';
  const velho = exe + '.old';
  fs.writeFileSync(novo, buf);
  try { fs.rmSync(velho, { force: true }); } catch { /* ainda em uso */ }
  fs.renameSync(exe, velho); // o Windows deixa renomear o .exe que está rodando
  try {
    fs.renameSync(novo, exe);
  } catch (e) {
    fs.renameSync(velho, exe);
    throw e;
  }
  log(`✅ Atualizado para a versão ${a.versao}. Reabrindo...`);
  salvarFila();
  setTimeout(() => {
    spawn(exe, ['--sem-janela'], { cwd: PASTA, detached: true, stdio: 'ignore', env: { ...process.env, STREAMBEATS_ESPERAR_MS: '2500' } }).unref();
    process.exit(0);
  }, 400);
}

// ---------------------------------------------------------------- painel (servidor local)
// Arquivos do painel: dentro do .exe ficam embutidos; rodando com node, vêm da pasta.
function lerArquivo(nome) {
  return EH_EXE ? Buffer.from(sea.getAsset(nome)) : fs.readFileSync(path.join(__dirname, nome));
}

// Janela de "Novidades": pega do CHANGELOG.md os tópicos da versão atual.
let novidadesCache;
function lerNovidades() {
  if (novidadesCache !== undefined) return novidadesCache;
  novidadesCache = null;
  try {
    const linhas = lerArquivo('CHANGELOG.md').toString('utf8').split(/\r?\n/);
    const inicio = linhas.findIndex((l) => l.startsWith(`## v${VERSAO} `) || l.trim() === `## v${VERSAO}`);
    if (inicio < 0) return null;
    const itens = [];
    let resumo = '';
    for (const l of linhas.slice(inicio + 1)) {
      if (l.startsWith('## ')) break;
      const limpa = (s) => s.replace(/\*\*|`/g, '').trim();
      if (/^\s*[-*] /.test(l)) itens.push(limpa(l.replace(/^\s*[-*] /, '')));
      else if (!resumo && l.trim()) resumo = limpa(l);
    }
    if (itens.length) novidadesCache = { versao: VERSAO, resumo, itens: itens.slice(0, 12) };
  } catch { /* sem CHANGELOG: sem janela de novidades */ }
  return novidadesCache;
}
function htmlDoPainel() {
  // Só para desenvolvimento: STREAMBEATS_PAINEL aponta para um painel de teste (prévia de um visual novo).
  const teste = !EH_EXE && process.env.STREAMBEATS_PAINEL;
  const html = teste ? fs.readFileSync(teste) : lerArquivo('painel.html');
  return html.toString('utf8').replace('__CHAVE__', CHAVE);
}

const ARQUIVOS_PUBLICOS = {
  '/favicon.ico': ['assets/streambeats.ico', 'image/x-icon'],
  '/icone.png': ['assets/streambeats_256x256.png', 'image/png'],
  '/icone-512.png': ['assets/streambeats_512x512.png', 'image/png'],
  '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
};
const MANIFESTO = JSON.stringify({
  name: 'StreamBeats - TwitchSongRequest',
  short_name: 'StreamBeats',
  start_url: '/',
  display: 'standalone',
  background_color: '#0e0e13',
  theme_color: '#121219',
  icons: [
    { src: '/icone.png', sizes: '256x256', type: 'image/png' },
    { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
  ],
});

function paginaSimples(res, corpo, redirecionar) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>StreamBeats</title><link rel="icon" href="/icone.png">
${redirecionar ? `<meta http-equiv="refresh" content="2;url=${URL_PAINEL}">` : ''}
<body style="font-family:system-ui,sans-serif;padding:48px;background:#0f0f14;color:#eee">${corpo}</body>`);
}

function json(res, codigo, dados) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { d += c; if (d.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const paraPainel = ({ id, titulo, nome, artistas, imagem, duracao, explicita, pedidoPor, prioridade, alerta, enviado, pular: vaiPular }) => (
  { id, titulo, nome, artistas, imagem, duracao, explicita, pedidoPor, prioridade, alerta, enviado, pular: vaiPular });

function estadoParaPainel() {
  return {
    config: cfg,
    versao: VERSAO,
    ehExe: EH_EXE,
    repoAtualizacao: GITHUB_REPO,
    atualizacao: estado.atualizacao,
    redirects: { spotify: SPOTIFY_REDIRECT, twitch: TWITCH_REDIRECT },
    urlOverlay: URL_OVERLAY,
    pasta: PASTA,
    spotify: { ...estado.spotify, conectado: spotifyConectado() && estado.spotify.conectado },
    podeCriarPlaylist: podeCriarPlaylist(),
    chat: estado.chat,
    twitchLogado: !!(tokens.twitch && tokens.twitch.client_id === cfg.twitch_client_id),
    twitch: {
      login: estado.twitch ? estado.twitch.login : null,
      ehDono: ehDonoDoCanal(),
      temEscopos: temEscoposPontos(),
      podeApi: podeUsarApiPontos(),
      eventsub: !!estado.eventsub,
      aoVivo: estado.aoVivo,
      loginVencido: estado.twitchLoginVencido,
    },
    player: estado.player,
    earrapeAtivo: Date.now() < earrapeAte,
    pedidosAbertos,
    tocandoAgora,
    votos: { atual: votosPular.size, precisa: cfg.votos_para_pular },
    pedidos: pedidos.map(paraPainel),
    pendentes: pendentes.map(paraPainel),
    historico: {
      quantidade: historico.faixas.length, desde: historico.desde,
      // a atual + as guardadas, com quantas músicas iriam pra playlist de cada uma
      lives: [{ id: 'atual', desde: historico.desde, quantidade: urisDaLive(historico).length },
        ...livesAnteriores.map((l) => ({ id: String(l.desde), desde: l.desde, quantidade: urisDaLive(l).length }))],
    },
    aprendendoRecompensa,
    novidades: lerNovidades(),
    deck: {
      comandos: Object.entries(COMANDOS_DECK).map(([id, [nome, icone]]) => ({ id, nome, icone })),
      pasta: path.join(PASTA, 'Atalhos pro Stream Deck'),
      windows: process.platform === 'win32',
    },
    logs,
  };
}

function estadoParaOverlay() {
  const t = tocandoAgora;
  return {
    versao: VERSAO, // o overlay se recarrega sozinho quando o app muda de versão (pega as correções sem mexer no OBS)
    tocando: t ? { uri: t.uri, nome: t.nome, artistas: t.artistas, titulo: t.titulo, imagem: t.imagem, pedidoPor: t.pedidoPor } : null,
    player: estado.player,
    proximas: naFila().slice(0, 3).map((p) => ({ titulo: p.titulo, nome: p.nome, artistas: p.artistas, pedidoPor: p.pedidoPor })),
    esconderPausado: cfg.esconder_overlay_pausado,
  };
}

async function acaoDoPainel(a) {
  const id = Number(a.id);
  switch (a.tipo) {
    case 'tocar-pausar':
      await spotify('PUT', estado.player && estado.player.tocando ? '/me/player/pause' : '/me/player/play');
      conferirPlayerEm(600);
      return null;
    case 'voltar':
      await spotify('POST', '/me/player/previous');
      conferirPlayerEm(700);
      return null;
    case 'volume':
      if (Date.now() < earrapeAte) return 'Espera o earrape acabar.';
      await definirVolume(a.valor);
      return null;
    case 'pular':
      await pular();
      log('⏭️ Música pulada pelo painel.');
      return null;
    case 'banir-atual':
      if (!tocandoAgora) return 'Nada tocando agora.';
      banir(tocandoAgora.uri, tocandoAgora.titulo);
      await pular();
      return null;
    case 'remover': {
      const p = acharPedido(id);
      if (p) { removerPedido(p); log(`⏭️ "${p.titulo}" tirada da fila pelo painel.`); }
      return null;
    }
    case 'banir': {
      const p = acharPedido(id);
      if (p) banir(p.uri, p.titulo);
      return null;
    }
    case 'topo':
      moverPara(id, primeiraPosicaoLivre());
      return null;
    case 'mover':
      moverPara(id, a.para);
      return null;
    case 'tocar-agora':
      return tocarAgora(id);
    case 'aprovar': {
      const p = pendentes.find((x) => x.id === id);
      if (!p) return null;
      pendentes.splice(pendentes.indexOf(p), 1);
      const pos = inserirNaFila(p);
      log(`✅ Aprovada: ${p.titulo}`);
      falarNoChat(`✅ @${p.pedidoPor} sua música "${p.titulo}" foi aprovada! Posição ${pos}.`);
      await alimentarSpotify();
      return null;
    }
    case 'recusar': {
      const p = pendentes.find((x) => x.id === id);
      if (!p) return null;
      pendentes.splice(pendentes.indexOf(p), 1);
      salvarFila();
      log(`🙅 Recusada: ${p.titulo}`);
      return null;
    }
    case 'desbanir':
      cfg.musicas_banidas = cfg.musicas_banidas.filter((m) => m.uri !== a.uri);
      salvarConfig();
      return null;
    case 'aprender':
      aprendendoRecompensa = TIPOS_RECOMPENSA.includes(a.qual) ? a.qual : null;
      if (aprendendoRecompensa) log('🎁 Esperando alguém resgatar a recompensa no chat...');
      return null;
    case 'limpar-recompensa':
      if (TIPOS_RECOMPENSA.includes(a.qual)) { cfg[`recompensa_${a.qual}_id`] = ''; salvarConfig(); }
      return null;
    case 'criar-recompensas':
      await criarRecompensas();
      return '🎁 Recompensas criadas na Twitch!';
    case 'recompensa-ligar': {
      if (!TIPOS_RECOMPENSA.includes(a.qual) || !cfg.recompensas_api[a.qual]) return null;
      const ligada = !!a.ligada;
      await mudarRecompensa(a.qual, { is_enabled: ligada });
      cfg.recompensas_api[a.qual].ligada = ligada;
      salvarConfig();
      log(`🎁 "${NOMES_RECOMPENSA[a.qual]}" ${ligada ? 'ligada' : 'desligada'} na Twitch.`);
      return null;
    }
    case 'recompensa-custo': {
      if (!TIPOS_RECOMPENSA.includes(a.qual)) return null;
      cfg.custos[a.qual] = inteiro(a.custo, cfg.custos[a.qual], 1, 10000000);
      salvarConfig();
      if (cfg.recompensas_api[a.qual]) await mudarRecompensa(a.qual, { cost: cfg.custos[a.qual] });
      return null;
    }
    case 'remover-recompensas':
      await removerRecompensas();
      return null;
    case 'procurar-atualizacao':
      if (!GITHUB_REPO) return 'A atualização automática ainda não foi configurada.';
      await procurarAtualizacao(false);
      return estado.atualizacao && estado.atualizacao.nova ? `Versão ${estado.atualizacao.versao} disponível!` : 'Você já está na versão mais nova.';
    case 'atualizar':
      await aplicarAtualizacao();
      return 'Atualizando... o app reabre sozinho.';
    case 'pedidos':
      definirPedidosAbertos(a.abertos);
      log(pedidosAbertos ? '🔓 Pedidos abertos.' : '🔒 Pedidos fechados.');
      return null;
    case 'novidades-vistas':
      // o streamer clicou em "Entendi": a janela de novidades desta versão não aparece de novo
      cfg.ultima_versao_vista = VERSAO;
      salvarConfig();
      return null;
    case 'criar-atalhos': {
      const pasta = await criarAtalhosDeck();
      return `🎛️ Atalhos criados na pasta "${path.basename(pasta)}". É só arrastar cada um pro botão do Stream Deck.`;
    }
    case 'deck':
      return executarComandoDeck(String(a.acao || ''));
    default:
      return 'Ação desconhecida.';
  }
}

// ---------------------------------------------------------------- Stream Deck (Fifine, Elgato e outros)
async function executarComandoDeck(acao) {
  if (!COMANDOS_DECK[acao]) return 'Comando desconhecido.';
  log(`🎛️ Stream Deck: ${COMANDOS_DECK[acao][0]}`);
  switch (acao) {
    case 'tocar-pausar': return acaoDoPainel({ tipo: 'tocar-pausar' });
    case 'pular': return acaoDoPainel({ tipo: 'pular' });
    case 'voltar': return acaoDoPainel({ tipo: 'voltar' });
    case 'banir': return acaoDoPainel({ tipo: 'banir-atual' });
    case 'pedidos': return acaoDoPainel({ tipo: 'pedidos', abertos: !pedidosAbertos });
    case 'volume-mais':
    case 'volume-menos': {
      const atual = estado.spotify.volume == null ? 50 : estado.spotify.volume;
      return acaoDoPainel({ tipo: 'volume', valor: atual + (acao === 'volume-mais' ? 10 : -10) });
    }
    case 'earrape': return earrape(cfg.canal_twitch || 'o streamer');
    default: return null;
  }
}

const textoPs = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// Cria um atalho (.lnk) pra cada comando. O Stream Deck só precisa "abrir" o atalho.
async function criarAtalhosDeck() {
  if (process.platform !== 'win32') throw new Error('Os atalhos do Stream Deck só funcionam no Windows.');
  const pasta = path.join(PASTA, 'Atalhos pro Stream Deck');
  fs.mkdirSync(pasta, { recursive: true });
  const pastaApp = EH_EXE ? path.dirname(process.execPath) : __dirname;
  const fixos = [];
  if (!EH_EXE) fixos.push(`"${path.join(__dirname, 'streambeats.js')}"`);
  // se o app está usando outra pasta ou porta (testes), o atalho leva junto
  if (PASTA !== pastaApp) fixos.push(`"--pasta=${PASTA}"`);
  if (PORTA !== 8888) fixos.push(`--porta=${PORTA}`);
  const icone = EH_EXE ? `${process.execPath},0` : path.join(__dirname, 'assets', 'streambeats.ico');
  const linhas = ['$ErrorActionPreference = "Stop"', '$sh = New-Object -ComObject WScript.Shell'];
  for (const [acao, [nome]] of Object.entries(COMANDOS_DECK)) {
    const lnk = path.join(pasta, `StreamBeats - ${nome}.lnk`);
    linhas.push(`$l = $sh.CreateShortcut(${textoPs(lnk)}); $l.TargetPath = ${textoPs(process.execPath)}; `
      + `$l.Arguments = ${textoPs([...fixos, `--deck=${acao}`].join(' '))}; $l.WorkingDirectory = ${textoPs(pastaApp)}; `
      + `$l.IconLocation = ${textoPs(icone)}; $l.WindowStyle = 7; $l.Description = ${textoPs('StreamBeats: ' + nome)}; $l.Save()`);
  }
  const codificado = Buffer.from(linhas.join('\n'), 'utf16le').toString('base64');
  await new Promise((ok, falhou) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificado], { windowsHide: true, stdio: 'ignore' });
    p.on('exit', (codigo) => (codigo === 0 ? ok() : falhou(new Error('Não consegui criar os atalhos (código ' + codigo + ').'))));
    p.on('error', falhou);
  });
  exec(`explorer "${pasta}"`, { windowsHide: true });
  log('🎛️ Atalhos pro Stream Deck criados em: ' + pasta);
  return pasta;
}

// Quem roda "StreamBeats --deck=pular": manda o comando pro StreamBeats aberto e sai, sem janela.
async function enviarComandoDeck(acao) {
  let chave;
  try { chave = fs.readFileSync(ARQ_CONTROLE, 'utf8').trim(); } catch { return; } // o app não está aberto
  try {
    await fetch(`http://127.0.0.1:${PORTA}/api/controle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Controle': chave },
      body: JSON.stringify({ acao }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* o app não respondeu */ }
}

async function tratarControle(req, res) {
  if (req.method !== 'POST' || req.headers['x-controle'] !== CHAVE_CONTROLE) return json(res, 403, { erro: 'chave inválida' });
  const corpo = await lerCorpo(req).catch(() => null);
  try {
    const aviso = await executarComandoDeck(String((corpo && corpo.acao) || ''));
    return json(res, 200, { ok: true, aviso });
  } catch (e) {
    log('❗ Stream Deck: ' + e.message);
    return json(res, 200, { ok: false, erro: e.message });
  }
}

async function desligar() {
  log('Desligando...');
  salvarFila();
  if (Date.now() < earrapeAte && volumeAntesEarrape != null) {
    try { await definirVolume(volumeAntesEarrape); } catch { /* tentamos */ }
  }
  setTimeout(() => process.exit(0), 300);
}

async function tratarApi(req, res, rota) {
  if (req.headers['x-chave'] !== CHAVE) return json(res, 403, { erro: 'chave inválida' });
  if (req.method === 'GET' && rota === '/api/estado') return json(res, 200, estadoParaPainel());
  if (req.method !== 'POST') return json(res, 405, { erro: 'método' });
  const corpo = await lerCorpo(req).catch(() => null);
  if (!corpo) return json(res, 400, { erro: 'corpo inválido' });

  try {
    switch (rota) {
      case '/api/config':
        await aplicarConfig(corpo.config || {});
        return json(res, 200, { ok: true });
      case '/api/acao': {
        const aviso = await acaoDoPainel(corpo);
        return json(res, 200, { ok: true, aviso });
      }
      case '/api/verificar': {
        const r = corpo.servico === 'twitch' ? await reverificarTwitch() : await reverificarSpotify();
        return json(res, 200, { ok: true, ...r });
      }
      case '/api/criar-playlist': {
        const url = await criarPlaylist(corpo.live);
        return json(res, 200, { ok: true, url });
      }
      case '/api/spotify/desconectar':
        desconectarSpotify();
        log('Spotify desconectado.');
        return json(res, 200, { ok: true });
      case '/api/twitch/desconectar':
        delete tokens.twitch;
        salvarTokens();
        estado.twitchLoginVencido = false; // saiu de propósito: não é login vencido
        log('Login da Twitch removido.');
        await reconectarChat();
        return json(res, 200, { ok: true });
      case '/api/teste':
        enfileirarMensagem({
          usuario: 'painel', nome: 'Painel', teste: true, id: null, badges: new Set(['broadcaster']),
          texto: `${cfg.comandos.pedir[0]} ${String(corpo.texto || '').slice(0, 200)}`,
        });
        return json(res, 200, { ok: true });
      case '/api/desligar':
        json(res, 200, { ok: true });
        await desligar();
        return undefined;
      default:
        return json(res, 404, { erro: 'rota desconhecida' });
    }
  } catch (e) {
    return json(res, 200, { ok: false, erro: e.semLogin ? 'Conecte o Spotify primeiro (aba Configurar).' : e.message });
  }
}

function iniciarServidor() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      // Só aceita quem acessa pelo próprio PC (bloqueia truques de outros sites)
      const host = String(req.headers.host || '');
      if (host !== `127.0.0.1:${PORTA}` && host !== `localhost:${PORTA}`) { res.writeHead(403); return res.end(); }
      const u = new URL(req.url, URL_PAINEL);

      try {
        if (u.pathname === '/api/controle') return await tratarControle(req, res);
        if (u.pathname.startsWith('/api/')) return await tratarApi(req, res, u.pathname);

        if (u.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(htmlDoPainel());
        }

        if (u.pathname === '/overlay/estado') return json(res, 200, estadoParaOverlay());

        if (ARQUIVOS_PUBLICOS[u.pathname]) {
          const [arq, tipo] = ARQUIVOS_PUBLICOS[u.pathname];
          res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': u.pathname === '/overlay' ? 'no-store' : 'max-age=86400' });
          // Só para desenvolvimento: STREAMBEATS_OVERLAY aponta para um overlay de teste (prévia).
          if (u.pathname === '/overlay' && !EH_EXE && process.env.STREAMBEATS_OVERLAY) return res.end(fs.readFileSync(process.env.STREAMBEATS_OVERLAY));
          return res.end(lerArquivo(arq));
        }
        if (u.pathname === '/manifest.webmanifest') {
          res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
          return res.end(MANIFESTO);
        }

        if (u.pathname === '/login/spotify') {
          if (u.searchParams.get('k') !== CHAVE) { res.writeHead(403); return res.end(); }
          if (!cfg.spotify_client_id) return paginaSimples(res, '<h2>Coloque o Client ID do Spotify primeiro.</h2>', true);
          res.writeHead(302, { Location: linkLoginSpotify() });
          return res.end();
        }

        if (u.pathname === '/spotify') {
          const e = esperandoLogin.spotify;
          if (!e || u.searchParams.get('state') !== e.state) return paginaSimples(res, '<h2>Link inválido ou expirado.</h2>', true);
          delete esperandoLogin.spotify;
          const code = u.searchParams.get('code');
          if (!code) return paginaSimples(res, '<h2>❌ O Spotify não foi autorizado.</h2>', true);
          try {
            guardarTokenSpotify(await pedirTokenSpotify({
              grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT,
              client_id: cfg.spotify_client_id, code_verifier: e.verifier,
            }));
          } catch (err) {
            log('❗ Login do Spotify falhou: ' + err.message);
            return paginaSimples(res, `<h2>❌ Não deu certo: ${String(err.message).replace(/</g, '&lt;')}</h2>`, true);
          }
          await verificarSpotify();
          res.writeHead(302, { Location: URL_PAINEL });
          return res.end();
        }

        if (u.pathname === '/login/twitch') {
          if (u.searchParams.get('k') !== CHAVE) { res.writeHead(403); return res.end(); }
          if (!cfg.twitch_client_id) return paginaSimples(res, '<h2>Coloque o ID do cliente da Twitch primeiro.</h2>', true);
          res.writeHead(302, { Location: linkLoginTwitch() });
          return res.end();
        }

        if (u.pathname === '/twitch') {
          // A Twitch devolve o token depois do "#" do link, que só o navegador enxerga.
          return paginaSimples(res, `<h2 id="m">Conectando...</h2><script>
const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
fetch('/twitch-token?' + new URLSearchParams({access_token: p.get('access_token') || '', state: p.get('state') || ''}))
  .then(r => r.text()).then(t => { document.getElementById('m').textContent = t; setTimeout(() => location.href = ${JSON.stringify(URL_PAINEL)}, 1500); });
</script>`);
        }

        if (u.pathname === '/twitch-token') {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          const e = esperandoLogin.twitch;
          if (!e || u.searchParams.get('state') !== e.state) return res.end('Link inválido ou expirado.');
          delete esperandoLogin.twitch;
          const tok = u.searchParams.get('access_token');
          if (!tok) return res.end('❌ A Twitch não foi autorizada.');
          tokens.twitch = { access_token: tok, client_id: cfg.twitch_client_id };
          salvarTokens();
          estado.twitchLoginVencido = false;
          if (!cfg.responder_no_chat) { cfg.responder_no_chat = true; salvarConfig(); }
          await reconectarChat();
          return res.end('✅ Twitch conectada! Voltando ao painel...');
        }

        res.writeHead(404);
        return res.end();
      } catch (err) {
        log('❗ Erro no painel: ' + err.message);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
        return undefined;
      }
    });
    srv.on('error', reject);
    srv.listen(PORTA, '127.0.0.1', resolve);
  });
}

// ---------------------------------------------------------------- erros graves
function mostrarErroFatal(mensagem) {
  log('❗ O app parou com um erro: ' + mensagem);
  if (TEM_TERMINAL) {
    imprimir('Aperte Enter para fechar.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
    return;
  }
  if (process.platform !== 'win32') process.exit(1);
  // Sem janela preta: mostra uma caixinha de aviso do Windows.
  const texto = String(mensagem).replace(/'/g, "''").replace(/[\r\n]+/g, ' ').slice(0, 600);
  const ps = spawn('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('O StreamBeats parou com um erro: ${texto}  (Detalhes no arquivo registro.log, na pasta do app.)', 'StreamBeats') | Out-Null`],
  { stdio: 'ignore', windowsHide: true });
  ps.on('exit', () => process.exit(1));
  ps.on('error', () => process.exit(1));
}

// ---------------------------------------------------------------- início
async function main() {
  for (const s of ['stdout', 'stderr']) { try { process[s].on('error', () => {}); } catch { /* sem janela */ } }
  process.title = 'StreamBeats - TwitchSongRequest';
  if (process.env.STREAMBEATS_AUTOTESTE === '1') {
    // usado pelo gerar-exe para conferir se o .exe ficou bom
    htmlDoPainel();
    for (const [arq] of Object.values(ARQUIVOS_PUBLICOS)) lerArquivo(arq);
    lerArquivo('CHANGELOG.md'); // a janela de novidades lê daqui
    if (process.env.STREAMBEATS_AUTOTESTE_ARQ) fs.writeFileSync(process.env.STREAMBEATS_AUTOTESTE_ARQ, 'AUTOTESTE OK ' + VERSAO);
    imprimir('AUTOTESTE OK');
    process.exit(0);
  }
  const deck = argumento('deck');
  if (deck) {
    // aberto por um atalho do Stream Deck: só manda o comando e fecha
    await enviarComandoDeck(deck);
    process.exit(0);
  }
  // Durante a live, um erro inesperado não pode derrubar o app: registra e segue.
  process.on('uncaughtException', (e) => log('❗ Erro inesperado (o app continua): ' + ((e && e.stack) || e)));
  process.on('unhandledRejection', (e) => log('❗ Erro inesperado (o app continua): ' + ((e && e.message) || e)));
  const espera = Number(process.env.STREAMBEATS_ESPERAR_MS) || 0;
  delete process.env.STREAMBEATS_ESPERAR_MS;
  if (espera) await esperar(espera); // depois de uma atualização, espera o app velho fechar

  imprimir('==============================================');
  imprimir(`  StreamBeats - TwitchSongRequest  v${VERSAO}`);
  imprimir('  (pedidos do chat da Twitch -> Spotify)');
  imprimir('  O painel abre numa janela separada.');
  imprimir('  Para DESLIGAR: botão "Desligar" no painel.');
  imprimir('==============================================');
  try {
    await iniciarServidor();
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      imprimir('O StreamBeats já está aberto. Abrindo o painel...');
      abrirPainel();
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    throw e;
  }
  carregarConfig();
  carregarFila();
  try { fs.writeFileSync(ARQ_CONTROLE, CHAVE_CONTROLE); } catch { /* sem a chave, os atalhos não funcionam */ }
  if (fs.existsSync(ARQ_TOKENS)) {
    try { tokens = lerJson(ARQ_TOKENS); } catch { tokens = {}; }
  }
  log(`StreamBeats v${VERSAO} aberto. Painel: ${URL_PAINEL}`);
  if (!process.argv.includes('--sem-janela')) abrirPainel();
  if (EH_EXE) setTimeout(() => { try { fs.rmSync(process.execPath + '.old', { force: true }); } catch { /* ainda em uso */ } }, 8000);

  if (spotifyConectado()) await verificarSpotify();
  await reconectarChat();
  cicloDoPlayer(); // pergunta ao Spotify o que está tocando, no ritmo de proximaConsultaMs()
  setInterval(verificarAoVivo, 60000); // a live está no ar? (confere a cada minuto)
  setInterval(recuperarTwitch, 30000); // abriu sem internet? quando a Twitch voltar, entra com o login de novo
  setInterval(conferirLoginTwitch, 3600000); // a Twitch exige conferir o login de hora em hora (o da abertura é feito ao conectar o chat)
  if (GITHUB_REPO) {
    setTimeout(() => procurarAtualizacao(), 10000);
    setInterval(() => procurarAtualizacao(), 6 * 3600000);
  }
  process.on('SIGINT', () => { salvarFila(); process.exit(0); });
}

if (require.main === module || EH_EXE) {
  main().catch((e) => mostrarErroFatal((e && e.message) || String(e)));
}

module.exports = {
  parseIrc, extrairIdSpotify, textoDeBusca, conectarTwitch, normalizarConfig, relevancia, compararVersao,
  // para os testes
  _teste: {
    definirConfig: (c) => { cfg = normalizarConfig(c); },
    definirTokens: (t) => { tokens = t; },
    definirSpotify: (fn) => { spotify = fn; }, // eslint-disable-line no-func-assign
    estado, get pedidos() { return pedidos; }, get pendentes() { return pendentes; },
    aoMensagem, aoTrocarMusica, alimentarSpotify, acaoDoPainel, moverPara, cmdPedir, tratarResgate,
    definirHelix: (fn) => { helix = fn; }, // eslint-disable-line no-func-assign
    get tocandoAgora() { return tocandoAgora; }, get historico() { return historico; },
    get earrapeAte() { return earrapeAte; },
    // correções da revisão (vigia do chat, tempo limite, recuperação, gravação segura)
    atualizarPlayer, verificarSpotify, reconectarChat, recuperarTwitch, reverificarTwitch,
    gravarSeguro, lerJsonComBackup, carregarConfig, carregarFila,
    get cfg() { return cfg; }, get irc() { return irc; },
    // histórico por live, login da Twitch de hora em hora, pedidos abertos/fechados salvos
    verificarAoVivo, comecarHistoricoDeLiveNova, conferirLoginTwitch, estadoParaPainel,
    definirHistorico: (h) => { historico = h; }, get pedidosAbertos() { return pedidosAbertos; },
    // as 3 últimas lives
    get livesAnteriores() { return livesAnteriores; }, definirLivesAnteriores: (l) => { livesAnteriores = l; },
    separarSeFoiOutraLive, criarPlaylist, separarEmLives,
    // menos consultas ao Spotify e espera depois do bloqueio
    proximaConsultaMs, chamarSpotify: (...a) => spotify(...a), adiantarPlayer, conferirPlayerEm,
    ligarCicloParaTeste: () => { cicloLigado = true; }, get proximaConsultaEm() { return proximaConsultaEm; },
    get pausaSpotifyAte() { return pausaSpotifyAte; }, definirPausaSpotify: (t, zerar = true) => { pausaSpotifyAte = t; if (zerar) bloqueiosSeguidos = 0; },
  },
};
