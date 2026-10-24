// Lê uma música no formato do UltraStar (.txt): o mesmo que a comunidade usa e
// que o UltraSinger gera. Sem rede e sem áudio, então dá pra testar no Node.
//
// O arquivo marca o tempo em "batidas": cada batida dura 60 / (BPM × 4)
// segundos, contadas a partir do #GAP (em milissegundos). A altura vem em
// semitons, com 0 = Dó central (MIDI 60).

const TIPOS = { ":": "normal", "*": "ouro", "F": "livre", "R": "falada", "G": "falada-ouro" };

function numero(texto) {
  return Number(String(texto).replace(",", "."));  // tem arquivo que escreve 200,5
}

export function lerMusica(texto) {
  const musica = { titulo: "", artista: "", bpm: 0, gap: 0, cantores: {}, partes: [], arquivos: {} };
  const partePorNumero = {};
  let parte = null;
  let linha = null;

  function abrirParte(n) {
    if (!partePorNumero[n]) {
      partePorNumero[n] = { numero: n, linhas: [] };
      musica.partes.push(partePorNumero[n]);
    }
    parte = partePorNumero[n];
    linha = null;
  }

  for (const cru of String(texto).split(/\r?\n/)) {
    const l = cru.replace(/^﻿/, "");
    if (!l.trim()) continue;
    if (l.startsWith("#")) {
      const i = l.indexOf(":");
      if (i < 0) continue;
      const chave = l.slice(1, i).trim().toUpperCase();
      const valor = l.slice(i + 1).trim();
      if (chave === "TITLE") musica.titulo = valor;
      else if (chave === "ARTIST") musica.artista = valor;
      else if (chave === "BPM") musica.bpm = numero(valor);
      else if (chave === "GAP") musica.gap = numero(valor);
      // Os arquivos de áudio que acompanham o .txt. #AUDIO é o nome novo do
      // #MP3; quando os dois vêm, vale o #AUDIO.
      else if (chave === "AUDIO") musica.arquivos.audio = valor;
      else if (chave === "MP3") musica.arquivos.audio ??= valor;
      else if (chave === "INSTRUMENTAL") musica.arquivos.instrumental = valor;
      else if (chave === "VOCALS") musica.arquivos.voz = valor;
      else if (chave === "RELATIVE" && /^yes$/i.test(valor)) {
        throw new Error("Música no formato relativo (#RELATIVE) ainda não é aceita.");
      } else if (/^(DUETSINGERP|P)[12]$/.test(chave)) {
        musica.cantores[chave.slice(-1)] = valor;
      }
      continue;
    }
    if (/^P\s*\d+\s*$/.test(l)) { abrirParte(Number(l.replace(/\D/g, ""))); continue; }
    if (l.startsWith("E")) break;
    if (!parte) abrirParte(1);
    if (l.startsWith("-")) { linha = null; continue; }
    // Tipo, início, duração, altura e a sílaba. A sílaba vem depois de UM
    // espaço; se tiver outro, é o espaço entre palavras e faz parte dela.
    const m = l.match(/^([:*FRG])\s+(-?\d+)\s+(\d+)\s+(-?\d+) ?(.*)$/);
    if (!m) continue;  // linha que não dá pra entender: pula, como o UltraStar faz
    if (!linha) { linha = { notas: [] }; parte.linhas.push(linha); }
    linha.notas.push({
      tipo: TIPOS[m[1]], inicio: Number(m[2]), duracao: Number(m[3]), tom: Number(m[4]), silaba: m[5],
    });
  }

  if (!(musica.bpm > 0)) throw new Error("A música não diz o andamento (#BPM).");
  for (const p of musica.partes) {
    p.linhas = p.linhas.filter((ln) => ln.notas.length);
    for (const ln of p.linhas) {
      const ultima = ln.notas[ln.notas.length - 1];
      ln.inicio = ln.notas[0].inicio;
      ln.fim = ultima.inicio + ultima.duracao;
      ln.texto = ln.notas.map((n) => n.silaba).join("").replace(/~/g, "").trim();
    }
  }
  return musica;
}

export function duracaoDaBatida(musica) {
  return 60 / (musica.bpm * 4);
}

export function segundosDaBatida(musica, batida) {
  return musica.gap / 1000 + batida * duracaoDaBatida(musica);
}

export function batidaNoTempo(musica, segundos) {
  return (segundos - musica.gap / 1000) / duracaoDaBatida(musica);
}

export function midiDoTom(tom) {
  return 60 + tom;
}

export function fimDaMusica(musica) {
  let fim = 0;
  for (const p of musica.partes) for (const ln of p.linhas) fim = Math.max(fim, ln.fim);
  return fim;
}

// A nota que essa parte devia estar cantando nessa batida, ou null.
export function notaNoTempo(parte, batida) {
  for (const ln of parte.linhas) {
    if (batida < ln.inicio) return null;  // as linhas estão em ordem
    if (batida >= ln.fim) continue;
    return ln.notas.find((n) => batida >= n.inicio && batida < n.inicio + n.duracao) ?? null;
  }
  return null;
}

// A linha que aparece na tela: a que está tocando, ou a próxima, se ela
// começa dentro da antecedência (em batidas). Entre uma e outra, nenhuma.
export function linhaNaTela(parte, batida, antecedencia = Infinity) {
  const ln = parte.linhas.find((l) => batida < l.fim);
  if (!ln) return null;
  return ln.inicio - batida <= antecedencia ? ln : null;
}

// A letra de uma linha em pedaços, pra pintar no tempo. No UltraStar, uma
// sílaba que começa com "~" é a anterior sustentada em outra nota ("so~~~l"):
// ela não aparece escrita, só estica o pedaço de antes.
export function pedacosDaLinha(linha) {
  const pedacos = [];
  for (const n of linha.notas) {
    const texto = n.silaba.replace(/~/g, "");
    const anterior = pedacos[pedacos.length - 1];
    if (anterior && n.silaba.trimStart().startsWith("~")) {
      anterior.texto += texto;
      anterior.fim = n.inicio + n.duracao;
    } else {
      pedacos.push({ texto, inicio: n.inicio, fim: n.inicio + n.duracao });
    }
  }
  return pedacos;
}

// O UltraSinger quebra a letra a cada respiração e às vezes sobra linha de uma
// palavra só ("I" / "thought you thought of" / "me"). Pra mostrar, junta cada
// linha com as seguintes enquanto elas vêm coladas (menos de 1 segundo de
// espaço) e a frase ainda cabe na tela. Só muda a letra; as notas são as mesmas.
export function frasesParaLetra(parte, musica, maxLetras = 42) {
  const folga = 1 / duracaoDaBatida(musica);  // 1 segundo, em batidas
  const frases = [];
  let atual = null;
  for (const ln of parte.linhas) {
    const cabe = atual && ln.inicio - atual.fim <= folga && atual.texto.length + 1 + ln.texto.length <= maxLetras;
    if (cabe) {
      // A linha nova começa uma palavra: a primeira sílaba ganha o espaço.
      const [primeira, ...resto] = ln.notas;
      const espacada = /^\s/.test(primeira.silaba) ? primeira : { ...primeira, silaba: ` ${primeira.silaba}` };
      atual.notas.push(espacada, ...resto);
      atual.fim = ln.fim;
      atual.texto = `${atual.texto} ${ln.texto}`;
    } else {
      atual = { notas: [...ln.notas], inicio: ln.inicio, fim: ln.fim, texto: ln.texto };
      frases.push(atual);
    }
  }
  return { numero: parte.numero, linhas: frases };
}

export function linhaSeguinte(parte, linha) {
  const i = parte.linhas.indexOf(linha);
  return i >= 0 ? parte.linhas[i + 1] ?? null : null;
}

// Uma pessoa cantando um dueto sozinha canta as duas partes. Linha que as duas
// partes cantam juntas (mesmo início, mesmo texto) entra uma vez só.
export function parteSolo(musica) {
  if (musica.partes.length <= 1) return musica.partes[0];
  const vistas = new Map();
  for (const p of musica.partes) {
    for (const ln of p.linhas) {
      const chave = `${ln.inicio}|${ln.texto}`;
      if (!vistas.has(chave)) vistas.set(chave, ln);
    }
  }
  return { numero: 0, linhas: [...vistas.values()].sort((a, b) => a.inicio - b.inicio) };
}
