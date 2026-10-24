// Músicas importadas ficam no navegador do palco. Se o servidor do gogó também
// tiver uma pasta de músicas configurada, o catálogo remoto aparece junto e o
// palco guarda localmente cada faixa quando ela é preparada.

const BANCO = "gogo";
const LOJA = "musicas";
const catalogoDoPc = new Map();
const MAX_FAIXAS_PC_EM_CACHE = 20;

async function atualizarCatalogoDoPc() {
  try {
    const resposta = await fetch("/api/catalogo", { cache: "no-store" });
    if (!resposta.ok) throw new Error("O catálogo do PC não respondeu.");
    const musicas = await resposta.json();
    catalogoDoPc.clear();
    for (const musica of musicas) catalogoDoPc.set(musica.id, musica);
  } catch {
    // Hospedagens estáticas sem biblioteca compartilhada continuam usando as
    // músicas importadas neste navegador.
  }
  return [...catalogoDoPc.values()];
}

async function respostaBlob(url, rotulo) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Não consegui carregar ${rotulo} do servidor.`);
  return resposta.blob();
}

function esperar(requisicao) {
  return new Promise((ok, falha) => {
    requisicao.onsuccess = () => ok(requisicao.result);
    requisicao.onerror = () => falha(requisicao.error);
  });
}

export async function abrirBiblioteca() {
  const abertura = indexedDB.open(BANCO, 1);
  abertura.onupgradeneeded = () => abertura.result.createObjectStore(LOJA, { keyPath: "id" });
  const banco = await esperar(abertura);
  const loja = (modo) => banco.transaction(LOJA, modo).objectStore(LOJA);
  const gravar = (operacao) => new Promise((ok, falha) => {
    const transacao = banco.transaction(LOJA, "readwrite");
    operacao(transacao.objectStore(LOJA));
    transacao.oncomplete = () => ok();
    transacao.onerror = () => falha(transacao.error ?? new Error("Não consegui salvar na biblioteca."));
    transacao.onabort = () => falha(transacao.error ?? new Error("A gravação na biblioteca foi cancelada."));
  });
  async function apararCacheDoPc() {
    const todas = await esperar(loja("readonly").getAll());
    const antigas = todas.filter((musica) => musica.servidor)
      .sort((a, b) => (a.acessadaEm ?? 0) - (b.acessadaEm ?? 0));
    if (antigas.length <= MAX_FAIXAS_PC_EM_CACHE) return;
    const ids = antigas.slice(0, antigas.length - MAX_FAIXAS_PC_EM_CACHE).map((musica) => musica.id);
    await gravar((armazenamento) => ids.forEach((id) => armazenamento.delete(id)));
  }
  return {
    // Só o que a lista precisa; o áudio fica guardado até a hora de tocar.
    async listar() {
      const todas = await esperar(loja("readonly").getAll());
      const remotas = await atualizarCatalogoDoPc();
      const idsRemotos = new Set(remotas.map((musica) => musica.id));
      const locais = todas
        .filter((musica) => !musica.servidor || !idsRemotos.has(musica.id))
        .map(({ id, titulo, artista, dueto, semVoz, voz, servidor }) => ({
          id, titulo, artista, dueto, semVoz, temVoz: Boolean(voz), origem: servidor ? "pc" : "aparelho",
        }));
      return [
        ...locais,
        ...remotas.map(({ id, titulo, artista, dueto, semVoz, temVoz }) => ({
          id, titulo, artista, dueto, semVoz, temVoz: Boolean(temVoz), origem: "pc",
        })),
      ]
        .sort((a, b) => `${a.artista} ${a.titulo}`.localeCompare(`${b.artista} ${b.titulo}`, "pt-BR"));
    },
    // { id, titulo, artista, dueto, semVoz, texto (o .txt), audio (o arquivo),
    //   voz (o [Vocals], pra a artista cantar junto; pode faltar) }
    adicionar: (musica) => gravar((armazenamento) => armazenamento.put(musica)),
    remover: (id) => gravar((armazenamento) => armazenamento.delete(id)),
    async pegar(id) {
      const remoto = catalogoDoPc.get(id);
      const guardada = await esperar(loja("readonly").get(id));
      if (!remoto) return guardada;
      if (guardada?.servidor && guardada.revisao === remoto.revisao) {
        try {
          await gravar((armazenamento) => armazenamento.put({ ...guardada, acessadaEm: Date.now() }));
        } catch { /* segue tocando mesmo se o aparelho estiver sem espaço */ }
        return guardada;
      }

      const [texto, audio, voz] = await Promise.all([
        fetch(remoto.textoUrl).then(async (r) => {
          if (!r.ok) throw new Error("Não consegui carregar a letra do servidor.");
          return r.text();
        }),
        respostaBlob(remoto.audioUrl, "o instrumental"),
        remoto.vozUrl ? respostaBlob(remoto.vozUrl, "a voz") : Promise.resolve(null),
      ]);
      const musica = {
        id: remoto.id, titulo: remoto.titulo, artista: remoto.artista,
        dueto: remoto.dueto, semVoz: remoto.semVoz, texto, audio, voz,
        servidor: true, revisao: remoto.revisao, acessadaEm: Date.now(),
      };
      try {
        await gravar((armazenamento) => armazenamento.put(musica));
        await apararCacheDoPc();
        await pedirParaGuardar();
      }
      catch { /* ainda toca nesta sessão mesmo se o aparelho estiver sem espaço */ }
      return musica;
    },
  };
}

// Pede pro navegador não apagar a biblioteca quando faltar espaço. Sem isso,
// num celular cheio, as músicas podiam sumir antes da festa.
export async function pedirParaGuardar() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
