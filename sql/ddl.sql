-- Synthetic data only. Replace SEU_PROJETO with your project id.
-- PK/FK are NOT ENFORCED in BigQuery: they document intent and help the optimizer.
-- Integrity is checked by the pipeline (see kyc/), not by the database.

CREATE SCHEMA IF NOT EXISTS `SEU_PROJETO.vertice_demo` OPTIONS (location = 'US');

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
  nivel_achado STRING,              -- SEM_ACHADO | MODERADO | ALTO (null when not concluded)
  consultado_em TIMESTAMP,
  trecho STRING,
  evidencia_id STRING,
  gcs_uri STRING,
  PRIMARY KEY (caso_id, achado_id) NOT ENFORCED,
  FOREIGN KEY (caso_id) REFERENCES `SEU_PROJETO.vertice_demo.oportunidades` (caso_id) NOT ENFORCED
)
CLUSTER BY caso_id;
