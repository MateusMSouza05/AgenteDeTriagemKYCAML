-- Somente dados sintéticos. O infra/setup.sh troca SEU_PROJETO pelo id do projeto.
-- PK/FK são NOT ENFORCED no BigQuery: documentam a intenção e ajudam o otimizador.
-- A integridade é conferida pelo código (src/), não pelo banco.
-- Os datasets são criados pelo infra/setup.sh (vertice_demo = dados, vertice_api = função autorizada).

-- Contrato original do desafio (Anexo B), com chaves.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.oportunidades` (
  caso_id STRING NOT NULL,
  cnpj STRING,                      -- ID-SINTETICO-xxxx, nunca um CNPJ real
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

-- achado_id se repete entre casos (A-SAN, A-PEP...), por isso a chave é (caso_id, achado_id).
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.achados` (
  caso_id STRING NOT NULL,
  achado_id STRING NOT NULL,
  tipo_fonte STRING,                -- SANCOES | PEP | PROCESSOS | MIDIA
  status_consulta STRING,           -- CONCLUIDA | INDISPONIVEL
  nivel_achado STRING,              -- SEM_ACHADO | MODERADO | ALTO (vazio quando não concluída)
  consultado_em TIMESTAMP,
  trecho STRING,
  evidencia_id STRING,
  gcs_uri STRING,
  PRIMARY KEY (caso_id, achado_id) NOT ENFORCED,
  FOREIGN KEY (caso_id) REFERENCES `SEU_PROJETO.vertice_demo.oportunidades` (caso_id) NOT ENFORCED
)
CLUSTER BY caso_id;

-- Manifesto de integridade: sha256 de cada objeto de evidência, gravado na carga do pacote.
-- Quem consegue sobrescrever um objeto no GCS não consegue alterar esta tabela, e vice-versa.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.evidencias` (
  evidencia_id STRING NOT NULL,
  caso_id STRING NOT NULL,
  gcs_uri STRING NOT NULL,
  sha256 STRING NOT NULL,
  PRIMARY KEY (caso_id, evidencia_id) NOT ENFORCED
)
CLUSTER BY caso_id;

-- Saída do agente, só com inserções (texto determinístico, nunca editado). É a única tabela em que o agente escreve.
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
  valido_ate TIMESTAMP NOT NULL     -- política: até 12 meses ou alteração societária relevante
)
PARTITION BY DATE(gerado_em)
CLUSTER BY caso_id;

-- Decisões humanas. Só pessoas autorizadas escrevem aqui; o agente não tem acesso.
CREATE TABLE IF NOT EXISTS `SEU_PROJETO.vertice_demo.decisoes_humanas` (
  caso_id STRING NOT NULL,
  parecer_id STRING NOT NULL,
  decisao STRING NOT NULL,          -- APROVADO | RECUSADO | LIBERADO_INICIO
  responsavel STRING NOT NULL,
  justificativa STRING,
  decidido_em TIMESTAMP NOT NULL
)
CLUSTER BY caso_id;
