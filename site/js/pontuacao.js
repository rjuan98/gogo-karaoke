// Como a nota cantada vira ponto. Sem rede e sem áudio: dá pra testar no Node.
import { midiDoTom } from "./musica.js";

// A regra de cada dificuldade, do jeito que aparece pra quem vai cantar.
// "folga" é quanto a nota pode fugir da certa, em semitons; null = não olha o tom.
export const DIFICULDADES = {
  facil: { nome: "Fácil", regra: "Conta cantar uma nota firme na hora certa. Qual nota, não importa.", folga: null },
  medio: { nome: "Médio", regra: "Conta a nota, com folga de meio tom pra cima ou pra baixo.", folga: 1 },
  dificil: { nome: "Difícil", regra: "Conta a nota exata.", folga: 0.5 },
};

// Distância em semitons sem olhar a oitava: cantar uma oitava acima ou abaixo
// (o que todo homem faz numa música de mulher, e vice-versa) vale igual.
export function distanciaSemOitava(midiA, midiB) {
  const d = (((midiA - midiB) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

// No fácil basta uma nota firme: ventilador, conversa e TV não sustentam nota,
// então não ganham ponto (no teste em casa, o ventilador passava por voz).
// Leva a nota cantada pra oitava mais perto da nota certa. É só pra desenhar:
// quem canta uma oitava abaixo aparece colado na barra, e não lá embaixo.
export function pertoDaOitava(midi, alvo) {
  return alvo + ((((midi - alvo) % 12) + 18) % 12) - 6;
}

export function acertou(midiCantado, tom, dificuldade) {
  if (midiCantado === null) return false;
  const folga = DIFICULDADES[dificuldade].folga;
  if (folga === null) return true;
  return distanciaSemOitava(midiCantado, midiDoTom(tom)) <= folga;
}

// No fácil, cantar 60% de uma nota já vale a nota inteira: o microfone do
// celular perde pedaço (consoante, respiração), e no primeiro teste de
// verdade nem o fácil parecia fácil.
const CHEIA_NO_FACIL = 0.6;

// "No embalo": com esse tanto de notas certas seguidas, cada nota certa
// passa a valer 50% a mais, até errar uma.
export const SEQUENCIA_DO_EMBALO = 8;
export const BONUS_DO_EMBALO = 0.5;

function ehOuro(nota) {
  return nota.tipo === "ouro" || nota.tipo === "falada-ouro";
}

function ehFalada(nota) {
  return nota.tipo === "falada" || nota.tipo === "falada-ouro";
}

// O placar de quem canta uma parte. Cada leitura do celular (umas 20 por
// segundo) cai numa nota; a nota vale pela fração de leituras certas.
export class Placar {
  constructor(parte, dificuldade) {
    this.parte = parte;
    this.dificuldade = dificuldade;
    this.notas = new Map();  // nota → { amostras, acertos, comVoz }
    this.letrasAcertadas = new Set();
    this.sequencia = 0;      // notas certas seguidas
    this.embalo = false;
    this.noEmbalo = new Set();  // notas cantadas no embalo: valem mais
    this.fechadas = new Set();
  }

  // Devolve se essa leitura acertou, ou null se não havia nota pra cantar.
  // soSeCerto: a leitura caiu um tiquinho antes ou depois da nota; só conta
  // se ajudar.
  registrar(nota, midi, voz, { soSeCerto = false } = {}) {
    if (!nota || nota.tipo === "livre") return null;
    // Trecho falado (rap) não tem nota certa: conta ter voz na hora.
    const certo = ehFalada(nota) ? voz === true : acertou(midi, nota.tom, this.dificuldade);
    if (soSeCerto && !certo) return null;
    let r = this.notas.get(nota);
    if (!r) {
      r = { amostras: 0, acertos: 0, comVoz: 0 };
      this.notas.set(nota, r);
    }
    r.amostras++;
    if (certo) r.acertos++;
    if (voz === true) r.comVoz++;
    return certo;
  }

  fracaoCerta(nota) {
    const r = this.notas.get(nota);
    const fracao = r && r.amostras ? r.acertos / r.amostras : 0;
    return this.dificuldade === "facil" ? Math.min(1, fracao / CHEIA_NO_FACIL) : fracao;
  }

  fracaoNoTempo(nota) {
    const r = this.notas.get(nota);
    return r && r.amostras ? r.comVoz / r.amostras : 0;
  }

  fracaoPontuada(nota) {
    return this.fracaoCerta(nota);
  }

  acertarLetra(nota) {
    if (nota && nota.tipo !== "livre" && !nota.silaba.trimStart().startsWith("~")) {
      this.letrasAcertadas.add(nota);
    }
  }

  // Quando a nota acaba: certa (metade ou mais) soma na sequência, errada zera.
  // Devolve se a pessoa está no embalo.
  fecharNota(nota) {
    if (!nota || nota.tipo === "livre" || this.fechadas.has(nota)) return this.embalo;
    this.fechadas.add(nota);
    const certa = this.fracaoPontuada(nota) >= 0.5;
    if (certa && this.embalo) this.noEmbalo.add(nota);
    this.sequencia = certa ? this.sequencia + 1 : 0;
    this.embalo = this.sequencia >= SEQUENCIA_DO_EMBALO;
    return this.embalo;
  }

  // Pontos de 0 a 10.000, e o que vai no resultado. Nota de ouro vale dobrado;
  // nota longa vale mais que nota curta.
  resumo() {
    let peso = 0, ganho = 0, extra = 0, total = 0, certas = 0, noTempo = 0, linhasPerfeitas = 0, linhas = 0;
    for (const ln of this.parte.linhas) {
      const contam = ln.notas.filter((n) => n.tipo !== "livre");
      if (!contam.length) continue;
      linhas++;
      let perfeita = true;
      for (const n of contam) {
        const fracao = this.fracaoCerta(n);
        const fracaoNoTempo = this.fracaoNoTempo(n);
        const p = n.duracao * (ehOuro(n) ? 2 : 1);
        peso += p;
        ganho += p * fracao;
        if (this.noEmbalo.has(n)) extra += p * fracao * BONUS_DO_EMBALO;
        total++;
        if (fracao >= 0.5) certas++;
        if (fracao < 0.5) perfeita = false;
        if (fracaoNoTempo >= 0.5) noTempo++;
      }
      if (perfeita) linhasPerfeitas++;
    }
    const silabas = this.parte.linhas.flatMap((ln) => ln.notas)
      .filter((n) => n.tipo !== "livre" && !n.silaba.trimStart().startsWith("~"));
    const letra = silabas.length ? silabas.filter((n) => this.letrasAcertadas.has(n)).length / silabas.length : 0;
    const bonusLetra = this.dificuldade === "facil" ? 0 : Math.round(500 * letra);
    return {
      // Os bônus da letra e do embalo vêm por cima: dá pra passar de 10.000.
      pontos: peso ? Math.round((10000 * ganho) / peso) + Math.round((10000 * extra) / peso) + bonusLetra : 0,
      bonus: peso ? Math.round((10000 * extra) / peso) : 0,
      bonusLetra,
      notas: total ? certas / total : 0,
      letra,
      tempo: total ? noTempo / total : 0,
      linhasPerfeitas,
      linhas,
    };
  }
}

// Zoeira carinhosa, e sem gênero: o app não sabe se a Ana é Ana ou Ano, então
// nada de "afinadíssima" — só frases.
export function tituloDe(r, dificuldade = "medio") {
  const escolher = (frases) => frases[Math.abs(Math.floor(r.pontos ?? 0)) % frases.length];
  if (r.tempo < 0.2) return escolher(["Microfone tímido", "A voz foi buscar uma bebida", "Presença de palco invisível"]);
  // No fácil o tom não conta, então nenhum título pode elogiar nem zoar a
  // afinação (no primeiro teste de verdade saiu "Afinação de estúdio" no fácil).
  if (dificuldade === "facil") {
    if (r.tempo >= 0.8) return escolher(["Ritmo de estúdio", "Nasceu no palco", "O metrônomo pediu autógrafo"]);
    if (r.tempo >= 0.6) return escolher(["Mandou bem", "A festa agradece", "Carisma em alta"]);
    return escolher(["No caminho certo", "A coragem chegou primeiro", "Foi no improviso e foi bonito"]);
  }
  if (r.notas >= 0.8 && r.tempo >= 0.8) return escolher(["Afinação de estúdio", "A caixa de som ficou com ciúme", "Nota atrás de nota, que espetáculo"]);
  if (r.tempo >= 0.7 && r.notas < 0.5) return escolher(["Ritmo no sangue, tom de férias", "O tom foi passear", "Dançou com a música, discutiu com as notas"]);
  if (r.tempo >= 0.5 && r.notas < 0.3) return escolher(["Faltou nota, sobrou coragem", "A coragem cantou em outro tom", "O afinador pediu um intervalo"]);
  if (r.notas >= 0.6) return escolher(["Mandou bem", "A festa agradece", "O microfone virou fã"]);
  return escolher(["No caminho certo", "A coragem chegou primeiro", "Foi no improviso e foi bonito"]);
}

export function tituloDaDupla(a, b) {
  const maior = Math.max(a.pontos, b.pontos);
  if (!maior) return "Dupla tímida";
  return Math.abs(a.pontos - b.pontos) <= 0.15 * maior ? "Dupla entrosada" : "Um carregou o outro";
}

// Recebe as três últimas leituras (a mais nova no fim; null = sem nota).
// Pontinho solto — oitava errada, um estalo — some; nota sustentada continua;
// e quando a pessoa para de cantar, a linha para na hora.
export function suavizar(ultimas) {
  const atual = ultimas[ultimas.length - 1] ?? null;
  if (atual === null) return null;
  const comNota = ultimas.filter((m) => m !== null);
  if (comNota.length < 2) return null;
  if (comNota.length === 2) return atual;
  return [...comNota].sort((a, b) => a - b)[1];
}
