// Full triage of one case: load → check evidence → apply rules. Also a CLI for the demo:
//   npm run triar V-001 V-003
import { carregarCaso } from './dados.ts';
import { conferirAchados } from './evidencias.ts';
import { classificar } from './regras.ts';
import type { ResultadoTriagem } from './tipos.ts';

export async function triarCaso(casoId: string, agora = new Date()): Promise<ResultadoTriagem> {
  const { oportunidade, achados, manifesto } = await carregarCaso(casoId);
  return classificar(oportunidade, await conferirAchados(casoId, achados, manifesto), agora);
}

if (import.meta.main) {
  const casos = process.argv.slice(2);
  if (!casos.length) {
    console.error('Uso: npm run triar V-001 [V-002 ...]');
    process.exit(1);
  }
  for (const caso of casos) console.log(JSON.stringify(await triarCaso(caso), null, 2));
}
