// Conferência de evidências. Um gcs_uri na tabela não prova que o objeto existe nem que está intacto,
// por isso cada achado é conferido antes de virar fato.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@google-cloud/storage';
import { modoLocal } from './dados.ts';
import type { Achado, AchadoConferido, ProblemaEvidencia, Snapshot } from './tipos.ts';

export const BUCKET = process.env.KYC_BUCKET ?? 'vertice-kyc-projeto-vertice-auditores';
const DIR_DADOS = process.env.KYC_DATA_DIR ?? 'data';

/** O objeto precisa estar sob o prefixo do caso; '..' é recusado para não escapar da pasta no espelho local. */
const dentroDoCaso = (casoId: string, uri: string, bucket = BUCKET) =>
  uri.startsWith(`gs://${bucket}/evidencias/${casoId}/`) && !uri.includes('..');

/**
 * Conferência pura de um objeto de evidência, nesta ordem:
 * prefixo do caso → existe → consta no manifesto → sha256 bate →
 * pertence a este caso → corresponde ao achado → campos de evidência mínima.
 */
export function conferirConteudo(
  casoId: string,
  achado: Achado,
  conteudo: Buffer | null,
  sha256Esperado: string | undefined,
  bucket = BUCKET,
): { problema: ProblemaEvidencia | null; snapshot: Snapshot | null } {
  const falha = (problema: ProblemaEvidencia) => ({ problema, snapshot: null });

  if (!dentroDoCaso(casoId, achado.gcs_uri, bucket)) return falha('EVIDENCIA_FORA_DO_CASO');
  if (conteudo === null) return falha('EVIDENCIA_NAO_ENCONTRADA');
  if (!sha256Esperado) return falha('EVIDENCIA_NAO_REGISTRADA');
  if (createHash('sha256').update(conteudo).digest('hex') !== sha256Esperado) return falha('EVIDENCIA_ALTERADA');

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(conteudo.toString('utf8'));
  } catch {
    return falha('EVIDENCIA_INCOMPLETA');
  }
  if (snapshot.caso_id !== casoId) return falha('EVIDENCIA_DE_OUTRO_CASO');
  if (snapshot.evidencia_id !== achado.evidencia_id || snapshot.tipo_fonte !== achado.tipo_fonte) {
    return falha('EVIDENCIA_DIVERGENTE');
  }
  // Política "evidência mínima": fonte, identificador ou URL, data/hora e trecho.
  const minima = snapshot.fonte && (snapshot.identificador_consultado || snapshot.url) && snapshot.consultado_em && snapshot.trecho;
  if (!minima || !Array.isArray(snapshot.correspondencias)) return falha('EVIDENCIA_INCOMPLETA');

  return { problema: null, snapshot };
}

// --- leitura: GCS na nuvem, data/gcs como espelho local ---

let storage: Storage | undefined;

/** Devolve os bytes do objeto, ou null quando ele não existe. Erro de permissão não é "ausente": interrompe a triagem. */
async function ler(gcsUri: string): Promise<Buffer | null> {
  const caminho = gcsUri.replace(/^gs:\/\/[^/]+\//, '');
  try {
    if (modoLocal()) return await readFile(join(DIR_DADOS, 'gcs', caminho));
    storage ??= new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
    const [conteudo] = await storage.bucket(BUCKET).file(caminho).download();
    return conteudo;
  } catch (erro) {
    const e = erro as { code?: string | number };
    if (e.code === 'ENOENT' || e.code === 404) return null;
    throw erro;
  }
}

export async function conferirAchados(casoId: string, achados: Achado[], manifesto: Map<string, string>): Promise<AchadoConferido[]> {
  return Promise.all(achados.map(async achado => {
    // Só lê depois da checagem de prefixo: nunca busca um URI fora deste caso.
    const conteudo = dentroDoCaso(casoId, achado.gcs_uri) ? await ler(achado.gcs_uri) : null;
    return { ...achado, ...conferirConteudo(casoId, achado, conteudo, manifesto.get(achado.gcs_uri)) };
  }));
}
