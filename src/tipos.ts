// Contract shared by data loading, evidence checks, rules and the agent.
// Closed sets are string unions (Node type stripping does not support enums).

export type TipoFonte = 'SANCOES' | 'PEP' | 'PROCESSOS' | 'MIDIA';
export const FONTES_OBRIGATORIAS: readonly TipoFonte[] = ['SANCOES', 'PEP', 'PROCESSOS', 'MIDIA'];

export type Resultado = 'LEVE' | 'MODERADO' | 'ALTO' | 'PENDENTE';

/** Row of BigQuery `oportunidades` (or data/oportunidades.csv). */
export interface Oportunidade {
  caso_id: string;
  cnpj: string;
  razao_social: string;
  setor: string;
  situacao: string;
  beneficiario_final_identificado: boolean;
  servicos: string;
  linha_de_servico: string;
  valor_estimado: number;
  gerente: string;
  socio: string;
}

/** Row of BigQuery `achados`. Values stay `string` because they come from outside: rules treat unknown values as non-conclusive. */
export interface Achado {
  caso_id: string;
  achado_id: string;
  tipo_fonte: string;
  status_consulta: string;
  nivel_achado: string | null;
  consultado_em: string;
  trecho: string;
  evidencia_id: string;
  gcs_uri: string;
}

/** JSON evidence snapshot stored in GCS at `gcs_uri`. */
export interface Snapshot {
  evidencia_id: string;
  caso_id: string;
  tipo_fonte: string;
  fonte: string;
  identificador_consultado?: string;
  url?: string;
  consultado_em: string;
  status_consulta: string;
  trecho: string;
  correspondencias: { nome: string; identificador?: string; lista?: string }[];
}

export type ProblemaEvidencia =
  | 'EVIDENCIA_FORA_DO_CASO'
  | 'EVIDENCIA_NAO_ENCONTRADA'
  | 'EVIDENCIA_NAO_REGISTRADA'
  | 'EVIDENCIA_ALTERADA'
  | 'EVIDENCIA_DE_OUTRO_CASO'
  | 'EVIDENCIA_DIVERGENTE'
  | 'EVIDENCIA_INCOMPLETA';

/** Finding after its evidence was checked. `problema === null` means the evidence is valid. */
export interface AchadoConferido extends Achado {
  problema: ProblemaEvidencia | null;
  snapshot: Snapshot | null;
}

export type CodigoMotivo =
  // facts that set the level
  | 'SANCAO_CONFIRMADA'
  | 'ACHADO_ALTO_CONFIRMADO'
  | 'BENEFICIARIO_NAO_IDENTIFICADO'
  | 'ACHADO_MODERADO_CONFIRMADO'
  | 'SETOR_SENSIVEL'
  // pending items / exceptions that block LEVE
  | 'FONTE_AUSENTE'
  | 'FONTE_INDISPONIVEL'
  | 'CONSULTA_VENCIDA'
  | 'NIVEL_INVALIDO'
  | 'HOMONIMO'
  | 'CADASTRO_INATIVO'
  | ProblemaEvidencia;

export interface Motivo {
  codigo: CodigoMotivo;
  descricao: string;
  /** Where the fact comes from: evidence id, or the `oportunidades` record for registry facts. */
  evidencia_id?: string;
  gcs_uri?: string;
}

export interface EvidenciaCitada {
  achado_id: string;
  tipo_fonte: string;
  status_consulta: string;
  nivel_achado: string | null;
  consultado_em: string;
  trecho: string;
  evidencia_id: string;
  gcs_uri: string;
  conferida: boolean;
}

export interface ResultadoTriagem {
  caso_id: string;
  razao_social: string;
  resultado: Resultado;
  /** When PENDENTE but a MODERADO fact is already confirmed: the case cannot end below this level. */
  nivel_minimo: 'MODERADO' | null;
  encaminhamento: string;
  /** Work cannot start until a human decision is recorded. */
  bloqueia_inicio: boolean;
  motivos: Motivo[];
  evidencias: EvidenciaCitada[];
  regras_versao: string;
  avaliado_em: string;
}
