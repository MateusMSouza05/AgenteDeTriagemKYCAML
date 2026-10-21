// Official preliminary report: a fixed template over the rules' output. No LLM touches this text.
// In cloud mode it is appended to vertice_demo.pareceres (audit trail, never updated).
import { bigquery, modoLocal } from './dados.ts';
import { VALIDADE_MESES } from './regras.ts';
import type { ResultadoTriagem } from './tipos.ts';

/** Policy: valid for up to 12 months or until a relevant corporate change. */
export function validoAte(r: ResultadoTriagem): string {
  const data = new Date(r.avaliado_em);
  data.setUTCMonth(data.getUTCMonth() + VALIDADE_MESES);
  return data.toISOString();
}

const celula = (texto: string | null) => (texto ?? '—').replaceAll('|', '\\|');

export function renderizarParecer(r: ResultadoTriagem, parecerId?: string): string {
  const linhas = [
    `# Parecer preliminar KYC/AML — ${r.caso_id}`,
    '',
    `**Empresa:** ${r.razao_social} (dados sintéticos)  `,
    `**Resultado:** ${r.resultado}${r.nivel_minimo ? ` (nível mínimo já confirmado: ${r.nivel_minimo})` : ''}  `,
    `**Encaminhamento:** ${r.encaminhamento}  `,
    `**Início do trabalho:** ${r.bloqueia_inicio
      ? 'BLOQUEADO até decisão humana registrada.'
      : 'não bloqueado pela triagem; depende de autorização humana segundo a política.'}  `,
    `**Avaliado em:** ${r.avaliado_em} · **Válido até:** ${validoAte(r)} (ou até alteração societária relevante)  `,
    `**Regras:** versão ${r.regras_versao}${parecerId ? ` · **Parecer:** ${parecerId}` : ''}`,
    '',
    '## Motivos',
    '',
    ...(r.motivos.length
      ? r.motivos.map(m => `- \`${m.codigo}\` — ${m.descricao}${m.evidencia_id ? ` Evidência: \`${m.evidencia_id}\`` : ''}${m.gcs_uri ? ` (\`${m.gcs_uri}\`)` : ''}`)
      : ['- Nenhum achado relevante nas fontes requeridas; consultas concluídas; cadastro ativo; beneficiário final identificado.']),
    '',
    '## Evidências consultadas',
    '',
    '| Fonte | Status | Nível | Consultado em | Evidência | Conferida | Trecho |',
    '|---|---|---|---|---|---|---|',
    ...r.evidencias.map(e =>
      `| ${e.tipo_fonte} | ${e.status_consulta} | ${celula(e.nivel_achado)} | ${e.consultado_em} | \`${e.evidencia_id}\` <br> \`${e.gcs_uri}\` | ${e.conferida ? 'sim' : '**não**'} | ${celula(e.trecho)} |`),
    '',
    '---',
    '',
    `> Recomendação preliminar gerada por regras determinísticas (versão ${r.regras_versao}). ` +
      'Não constitui aceite, recusa ou liberação de início: essas decisões são exclusivamente humanas ' +
      'e devem ser registradas em `vertice_demo.decisoes_humanas`. Dados e identificadores inteiramente sintéticos.',
    '',
  ];
  return linhas.join('\n');
}

/** Appends the report to BigQuery (cloud mode only). Parameterized INSERT: the agent can write this table and nothing else. */
export async function registrarParecer(r: ResultadoTriagem, texto: string, parecerId: string): Promise<boolean> {
  if (modoLocal()) return false;
  await bigquery().query({
    query: `INSERT INTO \`${process.env.GOOGLE_CLOUD_PROJECT}.vertice_demo.pareceres\`
      (parecer_id, caso_id, resultado, nivel_minimo, bloqueia_inicio, encaminhamento, motivos, evidencias, texto, regras_versao, gerado_em, valido_ate)
      VALUES (@parecer_id, @caso_id, @resultado, @nivel_minimo, @bloqueia_inicio, @encaminhamento,
        PARSE_JSON(@motivos), PARSE_JSON(@evidencias), @texto, @regras_versao, TIMESTAMP(@gerado_em), TIMESTAMP(@valido_ate))`,
    params: {
      parecer_id: parecerId, caso_id: r.caso_id, resultado: r.resultado, nivel_minimo: r.nivel_minimo,
      bloqueia_inicio: r.bloqueia_inicio, encaminhamento: r.encaminhamento,
      motivos: JSON.stringify(r.motivos), evidencias: JSON.stringify(r.evidencias), texto,
      regras_versao: r.regras_versao, gerado_em: r.avaliado_em, valido_ate: validoAte(r),
    },
    types: { nivel_minimo: 'STRING' }, // null parameters need an explicit type
    location: process.env.KYC_BQ_LOCATION ?? 'southamerica-east1',
  });
  return true;
}
