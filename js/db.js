/* Armazenamento local (IndexedDB): gastos, fotos e configurações ficam só no celular. */
const DB = (() => {
  let conexao = null;

  function abrir() {
    if (!conexao) {
      conexao = new Promise((resolver, rejeitar) => {
        const req = indexedDB.open('reembolso', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('gastos')) db.createObjectStore('gastos', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => resolver(req.result);
        req.onerror = () => rejeitar(req.error);
        req.onblocked = () => rejeitar(new Error('Feche outras abas do app e tente de novo.'));
      });
      conexao.catch(() => { conexao = null; });
    }
    return conexao;
  }

  // Executa fn dentro de uma transação; resolve quando a transação termina.
  // Se fn devolver um IDBRequest, o resultado dele é retornado.
  async function rodar(lojas, modo, fn) {
    const db = await abrir();
    return new Promise((resolver, rejeitar) => {
      const t = db.transaction(lojas, modo);
      const r = fn(t);
      t.oncomplete = () => resolver(r instanceof IDBRequest ? r.result : r);
      t.onerror = () => rejeitar(t.error);
      t.onabort = () => rejeitar(t.error || new Error('Não foi possível salvar.'));
    });
  }

  return {
    obter: (loja, chave) => rodar([loja], 'readonly', t => t.objectStore(loja).get(chave)),
    todos: loja => rodar([loja], 'readonly', t => t.objectStore(loja).getAll()),
    gravar: (loja, valor, chave) => rodar([loja], 'readwrite', t => { t.objectStore(loja).put(valor, chave); }),
    lerConfig: chave => rodar(['kv'], 'readonly', t => t.objectStore('kv').get(chave)),
    gravarConfig: (chave, valor) => rodar(['kv'], 'readwrite', t => { t.objectStore('kv').put(valor, chave); }),

    // Salva o gasto e suas fotos novas, e apaga as fotos removidas, tudo de uma vez.
    salvarGasto: (gasto, fotosNovas, fotosRemovidas) =>
      rodar(['gastos', 'fotos'], 'readwrite', t => {
        const fotos = t.objectStore('fotos');
        for (const f of fotosNovas) fotos.put(f);
        for (const id of fotosRemovidas) fotos.delete(id);
        t.objectStore('gastos').put(gasto);
      }),

    excluirGastos: gastos =>
      rodar(['gastos', 'fotos'], 'readwrite', t => {
        for (const g of gastos) {
          for (const id of g.fotos || []) t.objectStore('fotos').delete(id);
          t.objectStore('gastos').delete(g.id);
        }
      }),

    // Restauração de backup: grava vários registros numa transação.
    importar: (gastos, fotos, configs) =>
      rodar(['gastos', 'fotos', 'kv'], 'readwrite', t => {
        for (const f of fotos) t.objectStore('fotos').put(f);
        for (const g of gastos) t.objectStore('gastos').put(g);
        for (const [k, v] of Object.entries(configs)) t.objectStore('kv').put(v, k);
      }),
  };
})();
