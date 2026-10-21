// Triagem completa de um caso: carregar → conferir evidências → aplicar regras → parecer oficial.
// Também é a linha de comando da demo (grava pareceres/<caso>.md; no modo nuvem também grava no BigQuery):
//   npm run triar V-001 V-003
//   npm run triar -- --json V-003
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { carregarCaso } from './dados.ts';
import { conferirAchados } from './evidencias.ts';
import { registrarParecer, renderizarParecer } from './parecer.ts';
import { classificar } from './regras.ts';
import type { ResultadoTriagem } from './tipos.ts';

export async function triarCaso(casoId: string, agora = new Date()): Promise<ResultadoTriagem> {
  const { oportunidade, achados, manifesto } = await carregarCaso(casoId);
  return classificar(oportunidade, await conferirAchados(casoId, achados, manifesto), agora);
}

/** Triagem + parecer determinístico + registro de auditoria. Usado pela linha de comando e pela única ferramenta do agente. */
export async function emitirParecer(casoId: string, agora = new Date()) {
  const resultado = await triarCaso(casoId, agora);
  const parecerId = randomUUID();
  const texto = renderizarParecer(resultado, parecerId);
  const registrado = await registrarParecer(resultado, texto, parecerId);
  return { resultado, parecerId, texto, registrado };
}

if (import.meta.main) {
  const json = process.argv.includes('--json');
  const casos = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!casos.length) {
    console.error('Uso: npm run triar V-001 [V-002 ...]   (--json para o resultado estruturado)');
    process.exit(1);
  }
  for (const caso of casos) {
    if (json) {
      console.log(JSON.stringify(await triarCaso(caso), null, 2));
      continue;
    }
    const { texto, registrado, parecerId } = await emitirParecer(caso);
    await mkdir('pareceres', { recursive: true });
    await writeFile(`pareceres/${caso}.md`, texto);
    console.log(texto);
    console.error(`→ pareceres/${caso}.md${registrado ? ` · registrado em vertice_demo.pareceres (${parecerId})` : ' · modo local, não registrado no BigQuery'}`);
  }
}
