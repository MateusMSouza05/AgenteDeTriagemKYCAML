// Evidence checks. A gcs_uri in a table does not prove the object exists or is unchanged,
// so every finding is checked before it can become a fact.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@google-cloud/storage';
import { modoLocal } from './dados.ts';
import type { Achado, AchadoConferido, ProblemaEvidencia, Snapshot } from './tipos.ts';

export const BUCKET = process.env.KYC_BUCKET ?? 'vertice-kyc-projeto-vertice-auditores';
const DIR_DADOS = process.env.KYC_DATA_DIR ?? 'data';

/** The object must live under this case's prefix; '..' is rejected so the local mirror cannot escape it. */
const dentroDoCaso = (casoId: string, uri: string, bucket = BUCKET) =>
  uri.startsWith(`gs://${bucket}/evidencias/${casoId}/`) && !uri.includes('..');

/**
 * Pure check of one evidence object, in order:
 * prefix of the case → exists → registered in the manifest → sha256 matches →
 * belongs to this case → matches the finding → minimum evidence fields.
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
  // Policy "evidência mínima": source, identifier or URL, date/time and excerpt.
  const minima = snapshot.fonte && (snapshot.identificador_consultado || snapshot.url) && snapshot.consultado_em && snapshot.trecho;
  if (!minima || !Array.isArray(snapshot.correspondencias)) return falha('EVIDENCIA_INCOMPLETA');

  return { problema: null, snapshot };
}

// --- reading: GCS in the cloud, data/gcs as the local mirror ---

let storage: Storage | undefined;

/** Returns the object bytes, or null when it does not exist. Permission errors are not "missing": they stop the triage. */
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
    // Read only after the prefix check: never fetch a URI outside this case.
    const conteudo = dentroDoCaso(casoId, achado.gcs_uri) ? await ler(achado.gcs_uri) : null;
    return { ...achado, ...conferirConteudo(casoId, achado, conteudo, manifesto.get(achado.gcs_uri)) };
  }));
}
