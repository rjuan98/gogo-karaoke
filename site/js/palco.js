// O palco: abre a sala, guarda a biblioteca, cuida da fila e, quando é a vez de
// alguém, toca a música, mostra as notas vindo e conta os pontos. Com ?robo no
// endereço entra um cantor de mentira que canta sozinho — pra ver tudo sem cantar.
import { hzParaMidi, nomeDaNota, ouvir, limiarDoSilencio } from "./nota.js";
import { abrirSala } from "./sala.js";
import { enderecoSoDesteAparelho, limparCodigo, idDoYoutube } from "./protocolo.js";
import {
  lerMusica, parteSolo, batidaNoTempo, notaNoTempo, midiDoTom, segundosDaBatida, fimDaMusica, frasesParaLetra,
  duracaoDaBatida,
} from "./musica.js";
import { DIFICULDADES, Placar, suavizar, pertoDaOitava, tituloDe, tituloDaDupla } from "./pontuacao.js";
import { TEXTO, ACORDES, SOLO, BATIDAS_POR_TEMPO } from "./musicaDeTeste.js";
import { tocarMusicaDeTeste } from "./sintetizador.js";
import { parearArquivos, separarPorPasta, tocarSom } from "./arquivoDeMusica.js";
import { abrirBiblioteca, pedirParaGuardar } from "./biblioteca.js";
import { novoPedido, filaOrdenada, semQuemSaiu, volumeDaVoz } from "./fila.js";
import { ajustarTela, desenharPauta } from "./pauta.js";
import { desenharCantando, fundo } from "./cantando.js";

const SEM_SINAL_MS = 2000;  // celular que sumiu esse tempo todo provavelmente apagou a tela
// O que o celular leva entre ouvir e mandar, fora a rede: o pedaço de áudio
// analisado (uns 43 ms) e a espera até a próxima leitura (até 50 ms).
// Estimado; dá pra afinar com gente de verdade cantando.
const LATENCIA_MIC_MS = 80;
const FOLGA_DE_TEMPO_S = 0.12;  // entrar ou sair esse tanto fora da nota ainda conta
// Depois do resultado, a próxima música começa sozinha nesse tempo: na festa,
// tempo morto entre uma pessoa e outra mata o clima.
const ESPERA_PROXIMA_SEG = 15;
const ROBO = new URLSearchParams(location.search).has("robo");
const TESTE = { id: "teste", titulo: "Solta a voz", artista: "gogó", dueto: true, semVoz: true };

const cantores = new Map();
const tela = document.getElementById("pauta");
const ctx = tela.getContext("2d");
const lista = document.getElementById("cantores");
const $ = (id) => document.getElementById(id);
const reduzirMovimento = matchMedia("(prefers-reduced-motion: reduce)");
const SEM_MUSICA = new Uint8Array(16).fill(200);  // fora da música, o fundo gira bem aceso

let sala = null;
let audio = null;
let mestre = null;           // o volume geral: tudo que toca passa por ele
let volumeGeral = lerVolume();
let biblioteca = null;
let musicas = [TESTE];       // o que aparece na biblioteca e nos celulares
let fila = [];
let iniciandoProxima = false;
const vezes = new Map();     // quantas vezes cada um pediu e cantou hoje (ordem justa)
const decodificadas = new Map();  // id → áudio já aberto (só a atual e a próxima)
let dificuldadeDoPalco = "medio";
let estado = "sala";         // sala | cantando | livre (vídeo do YouTube) | resultado
let rodada = null;
let contagem = null;         // a próxima começando sozinha
let pedidosDoPalco = 0;
let ultimoEfeitoEmbalo = 0;
let sonsDaMusicaFinal = [];
let limpezaMusicaFinal = null;
let ultimaPontuacaoFinal = null;
let monitorMicrofone = null;
let ganhoAmbiente = null;
let alvoAmbienteAnterior = null;
let ambienteAtual = null;
let ambienteCarregando = false;
let ambienteAnteriorId = null;
const faixasAmbienteFalhas = new Set();

function pararMusicaFinal() {
  clearTimeout(limpezaMusicaFinal);
  limpezaMusicaFinal = null;
  for (const som of sonsDaMusicaFinal) {
    try { som.stop(); } catch { /* o som já terminou */ }
  }
  sonsDaMusicaFinal = [];
}

async function tocarMusicaFinal(pontos) {
  if (!audio || !mestre) return;
  try { await audio.resume(); } catch { return; }
  if (estado !== "resultado" || ultimaPontuacaoFinal !== pontos) return;
  pararMusicaFinal();
  const nivel = Math.max(0, Math.min(1, pontos / 10000));
  const intervalo = 0.58 - nivel * 0.34;
  const total = Math.floor(9.5 / intervalo);
  const escala = [0, 4, 7, 4, 2, 5, 9, 7];
  const inicio = audio.currentTime + 0.08;

  function nota(midi, quando, duracao, forma, volume) {
    const osc = audio.createOscillator();
    const ganho = audio.createGain();
    osc.type = forma;
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    ganho.gain.setValueAtTime(0.0001, quando);
    ganho.gain.exponentialRampToValueAtTime(volume, quando + 0.018);
    ganho.gain.exponentialRampToValueAtTime(0.0001, quando + duracao);
    osc.connect(ganho).connect(mestre);
    osc.start(quando);
    osc.stop(quando + duracao + 0.01);
    sonsDaMusicaFinal.push(osc);
  }

  for (let i = 0; i < total; i++) {
    const quando = inicio + i * intervalo;
    const midi = 48 + Math.round(nivel * 12) + escala[i % escala.length];
    nota(midi, quando, intervalo * 0.78, nivel > 0.75 ? "triangle" : "sine", 0.055);
    // Pontuações altas ganham uma harmonia e pequenos brilhos por cima.
    if (nivel > 0.55 && i % 2 === 0) nota(midi + 7, quando, intervalo * 0.42, "sine", 0.025 + nivel * 0.02);
    if (nivel > 0.82 && i % 4 === 0) nota(midi + 19, quando + 0.04, 0.14, "sine", 0.035);
  }
  limpezaMusicaFinal = setTimeout(() => {
    sonsDaMusicaFinal = [];
    limpezaMusicaFinal = null;
    if (estado === "resultado" && ultimaPontuacaoFinal === pontos) tocarMusicaFinal(pontos);
  }, 10200);
}

function efeitoEmbalo() {
  if (!audio || !mestre || performance.now() - ultimoEfeitoEmbalo < 250) return;
  ultimoEfeitoEmbalo = performance.now();
  const agora = audio.currentTime;
  for (const [i, hz] of [660, 880, 1100].entries()) {
    const osc = audio.createOscillator();
    const ganho = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    ganho.gain.setValueAtTime(0.0001, agora + i * 0.045);
    ganho.gain.exponentialRampToValueAtTime(0.11, agora + i * 0.04 + 0.008);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + i * 0.04 + 0.16);
    osc.connect(ganho).connect(mestre);
    osc.start(agora + i * 0.04);
    osc.stop(agora + i * 0.04 + 0.17);
  }
}

// --- O volume -----------------------------------------------------------------

function lerVolume() {
  try {
    const v = Number(localStorage.getItem("gogo-volume"));
    return Number.isFinite(v) && localStorage.getItem("gogo-volume") !== null ? Math.min(1, Math.max(0, v)) : 0.7;
  } catch {
    return 0.7;
  }
}

function garantirAudio() {
  audio ??= new AudioContext({ latencyHint: "interactive" });
  if (!mestre) {
    mestre = audio.createGain();
    mestre.gain.value = volumeGeral;
    mestre.connect(audio.destination);
  }
  if (!ganhoAmbiente) {
    ganhoAmbiente = audio.createGain();
    ganhoAmbiente.gain.value = 0;
    ganhoAmbiente.connect(mestre);
  }
  return audio;
}

async function iniciarSomDeFundo() {
  const ids = musicas.filter((musica) => musica.id !== "teste").map((musica) => musica.id);
  if (!audio || audio.state !== "running" || estado !== "sala" || !biblioteca || !ganhoAmbiente
    || !ids.length || ambienteAtual || ambienteCarregando) return;
  const disponiveis = ids.filter((id) => !faixasAmbienteFalhas.has(id));
  if (!disponiveis.length) return;
  const semRepetir = disponiveis.filter((id) => id !== ambienteAnteriorId);
  const id = (semRepetir.length ? semRepetir : disponiveis)[Math.floor(Math.random() * (semRepetir.length || disponiveis.length))];
  ambienteCarregando = true;
  try {
    const item = await biblioteca.pegar(id);
    if (!item?.audio) throw new Error("A faixa não tem áudio");
    const buffer = await audio.decodeAudioData(await item.audio.arrayBuffer());
    if (estado !== "sala" || !musicas.some((musica) => musica.id === id) || audio.state !== "running") return;
    const fonte = audio.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(ganhoAmbiente);
    const atual = {
      id, fonte, inicio: audio.currentTime,
      bpm: Math.max(50, Math.min(160, (lerMusica(item.texto).bpm || 304) / 4)),
    };
    ambienteAtual = atual;
    ambienteAnteriorId = id;
    fonte.onended = () => {
      if (ambienteAtual !== atual) return;
      ambienteAtual = null;
      setTimeout(iniciarSomDeFundo, 250);
    };
    fonte.start();
  } catch {
    faixasAmbienteFalhas.add(id);
  } finally {
    ambienteCarregando = false;
  }
}

function atualizarAmbiente() {
  if (!audio || !ganhoAmbiente) return;
  const salaAberta = estado === "sala" && musicas.some((musica) => musica.id !== "teste");
  if (salaAberta !== alvoAmbienteAnterior) {
    alvoAmbienteAnterior = salaAberta;
    ganhoAmbiente.gain.setTargetAtTime(salaAberta ? 0.12 : 0, audio.currentTime, 0.45);
  }
  if (salaAberta && !ambienteAtual) iniciarSomDeFundo();
}

function mudarVolume(v) {
  volumeGeral = Math.min(1, Math.max(0, v));
  mestre?.gain.setTargetAtTime(volumeGeral, audio.currentTime, 0.05);
  try { player?.setVolume(Math.round(volumeGeral * 100)); } catch { /* vídeo ainda abrindo */ }
  try { localStorage.setItem("gogo-volume", String(volumeGeral)); } catch { /* aba anônima */ }
}

// --- A sala -----------------------------------------------------------------

function codigoGuardado() {
  try {
    const codigo = limparCodigo(localStorage.getItem("gogo-sala"));
    return codigo.length === 5 ? codigo : null;
  } catch {
    return null;
  }
}

function mostrarConvite(codigo) {
  try { localStorage.setItem("gogo-sala", codigo); } catch { /* aba anônima: sorteia de novo na próxima */ }
  const linkDoCelular = new URL(`cel.html?sala=${codigo}`, location.href).href;
  const host = location.hostname.toLowerCase();
  const redeLocal = enderecoSoDesteAparelho(host) || /^(10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
  const dicaDeConexao = redeLocal
    ? "celular e computador precisam estar no mesmo Wi-Fi."
    : "compartilhe este link com quem vai cantar.";
  $("enderecoRede").textContent = `Endereço do palco: ${new URL("palco.html", location.href).href} · ${dicaDeConexao}`;
  $("codigo").textContent = codigo;
  if (enderecoSoDesteAparelho(location.hostname)) {
    // Sem QR code: ele mandaria o celular pra "localhost", que é o próprio celular.
    mostrarErro("Abra o palco pelo endereço da rede (o que aparece no terminal) pra os celulares conseguirem entrar.");
    return;
  }
  const qr = qrcode(0, "M");  // global do qrcode-generator, carregado na página
  qr.addData(linkDoCelular);
  qr.make();
  $("qr").innerHTML = qr.createSvgTag(6, 2);
  $("qr").hidden = false;
}

function mostrarErro(texto) {
  $("endereco").textContent = texto;
  $("endereco").classList.add("erro");
  $("endereco").hidden = false;
}

function novoCantor({ id, nome, cor }, reconectando = false) {
  if (reconectando && cantores.has(id)) {
    const cantor = cantores.get(id);
    cantor.nome = nome;
    montarLista();
    sala?.enviar(id, mensagemDaBiblioteca());
    mostrarFila();
    return;
  }
  cantores.set(id, { id, nome, cor, janela: [], pontos: [], ultimo: null, atraso: null, cartao: null });
  montarLista();
  sala?.enviar(id, mensagemDaBiblioteca());
  mostrarFila();  // a lista de quem está na sala mudou: os celulares precisam saber
}

function cantorSaiu(id) {
  cantores.delete(id);
  fila = semQuemSaiu(fila, id);
  montarLista();
  mostrarFila();
}

function nomes(ids) {
  return ids.map((id) => cantores.get(id)?.nome ?? "alguém que saiu").join(" e ");
}

// "Música · Ana e Beto", ou só "Música" quando ninguém está no pedido
// (YouTube posto pelo palco, sem ninguém na sala).
function rotulo(pedido, titulo) {
  return pedido.quem.length ? `${titulo} · ${nomes(pedido.quem)}` : titulo;
}

function receberNota(id, nota) {
  const c = cantores.get(id);
  if (!c) return;
  const t = performance.now();
  c.janela.push(nota.hz ? hzParaMidi(nota.hz) : null);
  if (c.janela.length > 3) c.janela.shift();
  const midi = suavizar(c.janela);
  c.pontos.push({ t, midi, voz: nota.voz });
  c.ultimo = { t, midi, voz: nota.voz };
  c.atraso = nota.atraso;
  if (estado === "cantando") {
    const p = rodada.participantes.find((q) => q.cantor.id === id);
    if (p) registrar(p, midi, nota.voz, t - (nota.atraso ?? 0) - LATENCIA_MIC_MS);
  }
}

// Os cartões são montados uma vez por cantor; depois só o texto muda.
function montarLista() {
  if (!cantores.size) {
    lista.innerHTML = '<p class="vazio">Ninguém entrou ainda.</p>';
    return;
  }
  lista.querySelector(".vazio")?.remove();
  for (const el of [...lista.children]) {
    if (!cantores.has(el.dataset.id)) el.remove();
  }
  for (const c of cantores.values()) {
    if (c.cartao) continue;
    c.cartao = document.createElement("div");
    c.cartao.className = "cantor";
    c.cartao.dataset.id = c.id;
    c.cartao.style.setProperty("--cor", c.cor);
    c.cartao.innerHTML = '<div class="nome"></div><div class="nota">–</div><div class="info"></div>';
    c.cartao.querySelector(".nome").textContent = c.nome;  // nome vem do celular: nunca como HTML
    lista.appendChild(c.cartao);
  }
}

function atualizarCartoes(agora) {
  for (const c of cantores.values()) {
    if (!c.cartao) continue;
    const nota = c.cartao.querySelector(".nota");
    const info = c.cartao.querySelector(".info");
    const u = c.ultimo;
    // Sem detalhe técnico: na festa, só interessa se o microfone está ouvindo.
    if (!u || agora - u.t > SEM_SINAL_MS) {
      nota.textContent = "–";
      info.textContent = c.id === "robo" ? "canta quando a música começar" : "celular desconectado";
    } else if (!u.voz) {
      nota.textContent = "–";
      info.textContent = "em silêncio";
    } else {
      nota.textContent = u.midi === null ? "♪" : nomeDaNota(u.midi);
      info.textContent = "cantando";
    }
  }
}

// --- A biblioteca -----------------------------------------------------------

function mensagemDaBiblioteca() {
  return {
    tipo: "biblioteca",
    musicas: musicas.map(({ id, titulo, artista, dueto, temVoz }) => ({ id, titulo, artista, dueto, temVoz: Boolean(temVoz) })),
  };
}

async function recarregarMusicas() {
  musicas = [...(biblioteca ? await biblioteca.listar() : []), TESTE];
  faixasAmbienteFalhas.clear();
  const n = musicas.length - 1;
  const doPc = musicas.filter((musica) => musica.origem === "pc").length;
  const desteAparelho = n - doPc;
  $("contagemMusicas").textContent = n
    ? `${n} música${n === 1 ? "" : "s"} disponível${n === 1 ? "" : "is"}.`
      + (doPc ? ` ${doPc} do PC; o palco carrega a faixa e a próxima automaticamente.` : "")
      + (desteAparelho ? ` ${desteAparelho} importada${desteAparelho === 1 ? "" : "s"} neste aparelho.` : "")
      + " Uma delas também tocará aleatoriamente enquanto aguardam."
    : "Adicione músicas ou configure a biblioteca compartilhada do PC.";
  mostrarBiblioteca();
  sala?.enviarTodos(mensagemDaBiblioteca());
}

async function adicionarArquivos(arquivos) {
  const todos = [...arquivos];
  if (!todos.length) return;
  if (!biblioteca) {
    $("avisoMusica").textContent = "Este navegador não deixa guardar músicas (aba anônima?).";
    return;
  }
  // Arquivos escolhidos soltos não têm caminho; os da pasta inteira têm.
  const caminho = (f) => f.webkitRelativePath || f.name;
  const porCaminho = new Map(todos.map((f) => [caminho(f), f]));
  const totalDeTxt = todos.filter((f) => /\.txt$/i.test(f.name)).length;
  const problemas = [];
  let substituirColisoes = null;
  let guardadas = 0, lidas = 0;
  for (const [pasta, nomes] of separarPorPasta(todos.map(caminho))) {
    const arquivo = (nome) => porCaminho.get(pasta ? `${pasta}/${nome}` : nome);
    const txts = [];
    for (const nome of nomes.filter((n) => /\.txt$/i.test(n))) {
      $("avisoMusica").textContent = `Guardando ${++lidas} de ${totalDeTxt}…`;
      try {
        const texto = await arquivo(nome).text();
        txts.push({ nome, texto, musica: lerMusica(texto) });
      } catch (erro) {
        problemas.push(`${nome} (${erro.message})`);
      }
    }
    for (const par of parearArquivos(txts, nomes)) {
      if (!par.audio) {
        problemas.push(`${par.musica.titulo || par.nome} (sem o áudio)`);
        continue;
      }
      const m = par.musica;
      const semVoz = par.audio === m.arquivos.instrumental;
      // A voz separada só serve se a música toca o instrumental (senão a
      // artista já está no áudio).
      const voz = semVoz && m.arquivos.voz && nomes.includes(m.arquivos.voz) ? arquivo(m.arquivos.voz) : null;
      const id = `${m.artista} - ${m.titulo}`;
      const existente = await biblioteca.pegar(id);
      if (existente && substituirColisoes === null) {
        substituirColisoes = confirm(`Já existe “${m.titulo} — ${m.artista}” na biblioteca.\n\nSubstituir as músicas com o mesmo artista e título que aparecerem nesta importação?`);
      }
      if (existente && !substituirColisoes) {
        problemas.push(`${m.titulo} (já existe; mantive a versão atual)`);
        continue;
      }
      try {
        await biblioteca.adicionar({
          id, titulo: m.titulo, artista: m.artista,
          dueto: m.partes.length >= 2, semVoz, texto: par.texto, audio: arquivo(par.audio), voz,
        });
        guardadas++;
      } catch {
        problemas.push(`${m.titulo} (não consegui guardar; talvez falte espaço no aparelho)`);
      }
    }
  }
  await pedirParaGuardar();
  await recarregarMusicas();
  $("avisoMusica").textContent = `${guardadas} música${guardadas === 1 ? "" : "s"} guardada${guardadas === 1 ? "" : "s"}.`
    + (problemas.length ? ` Ficaram de fora: ${problemas.join("; ")}.` : "");
}

function botao(texto, classe, aoClicar) {
  const b = document.createElement("button");
  b.className = classe;
  b.textContent = texto;
  b.addEventListener("click", aoClicar);
  return b;
}

function mostrarBiblioteca() {
  const busca = $("buscaBiblioteca").value.trim().toLocaleLowerCase("pt-BR");
  const ul = $("listaBiblioteca");
  ul.replaceChildren();
  for (const m of musicas.filter((x) => `${x.titulo} ${x.artista}`.toLocaleLowerCase("pt-BR").includes(busca))) {
    const li = document.createElement("li");
    li.className = "item";
    const texto = document.createElement("div");
    texto.className = "item-texto";
    texto.textContent = `${m.titulo} · ${m.artista}`;
    const detalhe = document.createElement("div");
    detalhe.className = "item-detalhe";
    detalhe.textContent = [m.id === "teste" ? "música de teste" : "", m.dueto ? "dueto" : "",
      m.origem === "pc" ? "no PC · carrega automaticamente" : "",
      m.semVoz === false ? "com a voz original (falta preparar)" : "",
      m.temVoz ? "a artista pode cantar junto" : ""].filter(Boolean).join(" · ");
    texto.appendChild(detalhe);
    li.append(texto, botao("Pôr na fila", "secundario", () => porNaFilaPeloPalco(m.id)));
    if (m.id !== "teste" && m.origem !== "pc") {
      li.appendChild(botao("Apagar", "secundario", async () => {
        if (!confirm(`Apagar "${m.titulo}" da biblioteca deste aparelho?`)) return;
        await biblioteca.remover(m.id);
        decodificadas.delete(`${m.id}|audio`);
        decodificadas.delete(`${m.id}|voz`);
        await recarregarMusicas();
      }));
    }
    ul.appendChild(li);
  }
}

// Pelo palco, a música entra na fila pra quem está na sala (até duas pessoas).
// Um aviso por cima de tudo, embaixo, que some sozinho. Sem ele, o clique que
// não podia dar certo (música sem ninguém pra cantar) parecia não fazer nada.
let avisoSome = null;
function avisar(texto) {
  $("aviso").textContent = texto;
  $("aviso").hidden = false;
  clearTimeout(avisoSome);
  avisoSome = setTimeout(() => { $("aviso").hidden = true; }, 5000);
}

function porNaFilaPeloPalco(musicaId) {
  const quem = [...cantores.keys()].slice(0, Number($("participantesPalco").value));
  if (!quem.length) {
    avisar("Falta alguém pra cantar: ligue o microfone aqui em cima ou entre na sala pelo celular.");
    $("nomeMicrofone").scrollIntoView({ behavior: "smooth", block: "center" });
    $("nomeMicrofone").focus({ preventScroll: true });
    return;
  }
  // No fácil, a artista canta junto baixinho: é o modo de quem tem vergonha.
  const voz = musicas.find((m) => m.id === musicaId)?.temVoz && dificuldadeDoPalco === "facil" ? 0.35 : 0;
  fila.push({ id: `palco${++pedidosDoPalco}`, musicaId, quem, dificuldade: dificuldadeDoPalco, voz, pedidoPor: "palco" });
  $("painelBiblioteca").hidden = true;
  mostrarFila();
  avisar(`${musicas.find((m) => m.id === musicaId)?.titulo ?? "A música"} entrou na fila.`);
}

// YouTube pelo próprio palco: serve até sem ninguém conectado (o vídeo toca
// do mesmo jeito; só não tem voz pra desenhar).
function porYoutubeNaFila() {
  const video = idDoYoutube($("linkYoutubePalco").value);
  if (!video) {
    $("avisoYoutube").textContent = "Esse link não parece ser de um vídeo do YouTube.";
    return;
  }
  const pedido = {
    id: `palco${++pedidosDoPalco}`, youtube: video, titulo: "Vídeo do YouTube",
    quem: [...cantores.keys()].slice(0, Number($("participantesPalco").value)), pedidoPor: "palco",
  };
  fila.push(pedido);
  buscarTitulo(pedido);
  $("linkYoutubePalco").value = "";
  $("avisoYoutube").textContent = "";
  $("painelBiblioteca").hidden = true;
  mostrarFila();
  avisar("O vídeo entrou na fila.");
}

function escolherDificuldade(nova) {
  dificuldadeDoPalco = nova;
  for (const b of document.querySelectorAll("[data-dificuldade]")) {
    b.setAttribute("aria-pressed", String(b.dataset.dificuldade === nova));
  }
}

// --- A fila -----------------------------------------------------------------

function titulo(pedido) {
  if (pedido.youtube) return pedido.titulo;
  return musicas.find((m) => m.id === pedido.musicaId)?.titulo ?? "música que sumiu";
}

// O título de verdade de um vídeo do YouTube, pra fila não mostrar só
// "Vídeo do YouTube". Se não der, fica o genérico mesmo.
async function buscarTitulo(pedido) {
  try {
    const endereco = `https://www.youtube.com/watch?v=${pedido.youtube}`;
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(endereco)}`);
    const t = r.ok ? String((await r.json()).title ?? "").slice(0, 80) : "";
    if (t) {
      pedido.titulo = t;
      mostrarFila();
    }
  } catch { /* sem título: segue "Vídeo do YouTube" */ }
}

function mostrarFila() {
  const ordem = filaOrdenada(fila, vezes);
  const ol = $("fila");
  ol.replaceChildren();
  for (const p of ordem) {
    const li = document.createElement("li");
    const texto = document.createElement("span");
    texto.className = "texto-fila";
    texto.textContent = rotulo(p, titulo(p));
    const tirar = document.createElement("button");
    tirar.className = "tirar-fila-palco";
    tirar.textContent = "Remover";
    tirar.setAttribute("aria-label", `Remover ${titulo(p)} da fila`);
    tirar.addEventListener("click", () => removerPedido(p.id));
    li.append(texto, tirar);
    ol.appendChild(li);
  }
  $("filaVazia").hidden = ordem.length > 0;
  sala?.enviarTodos({
    tipo: "fila",
    itens: ordem.map((p) => ({
      id: p.id, titulo: titulo(p), quem: nomes(p.quem),
      dificuldade: p.youtube ? "YouTube, sem pontuação" : DIFICULDADES[p.dificuldade].nome, pedidoPor: p.pedidoPor,
    })),
    agora: rodada && (estado === "cantando" || estado === "livre")
      ? rotulo(rodada.pedido, rodada.musica.titulo) : null,
    ocupado: iniciandoProxima || estado === "cantando" || estado === "livre",
    tocando: estado === "cantando" || estado === "livre",
    cantores: [...cantores.values()].map(({ id, nome, cor }) => ({ id, nome, cor })),
  });
  prepararProxima();
}

function removerPedido(id) {
  const antes = fila.length;
  fila = fila.filter((p) => p.id !== id);
  if (fila.length !== antes) {
    mostrarFila();
    avisar("Pedido removido da fila.");
    return true;
  }
  return false;
}

function recado(id, msg) {
  if (msg.tipo === "pedido") {
    const r = novoPedido(msg, id, { musicas, conectados: cantores, fila });
    if (r.erro) {
      sala.enviar(id, { tipo: "aviso", texto: r.erro });
      return;
    }
    fila.push(r.pedido);
    mostrarFila();
    if (r.pedido.youtube) buscarTitulo(r.pedido);
    const posicao = filaOrdenada(fila, vezes).indexOf(r.pedido) + 1;
    sala.enviar(id, { tipo: "aviso", texto: `Na fila! ${posicao === 1 ? "A sua é a próxima." : `A sua é a ${posicao}ª.`}` });
  } else if (msg.tipo === "volumeVoz") {
    // Só quem está cantando mexe no volume da artista.
    if (estado === "cantando" && rodada.participantes.some((p) => p.cantor.id === id)) {
      rodada.vozUsada = Math.max(rodada.vozUsada, volumeDaVoz(msg.valor));
      rodada.som.ajustarVoz?.(volumeDaVoz(msg.valor));
    }
  } else if (msg.tipo === "tirar") {
    const pedido = fila.find((p) => p.id === msg.pedido && p.pedidoPor === id);
    if (pedido) {
      removerPedido(pedido.id);
      sala.enviar(id, { tipo: "aviso", texto: `Pedido “${titulo(pedido)}” cancelado.` });
    } else {
      mostrarFila(); // devolve a versão atual caso o pedido já tenha saído
      sala.enviar(id, { tipo: "aviso", texto: "Esse pedido já não está na fila." });
    }
  } else if (msg.tipo === "comecar") {
    comecarProxima();
  } else if (msg.tipo === "pular") {
    pularMusica();
  }
}

// --- Tocando ----------------------------------------------------------------

// Áudio aberto ocupa muita memória no celular: guarda só uns poucos (a música
// atual e a próxima, cada uma com a voz da artista, se tiver).
function guardarDecodificada(chave, som) {
  decodificadas.set(chave, som);
  while (decodificadas.size > 4) decodificadas.delete(decodificadas.keys().next().value);
}

async function abrirSom(id, qual = "audio") {
  const chave = `${id}|${qual}`;
  if (decodificadas.has(chave)) return decodificadas.get(chave);
  const item = await biblioteca.pegar(id);
  if (!item) throw new Error("Essa música não está mais na biblioteca.");
  if (!item[qual]) return null;
  const som = await audio.decodeAudioData(await item[qual].arrayBuffer());
  guardarDecodificada(chave, som);
  return som;
}

// Enquanto alguém canta, o áudio da próxima já vai sendo aberto: no celular
// isso leva um ou dois segundos, e esse tempo morto aparece na festa.
async function prepararProxima() {
  const p = filaOrdenada(fila, vezes)[0];
  if (!p || p.youtube || p.musicaId === "teste" || !biblioteca) return;
  garantirAudio();
  try {
    await abrirSom(p.musicaId);
    await abrirSom(p.musicaId, "voz");
  } catch { /* na hora de tocar, o erro aparece */ }
}

async function musicaParaTocar(id, volumeVoz) {
  if (id === "teste") {
    const musica = lerMusica(TEXTO);
    return {
      musica,
      tocar: () => tocarMusicaDeTeste(audio, musica, {
        acordes: ACORDES, solo: SOLO, batidasPorTempo: BATIDAS_POR_TEMPO, destino: mestre,
      }),
    };
  }
  const item = await biblioteca.pegar(id);
  if (!item) throw new Error("Essa música não está mais na biblioteca.");
  const som = await abrirSom(id);
  // A voz da artista vai sempre junto quando existe (mesmo começando em zero),
  // pra quem está cantando poder aumentar no meio da música.
  const voz = item.voz ? await abrirSom(id, "voz") : null;
  return {
    musica: lerMusica(item.texto), faixasSeparadas: item.semVoz === true && Boolean(voz),
    tocar: () => tocarSom(audio, som, { voz, volumeVoz, destino: mestre }),
  };
}

function registrar(p, midi, voz, tCantou) {
  const agora = performance.now();
  const batida = batidaNoTempo(rodada.musica, (tCantou - rodada.tInicioMs) / 1000);
  const nota = notaNoTempo(p.parte, batida);
  // Quem entra um tiquinho antes ou sai um tiquinho depois da nota não perde:
  // a leitura vai pra nota vizinha, mas só se estiver certa.
  const folga = FOLGA_DE_TEMPO_S / duracaoDaBatida(rodada.musica);
  const vizinha = nota ? null : notaNoTempo(p.parte, batida - folga) ?? notaNoTempo(p.parte, batida + folga);
  const certo = p.placar.registrar(nota ?? vizinha, midi, voz, { soSeCerto: !nota });
  if (nota !== p.notaAtual) {
    // A nota de antes acabou: entra na sequência do embalo.
    const antes = p.placar.embalo;
    if (p.placar.fecharNota(p.notaAtual) && !antes) { p.embaloDesde = agora; efeitoEmbalo(); }
    p.notaAtual = nota;
  }
  if (nota) p.ultimoAlvo = midiDoTom(nota.tom);
  const { min, max } = p.faixaDeTons;
  const exibido = midi === null ? null : Math.min(max + 1, Math.max(min - 1, pertoDaOitava(midi, p.ultimoAlvo)));
  p.rastro.push({ batida, exibido });
  if (p.rastro.length > 600) p.rastro.shift();
  p.ultimaLeitura = agora;
  p.ultimoExibido = exibido;
  if (certo) {
    p.ultimoAcerto = agora;
    if (nota && voz && p.placar.dificuldade !== "facil" && !nota.silaba.trimStart().startsWith("~")) {
      p.placar.acertarLetra(nota);
      if (!p.letrasAnimadas.has(nota)) {
        p.letrasAnimadas.add(nota);
        p.letrasPulando.push({ inicio: nota.inicio, t: agora });
      }
    }
    // Uma vez por nota: o nome da nota que a pessoa cantou pula na tela.
    if (nota && midi !== null && !p.comPulo.has(nota)) {
      p.comPulo.add(nota);
      p.pulos.push({ t: agora, texto: nomeDaNota(midi), exibido });
    }
  }
}

function participante(cantor, parte, dificuldade, musica) {
  const tons = parte.linhas.flatMap((ln) => ln.notas.map((n) => midiDoTom(n.tom)));
  const min = Math.min(...tons) - 2, max = Math.max(...tons) + 2;
  return {
    cantor, parte,
    letra: frasesParaLetra(parte, musica),  // a letra em frases, sem pedacinho solto
    placar: new Placar(parte, dificuldade),
    faixaDeTons: { min, max },
    ultimoAlvo: (min + max) / 2,
    rastro: [], pulos: [], comPulo: new Set(), letrasPulando: [], letrasAnimadas: new Set(),
    ultimoAcerto: -Infinity, ultimaLeitura: -Infinity, ultimoExibido: null,
    notaAtual: null, embaloDesde: -Infinity, faiscas: [],
  };
}

async function comecarProxima() {
  if (iniciandoProxima || estado === "cantando" || estado === "livre") return;
  pararContagem();
  const pedido = filaOrdenada(fila, vezes)[0];
  if (!pedido) {
    $("filaVazia").textContent = "A fila está vazia. Escolham a música pelo celular.";
    avisar("A fila está vazia: escolham a música pelo celular ou em \u201cEscolher música\u201d.");
    return;
  }
  const posicaoOriginal = fila.indexOf(pedido);
  iniciandoProxima = true;
  fila = fila.filter((p) => p !== pedido);
  mostrarFila();
  try {
    const iniciou = await (pedido.youtube ? cantarYoutube(pedido) : cantar(pedido));
    if (iniciou === false) {
      fila.splice(Math.min(posicaoOriginal, fila.length), 0, pedido);
      avisar("Não consegui abrir essa música. Ela voltou para a fila; confira os arquivos no palco.");
    } else if (iniciou === null) {
      avisar("Quem ia cantar saiu da sala. Escolham outra música pelo celular.");
    }
  } catch (erro) {
    if (estado !== "cantando" && estado !== "livre") {
      fila.splice(Math.min(posicaoOriginal, fila.length), 0, pedido);
    }
    avisar(`Não consegui iniciar a música. ${erro?.message ?? "Ela continua na fila."}`);
  } finally {
    iniciandoProxima = false;
    mostrarFila();
  }
}

function pularMusica() {
  if (iniciandoProxima || (estado !== "cantando" && estado !== "livre") || !filaOrdenada(fila, vezes).length) return;
  pararContagem();
  pararMusicaFinal();
  if (estado === "livre") {
    try { player?.stopVideo(); } catch { /* o vídeo ainda pode estar abrindo */ }
    $("youtube").hidden = true;
    $("parar").hidden = true;
    document.body.classList.remove("cantando", "livre");
    for (const p of rodada.participantes) sala?.enviar(p.cantor.id, { tipo: "parou" });
    estado = "sala";
    rodada = null;
    mostrarFila();
  } else {
    terminar({ interrompida: true });
  }
  comecarProxima();
}

// --- Vídeo do YouTube ---------------------------------------------------------
// Pra música que ninguém preparou: o vídeo de karaokê toca na TV, com a letra
// dele, e o gogó desenha as vozes embaixo. Sem notas, não tem pontuação.

let promessaYoutube = null;
let player = null;

function carregarYoutube() {
  promessaYoutube ??= new Promise((pronto, falha) => {
    const script = document.createElement("script");
    let resolvido = false;
    const limite = setTimeout(() => {
      if (resolvido) return;
      resolvido = true;
      script.remove();
      falha(new Error("O YouTube não respondeu. Confira a conexão e tente de novo."));
    }, 12000);
    window.onYouTubeIframeAPIReady = () => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(limite);
      pronto(window.YT);
    };
    script.onerror = () => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(limite);
      script.remove();
      falha(new Error("Não consegui carregar o YouTube. Confira a conexão e tente de novo."));
    };
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  }).catch((erro) => {
    promessaYoutube = null;
    throw erro;
  });
  return promessaYoutube;
}

async function cantarYoutube(pedido) {
  const quem = pedido.quem.map((id) => cantores.get(id)).filter(Boolean);
  if (!quem.length) return null;
  const YT = await carregarYoutube();
  vezes.set(pedido.pedidoPor, (vezes.get(pedido.pedidoPor) ?? 0) + 1);
  rodada = { youtube: true, pedido, participantes: quem.map((cantor) => ({ cantor })), musica: { titulo: pedido.titulo } };
  estado = "livre";
  document.body.classList.add("cantando", "livre");
  acordarControles();
  $("resultado").hidden = true;
  $("painelBiblioteca").hidden = true;
  $("youtube").hidden = false;
  $("parar").hidden = false;
  if (player) {
    player.loadVideoById(pedido.youtube);
    player.setVolume(Math.round(volumeGeral * 100));
  } else {
    player = new YT.Player("videoYoutube", {
      videoId: pedido.youtube,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
      events: {
        onReady: (e) => e.target.setVolume(Math.round(volumeGeral * 100)),
        onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED && estado === "livre") terminarLivre(); },
        // 101 e 150: o dono do vídeo não deixa tocar fora do YouTube.
        onError: () => { if (estado === "livre") terminarLivre("Esse vídeo não deixa tocar fora do YouTube. Escolham outro."); },
      },
    });
  }
  for (const c of quem) sala?.enviar(c.id, { tipo: "vez", texto: "Vídeo do YouTube, sem pontuação" });
  return true;
}

function terminarLivre(problema = null) {
  try { player?.stopVideo(); } catch { /* o player nem chegou a abrir */ }
  $("youtube").hidden = true;
  $("parar").hidden = true;
  document.body.classList.remove("cantando", "livre");
  for (const p of rodada.participantes) sala?.enviar(p.cantor.id, { tipo: "fim", titulo: problema ? "O vídeo não tocou" : "Mandou ver!" });
  estado = "resultado";
  $("resMusica").textContent = `${rodada.musica.titulo} · do YouTube, sem pontuação`;
  $("resTitulo").textContent = problema ? "O vídeo não tocou" : "Mandou ver!";
  const caixa = $("resCantores");
  caixa.replaceChildren();
  const quem = document.createElement("p");
  quem.className = "proxima";
  quem.textContent = problema ?? nomes(rodada.pedido.quem);
  quem.hidden = !quem.textContent;
  caixa.appendChild(quem);
  mostrarProxima();
  mostrarFila();
}

async function cantar(pedido) {
  pararMusicaFinal();
  const quem = pedido.quem.map((id) => cantores.get(id)).filter(Boolean);
  if (!quem.length) return null;
  garantirAudio();  // nasce no clique: sem clique, o navegador não deixa tocar
  await audio.resume();
  let escolhida;
  try {
    escolhida = await musicaParaTocar(pedido.musicaId, pedido.voz ?? 0);
  } catch (erro) {
    $("avisoMusica").textContent = erro.message;
    return false;
  }
  const musica = escolhida.musica;
  // Dueto: cada um a sua parte. Duas pessoas numa música que não é dueto:
  // as duas cantam tudo, cada uma com o seu placar. Sozinho: as duas partes.
  const participantes = quem.length === 2
    ? quem.map((c, i) => participante(c, musica.partes[musica.partes.length >= 2 ? i : 0], pedido.dificuldade, musica))
    : [participante(quem[0], parteSolo(musica), pedido.dificuldade, musica)];
  vezes.set(pedido.pedidoPor, (vezes.get(pedido.pedidoPor) ?? 0) + 1);
  const som = escolhida.tocar();
  $("controleFaixaMusica").hidden = !escolhida.faixasSeparadas;
  $("controleFaixaVoz").hidden = !escolhida.faixasSeparadas;
  $("volumeFaixaMusica").value = "100";
  $("volumeFaixaVoz").value = String(Math.round((pedido.voz ?? 0) * 100));
  rodada = {
    musica, pedido, participantes, som, dificuldade: pedido.dificuldade, vozUsada: pedido.voz ?? 0,
    faixasSeparadas: escolhida.faixasSeparadas === true,
    tInicioMs: performance.now() + (som.inicio - audio.currentTime) * 1000,
    // Música de verdade toca até o fim do áudio; a de teste, até a última nota.
    fimSeg: Math.max(segundosDaBatida(musica, fimDaMusica(musica)) + 2, som.duracao ?? 0),
    frequencias: new Uint8Array(som.analisador.frequencyBinCount),
  };
  estado = "cantando";
  document.body.classList.add("cantando");
  acordarControles();
  $("resultado").hidden = true;
  $("painelBiblioteca").hidden = true;
  $("parar").hidden = false;
  for (const p of participantes) {
    const outro = participantes.find((o) => o !== p);
    const com = outro ? `${musica.partes.length >= 2 ? "Dueto" : "Junto"} com ${outro.cantor.nome}` : "Solo";
    sala?.enviar(p.cantor.id, {
      tipo: "vez", texto: `${com} · ${DIFICULDADES[pedido.dificuldade].nome}`,
      temVoz: som.temVoz === true, voz: pedido.voz ?? 0,
    });
  }
  return true;
}

function terminar({ interrompida = false } = {}) {
  rodada.som.parar();
  $("parar").hidden = true;
  document.body.classList.remove("cantando");
  const resumos = rodada.participantes.map((p) => ({ p, r: p.placar.resumo() }));
  for (const { p, r } of resumos) {
    sala?.enviar(p.cantor.id, interrompida
      ? { tipo: "parou" }
      : { tipo: "fim", pontos: r.pontos, titulo: tituloDe(r, rodada.dificuldade) });
  }
  if (interrompida) {
    $("controleFaixaMusica").hidden = true;
    $("controleFaixaVoz").hidden = true;
    estado = "sala";
    rodada = null;
    mostrarFila();
    return;
  }
  estado = "resultado";
  ultimaPontuacaoFinal = resumos.reduce((soma, x) => soma + x.r.pontos, 0) / resumos.length;
  $("ouvirFinal").hidden = false;
  atualizarAmbiente();
  mostrarResultado(resumos);
  tocarMusicaFinal(ultimaPontuacaoFinal);
  mostrarFila();
}

function porcento(fracao) {
  return `${Math.round(fracao * 100)}%`;
}

function mostrarResultado(resumos) {
  const m = rodada.musica;
  const facil = rodada.dificuldade === "facil";
  // Com a artista cantando junto, o celular ouve ela também: o resultado avisa.
  $("resMusica").textContent = `${m.titulo} · ${m.artista} · ${DIFICULDADES[rodada.dificuldade].nome}`
    + (rodada.vozUsada > 0 ? " · com a voz da artista" : "");
  $("resTitulo").textContent = resumos.length === 2
    ? tituloDaDupla(resumos[0].r, resumos[1].r)
    : tituloDe(resumos[0].r, rodada.dificuldade);
  const caixa = $("resCantores");
  caixa.replaceChildren();
  for (const { p, r } of resumos) {
    const el = document.createElement("div");
    el.className = "res-cantor";
    el.style.setProperty("--cor", p.cantor.cor);
    el.innerHTML = '<div class="res-nome"></div><div class="res-pontos"></div><div class="res-titulo"></div><div class="res-info"></div>';
    el.querySelector(".res-nome").textContent = p.cantor.nome;
    el.querySelector(".res-pontos").textContent = r.pontos.toLocaleString("pt-BR");
    el.querySelector(".res-titulo").textContent = resumos.length === 2 ? tituloDe(r, rodada.dificuldade) : "";
    // No fácil "notas certas" e "no tempo" são a mesma coisa: mostra uma só.
    const acerto = facil
      ? `Entrou na hora certa: ${porcento(r.tempo)}`
      : `Notas certas: ${porcento(r.notas)} · sílabas no tempo: ${porcento(r.letra)}`;
    el.querySelector(".res-info").textContent = `${acerto}\nLinhas perfeitas: ${r.linhasPerfeitas} de ${r.linhas}`
      + (r.bonus ? `\nBônus do embalo: +${r.bonus.toLocaleString("pt-BR")}` : "")
      + (r.bonusLetra ? `\nBônus da letra: +${r.bonusLetra.toLocaleString("pt-BR")}` : "");
    caixa.appendChild(el);
  }
  mostrarProxima();
}

function mostrarProxima() {
  const proxima = filaOrdenada(fila, vezes)[0];
  $("comecarProxima").hidden = !proxima;
  $("esperar").hidden = !proxima;
  if (proxima) {
    $("proxima").textContent = `Próxima: ${rotulo(proxima, titulo(proxima))}`;
    for (const id of proxima.quem) sala?.enviar(id, { tipo: "aviso", texto: "A próxima é a sua! Pega o celular." });
    iniciarContagem();
  } else {
    $("proxima").textContent = "A fila está vazia. Escolham a próxima pelo celular.";
  }
  $("resultado").hidden = false;
}

function iniciarContagem() {
  pararContagem();
  const fim = performance.now() + ESPERA_PROXIMA_SEG * 1000;
  const tique = () => {
    const s = Math.ceil((fim - performance.now()) / 1000);
    if (s <= 0) comecarProxima();
    else $("comecarProxima").textContent = `Começar a próxima (${s})`;
  };
  tique();
  contagem = setInterval(tique, 250);
}

function pararContagem() {
  clearInterval(contagem);
  contagem = null;
  $("comecarProxima").textContent = "Começar a próxima";
}

// O robô: canta uma oitava abaixo, como uma voz grave, e erra de vez em quando.
let ultimoRobo = 0;
function roboCanta(agora) {
  if (agora - ultimoRobo < 50) return;  // 20 leituras por segundo, igual ao celular
  ultimoRobo = agora;
  const p = rodada.participantes.find((q) => q.cantor.id === "robo");
  if (!p) return;
  const nota = notaNoTempo(p.parte, batidaNoTempo(rodada.musica, (agora - rodada.tInicioMs) / 1000));
  const midi = nota ? midiDoTom(nota.tom) - 12 + (Math.random() < 0.2 ? 2.5 : (Math.random() - 0.5) * 0.6) : null;
  registrar(p, midi, midi !== null, agora);
}

// --- O quadro ---------------------------------------------------------------

function quadro() {
  const agora = performance.now();
  const { L, A, dpr } = ajustarTela(tela);
  let faseTremor = 0;
  let tremorNoEmbalo = false;
  if (estado === "cantando") {
    const seg = (agora - rodada.tInicioMs) / 1000;
    const noEmbalo = rodada.participantes.some((p) => p.placar.embalo);
    const batidasPorMinuto = Math.max(50, Math.min(160, rodada.musica.bpm / 4 || 76));
    const fase = (seg - rodada.musica.gap / 1000) * batidasPorMinuto / 60;
    faseTremor = fase;
    tremorNoEmbalo = noEmbalo && !reduzirMovimento.matches;
    const pulso = (1 + Math.sin(fase * 2 * Math.PI)) / 2;
    tela.style.transform = noEmbalo && !reduzirMovimento.matches ? `scale(${1 + pulso * 0.003})` : "";
    if (ROBO) roboCanta(agora);
    if (seg > rodada.fimSeg) {
      terminar();
    } else {
      rodada.som.analisador.getByteFrequencyData(rodada.frequencias);
      // A tela de cantar foi desenhada pra 720 de altura: no celular deitado
      // ou numa TV grande, tudo cresce ou diminui junto, pela altura.
      desenharCantando(ctx, L, A, Math.max(0.4, A / 720), {
        musica: rodada.musica, rodada, seg, agora, frequencias: rodada.frequencias, parado: reduzirMovimento.matches,
      });
    }
  }
  if (estado === "livre") {
    tela.style.transform = "";
    // Embaixo do vídeo, só as vozes de quem está cantando.
    fundo(ctx, L, A, { frequencias: SEM_MUSICA, agora, parado: reduzirMovimento.matches });
    desenharPauta(ctx, L, A, dpr, new Map(rodada.participantes.map((p) => [p.cantor.id, cantores.get(p.cantor.id) ?? p.cantor])), agora);
  } else if (estado !== "cantando") {
    tela.style.transform = "";
    // Na sala, o mesmo fundo colorido da música, e a voz de quem já entrou
    // correndo no meio, entre o convite e a fila.
    const tempoAmbiente = ambienteAtual && audio ? audio.currentTime - ambienteAtual.inicio : 0;
    const pulso = ambienteAtual && !reduzirMovimento.matches
      ? (1 + Math.sin(tempoAmbiente * 2 * Math.PI * ambienteAtual.bpm / 60)) / 2 : 0;
    tela.style.transform = pulso ? `scale(${1 + pulso * 0.003})` : "";
    fundo(ctx, L, A, { frequencias: SEM_MUSICA, agora, parado: reduzirMovimento.matches, pulso });
    const meio = $("meio").getBoundingClientRect();
    if (meio.width > 120 && cantores.size) {
      ctx.save();
      ctx.translate(meio.left * dpr, meio.top * dpr);
      desenharPauta(ctx, meio.width * dpr, meio.height * dpr, dpr, cantores, agora);
      ctx.restore();
    }
  }
  document.body.classList.toggle("tremendo", tremorNoEmbalo);
  document.body.style.setProperty("--tremor-x", tremorNoEmbalo ? `${Math.sin(faseTremor * 2 * Math.PI) * 1.4}px` : "0px");
  document.body.style.setProperty("--tremor-y", tremorNoEmbalo ? `${Math.sin(faseTremor * 4 * Math.PI) * 0.8}px` : "0px");
  atualizarCartoes(agora);
  atualizarAmbiente();
  requestAnimationFrame(quadro);
}

// O microfone do próprio palco vira mais um cantor da sala, igual aos
// celulares. Ele ouve também o que sai da caixa de som: com fone de ouvido
// (a música no fone, o microfone só na voz) funciona bem melhor.
// Computador costuma ter mais de um microfone (no primeiro teste, o escolhido
// era o "DroidCam", mudo com o app desligado): dá pra escolher, e a barra
// mostra na hora se ele está ouvindo.
let microfone = null;  // { fluxo, laco }

async function ligarMicrofone() {
  const nome = $("nomeMicrofone").value.trim().slice(0, 20) || "Microfone";
  garantirAudio();
  await audio.resume();
  const escolhido = $("qualMicrofone").value;
  let fluxo;
  try {
    // O retorno local é direto e sem cancelamento de eco para reduzir a latência.
    fluxo = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: escolhido ? { exact: escolhido } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
  } catch (erro) {
    $("avisoMicrofone").textContent = erro.name === "NotAllowedError"
      ? "O microfone foi bloqueado. Libere nas permissões do site."
      : "Não achei microfone neste aparelho.";
    return;
  }
  if (microfone) {
    clearInterval(microfone.laco);
    microfone.ganhoMonitor?.disconnect();
    microfone.fluxo.getTracks().forEach((t) => t.stop());
  }
  await listarMicrofones(fluxo);
  const analisador = audio.createAnalyser();
  analisador.fftSize = 2048;
  const fonteMicrofone = audio.createMediaStreamSource(fluxo);
  fonteMicrofone.connect(analisador);
  const ganhoMonitor = audio.createGain();
  ganhoMonitor.gain.value = Number($("volumeMonitor").value) / 100;
  fonteMicrofone.connect(ganhoMonitor).connect(mestre);
  monitorMicrofone = ganhoMonitor;
  const id = "microfone";
  if (cantores.has(id)) {
    const c = cantores.get(id);
    c.nome = nome;
    const etiqueta = c.cartao?.querySelector(".nome");
    if (etiqueta) etiqueta.textContent = nome;
    mostrarFila();
  } else {
    novoCantor({ id, nome, cor: "#4A90E2" });
  }
  $("usarMicrofone").textContent = "Trocar de microfone";
  $("avisoMicrofone").textContent = "Um instante em silêncio…";
  const amostras = new Float32Array(analisador.fftSize);
  const volumesDoSilencio = [];
  const fimDaCalibragem = performance.now() + 1500;
  let limiar = null;
  microfone = {
    fluxo, ganhoMonitor,
    laco: setInterval(() => {
      analisador.getFloatTimeDomainData(amostras);
      const r = ouvir(amostras, audio.sampleRate, limiar ?? undefined);
      $("nivelMicrofone").style.width = `${Math.min(100, r.volume * 400)}%`;
      if (performance.now() < fimDaCalibragem) {
        volumesDoSilencio.push(r.volume);
        return;
      }
      if (limiar === null) {
        limiar = limiarDoSilencio(volumesDoSilencio);
        $("avisoMicrofone").textContent =
          `${nome} está na sala. Fale alguma coisa: se a barra não mexer, escolha outro microfone na lista.`;
      }
      receberNota(id, { hz: r.hz, voz: r.voz, atraso: 0 });
    }, 50),
  };
}

// Só depois da permissão o navegador conta o nome dos microfones.
async function listarMicrofones(fluxo) {
  const atual = fluxo.getAudioTracks()[0]?.getSettings().deviceId;
  const lista = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === "audioinput" && !["default", "communications"].includes(d.deviceId));
  const select = $("qualMicrofone");
  select.replaceChildren(...lista.map((d, i) => {
    const opcao = document.createElement("option");
    opcao.value = d.deviceId;
    opcao.textContent = d.label || `Microfone ${i + 1}`;
    opcao.selected = d.deviceId === atual;
    return opcao;
  }));
  select.hidden = lista.length < 2;
}

// Sem isso o celular do palco apaga a tela no meio da festa.
async function manterTelaLigada() {
  try { await navigator.wakeLock?.request("screen"); } catch { /* sem suporte: segue */ }
}

// No celular do palco, o primeiro toque já põe a tela cheia e deitada (no
// computador, é o F11).
async function entrarEmTelaCheia() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      await screen.orientation?.lock?.("landscape").catch(() => {});
    }
  } catch { /* sem tela cheia: segue normal */ }
  manterTelaLigada();
}

// Cantando, o volume e o "Parar" somem depois de uns segundos sem mexer na
// tela, e voltam no primeiro toque ou movimento do mouse.
let paraSumir = null;
function acordarControles() {
  document.body.classList.remove("quieto");
  clearTimeout(paraSumir);
  paraSumir = setTimeout(() => document.body.classList.add("quieto"), 3000);
}

for (const b of document.querySelectorAll("[data-dificuldade]")) {
  b.addEventListener("click", () => escolherDificuldade(b.dataset.dificuldade));
}
$("comecar").addEventListener("click", comecarProxima);
$("comecarProxima").addEventListener("click", comecarProxima);
$("ativarSom").addEventListener("click", async () => {
  try {
    garantirAudio();
    await audio.resume();
    if (audio.state !== "running") throw new Error("O navegador ainda não liberou o áudio.");
    iniciarSomDeFundo();
    atualizarAmbiente();
    $("ativarSom").textContent = "Som do palco ativado ✓";
    avisar("Som pronto. Agora dá para iniciar a fila pelo celular.");
  } catch (erro) {
    avisar(erro.message ?? "Não consegui ativar o áudio neste aparelho.");
  }
});
$("esperar").addEventListener("click", pararContagem);
$("parar").addEventListener("click", () => (estado === "livre" ? terminarLivre() : terminar({ interrompida: true })));
$("voltar").addEventListener("click", () => {
  pararContagem();
  pararMusicaFinal();
  $("resultado").hidden = true;
  estado = "sala";
});
$("verBiblioteca").addEventListener("click", () => {
  $("painelBiblioteca").hidden = false;
  $("painelBiblioteca").scrollTop = 0;  // abre no topo, onde está o YouTube
});
$("buscaBiblioteca").addEventListener("input", mostrarBiblioteca);
$("fecharBiblioteca").addEventListener("click", () => { $("painelBiblioteca").hidden = true; });
$("adicionar").addEventListener("click", () => $("arquivos").click());
$("arquivos").addEventListener("change", async (e) => {
  try { await adicionarArquivos(e.target.files); }
  catch { $("avisoMusica").textContent = "Não consegui ler esses arquivos. Tente escolher de novo."; }
  finally { e.target.value = ""; }
});
$("adicionarPasta").addEventListener("click", () => $("pasta").click());
$("pasta").addEventListener("change", async (e) => {
  try { await adicionarArquivos(e.target.files); }
  catch { $("avisoMusica").textContent = "Não consegui ler essa pasta. Tente escolher de novo."; }
  finally { e.target.value = ""; }
});
// Celular não escolhe pasta inteira: lá só aparece "Adicionar arquivos".
$("adicionarPasta").hidden = !("webkitdirectory" in document.createElement("input")) || matchMedia("(pointer: coarse)").matches;
$("usarMicrofone").addEventListener("click", ligarMicrofone);
$("volumeMonitor").addEventListener("input", (e) => {
  monitorMicrofone?.gain.setTargetAtTime(Number(e.target.value) / 100, audio.currentTime, 0.04);
});
$("volumeFaixaMusica").addEventListener("input", (e) => {
  if (rodada?.faixasSeparadas) rodada.som.ajustarMusica?.(Number(e.target.value) / 100);
});
$("volumeFaixaVoz").addEventListener("input", (e) => {
  if (rodada?.faixasSeparadas) {
    const volume = Number(e.target.value) / 100;
    rodada.vozUsada = volume;
    rodada.som.ajustarVoz?.(volume);
  }
});
$("ouvirFinal").addEventListener("click", () => {
  if (ultimaPontuacaoFinal !== null) {
    garantirAudio();
    audio.resume().then(() => tocarMusicaFinal(ultimaPontuacaoFinal)).catch(() => {});
  }
});
$("volume").value = String(Math.round(volumeGeral * 100));
$("volume").addEventListener("input", (e) => mudarVolume(Number(e.target.value) / 100));
$("porYoutubeNaFila").addEventListener("click", porYoutubeNaFila);
$("procurarYoutubePalco").addEventListener("click", () => {
  const termo = `${$("termoYoutubePalco").value.trim()} karaoke`.trim();
  window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(termo)}`, "_blank", "noopener");
});
$("qualMicrofone").addEventListener("change", ligarMicrofone);
if (matchMedia("(pointer: coarse)").matches) addEventListener("click", entrarEmTelaCheia, { once: true });
document.addEventListener("pointerdown", () => {
  garantirAudio();
  audio.resume().then(() => {
    iniciarSomDeFundo();
    atualizarAmbiente();
  }).catch(() => {});
}, { once: true });
for (const tipo of ["pointermove", "pointerdown", "keydown"]) addEventListener(tipo, acordarControles);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") manterTelaLigada();
});
escolherDificuldade(dificuldadeDoPalco);
manterTelaLigada();
if (ROBO) {
  novoCantor({ id: "robo", nome: "Robô", cor: "#8F88E8" });
  window.gogo = { rodada: () => rodada, fila: () => fila };  // pra inspecionar pelo console, só no modo robô
}

try {
  biblioteca = await abrirBiblioteca();
} catch {
  $("avisoMusica").textContent = "Este navegador não deixa guardar músicas (aba anônima?).";
}
await recarregarMusicas();
mostrarFila();

sala = abrirSala({
  aberta: mostrarConvite,
  entrou: novoCantor,
  saiu: cantorSaiu,
  nota: receberNota,
  mensagem: recado,
  erro: mostrarErro,
}, { codigo: codigoGuardado() });
requestAnimationFrame(quadro);
