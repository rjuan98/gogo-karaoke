// O instrumental da música de teste, tocado pelo próprio navegador: não precisa
// de arquivo de áudio nenhum. Música de verdade vai tocar um arquivo; o resto
// do palco não muda, porque os dois entregam a mesma coisa: quando a música
// começou, um analisador (pro visualizador) e um jeito de parar.
import { duracaoDaBatida, midiDoTom, parteSolo, segundosDaBatida } from "./musica.js";

function tocar(audio, destino, { midi, quando, duracao, forma, volume }) {
  const osc = audio.createOscillator();
  const envelope = audio.createGain();
  const fim = quando + duracao;
  osc.type = forma;
  osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  // Entra e sai suave: corte seco de onda dá estalo.
  envelope.gain.setValueAtTime(0, quando);
  envelope.gain.linearRampToValueAtTime(volume, quando + 0.015);
  envelope.gain.setValueAtTime(volume, Math.max(quando + 0.015, fim - 0.05));
  envelope.gain.linearRampToValueAtTime(0, fim);
  osc.connect(envelope).connect(destino);
  osc.start(quando);
  osc.stop(fim + 0.02);
}

// O caminho até a caixa de som, passando pelo analisador do visualizador.
// "destino" é o volume geral do palco (o controle de volume da tela).
export function saidaComAnalisador(audio, destino = audio.destination, ganho = 0.8) {
  const saida = audio.createGain();
  saida.gain.value = ganho;
  const analisador = audio.createAnalyser();
  analisador.fftSize = 256;
  analisador.minDecibels = -85;
  analisador.maxDecibels = -25;
  analisador.smoothingTimeConstant = 0.75;
  saida.connect(analisador);
  analisador.connect(destino);
  return { saida, analisador };
}

export function tocarMusicaDeTeste(audio, musica, { acordes, solo, batidasPorTempo, guia = false, destino }) {
  const { saida, analisador } = saidaComAnalisador(audio, destino);

  const inicio = audio.currentTime + 0.3;  // folga pra agendar tudo antes de tocar
  const quando = (batida) => inicio + segundosDaBatida(musica, batida);
  const batida = duracaoDaBatida(musica);
  const tempo = batidasPorTempo * batida;

  // Contagem: um tique por tempo no espaço antes da primeira nota.
  for (let t = musica.gap / 1000 - tempo; t >= 0; t -= tempo) {
    tocar(audio, saida, { midi: 84, quando: inicio + t, duracao: 0.05, forma: "sine", volume: 0.15 });
  }
  for (const a of acordes) {
    for (let b = 0; b < a.duracao; b += batidasPorTempo) {
      tocar(audio, saida, { midi: a.baixo, quando: quando(a.batida + b), duracao: tempo * 0.9, forma: "triangle", volume: 0.35 });
    }
    for (const midi of a.notas) {
      tocar(audio, saida, { midi, quando: quando(a.batida), duracao: a.duracao * batida * 0.95, forma: "sine", volume: 0.06 });
    }
  }
  for (const s of solo) {
    tocar(audio, saida, { midi: s.midi, quando: quando(s.batida), duracao: s.duracao * batida, forma: "triangle", volume: 0.22 });
  }
  // A melodia-guia ajuda quem não conhece a música, mas o celular pode ouvir
  // ela saindo da caixa: por isso começa desligada.
  if (guia) {
    for (const ln of parteSolo(musica).linhas) {
      for (const n of ln.notas) {
        tocar(audio, saida, { midi: midiDoTom(n.tom), quando: quando(n.inicio), duracao: n.duracao * batida, forma: "triangle", volume: 0.14 });
      }
    }
  }

  return {
    inicio,
    analisador,
    parar() {
      saida.gain.setTargetAtTime(0, audio.currentTime, 0.05);
      setTimeout(() => saida.disconnect(), 400);
    },
  };
}
