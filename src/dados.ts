// Loads one case: the opportunity and its findings, filtered by caso_id only.
// Local mode reads data/*.csv; the BigQuery version (phase 3) keeps the same signature.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Achado, Oportunidade } from './tipos.ts';

const DIR_DADOS = process.env.KYC_DATA_DIR ?? 'data';
const CASO_ID = /^V-\d{3}$/;

/** Rejects anything that is not a case id before it reaches a query or a path. */
export function validarCasoId(casoId: string): void {
  if (!CASO_ID.test(casoId)) throw new Error(`caso_id inválido: ${JSON.stringify(casoId)}`);
}

/** Last line of defense against cross-case contamination, whatever the data source. */
export function garantirMesmoCaso(casoId: string, achados: Achado[]): void {
  const intruso = achados.find(a => a.caso_id !== casoId);
  if (intruso) throw new Error(`Achado ${intruso.achado_id} do caso ${intruso.caso_id} retornado para ${casoId}; triagem interrompida.`);
}

const lerCsv = async (arquivo: string): Promise<Record<string, string>[]> =>
  parse(await readFile(join(DIR_DADOS, arquivo)), { columns: true, skip_empty_lines: true });

export async function carregarCaso(casoId: string): Promise<{ oportunidade: Oportunidade; achados: Achado[] }> {
  validarCasoId(casoId);

  const linha = (await lerCsv('oportunidades.csv')).find(o => o.caso_id === casoId);
  if (!linha) throw new Error(`Caso ${casoId} não encontrado.`);
  const oportunidade: Oportunidade = {
    ...(linha as unknown as Oportunidade),
    beneficiario_final_identificado: linha.beneficiario_final_identificado === 'true',
    valor_estimado: Number(linha.valor_estimado),
  };

  const achados = (await lerCsv('achados.csv'))
    .filter(a => a.caso_id === casoId)
    .map(a => ({ ...(a as unknown as Achado), nivel_achado: a.nivel_achado || null }));
  garantirMesmoCaso(casoId, achados);

  return { oportunidade, achados };
}
