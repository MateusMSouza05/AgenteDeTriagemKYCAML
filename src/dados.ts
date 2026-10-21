// Loads one case: the opportunity, its findings and the sha256 manifest of its evidence.
// Cloud: one parameterized call to the authorized table function vertice_api.fn_caso.
// Local (KYC_LOCAL=1): the same data from data/*.csv.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BigQuery } from '@google-cloud/bigquery';
import { parse } from 'csv-parse/sync';
import type { Achado, Oportunidade } from './tipos.ts';

const DIR_DADOS = process.env.KYC_DATA_DIR ?? 'data';
const CASO_ID = /^V-\d{3}$/;
export const modoLocal = () => process.env.KYC_LOCAL === '1';

/** Same ISO format in both modes; unreadable values pass through so the rules can reject them. */
const iso = (valor: unknown) => {
  const data = new Date(String(valor ?? ''));
  return Number.isNaN(data.getTime()) ? String(valor ?? '') : data.toISOString();
};

export interface Caso {
  oportunidade: Oportunidade;
  achados: Achado[];
  /** gcs_uri → sha256 recorded when the evidence was loaded. */
  manifesto: Map<string, string>;
}

/** Rejects anything that is not a case id before it reaches a query or a path. */
export function validarCasoId(casoId: string): void {
  if (!CASO_ID.test(casoId)) throw new Error(`caso_id inválido: ${JSON.stringify(casoId)}`);
}

/** Last line of defense against cross-case contamination, whatever the data source. */
export function garantirMesmoCaso(casoId: string, achados: Achado[]): void {
  const intruso = achados.find(a => a.caso_id !== casoId);
  if (intruso) throw new Error(`Achado ${intruso.achado_id} do caso ${intruso.caso_id} retornado para ${casoId}; triagem interrompida.`);
}

export async function carregarCaso(casoId: string): Promise<Caso> {
  validarCasoId(casoId);
  const caso = modoLocal() ? await carregarLocal(casoId) : await carregarBigQuery(casoId);
  if (caso.oportunidade.caso_id !== casoId) throw new Error(`Oportunidade ${caso.oportunidade.caso_id} retornada para ${casoId}.`);
  garantirMesmoCaso(casoId, caso.achados);
  // Same order in both modes (and as the challenge's starter SQL), so outputs are reproducible.
  caso.achados.sort((a, b) => a.tipo_fonte.localeCompare(b.tipo_fonte) || a.achado_id.localeCompare(b.achado_id));
  return caso;
}

// --- BigQuery ---

let cliente: BigQuery | undefined;

async function carregarBigQuery(casoId: string): Promise<Caso> {
  cliente ??= new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  const [linhas] = await cliente.query({
    query: `SELECT * FROM \`${process.env.GOOGLE_CLOUD_PROJECT}.vertice_api.fn_caso\`(@caso_id)`,
    params: { caso_id: casoId },
    location: process.env.KYC_BQ_LOCATION ?? 'southamerica-east1',
  });
  if (!linhas.length) throw new Error(`Caso ${casoId} não encontrado.`);

  const o = linhas[0];
  const oportunidade: Oportunidade = {
    caso_id: o.caso_id, cnpj: o.cnpj, razao_social: o.razao_social, setor: o.setor, situacao: o.situacao,
    beneficiario_final_identificado: o.beneficiario_final_identificado === true,
    servicos: o.servicos, linha_de_servico: o.linha_de_servico,
    valor_estimado: Number(o.valor_estimado), // NUMERIC comes back as a Big object
    gerente: o.gerente, socio: o.socio,
  };
  // LEFT JOIN: an opportunity without findings comes back as one row with null achado_id.
  const comAchado = linhas.filter(l => l.achado_id !== null);
  const achados: Achado[] = comAchado.map(l => ({
    caso_id: l.caso_id, achado_id: l.achado_id, tipo_fonte: l.tipo_fonte, status_consulta: l.status_consulta,
    nivel_achado: l.nivel_achado || null,
    consultado_em: iso(l.consultado_em?.value), // TIMESTAMP comes back as BigQueryTimestamp
    trecho: l.trecho, evidencia_id: l.evidencia_id, gcs_uri: l.gcs_uri,
  }));
  const manifesto = new Map(comAchado.filter(l => l.sha256).map(l => [l.gcs_uri as string, l.sha256 as string]));
  return { oportunidade, achados, manifesto };
}

// --- local mirror ---

const lerCsv = async (arquivo: string): Promise<Record<string, string>[]> =>
  parse(await readFile(join(DIR_DADOS, arquivo)), { columns: true, skip_empty_lines: true });

async function carregarLocal(casoId: string): Promise<Caso> {
  const linha = (await lerCsv('oportunidades.csv')).find(o => o.caso_id === casoId);
  if (!linha) throw new Error(`Caso ${casoId} não encontrado.`);
  const oportunidade: Oportunidade = {
    ...(linha as unknown as Oportunidade),
    beneficiario_final_identificado: linha.beneficiario_final_identificado === 'true',
    valor_estimado: Number(linha.valor_estimado),
  };
  const achados = (await lerCsv('achados.csv'))
    .filter(a => a.caso_id === casoId)
    .map(a => ({ ...(a as unknown as Achado), nivel_achado: a.nivel_achado || null, consultado_em: iso(a.consultado_em) }));
  const manifesto = new Map((await lerCsv('evidencias.csv')).filter(e => e.caso_id === casoId).map(e => [e.gcs_uri, e.sha256]));
  return { oportunidade, achados, manifesto };
}
