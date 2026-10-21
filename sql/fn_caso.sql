-- Único caminho de leitura do agente. Fica em vertice_api e é autorizada em vertice_demo,
-- então a conta de serviço do agente a chama sem ter acesso às tabelas brutas.
-- Um caso por chamada, filtrado por parâmetro (sem concatenar texto, sem SQL livre).
-- Os LEFT JOINs mantêm a oportunidade mesmo sem achados: as regras tratam isso como PENDENTE.
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
