// Bateria da detecção de nota e das regras da sala. Não precisa de microfone
// nem de rede: gera a onda aqui mesmo.
// Use sempre que mexer em site/js/nota.js ou site/js/protocolo.js:  node testes.mjs
import { ouvir, detectarNota, hzParaMidi, nomeDaNota, centsDaNota, limiarDoSilencio, VOLUME_MIN } from "./site/js/nota.js";
import {
  lerMusica, segundosDaBatida, batidaNoTempo, notaNoTempo, linhaNaTela, linhaSeguinte, parteSolo, fimDaMusica, midiDoTom,
  pedacosDaLinha, frasesParaLetra,
} from "./site/js/musica.js";
import {
  distanciaSemOitava, acertou, pertoDaOitava, Placar, tituloDe, tituloDaDupla, suavizar,
} from "./site/js/pontuacao.js";
import { TEXTO, ACORDES, SOLO } from "./site/js/musicaDeTeste.js";
import { escolherAudio, parearArquivos, separarPorPasta, ganhoParaIgualar } from "./site/js/arquivoDeMusica.js";
import { novoPedido, filaOrdenada, semQuemSaiu, MAXIMO_POR_PESSOA, volumeDaVoz } from "./site/js/fila.js";
import { codigoNovo, limparCodigo, idDoPalco, corDoCantor, nomeLimpo, notaRecebida, CORES, enderecoSoDesteAparelho, idDoYoutube } from "./site/js/protocolo.js";

const OK = [], FALHAS = [];

function check(nome, cond, extra = "") {
  (cond ? OK : FALHAS).push(nome);
  console.log((cond ? "  ok  " : "  XX  ") + nome + (extra && !cond ? `   [${extra}]` : ""));
}

function secao(t) {
  console.log(`\n=== ${t} ===`);
}

// Uma onda com a fundamental e os harmônicos que quiser, no volume de um
// microfone razoável. [1] é uma nota pura; voz de gente tem vários.
function onda(hz, taxa, harmonicos = [1], tamanho = 2048, amplitude = 0.3) {
  const total = harmonicos.reduce((a, b) => a + b, 0);
  const x = new Float32Array(tamanho);
  for (let i = 0; i < tamanho; i++) {
    let v = 0;
    harmonicos.forEach((peso, k) => { v += peso * Math.sin(2 * Math.PI * hz * (k + 1) * i / taxa); });
    x[i] = (amplitude * v) / total;
  }
  return x;
}

// Ruído com semente fixa, pra o teste dar sempre o mesmo resultado.
function ruido(tamanho = 2048, amplitude = 0.3) {
  let s = 42;
  const x = new Float32Array(tamanho);
  for (let i = 0; i < tamanho; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    x[i] = amplitude * (s / 1073741824 - 1);
  }
  return x;
}

function erroEmCents(achado, certo) {
  return Math.abs(1200 * Math.log2(achado / certo));
}

const TAXAS = [44100, 48000];  // as duas que celular e notebook costumam usar

secao("Nota pura, do grave ao agudo");
for (const taxa of TAXAS) {
  for (const hz of [82.41, 110, 196, 261.63, 440, 659.25, 880, 1046.5]) {
    const r = detectarNota(onda(hz, taxa), taxa);
    const erro = r ? erroEmCents(r.hz, hz) : Infinity;
    check(`${hz} Hz a ${taxa / 1000} kHz sai certo (menos de 5 cents)`, erro < 5,
      r ? `achou ${r.hz.toFixed(2)} Hz, ${erro.toFixed(1)} cents` : "não achou nota");
  }
}

secao("Voz de verdade tem harmônicos — e não pode virar oitava errada");
for (const taxa of TAXAS) {
  for (const hz of [110, 220, 330, 523.25]) {
    // Parecido com voz cantada: fundamental forte, harmônicos caindo.
    const r = detectarNota(onda(hz, taxa, [1, 0.6, 0.4, 0.25, 0.15]), taxa);
    const erro = r ? erroEmCents(r.hz, hz) : Infinity;
    check(`${hz} Hz com harmônicos a ${taxa / 1000} kHz não pula de oitava`, erro < 10,
      r ? `achou ${r.hz.toFixed(2)} Hz` : "não achou nota");
  }
  // Segundo harmônico mais forte que a fundamental: ainda é a nota de baixo.
  const r = detectarNota(onda(150, taxa, [1, 1.4, 0.5]), taxa);
  check(`150 Hz com o 2º harmônico mais forte a ${taxa / 1000} kHz continua 150`,
    r && erroEmCents(r.hz, 150) < 10, r ? `achou ${r.hz.toFixed(2)} Hz` : "não achou nota");
  // Fundamental bem fraca: a onda quase se repete na metade do período. É aqui
  // que um limiar frouxo cai e a nota sai uma oitava acima.
  const fraca = detectarNota(onda(200, taxa, [0.4, 1]), taxa);
  check(`200 Hz com fundamental fraca a ${taxa / 1000} kHz não sobe uma oitava`,
    fraca && erroEmCents(fraca.hz, 200) < 10, fraca ? `achou ${fraca.hz.toFixed(2)} Hz` : "não achou nota");
}

secao("Silêncio, ruído e fala");
{
  const silencio = ouvir(new Float32Array(2048), 48000);
  check("silêncio não tem voz", silencio.voz === false && silencio.hz === null);

  const baixinho = ouvir(onda(220, 48000, [1], 2048, 0.005), 48000);
  check("nota baixinha demais conta como silêncio", baixinho.voz === false);

  const chiado = ouvir(ruido(), 48000);
  check("ruído tem som mas não tem nota", chiado.voz === true && chiado.hz === null,
    `voz=${chiado.voz} hz=${chiado.hz}`);

  const cantando = ouvir(onda(220, 48000, [1, 0.5, 0.3]), 48000);
  check("cantando tem voz e nota", cantando.voz === true && cantando.hz !== null);
}

secao("Fora da faixa de voz");
{
  check("50 Hz (mais grave que voz) não vira nota", detectarNota(onda(50, 48000), 48000) === null ||
    detectarNota(onda(50, 48000), 48000).hz > 70);
  const apito = detectarNota(onda(2500, 48000), 48000);
  check("apito de 2500 Hz não vira nota aguda impossível", apito === null || apito.hz <= 1100,
    apito ? `achou ${apito.hz.toFixed(0)} Hz` : "");
}

secao("Nome da nota");
{
  check("440 Hz é Lá", nomeDaNota(hzParaMidi(440)) === "Lá");
  check("261,63 Hz é Dó", nomeDaNota(hzParaMidi(261.63)) === "Dó");
  check("277,18 Hz é Dó♯", nomeDaNota(hzParaMidi(277.18)) === "Dó♯");
  check("110 Hz também é Lá (outra oitava, mesmo nome)", nomeDaNota(hzParaMidi(110)) === "Lá");
  check("Lá 440 é o número 69", Math.round(hzParaMidi(440)) === 69);
  const c = centsDaNota(hzParaMidi(452));
  check("452 Hz é um Lá uns 47 cents alto", c >= 44 && c <= 49, `deu ${c}`);
  const b = centsDaNota(hzParaMidi(430));
  check("430 Hz é um Lá uns 40 cents baixo", b >= -42 && b <= -38, `deu ${b}`);
}

secao("Código da sala");
{
  // Sorteio com semente fixa, pra o teste dar sempre o mesmo resultado.
  let s = 7;
  const sorteio = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const codigos = Array.from({ length: 5000 }, () => codigoNovo(sorteio));
  check("todo código tem 5 letras maiúsculas", codigos.every((c) => /^[A-Z]{5}$/.test(c)));
  check("todo código alterna consoante e vogal, pra dar pra ditar",
    codigos.every((c) => /^[^AEIOU][AEIOU][^AEIOU][AEIOU][^AEIOU]$/.test(c)));
  check("nenhum código tem C, Q ou X", codigos.every((c) => !/[CQX]/.test(c)));
  const feios = codigos.filter((c) => ["PUT", "FOD", "MERD", "PAU", "VIAD"].some((p) => c.includes(p)));
  check("nenhum código forma palavra feia da lista", feios.length === 0, feios.slice(0, 3).join(", "));
  check("os códigos variam (não é sempre o mesmo)", new Set(codigos).size > 4000);

  // Um sorteio viciado cujo primeiro código seria PUTAN: tem que ser jogado
  // fora, e o segundo (só zeros e quase-zeros) sai BABAB.
  const viciado = [0.58, 0.85, 0.8, 0.0, 0.5];
  let i = 0;
  const forcado = codigoNovo(() => (i < 5 ? viciado[i++] : 0.01));
  check("se o sorteio cair numa palavra feia, sorteia de novo", forcado === "BABAB", `deu ${forcado}`);

  check("código digitado em minúscula funciona", limparCodigo("lumen") === "LUMEN");
  check("espaço e traço no código são ignorados", limparCodigo(" lu-men ") === "LUMEN");
  check("código vazio não quebra", limparCodigo(null) === "");
  check("o palco se registra com prefixo próprio", idDoPalco("LUMEN") === "gogo-LUMEN");
}

secao("Endereço que o celular consegue abrir");
{
  // Foi assim que o primeiro teste em casa falhou: palco aberto em localhost,
  // QR code com localhost, celular procurando o site dentro dele mesmo.
  check("localhost só funciona no próprio aparelho", enderecoSoDesteAparelho("localhost"));
  check("127.0.0.1 também", enderecoSoDesteAparelho("127.0.0.1"));
  check("e o endereço IPv6 de si mesmo", enderecoSoDesteAparelho("[::1]"));
  check("LOCALHOST em maiúscula também", enderecoSoDesteAparelho("LOCALHOST"));
  check("o IP da rede de casa funciona no celular", !enderecoSoDesteAparelho("192.168.10.26"));
  check("um site publicado funciona no celular", !enderecoSoDesteAparelho("gogo.netlify.app"));
  check("um site com 'localhost' no meio do nome não é confundido", !enderecoSoDesteAparelho("localhost.gogo.app"));
}

secao("Quem entra na sala");
{
  check("primeiro cantor é verde, segundo é laranja", corDoCantor(1) === CORES[0] && corDoCantor(2) === CORES[1]);
  check("depois da última cor, recomeça", corDoCantor(CORES.length + 1) === CORES[0]);
  check("nome vazio vira 'Cantor 3'", nomeLimpo("   ", 3) === "Cantor 3");
  check("nome gigante é cortado em 20 letras", nomeLimpo("A".repeat(50), 1).length === 20);
  check("nome normal passa igual", nomeLimpo(" Ana ", 1) === "Ana");
}

secao("Nota que chega do celular");
{
  const boa = notaRecebida({ tipo: "nota", hz: 440, voz: true, atraso: 12 });
  check("nota normal passa igual", boa.hz === 440 && boa.voz === true && boa.atraso === 12);
  check("hz que não é número vira 'sem nota'", notaRecebida({ hz: "abc" }).hz === null);
  check("hz absurdo vira 'sem nota'", notaRecebida({ hz: 99999 }).hz === null);
  check("atraso que não veio continua não vindo (não vira 0)", notaRecebida({ atraso: null }).atraso === null);
  check("voz só conta se veio true de verdade", notaRecebida({ voz: "sim" }).voz === false);
  check("mensagem vazia não quebra", notaRecebida(undefined).hz === null);
}

secao("Silêncio da sala");
{
  check("sala quieta fica com o limiar mínimo", limiarDoSilencio(Array(30).fill(0.001)) === VOLUME_MIN);
  // Ventilador: barulho constante na casa dos 0,02.
  const ventilador = Array.from({ length: 30 }, (_, i) => 0.02 + (i % 5) * 0.001);
  const limiar = limiarDoSilencio(ventilador);
  check("com ventilador, o limiar sobe acima do barulho dele", limiar > 0.024 * 2, `deu ${limiar.toFixed(3)}`);
  check("um estalo isolado no silêncio não sobe o limiar",
    limiarDoSilencio([...Array(29).fill(0.002), 0.5]) === VOLUME_MIN);
  check("sala barulhenta demais não trava o limiar lá em cima", limiarDoSilencio(Array(30).fill(0.3)) === 0.15);
  check("sem nada ouvido, fica o mínimo", limiarDoSilencio([]) === VOLUME_MIN);

  const chiado = ruido(2048, 0.04);  // volume parecido com o de um ventilador perto do celular
  const limiarDoChiado = limiarDoSilencio(Array(30).fill(ouvir(chiado, 48000).volume));
  check("o barulho do ventilador, depois de calibrado, não conta como voz",
    ouvir(chiado, 48000, limiarDoChiado).voz === false);
  check("e a voz, mais alta que ele, conta", ouvir(onda(220, 48000, [1, 0.5, 0.3]), 48000, limiarDoChiado).voz === true);
}

// Uma música pequena, escrita à mão, com cada coisa que o formato tem.
const PEQUENA = `﻿#TITLE:Pequena\r
#ARTIST:Teste\r
#BPM:150,0\r
#GAP:1000\r
: 0 4 0 Lá\r
* 4 4 2  lá\r
F 8 4 4 ei\r
- 12\r
R 16 4 0 fa\r
: 20 4 7 la\r
E\r
lixo depois do fim`;

secao("Lendo uma música (formato UltraStar)");
{
  const m = lerMusica(PEQUENA);
  check("título e artista", m.titulo === "Pequena" && m.artista === "Teste");
  check("BPM com vírgula, do jeito que alguns arquivos escrevem", m.bpm === 150);
  check("GAP em milissegundos", m.gap === 1000);
  check("uma parte, duas linhas", m.partes.length === 1 && m.partes[0].linhas.length === 2);
  const [l1, l2] = m.partes[0].linhas;
  check("os tipos de nota: normal, ouro, livre, falada",
    l1.notas.map((n) => n.tipo).join() === "normal,ouro,livre" && l2.notas[0].tipo === "falada");
  check("o espaço antes da palavra fica na sílaba", l1.notas[1].silaba === " lá");
  check("o texto da linha junta as sílabas", l1.texto === "Lá láei");
  check("a linha sabe onde começa e acaba", l1.inicio === 0 && l1.fim === 12);
  check("o que vem depois do E é ignorado", m.partes[0].linhas.length === 2);

  // BPM 150 → batida de 60/600 = 0,1 s; GAP de 1 s.
  check("batida 0 é o fim do GAP", segundosDaBatida(m, 0) === 1);
  check("batida 10 é 1 segundo depois", Math.abs(segundosDaBatida(m, 10) - 2) < 1e-9);
  check("e a conta de volta bate", Math.abs(batidaNoTempo(m, 2) - 10) < 1e-9);
  const parte = m.partes[0];
  check("no meio da primeira nota, é ela que conta", notaNoTempo(parte, 2) === l1.notas[0]);
  check("antes da música, nenhuma nota", notaNoTempo(parte, -5) === null);
  check("entre uma linha e outra, nenhuma nota", notaNoTempo(parte, 14) === null);
  check("depois da última nota, nenhuma", notaNoTempo(parte, 30) === null);
  check("a tela mostra a linha que está tocando", linhaNaTela(parte, 5) === l1);
  check("entre as linhas, mostra a próxima se ela está perto", linhaNaTela(parte, 14, 4) === l2);
  check("e nada se ela ainda está longe", linhaNaTela(parte, 13, 2) === null);
  check("a linha seguinte da primeira é a segunda", linhaSeguinte(parte, l1) === l2);
  check("o Dó central é o MIDI 60", midiDoTom(0) === 60);

  let erro = "";
  try { lerMusica("#TITLE:x\n: 0 1 0 a"); } catch (e) { erro = e.message; }
  check("música sem BPM avisa em vez de tocar errado", erro.includes("BPM"));
  erro = "";
  try { lerMusica("#BPM:100\n#RELATIVE:yes\n: 0 1 0 a"); } catch (e) { erro = e.message; }
  check("formato relativo avisa que ainda não é aceito", erro.includes("relativo"));
}

secao("A letra na tela");
{
  // "so~~l" cantado em três notas, depois " lá" rápido, e um "~" com espaço
  // no fim (sílaba sustentada que fecha a palavra).
  const m = lerMusica(`#BPM:100
: 0 4 7 So
: 4 4 9 ~
: 8 8 7 ~
: 16 2 5  lá
: 18 2 4  si
: 20 6 2 ~\x20
: 26 2 0 fim
E`);
  const ln = m.partes[0].linhas[0];
  const pedacos = pedacosDaLinha(ln);
  check("o til não aparece na letra", pedacos.every((p) => !p.texto.includes("~")) && !ln.texto.includes("~"));
  check("a sílaba sustentada vira um pedaço só", pedacos[0].texto === "So" && pedacos[0].inicio === 0 && pedacos[0].fim === 16);
  check("sílaba rápida é um pedaço curto", pedacos[1].texto === " lá" && pedacos[1].fim - pedacos[1].inicio === 2);
  check("til com espaço estica a sílaba e fecha a palavra", pedacos[2].texto === " si " && pedacos[2].fim === 26);
  check("o texto da linha fica limpo", ln.texto === "So lá si fim");
}

secao("Letra picotada vira frase");
{
  // Do jeito que apareceu na Casual: uma linha longa e depois pedacinhos colados.
  // BPM 300 → batida de 0,05 s; 1 segundo = 20 batidas.
  const m = lerMusica(`#BPM:300
: 0 10 0 That I'm just a girl that you bang on your couch
- 12
: 14 4 0 I
- 20
: 22 10 0 thought you thought of
- 34
: 36 4 0 me
- 42
: 44 6 0 better
- 200
: 200 10 0 Depois de uma pausa longa
E`);
  const frases = frasesParaLetra(m.partes[0], m).linhas.map((l) => l.texto);
  check("a linha longa fica sozinha", frases[0] === "That I'm just a girl that you bang on your couch");
  check("os pedacinhos colados viram uma frase só", frases[1] === "I thought you thought of me better", frases[1]);
  check("depois de uma pausa longa, começa outra frase", frases[2] === "Depois de uma pausa longa");
  check("a frase pinta as sílabas com espaço entre as palavras",
    pedacosDaLinha(frasesParaLetra(m.partes[0], m).linhas[1]).map((p) => p.texto).join("") === "I thought you thought of me better");
  check("juntar frases não mexe nas linhas da pontuação", m.partes[0].linhas.length === 6);
}

secao("Link do YouTube");
{
  check("youtu.be", idDoYoutube("https://youtu.be/dQw4w9WgXcQ?si=abc") === "dQw4w9WgXcQ");
  check("watch?v=", idDoYoutube("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s") === "dQw4w9WgXcQ");
  check("link do celular (m.youtube)", idDoYoutube("https://m.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ");
  check("shorts", idDoYoutube("https://youtube.com/shorts/dQw4w9WgXcQ") === "dQw4w9WgXcQ");
  check("YouTube Music", idDoYoutube("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x") === "dQw4w9WgXcQ");
  check("só o código", idDoYoutube("dQw4w9WgXcQ") === "dQw4w9WgXcQ");
  check("link de outro site não vale", idDoYoutube("https://example.com/watch?v=dQw4w9WgXcQ") === null);
  check("texto qualquer não vale", idDoYoutube("canto gutural mongol") === null);
}

secao("Música aberta do aparelho");
{
  // O cabeçalho que o UltraSinger escreve (formato 1.2.0): #MP3 e #AUDIO
  // apontam pro mesmo arquivo, e o #INSTRUMENTAL é a música sem a voz.
  const m = lerMusica(`#VERSION:1.2.0
#ARTIST:Artista
#TITLE:Musica
#MP3:Artista - Musica.mp3
#AUDIO:Artista - Musica.mp3
#VOCALS:Artista - Musica [Vocals].mp3
#INSTRUMENTAL:Artista - Musica [Instrumental].mp3
#BPM:300
#GAP:1500
: 0 4 0 a
E`);
  check("o áudio da música vem do #AUDIO", m.arquivos.audio === "Artista - Musica.mp3");
  check("o instrumental vem do #INSTRUMENTAL", m.arquivos.instrumental === "Artista - Musica [Instrumental].mp3");
  check("a voz separada vem do #VOCALS", m.arquivos.voz === "Artista - Musica [Vocals].mp3");
  check("arquivo antigo, só com #MP3, também acha o áudio", lerMusica("#BPM:100\n#MP3:velho.mp3\n: 0 1 0 a").arquivos.audio === "velho.mp3");

  const todos = ["Artista - Musica.txt", "Artista - Musica.mp3", "Artista - Musica [Instrumental].mp3", "capa.jpg"];
  check("escolhendo tudo, toca o instrumental (sem a voz original)",
    escolherAudio(todos, m) === "Artista - Musica [Instrumental].mp3");
  check("sem o instrumental, toca o áudio da música",
    escolherAudio(["Artista - Musica.txt", "Artista - Musica.mp3"], m) === "Artista - Musica.mp3");
  check("com o áudio renomeado, toca o áudio que veio", escolherAudio(["x.txt", "minha musica.m4a"], m) === "minha musica.m4a");
  check("só a capa e o .txt: não tem o que tocar", escolherAudio(["x.txt", "capa.jpg"], m) === null);
}

secao("Todas as músicas no mesmo volume");
{
  const alta = [onda(220, 48000, [1], 48000, 0.9)];    // estourando, tipo Dancing Queen
  const baixa = [onda(220, 48000, [1], 48000, 0.05)];  // gravação baixinha
  const g1 = ganhoParaIgualar(alta), g2 = ganhoParaIgualar(baixa);
  check("música alta é abaixada", g1 < 0.5, `ganho ${g1.toFixed(2)}`);
  check("música baixa é aumentada, mas sem exagero", g2 > 1 && g2 <= 1.5, `ganho ${g2.toFixed(2)}`);
  check("silêncio total não explode o volume", ganhoParaIgualar([new Float32Array(1000)]) === 1);
}

secao("Várias músicas de uma vez");
{
  const cabeca = (nome) => lerMusica(`#BPM:100\n#AUDIO:${nome}.opus\n#INSTRUMENTAL:${nome} [Instrumental].opus\n: 0 1 0 a`);
  const nomes = ["A.txt", "A.opus", "A [Instrumental].opus", "B.txt", "B.opus", "C.txt", "outra coisa.mp3"];
  const pares = parearArquivos([
    { nome: "A.txt", musica: cabeca("A") }, { nome: "B.txt", musica: cabeca("B") }, { nome: "C.txt", musica: cabeca("C") },
  ], nomes);
  check("cada música pega o seu instrumental", pares[0].audio === "A [Instrumental].opus");
  check("sem instrumental, pega o seu próprio áudio", pares[1].audio === "B.opus");
  check("com várias músicas, não adivinha áudio de nome diferente (trocaria as músicas)", pares[2].audio === null);
  check("o resto do item passa junto", pares[0].nome === "A.txt" && pares[0].musica.arquivos.audio === "A.opus");
  const sozinha = parearArquivos([{ nome: "C.txt", musica: cabeca("C") }], ["C.txt", "minha.mp3"]);
  check("uma música sozinha aceita o áudio que veio, mesmo com outro nome", sozinha[0].audio === "minha.mp3");

  // A pasta "musicas" inteira, com a versão antiga e a do USDB da mesma música.
  const pastas = separarPorPasta([
    "musicas/Babe (1)/Babe.txt", "musicas/Babe (1)/Babe [Instrumental].opus",
    "musicas/Babe/Babe.txt", "musicas/Babe/Babe [Instrumental].opus",
    "musicas/Casual/Casual.txt",
  ]);
  check("cada pasta vira um grupo", pastas.length === 3);
  check("os arquivos de mesmo nome ficam cada um na sua pasta",
    pastas.every(([, nomes]) => nomes.filter((n) => n === "Babe.txt").length <= 1));
  check("a versão (1) vem depois, e é ela que fica valendo",
    pastas.map(([p]) => p).join("|") === "musicas/Babe|musicas/Babe (1)|musicas/Casual");
  check("arquivos escolhidos soltos (sem pasta) ficam num grupo só",
    separarPorPasta(["a.txt", "a.opus"]).length === 1 && separarPorPasta(["a.txt", "a.opus"])[0][0] === "");
}

secao("Fila");
{
  const musicas = [{ id: "teste" }, { id: "Chappell Roan - Casual", temVoz: true }];
  const conectados = new Map([["1", {}], ["2", {}], ["3", {}]]);
  let n = 0;
  const gerarId = () => `x${++n}`;
  const pedir = (msg, de, fila = []) => novoPedido(msg, de, { musicas, conectados, fila, gerarId });

  const solo = pedir({ musicaId: "Chappell Roan - Casual", dificuldade: "facil" }, "1");
  check("pedido solo vira um pedido com quem pediu", solo.pedido.quem.join() === "1" && solo.pedido.dificuldade === "facil");
  const dueto = pedir({ musicaId: "teste", com: "2", dificuldade: "dificil" }, "1");
  check("pedido com outra pessoa: quem pediu e a outra, nessa ordem", dueto.pedido.quem.join() === "1,2");
  check("música que não está na biblioteca é recusada", pedir({ musicaId: "Canto gutural mongol" }, "1").erro !== undefined);
  check("cantar com alguém que saiu é recusado", pedir({ musicaId: "teste", com: "9" }, "1").erro !== undefined);
  check("cantar consigo mesmo é recusado", pedir({ musicaId: "teste", com: "1" }, "1").erro !== undefined);
  check("dificuldade inventada vira médio", pedir({ musicaId: "teste", dificuldade: "impossivel" }, "1").pedido.dificuldade === "medio");
  const cheia = Array.from({ length: MAXIMO_POR_PESSOA }, (_, i) => ({ id: `f${i}`, pedidoPor: "1", quem: ["1"] }));
  check(`quem já tem ${MAXIMO_POR_PESSOA} na fila espera`, pedir({ musicaId: "teste" }, "1", cheia).erro !== undefined);
  check("os outros continuam podendo pedir", pedir({ musicaId: "teste" }, "2", cheia).pedido !== undefined);
  check("pedido com a voz da artista baixinha", pedir({ musicaId: "Chappell Roan - Casual", voz: 0.35 }, "1").pedido.voz === 0.35);
  check("música sem a voz separada não tem voz, peça o que pedir", pedir({ musicaId: "teste", voz: 1 }, "1").pedido.voz === 0);
  const video = pedir({ youtube: "https://youtu.be/dQw4w9WgXcQ" }, "1");
  check("pedido do YouTube entra na fila, sem precisar estar na biblioteca", video.pedido?.youtube === "dQw4w9WgXcQ");
  check("link quebrado do YouTube é recusado com explicação", pedir({ youtube: "oi" }, "1").erro !== undefined);
  check("o limite por pessoa vale pro YouTube também", pedir({ youtube: "dQw4w9WgXcQ" }, "1", cheia).erro !== undefined);
  check("volume da voz acima do máximo vira o máximo", volumeDaVoz(7) === 1);
  check("volume da voz estranho vira desligado", volumeDaVoz("alto") === 0 && volumeDaVoz(-1) === 0);

  // Ana (1) pediu três; Beto (2) e Carol (3) pediram depois.
  const fila = [
    { id: "a1", pedidoPor: "1", quem: ["1"] }, { id: "a2", pedidoPor: "1", quem: ["1"] },
    { id: "b1", pedidoPor: "2", quem: ["2", "1"] }, { id: "c1", pedidoPor: "3", quem: ["3"] },
  ];
  check("ninguém cantou ainda: vale a ordem de chegada",
    filaOrdenada(fila, new Map()).map((p) => p.id).join() === "a1,a2,b1,c1");
  check("Ana já cantou uma: Beto e Carol passam na frente dela",
    filaOrdenada(fila, new Map([["1", 1]])).map((p) => p.id).join() === "b1,c1,a1,a2");
  check("ordenar não mexe na fila original", fila.map((p) => p.id).join() === "a1,a2,b1,c1");
  check("quem sai da sala leva junto os pedidos em que estava",
    semQuemSaiu(fila, "2").map((p) => p.id).join() === "a1,a2,c1");
  check("inclusive o dueto em que só era convidado", semQuemSaiu(fila, "1").map((p) => p.id).join() === "c1");
}

secao("A música de teste");
{
  const m = lerMusica(TEXTO);
  const [p1, p2] = m.partes;
  check("é um dueto", m.partes.length === 2);
  check("a parte 1 canta 4 linhas e a parte 2 também", p1.linhas.length === 4 && p2.linhas.length === 4);
  check("a letra da primeira linha", p1.linhas[0].texto === "Solta a voz, amigo meu");
  check("a letra da parte 2", p2.linhas[0].texto === "Se afinar, ganha ponto" && p2.linhas[1].texto === "Errou a nota? Tudo bem");
  check("o fim, os dois juntos", p1.linhas[3].texto === "Hoje o gogó vai brilhar" && p2.linhas[3].texto === p1.linhas[3].texto);
  check("toda linha tem 7 notas", m.partes.every((p) => p.linhas.every((ln) => ln.notas.length === 7)));
  check("a última nota de cada linha é de ouro", m.partes.every((p) => p.linhas.every((ln) => ln.notas[6].tipo === "ouro")));
  check("as notas ficam entre o Dó e o Lá centrais",
    m.partes.every((p) => p.linhas.every((ln) => ln.notas.every((n) => n.tom >= 0 && n.tom <= 9))));
  const solo = parteSolo(m);
  check("cantando sozinho: 6 linhas (as duas do fim não repetem)", solo.linhas.length === 6);
  check("e em ordem", solo.linhas.every((ln, i) => i === 0 || ln.inicio > solo.linhas[i - 1].inicio));
  check("a música acaba na batida 511", fimDaMusica(m) === 511);
  check("o buraco instrumental dura mais de 8 segundos (pra o visualizador grande aparecer)",
    (p1.linhas[2].inicio - p2.linhas[1].fim) * (60 / (m.bpm * 4)) > 8);
  // O acompanhamento cobre a música toda, sem buraco nem acorde por cima de outro.
  const emOrdem = [...ACORDES].sort((a, b) => a.batida - b.batida);
  check("os acordes começam no início e emendam um no outro",
    emOrdem[0].batida === 0 && emOrdem.every((a, i) => i === 0 || a.batida === emOrdem[i - 1].batida + emOrdem[i - 1].duracao));
  check("e vão até depois da última nota", emOrdem.at(-1).batida + emOrdem.at(-1).duracao >= fimDaMusica(m));
  check("o solo instrumental fica no buraco entre a parte 2 e o final",
    SOLO[0].batida >= p2.linhas[1].fim && SOLO.at(-1).batida + SOLO.at(-1).duracao <= p1.linhas[2].inicio);
}

secao("Acertou a nota?");
{
  check("uma oitava acima é a mesma nota", distanciaSemOitava(72, 60) === 0);
  check("uma oitava abaixo também", distanciaSemOitava(48, 60) === 0);
  check("meio tom de diferença é 1", distanciaSemOitava(61, 60) === 1 && distanciaSemOitava(59, 60) === 1);
  check("o mais longe possível é 6 (o trítono)", distanciaSemOitava(66, 60) === 6);
  check("Si é meio tom abaixo do Dó de cima, não 11 acima", distanciaSemOitava(71, 60) === 1);

  check("fácil: qualquer nota firme vale", acertou(65, 0, "facil") && acertou(48.3, 7, "facil"));
  check("fácil: sem nota firme (ventilador, conversa) não vale", !acertou(null, 0, "facil"));
  check("médio: meio tom de folga vale", acertou(61, 0, "medio") && acertou(59, 0, "medio"));
  check("médio: um tom inteiro de distância não vale", !acertou(62, 0, "medio"));
  check("difícil: um pouco desafinado ainda é a nota", acertou(60.4, 0, "dificil"));
  check("difícil: perto do meio tom já não é", !acertou(60.6, 0, "dificil"));
  check("difícil: uma oitava abaixo e afinado vale", acertou(48, 0, "dificil"));

  check("pra desenhar, uma oitava abaixo vem pra perto da nota", pertoDaOitava(48.2, 60) === 60.2);
  check("e uma oitava acima também", Math.abs(pertoDaOitava(73, 60) - 61) < 1e-9);
}

secao("Placar");
{
  const m = lerMusica(PEQUENA);
  const parte = m.partes[0];
  const [la, ouro, livre] = parte.linhas[0].notas;
  const [falada, ultima] = parte.linhas[1].notas;
  const cantarTudo = (placar, certo) => {
    for (const n of [la, ouro, ultima]) for (let i = 0; i < 4; i++) placar.registrar(n, certo ? midiDoTom(n.tom) : midiDoTom(n.tom) + 3, true);
    for (let i = 0; i < 4; i++) placar.registrar(falada, null, true);
  };

  const perfeito = new Placar(parte, "medio");
  cantarTudo(perfeito, true);
  check("cantou tudo certo: 10.000 pontos", perfeito.resumo().pontos === 10000, `deu ${perfeito.resumo().pontos}`);
  check("e todas as linhas perfeitas", perfeito.resumo().linhasPerfeitas === 2);

  const calado = new Placar(parte, "medio");
  check("não cantou nada: zero", calado.resumo().pontos === 0 && calado.resumo().tempo === 0);

  const metade = new Placar(parte, "medio");
  for (const n of [la, ouro, ultima]) {
    metade.registrar(n, midiDoTom(n.tom), true);
    metade.registrar(n, null, false);
  }
  metade.registrar(falada, null, true);
  metade.registrar(falada, null, false);
  check("acertou metade de cada nota: 5.000", metade.resumo().pontos === 5000, `deu ${metade.resumo().pontos}`);

  // Só a nota de ouro certa: ela pesa 4 batidas × 2 = 8, de um total de 4+8+4+4 = 20.
  const soOuro = new Placar(parte, "medio");
  soOuro.registrar(ouro, midiDoTom(ouro.tom), true);
  check("nota de ouro vale dobrado", soOuro.resumo().pontos === 4000, `deu ${soOuro.resumo().pontos}`);

  check("nota livre não conta nem atrapalha", perfeito.registrar(livre, 99, true) === null);
  check("fora de nota nenhuma, nada é registrado", perfeito.registrar(null, 60, true) === null);
  check("trecho falado conta voz, sem olhar nota", new Placar(parte, "dificil").registrar(falada, null, true) === true);

  const desafinado = new Placar(parte, "medio");
  cantarTudo(desafinado, false);
  const r = desafinado.resumo();
  check("cantou o tempo todo, mas fora do tom: tempo alto, nota baixa", r.tempo === 1 && r.notas === 0.25, `tempo ${r.tempo}, notas ${r.notas}`);
  check("e o título zoa com carinho", ["Ritmo no sangue, tom de férias", "O tom foi passear", "Dançou com a música, discutiu com as notas"].includes(tituloDe(r)));

  const facil = new Placar(parte, "facil");
  cantarTudo(facil, false);
  check("no fácil, a mesma pessoa fora do tom ganha tudo", facil.resumo().pontos === 10000);

  // No fácil, 60% de uma nota já vale a nota toda.
  const quase = new Placar(parte, "facil");
  for (const ln of parte.linhas) for (const n of ln.notas) {
    for (let i = 0; i < 10; i++) quase.registrar(n, i < 6 ? 60 : null, i < 6);
  }
  check("fácil: cantou 60% de cada nota, ganha tudo", quase.resumo().pontos === 10000, `deu ${quase.resumo().pontos}`);

  // Leitura um tiquinho fora da nota: só conta se ajudar.
  const fora = new Placar(parte, "medio");
  const n0 = parte.linhas[0].notas[0];
  check("fora da nota e errada: não conta", fora.registrar(n0, null, false, { soSeCerto: true }) === null && fora.fracaoCerta(n0) === 0);
  check("fora da nota e certa: conta", fora.registrar(n0, midiDoTom(n0.tom), true, { soSeCerto: true }) === true && fora.fracaoCerta(n0) === 1);

  // O embalo: 8 notas certas seguidas e as próximas valem 50% a mais.
  const longa = { linhas: [{ inicio: 0, fim: 48, notas: Array.from({ length: 12 }, (_, i) => ({ inicio: i * 4, duracao: 2, tom: 0, tipo: "normal", texto: "la" })) }] };
  const notasDaParte = longa.linhas[0].notas;
  const embalado = new Placar(longa, "medio");
  let entrou = -1;
  notasDaParte.forEach((n, i) => {
    embalado.registrar(n, midiDoTom(n.tom), true);
    if (embalado.fecharNota(n) && entrou < 0) entrou = i;
  });
  check("entra no embalo na 8ª nota certa seguida", entrou === (notasDaParte.length >= 8 ? 7 : -1), `entrou na ${entrou + 1}ª de ${notasDaParte.length}`);
  if (notasDaParte.length > 8) {
    const r = embalado.resumo();
    check("no embalo, passa de 10.000 com bônus", r.pontos > 10000 && r.bonus > 0 && r.pontos === 10000 + r.bonus, `deu ${r.pontos} (+${r.bonus})`);
  }
  const quebrou = new Placar(longa, "medio");
  for (let i = 0; i < 8; i++) quebrou.fecharNota(notasDaParte[i]);
  check("errou (não cantou): a sequência zera e não entra no embalo", quebrou.sequencia === 0 && !quebrou.embalo);
}

secao("Títulos do resultado");
{
  check("quase não cantou", tituloDe({ notas: 0, tempo: 0.1 }) === "Microfone tímido");
  check("cantou tudo certo", tituloDe({ notas: 0.9, tempo: 0.95 }) === "Afinação de estúdio");
  check("cantou bastante, acertou pouco", tituloDe({ notas: 0.2, tempo: 0.6 }) === "Faltou nota, sobrou coragem");
  check("acertou bem", tituloDe({ notas: 0.65, tempo: 0.7 }) === "Mandou bem");
  check("no meio do caminho", tituloDe({ notas: 0.4, tempo: 0.5 }) === "No caminho certo");
  check("nenhum título tem gênero (íssima, ado/ada)",
    ["Microfone tímido", "Afinação de estúdio", "Ritmo no sangue, tom de férias", "Faltou nota, sobrou coragem",
      "Mandou bem", "No caminho certo"].every((t) => !/íssim|ad[oa]\b/.test(t)));
  // O primeiro teste de verdade, no fácil: 86% de notas e de tempo.
  check("no fácil, ir bem é ritmo, não afinação", tituloDe({ notas: 0.86, tempo: 0.86 }, "facil") === "Ritmo de estúdio");
  const titulosDoFacil = [0, 0.1, 0.3, 0.5, 0.65, 0.9, 1].map((t) => tituloDe({ notas: t, tempo: t }, "facil"));
  check("nenhum título do fácil fala de afinação ou de tom",
    titulosDoFacil.every((t) => !/afina|tom\b|nota/i.test(t)), titulosDoFacil.join(" | "));
  check("no médio, o mesmo resultado continua sendo afinação", tituloDe({ notas: 0.86, tempo: 0.86 }, "medio") === "Afinação de estúdio");
  check("dupla com pontos parecidos", tituloDaDupla({ pontos: 7800 }, { pontos: 7000 }) === "Dupla entrosada");
  check("dupla com um muito melhor", tituloDaDupla({ pontos: 8000 }, { pontos: 3000 }) === "Um carregou o outro");
  check("dupla que não cantou", tituloDaDupla({ pontos: 0 }, { pontos: 0 }) === "Dupla tímida");
}

secao("Pontinhos soltos");
{
  check("um salto de oitava no meio de uma nota some", suavizar([60, 60, 72]) === 60);
  check("um ponto sozinho no silêncio some", suavizar([null, null, 72]) === null);
  check("mudar de nota de verdade passa, depois de duas leituras", suavizar([60, 67, 67]) === 67);
  check("parou de cantar, a linha para na hora", suavizar([60, 60, null]) === null);
  check("com duas leituras seguidas, já aparece", suavizar([null, 64, 64]) === 64);
  check("começo da música, só uma leitura: espera", suavizar([64]) === null);
}

console.log(`\n${OK.length} ok, ${FALHAS.length} falha(s)`);
if (FALHAS.length) process.exit(1);
