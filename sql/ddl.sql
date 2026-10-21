-- Synthetic data only. infra/setup.sh replaces SEU_PROJETO with the project id.
-- PK/FK are NOT ENFORCED in BigQuery: they document intent and help the optimizer.
-- Integrity is checked by the pipeline (src/), not by the database.
-- Datasets are created by infra/setup.sh (vertice_demo = data, vertice_api = authorized function).

-- Original contract from the challenge (Annex B), plus keys.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.oportunidades` (
  caso_id STRING NOT NULL,
  cnpj STRING,                      -- ID-SINTETICO-xxxx, never a real CNPJ
  razao_social STRING,
  setor STRING,
  situacao STRING,                  -- ATIVA | INATIVA
  beneficiario_final_identificado BOOL,
  servicos STRING,
  linha_de_servico STRING,
  valor_estimado NUMERIC,
  gerente STRING,
  socio STRING,
  PRIMARY KEY (caso_id) NOT ENFORCED
);

-- achado_id repeats across cases (A-SAN, A-PEP...), so the key is (caso_id, achado_id).
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.achados` (
  caso_id STRING NOT NULL,
  achado_id STRING NOT NULL,
  tipo_fonte STRING,                -- SANCOES | PEP | PROCESSOS | MIDIA
  status_consulta STRING,           -- CONCLUIDA | INDISPONIVEL
  nivel_achado STRING,              -- SEM_ACHADO | MODERADO | ALTO (empty when not concluded)
  consultado_em TIMESTAMP,
  trecho STRING,
  evidencia_id STRING,
  gcs_uri STRING,
  PRIMARY KEY (caso_id, achado_id) NOT ENFORCED,
  FOREIGN KEY (caso_id) REFERENCES `SEU_PROJETO.vertice_demo.oportunidades` (caso_id) NOT ENFORCED
)
CLUSTER BY caso_id;

-- Integrity manifest: sha256 of each evidence object, recorded when the package is loaded.
-- Whoever can overwrite an object in GCS cannot change this table, and vice versa.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.evidencias` (
  evidencia_id STRING NOT NULL,
  caso_id STRING NOT NULL,
  gcs_uri STRING NOT NULL,
  sha256 STRING NOT NULL,
  PRIMARY KEY (caso_id, evidencia_id) NOT ENFORCED
)
CLUSTER BY caso_id;

-- Append-only output of the agent (deterministic text, never edited). The agent may only write here.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.pareceres` (
  parecer_id STRING NOT NULL,
  caso_id STRING NOT NULL,
  resultado STRING NOT NULL,        -- LEVE | MODERADO | ALTO | PENDENTE
  nivel_minimo STRING,
  bloqueia_inicio BOOL NOT NULL,
  encaminhamento STRING,
  motivos JSON,
  evidencias JSON,
  texto STRING,
  regras_versao STRING,
  gerado_em TIMESTAMP NOT NULL,
  valido_ate TIMESTAMP NOT NULL     -- policy: up to 12 months or a relevant corporate change
)
PARTITION BY DATE(gerado_em)
CLUSTER BY caso_id;

-- Human decisions. Only authorized people write here; the agent has no access.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.decisoes_humanas` (
  caso_id STRING NOT NULL,
  parecer_id STRING NOT NULL,
  decisao STRING NOT NULL,          -- APROVADO | RECUSADO | LIBERADO_INICIO
  responsavel STRING NOT NULL,
  justificativa STRING,
  decidido_em TIMESTAMP NOT NULL
)
CLUSTER BY caso_id;
