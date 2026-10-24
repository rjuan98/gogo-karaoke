// O celular: é o microfone (ouve, descobre a nota e manda só o número pro
// palco) e é por onde cada um escolhe a música e acompanha a fila.
import { ouvir, hzParaMidi, nomeDaNota, limiarDoSilencio, VOLUME_MIN } from "./nota.js";
import { entrarNaSala } from "./sala.js";
import { limparCodigo } from "./protocolo.js";
import { DIFICULDADES } from "./pontuacao.js";

const LEITURAS_POR_SEGUNDO = 20;
const CALIBRAGEM_MS = 1500;  // quanto tempo ouvindo a sala calada antes de começar
const parametros = new URLSearchParams(location.search);
// Com ?teste na URL, toca uma melodia por dentro em vez de abrir o microfone.
// Serve pra conferir o caminho todo sem ninguém cantar.
const TESTE = parametros.has("teste");

const $ = (id) => document.getElementById(id);
let sala = null;
let meuId = null;
let atraso = null;      // metade da ida e volta até o palco, em ms
let fimDaCalibragem = 0;
let musicas = [];       // a biblioteca do palco
let naSala = [];        // quem está na sala, pra cantar junto
const escolha = { musicaId: null, com: null, dificuldade: "medio", voz: null };
// A artista cantando junto: desligada, baixinha (pra quem tem vergonha) ou alta.
const VOLUMES_DA_VOZ = [["Sem", 0], ["Baixinha", 0.35], ["Junto", 0.8]];

// Sem escolha da pessoa, no fácil a artista canta junto baixinho.
function vozEscolhida() {
  return escolha.voz ?? (escolha.dificuldade === "facil" ? 0.35 : 0);
}

// Veio pelo QR code: o código já está no link, não precisa digitar.
const codigoDoLink = limparCodigo(parametros.get("sala"));
if (codigoDoLink.length === 5) {
  $("campoCodigo").hidden = true;
  $("sala").textContent = `sala ${codigoDoLink}`;
}

function mostrarErro(texto) {
  $("erro").textContent = texto;
}

function avisar(texto) {
  $("aviso").textContent = texto;
}

function lembrarNome() {
  try { return localStorage.getItem("gogo-nome") || ""; } catch { return ""; }
}

function guardarNome(valor) {
  try { localStorage.setItem("gogo-nome", valor); } catch { /* aba anônima: tudo bem */ }
}

// Sem isso o celular apaga a tela no meio da música e o navegador para de ouvir.
async function manterTelaLigada() {
  try { await navigator.wakeLock?.request("screen"); } catch { /* sem suporte: segue */ }
}

function tocarMelodiaDeTeste(audio, destino) {
  const osc = audio.createOscillator();
  const volume = audio.createGain();
  osc.type = "sawtooth";  // tem harmônicos, como voz; uma senoide pura seria fácil demais
  osc.connect(volume).connect(destino);  // vai só pro detector, não pro alto-falante
  osc.start();
  const melodia = [60, 62, 64, 65, 67, null, 67, 65, 64, 62, 60, null];
  let i = 0;
  setInterval(() => {
    const midi = melodia[i++ % melodia.length];
    volume.gain.setValueAtTime(midi === null ? 0 : 0.3, audio.currentTime);
    if (midi !== null) osc.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), audio.currentTime);
  }, 400);
}

function mostrar(r) {
  $("volume").style.width = `${Math.min(100, r.volume * 400)}%`;
  // Sem detalhe técnico: só se o microfone está te ouvindo, e a nota.
  $("detalhe").textContent = r.voz ? "Te ouvindo" : "Em silêncio";
  $("nota").textContent = !r.voz ? "–" : r.hz === null ? "♪" : nomeDaNota(hzParaMidi(r.hz));
}

// --- Escolher a música ------------------------------------------------------

function opcao(texto, marcada, aoClicar) {
  const b = document.createElement("button");
  b.textContent = texto;
  b.setAttribute("aria-pressed", String(marcada));
  b.addEventListener("click", aoClicar);
  return b;
}

function mostrarMusicas() {
  const busca = $("busca").value.trim().toLocaleLowerCase("pt-BR");
  const achadas = musicas.filter((m) => `${m.titulo} ${m.artista}`.toLocaleLowerCase("pt-BR").includes(busca));
  const ul = $("listaMusicas");
  ul.replaceChildren();
  for (const m of achadas) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "musica";
    const t = document.createElement("span");
    t.textContent = m.titulo;
    const de = document.createElement("span");
    de.className = "de";
    de.textContent = `${m.artista}${m.dueto ? " · dueto" : ""}`;
    b.append(t, de);
    b.addEventListener("click", () => escolher(m.id));
    li.appendChild(b);
    ul.appendChild(li);
  }
  $("semMusicas").hidden = achadas.length > 0 || !musicas.length;
}

function escolher(musicaId) {
  escolha.musicaId = musicaId;
  escolha.com = null;
  escolha.voz = null;
  $("buscaMusicas").hidden = true;
  $("escolha").hidden = false;
  mostrarEscolha();
}

function mostrarEscolha() {
  const m = musicas.find((x) => x.id === escolha.musicaId);
  if (!m) return voltarPraLista();
  $("escolhida").textContent = `${m.titulo} · ${m.artista}`;
  const outros = naSala.filter((c) => c.id !== meuId);
  if (!outros.some((c) => c.id === escolha.com)) escolha.com = null;
  $("opcoesQuem").replaceChildren(
    opcao("Só eu", escolha.com === null, () => { escolha.com = null; mostrarEscolha(); }),
    ...outros.map((c) => opcao(`Com ${c.nome}`, escolha.com === c.id, () => { escolha.com = c.id; mostrarEscolha(); })),
  );
  $("opcoesDificuldade").replaceChildren(...Object.entries(DIFICULDADES).map(([chave, d]) =>
    opcao(d.nome, escolha.dificuldade === chave, () => { escolha.dificuldade = chave; mostrarEscolha(); })));
  $("regra").textContent = DIFICULDADES[escolha.dificuldade].regra;
  $("campoVoz").hidden = !m.temVoz;
  $("opcoesVoz").replaceChildren(...VOLUMES_DA_VOZ.map(([nome, volume]) =>
    opcao(nome, vozEscolhida() === volume, () => { escolha.voz = volume; mostrarEscolha(); })));
}

function voltarPraLista() {
  $("escolha").hidden = true;
  $("buscaMusicas").hidden = false;
}

function pedir() {
  const enviado = sala?.enviar({
    tipo: "pedido", musicaId: escolha.musicaId, com: escolha.com, dificuldade: escolha.dificuldade, voz: vozEscolhida(),
  });
  if (!enviado) {
    avisar("Sem conexão com o palco. Espere reconectar e tente de novo.");
    return;
  }
  voltarPraLista();
  mostrarAba("fila");
}

// --- A fila -----------------------------------------------------------------

function mostrarFila(msg) {
  naSala = msg.cantores ?? naSala;
  if (!$("escolha").hidden) mostrarEscolha();
  $("agora").hidden = !msg.agora;
  $("agora").textContent = msg.agora ? `Cantando agora: ${msg.agora}` : "";
  const iniciar = $("comecarProxima");
  iniciar.disabled = msg.itens.length === 0 || msg.ocupado === true;
  iniciar.textContent = msg.ocupado ? "Tem alguém cantando" : msg.itens.length ? "Começar próxima música" : "Aguardando músicas";
  const pular = $("pularMusica");
  pular.hidden = msg.tocando !== true;
  pular.disabled = msg.itens.length === 0;
  const ol = $("listaFila");
  ol.replaceChildren();
  const minhas = msg.itens.filter((p) => p.pedidoPor === meuId).length;
  $("minhasNaFila").textContent = minhas
    ? `Você tem ${minhas} pedido${minhas === 1 ? "" : "s"} esperando. Toque em “Cancelar pedido” na música que quer tirar.`
    : "Seus pedidos aparecem aqui e podem ser cancelados até começarem.";
  for (const p of msg.itens) {
    const li = document.createElement("li");
    li.className = `item-fila${p.pedidoPor === meuId ? " minha" : ""}`;
    const t = document.createElement("span");
    t.className = "titulo-fila";
    t.textContent = p.pedidoPor === meuId ? `Sua música: ${p.titulo}` : p.titulo;
    const de = document.createElement("span");
    de.className = "de";
    de.textContent = `${p.quem} · ${p.dificuldade}`;
    li.append(t, de);
    if (p.pedidoPor === meuId) {
      const tirar = document.createElement("button");
      tirar.textContent = "Cancelar pedido";
      tirar.className = "remover-fila";
      tirar.setAttribute("aria-label", `Cancelar ${p.titulo}`);
      tirar.addEventListener("click", () => {
        tirar.disabled = true;
        tirar.textContent = "Cancelando…";
        if (!sala?.enviar({ tipo: "tirar", pedido: p.id })) {
          tirar.disabled = false;
          tirar.textContent = "Cancelar pedido";
          avisar("Sem conexão com o palco. Espere reconectar e tente de novo.");
        }
      });
      li.appendChild(tirar);
    }
    ol.appendChild(li);
  }
  $("filaVazia").hidden = msg.itens.length > 0;
  $("abaFila").textContent = msg.itens.length ? `Fila (${msg.itens.length})` : "Fila";
}

$("comecarProxima").addEventListener("click", () => {
  const botao = $("comecarProxima");
  botao.disabled = true;
  if (!sala?.enviar({ tipo: "comecar" })) {
    botao.disabled = false;
    avisar("Sem conexão com o palco. Espere reconectar e tente de novo.");
  }
});

$("pularMusica").addEventListener("click", () => {
  const botao = $("pularMusica");
  botao.disabled = true;
  if (!sala?.enviar({ tipo: "pular" })) {
    botao.disabled = false;
    avisar("Sem conexão com o palco. Espere reconectar e tente de novo.");
  }
});

function mostrarAba(qual) {
  for (const [aba, secao, nome] of [["abaMusicas", "secaoMusicas", "musicas"], ["abaYoutube", "secaoYoutube", "youtube"],
    ["abaFila", "secaoFila", "fila"]]) {
    $(secao).hidden = qual !== nome;
    $(aba).setAttribute("aria-pressed", String(qual === nome));
  }
}

// O palco manda a biblioteca, a fila, e avisa a vez de cada um.
function recadoDoPalco(msg) {
  if (msg.tipo === "biblioteca") {
    musicas = Array.isArray(msg.musicas) ? msg.musicas : [];
    mostrarMusicas();
    if (!$("escolha").hidden) mostrarEscolha();
  } else if (msg.tipo === "fila") {
    mostrarFila(msg);
  } else if (msg.tipo === "aviso") {
    avisar(msg.texto ?? "");
  } else if (msg.tipo === "vez") {
    avisar(`É a sua vez! Olhe pra TV. ${msg.texto ?? ""}`);
    // Durante a música, quem canta aumenta ou abaixa a artista na hora.
    $("controleVoz").hidden = msg.temVoz !== true;
    $("volumeVoz").value = String(Math.round(Number(msg.voz || 0) * 100));
  } else if (msg.tipo === "fim") {
    $("controleVoz").hidden = true;
    avisar(msg.pontos == null ? msg.titulo ?? "" : `${Number(msg.pontos).toLocaleString("pt-BR")} pontos · ${msg.titulo ?? ""}`);
  } else if (msg.tipo === "parou") {
    $("controleVoz").hidden = true;
    avisar("A música foi interrompida.");
  }
}

// --- Entrar -----------------------------------------------------------------

async function comecar() {
  mostrarErro("");
  const codigo = codigoDoLink.length === 5 ? codigoDoLink : limparCodigo($("codigo").value);
  if (codigo.length !== 5) {
    return mostrarErro("O código tem 5 letras, do jeito que aparece na TV.");
  }
  if (!TESTE && !window.isSecureContext) {
    return mostrarErro("O navegador só libera o microfone em página segura (endereço com https://).");
  }
  if (!TESTE && !navigator.mediaDevices?.getUserMedia) {
    return mostrarErro("Este navegador não deixa usar o microfone. Tente o Chrome ou o Safari.");
  }

  // O áudio tem que nascer dentro do toque no botão, senão o iPhone não deixa.
  const audio = new AudioContext({ latencyHint: "interactive" });
  const analisador = audio.createAnalyser();
  analisador.fftSize = 2048;

  if (TESTE) {
    tocarMelodiaDeTeste(audio, analisador);
  } else {
    let fluxo;
    try {
      // Sem os filtros de chamada de vídeo: eles achatam a voz e atrapalham a nota.
      fluxo = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      audio.close();
      return mostrarErro(e.name === "NotAllowedError"
        ? "O microfone foi bloqueado. Libere nas permissões do site e recarregue a página."
        : `Não consegui abrir o microfone (${e.name}).`);
    }
    audio.createMediaStreamSource(fluxo).connect(analisador);
  }
  await audio.resume();

  const nome = $("nome").value.trim();
  guardarNome(nome);
  $("sala").textContent = `sala ${codigo}`;
  $("entrada").hidden = true;
  $("painel").hidden = false;
  manterTelaLigada();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      manterTelaLigada();
      audio.resume().catch(() => {});
      if (!TESTE) {
        fimDaCalibragem = performance.now() + CALIBRAGEM_MS;
        volumesDoSilencio.length = 0;
        avisar("De volta! Um instante em silêncio…");
      }
    } else {
      $("estado").textContent = "Voltando para o gogó quando você retornar…";
    }
  });

  sala = entrarNaSala(codigo, nome, {
    conectado: (cantor) => {
      meuId = cantor.id;
      document.documentElement.style.setProperty("--cor", cantor.cor);
      $("estado").textContent = `Conectado como ${cantor.nome}`;
    },
    pong: (t) => {
      const metade = (performance.now() - t) / 2;
      atraso = atraso === null ? metade : atraso * 0.7 + metade * 0.3;
    },
    mensagem: recadoDoPalco,
    caiu: () => { $("estado").textContent = "Caiu a conexão com o palco. Tentando de novo…"; },
    erro: (texto) => { $("estado").textContent = texto; },
  });

  // Primeiro ouve a sala calada, pra aprender quanto barulho ela tem
  // (no teste em casa, o ventilador passava por voz). A melodia de teste
  // não precisa disso.
  let limiar = VOLUME_MIN;
  const volumesDoSilencio = [];
  fimDaCalibragem = TESTE ? 0 : performance.now() + CALIBRAGEM_MS;
  if (!TESTE) avisar("Um instante em silêncio…");

  const amostras = new Float32Array(analisador.fftSize);
  setInterval(() => {
    analisador.getFloatTimeDomainData(amostras);
    if (performance.now() < fimDaCalibragem) {
      volumesDoSilencio.push(ouvir(amostras, audio.sampleRate).volume);
      return;
    }
    if (volumesDoSilencio.length) {
      limiar = limiarDoSilencio(volumesDoSilencio);
      volumesDoSilencio.length = 0;
      avisar("Pronto! Escolha uma música.");
    }
    const r = ouvir(amostras, audio.sampleRate, limiar);
    mostrar(r);
    sala.enviar({ tipo: "nota", hz: r.hz, voz: r.voz, atraso: atraso === null ? null : Math.round(atraso) });
  }, 1000 / LEITURAS_POR_SEGUNDO);
  setInterval(() => sala.enviar({ tipo: "ping", t: performance.now() }), 2000);
}

$("nome").value = lembrarNome();
$("comecar").addEventListener("click", comecar);
$("busca").addEventListener("input", mostrarMusicas);
$("pedir").addEventListener("click", pedir);
$("voltarEscolha").addEventListener("click", voltarPraLista);
$("abaMusicas").addEventListener("click", () => mostrarAba("musicas"));
$("abaFila").addEventListener("click", () => mostrarAba("fila"));
$("volumeVoz").addEventListener("input", (e) => sala?.enviar({ tipo: "volumeVoz", valor: Number(e.target.value) / 100 }));
$("abaYoutube").addEventListener("click", () => mostrarAba("youtube"));
// A busca não achou: leva pro YouTube já com o que a pessoa digitou.
$("irPraYoutube").addEventListener("click", () => {
  $("termoYoutube").value = $("busca").value.trim();
  mostrarAba("youtube");
});
// Procurar abre o YouTube com "karaoke" na busca; a pessoa escolhe o vídeo,
// copia o link (Compartilhar → Copiar link) e cola aqui.
$("procurarYoutube").addEventListener("click", () => {
  const termo = `${$("termoYoutube").value.trim()} karaoke`.trim();
  window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(termo)}`, "_blank", "noopener");
});
$("colarLink").addEventListener("click", async () => {
  try {
    $("linkYoutube").value = (await navigator.clipboard.readText()).trim();
  } catch {
    $("linkYoutube").focus();  // sem permissão de ler o que foi copiado: cola na mão
    avisar("Toque no campo e cole o link.");
  }
});
$("pedirYoutube").addEventListener("click", () => {
  const link = $("linkYoutube").value.trim();
  if (!link) {
    avisar("Cole o link do vídeo primeiro.");
    return;
  }
  if (!sala?.enviar({ tipo: "pedido", youtube: link })) {
    avisar("Sem conexão com o palco. Espere reconectar e tente de novo.");
    return;
  }
  $("linkYoutube").value = "";
  mostrarAba("fila");
});
