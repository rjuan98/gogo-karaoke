// Descobre a nota que a pessoa está cantando, a partir de um pedaço de áudio.
// Não depende de onde o som veio: o celular usa hoje, e um microfone ligado no
// notebook vai usar o mesmo arquivo depois.
//
// O método é o YIN (de Cheveigné e Kawahara, 2002): procura de quanto em quanto
// tempo a onda se repete. Esse "de quanto em quanto" é o período, e 1/período é
// a frequência.

export const VOZ_MIN_HZ = 70;    // baixo bem grave
export const VOZ_MAX_HZ = 1100;  // soprano lá em cima

// Abaixo disso é silêncio, numa sala quieta. Sala com barulho ganha um limiar
// próprio: veja limiarDoSilencio.
export const VOLUME_MIN = 0.01;
// Nem a sala mais barulhenta sobe o limiar além disso, senão ninguém canta.
const LIMIAR_MAXIMO = 0.15;

// Quão parecida a onda tem que ser com ela mesma, um período depois, pra contar
// como nota. Menor = mais exigente. O artigo do YIN usa 0,1 a 0,15, mas voz de
// verdade (sussurro, eco, gente cantando junto) fica de fora demais: medido com
// a voz da Chappell Roan, 0,15 achava nota em 63% das leituras e 0,25 acha em
// 74%, errando só um pouco mais (79% → 76% batendo com a nota). Acima de 0,25
// a fundamental fraca começa a virar oitava errada (há teste pra isso).
const LIMIAR = 0.25;

const NOMES = ["Dó", "Dó♯", "Ré", "Ré♯", "Mi", "Fá", "Fá♯", "Sol", "Sol♯", "Lá", "Lá♯", "Si"];

export function volume(amostras) {
  let soma = 0;
  for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i];
  return Math.sqrt(soma / amostras.length);
}

// { hz, clareza } ou null quando o som não se repete (ruído, consoante, fala).
export function detectarNota(amostras, taxa) {
  const tauMin = Math.floor(taxa / VOZ_MAX_HZ);
  const tauMax = Math.min(Math.floor(taxa / VOZ_MIN_HZ), Math.floor(amostras.length / 2));
  const largura = amostras.length - tauMax;

  // Diferença entre a onda e ela mesma deslocada de tau amostras,
  // normalizada pela média acumulada (é o que tira o viés pro tau pequeno).
  const norm = new Float32Array(tauMax + 1);
  norm[0] = 1;
  let acumulado = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let d = 0;
    for (let j = 0; j < largura; j++) {
      const dif = amostras[j] - amostras[j + tau];
      d += dif * dif;
    }
    acumulado += d;
    norm[tau] = acumulado ? (d * tau) / acumulado : 1;
  }

  // O primeiro vale abaixo do limiar, e não o mais fundo: o mais fundo às vezes
  // é o dobro do período, e aí a nota sairia uma oitava abaixo.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (norm[t] < LIMIAR) {
      while (t + 1 <= tauMax && norm[t + 1] < norm[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // O vale de verdade cai entre duas amostras; uma parábola pelos três pontos
  // acha onde. Sem isso, a 48 kHz um Lá 880 sai 14 cents baixo.
  let exato = tau;
  if (tau > 1 && tau < tauMax) {
    const a = norm[tau - 1], b = norm[tau], c = norm[tau + 1];
    const curva = a + c - 2 * b;
    if (curva > 0) exato = tau + (a - c) / (2 * curva);
  }
  return { hz: taxa / exato, clareza: 1 - norm[tau] };
}

// O que o microfone ouviu neste pedaço: tem voz? em que nota?
// Tem voz sem nota quando a pessoa fala, sussurra ou canta uma consoante —
// e é isso que vai contar no modo fácil, que não olha o tom.
export function ouvir(amostras, taxa, volumeMin = VOLUME_MIN) {
  const vol = volume(amostras);
  if (vol < volumeMin) return { voz: false, hz: null, clareza: 0, volume: vol };
  const nota = detectarNota(amostras, taxa);
  return { voz: true, hz: nota ? nota.hz : null, clareza: nota ? nota.clareza : 0, volume: vol };
}

// Quanto barulho a sala faz com todo mundo calado (ventilador, geladeira, TV
// baixinha). Recebe os volumes de uns 2 segundos de silêncio; a voz precisa
// passar bem disso pra contar. O 90º percentil ignora um estalo isolado.
export function limiarDoSilencio(volumes) {
  if (!volumes.length) return VOLUME_MIN;
  const ordenados = [...volumes].sort((a, b) => a - b);
  const barulho = ordenados[Math.floor((ordenados.length - 1) * 0.9)];
  return Math.min(LIMIAR_MAXIMO, Math.max(VOLUME_MIN, barulho * 2.5));
}

// Número da nota no padrão MIDI: Lá 440 = 69, cada semitom soma 1.
export function hzParaMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

export function nomeDaNota(midi) {
  const n = Math.round(midi);
  return NOMES[((n % 12) + 12) % 12];
}

// Quanto a voz está acima (+) ou abaixo (-) da nota mais próxima. 100 cents = 1 semitom.
export function centsDaNota(midi) {
  return Math.round((midi - Math.round(midi)) * 100);
}
