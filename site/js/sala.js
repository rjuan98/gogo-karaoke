// A sala pela internet: o palco abre, os celulares entram.
//
// O servidor público do PeerJS só apresenta um aparelho ao outro. Depois disso
// as notas vão direto do celular pro palco (WebRTC), sem passar por servidor
// nosso — por isso o site pode ser só arquivos, sem nada rodando por trás.
import { codigoNovo, idDoPalco, corDoCantor, nomeLimpo, notaRecebida } from "./protocolo.js";

const Peer = window.Peer;  // vem do <script> do PeerJS na página

function explicar(erro) {
  if (erro.type === "browser-incompatible") return "Este navegador não consegue fazer a conexão. Tente o Chrome ou o Safari.";
  if (["network", "server-error", "socket-error", "socket-closed"].includes(erro.type)) {
    return "Não consegui falar com o servidor que apresenta os aparelhos. A internet está funcionando?";
  }
  return `Erro de conexão (${erro.type}).`;
}

// Eventos: aberta(codigo), entrou(cantor), saiu(id), nota(id, nota),
// mensagem(id, msg) (pedidos da fila etc.), erro(texto)
// Devolve { enviar(id, mensagem), enviarTodos(mensagem) }.
export function abrirSala(eventos, { codigo: codigoDeAntes = null } = {}) {
  let proximoNumero = 1;
  let insistencias = 0;
  const conexoes = new Map();  // id do cantor → conexão
  const idsPorChave = new Map(); // reconexão do mesmo celular preserva cantor e dueto
  const saidasPendentes = new Map();

  function atender(conexao) {
    let cantor = null;
    conexao.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.tipo === "oi" && !cantor) {
        const chave = typeof msg.chave === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(msg.chave) ? msg.chave : null;
        const existente = chave && idsPorChave.has(chave) ? idsPorChave.get(chave) : null;
        if (existente) {
          cantor = existente;
          const anterior = conexoes.get(cantor.id);
          if (anterior && anterior !== conexao) anterior.close();
          cantor.nome = nomeLimpo(msg.nome, Number(cantor.id));
        } else {
          const n = proximoNumero++;
          cantor = { id: String(n), nome: nomeLimpo(msg.nome, n), cor: corDoCantor(n), chave };
          if (chave) idsPorChave.set(chave, cantor);
        }
        conexoes.set(cantor.id, conexao);
        clearTimeout(saidasPendentes.get(cantor.id));
        saidasPendentes.delete(cantor.id);
        conexao.send({ tipo: "bem-vindo", ...cantor });
        eventos.entrou(cantor, Boolean(existente));
      } else if (msg.tipo === "ping") {
        // O celular mede ida e volta até aqui; metade disso é o atraso da nota.
        conexao.send({ tipo: "pong", t: msg.t });
      } else if (msg.tipo === "nota" && cantor) {
        eventos.nota(cantor.id, notaRecebida(msg));
      } else if (cantor) {
        eventos.mensagem?.(cantor.id, msg);
      }
    });
    conexao.on("close", () => {
      if (!cantor || conexoes.get(cantor.id) !== conexao) return;
      conexoes.delete(cantor.id);
      // Wi-Fi e celulares suspendem abas por alguns segundos. Dá tempo para o
      // mesmo telefone voltar sem perder o lugar na fila ou no dueto.
      saidasPendentes.set(cantor.id, setTimeout(() => {
        if (conexoes.has(cantor.id)) return;
        saidasPendentes.delete(cantor.id);
        eventos.saiu(cantor.id);
      }, 12000));
    });
    conexao.on("error", () => conexao.close());
  }

  // Reabrir com o código de antes faz os celulares, que ficam tentando
  // reconectar, voltarem sozinhos se o palco recarregar no meio da festa.
  function tentar(preferido = null) {
    const codigo = preferido ?? codigoNovo();
    const peer = new Peer(idDoPalco(codigo));
    peer.on("open", () => eventos.aberta(codigo));
    peer.on("connection", atender);
    // Caiu do servidor de apresentação: quem já entrou continua conectado,
    // só quem chegar agora precisa que ele volte.
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error", (erro) => {
      if (erro.type === "unavailable-id") {
        peer.destroy();
        // Logo depois de recarregar, o código de antes ainda fica preso no
        // servidor por uns segundos: insiste um pouco antes de sortear outro.
        // Código sorteado ocupado é outra sala no mundo: sorteia de novo.
        if (preferido && insistencias++ < 5) setTimeout(() => tentar(preferido), 2000);
        else tentar();
      } else {
        eventos.erro(explicar(erro));
      }
    });
  }

  tentar(codigoDeAntes);
  return {
    enviar(id, mensagem) {
      const conexao = conexoes.get(id);
      if (!conexao || !conexao.open) return false;
      try { conexao.send(mensagem); return true; } catch { return false; }
    },
    enviarTodos(mensagem) {
      for (const conexao of conexoes.values()) {
        if (!conexao.open) continue;
        try { conexao.send(mensagem); } catch { /* conexão caiu durante o envio */ }
      }
    },
  };
}

// Eventos: conectado(cantor), pong(t), mensagem(msg), caiu(), erro(texto)
export function entrarNaSala(codigo, nome, eventos) {
  const peer = new Peer();
  let chave;
  try {
    chave = sessionStorage.getItem("gogo-cantor");
    if (!chave) {
      chave = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("gogo-cantor", chave);
    }
  } catch {
    chave = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  let conexao = null;
  let agendado = null;
  let peerAberto = false;
  let conectando = false;

  function tentarDeNovo(ms) {
    if (agendado) return;
    agendado = setTimeout(() => { agendado = null; conectar(); }, ms);
  }

  function conectar() {
    if (!peerAberto || conectando || (conexao && conexao.open)) return;
    conectando = true;
    conexao = peer.connect(idDoPalco(codigo), { serialization: "json" });
    const atual = conexao;
    atual.on("open", () => {
      conectando = false;
      try { atual.send({ tipo: "oi", nome, chave }); }
      catch {
        if (conexao === atual) conexao = null;
        atual.close();
        tentarDeNovo(1500);
      }
    });
    atual.on("data", (msg) => {
      if (msg?.tipo === "bem-vindo") eventos.conectado(msg);
      else if (msg?.tipo === "pong") eventos.pong(msg.t);
      else if (msg && typeof msg === "object") eventos.mensagem?.(msg);
    });
    atual.on("close", () => { if (conexao !== atual) return; conectando = false; conexao = null; eventos.caiu(); tentarDeNovo(1500); });
    atual.on("error", () => {
      if (conexao !== atual) return;
      conectando = false;
      if (!atual.open) tentarDeNovo(1500);
    });
  }

  peer.on("open", () => { peerAberto = true; conectar(); });
  peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on("error", (erro) => {
    if (erro.type === "peer-unavailable") {
      // O palco ainda não abriu, ou o código está errado: avisa e continua tentando.
      eventos.erro(`Não achei a sala ${codigo}. Confira o código na TV.`);
      conectando = false;
      if (conexao && !conexao.open) conexao = null;
      tentarDeNovo(3000);
    } else {
      eventos.erro(explicar(erro));
    }
  });

  return {
    enviar(dados) {
      if (!conexao || !conexao.open) return false;
      try { conexao.send(dados); return true; } catch { return false; }
    },
  };
}
