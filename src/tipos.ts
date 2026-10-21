// Contrato compartilhado por carga de dados, conferência de evidências, regras e agente.
// Conjuntos fechados são unions de string (o type stripping do Node não aceita enum).

export type TipoFonte = 'SANCOES' | 'PEP' | 'PROCESSOS' | 'MIDIA';
export const FONTES_OBRIGATORIAS: readonly TipoFonte[] = ['SANCOES', 'PEP', 'PROCESSOS', 'MIDIA'];

export type Resultado = 'LEVE' | 'MODERADO' | 'ALTO' | 'PENDENTE';

/** Linha de `oportunidades` no BigQuery (ou data/oportunidades.csv). */
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

/** Linha de `achados` no BigQuery. Os valores ficam `string` porque vêm de fora: as regras tratam valor desconhecido como não conclusivo. */
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

/** Snapshot JSON de evidência guardado no GCS em `gcs_uri`. */
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

/** Achado depois da conferência da evidência. `problema === null` significa evidência válida. */
export interface AchadoConferido extends Achado {
  problema: ProblemaEvidencia | null;
  snapshot: Snapshot | null;
}

export type CodigoMotivo =
  // fatos que definem o nível
  | 'SANCAO_CONFIRMADA'
  | 'ACHADO_ALTO_CONFIRMADO'
  | 'BENEFICIARIO_NAO_IDENTIFICADO'
  | 'ACHADO_MODERADO_CONFIRMADO'
  | 'SETOR_SENSIVEL'
  // pendências / exceções que impedem LEVE
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
  /** De onde vem o fato: id da evidência, ou o registro de `oportunidades` para fatos cadastrais. */
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
  /** Quando PENDENTE mas já há fato MODERADO confirmado: o caso não pode terminar abaixo deste nível. */
  nivel_minimo: 'MODERADO' | null;
  encaminhamento: string;
  /** O trabalho não pode começar até haver decisão humana registrada. */
  bloqueia_inicio: boolean;
  motivos: Motivo[];
  evidencias: EvidenciaCitada[];
  regras_versao: string;
  avaliado_em: string;
}
