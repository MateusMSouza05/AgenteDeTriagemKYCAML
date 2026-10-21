-- The only read path of the agent. Lives in vertice_api and is authorized on vertice_demo,
-- so the agent's service account can call it without any access to the raw tables.
-- One case per call, filtered by a parameter (no string concatenation, no free SQL).
-- LEFT JOINs keep the opportunity even with no findings: the rules treat that as PENDENTE.
CREATE OR REPLACE TABLE FUNCTION `SEU_PROJETO.vertice_api.fn_caso`(p_caso_id STRING) AS (
  SELECT
    o.caso_id, o.cnpj, o.razao_social, o.setor, o.situacao, o.beneficiario_final_identificado,
    o.servicos, o.linha_de_servico, o.valor_estimado, o.gerente, o.socio,
    a.achado_id, a.tipo_fonte, a.status_consulta, a.nivel_achado, a.consultado_em,
    a.trecho, a.evidencia_id, a.gcs_uri,
    e.sha256
  FROM `SEU_PROJETO.vertice_demo.oportunidades` AS o
  LEFT JOIN `SEU_PROJETO.vertice_demo.achados` AS a
    ON a.caso_id = o.caso_id
  LEFT JOIN `SEU_PROJETO.vertice_demo.evidencias` AS e
    ON e.caso_id = a.caso_id AND e.gcs_uri = a.gcs_uri
  WHERE o.caso_id = p_caso_id
);
