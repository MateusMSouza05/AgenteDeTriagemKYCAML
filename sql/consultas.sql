-- Demo queries. Run as the project owner (BigQuery console or `bq query --use_legacy_sql=false`).
-- Project: projeto-vertice-auditores · region: southamerica-east1 · synthetic data only.

-- 1. Starter query from the challenge, adapted: join by caso_id (never by company name), case as a parameter.
--    In the console, declare the parameter or replace @caso_id with 'V-001'.
SELECT o.caso_id, o.razao_social, a.tipo_fonte, a.status_consulta,
       a.nivel_achado, a.consultado_em, a.evidencia_id, a.gcs_uri, a.trecho
FROM `projeto-vertice-auditores.vertice_demo.oportunidades` o
LEFT JOIN `projeto-vertice-auditores.vertice_demo.achados` a
  USING (caso_id)
WHERE o.caso_id = @caso_id
ORDER BY a.tipo_fonte, a.achado_id;

-- 2. The agent's only read path: one case per call, with the sha256 manifest of its evidence.
SELECT caso_id, tipo_fonte, status_consulta, nivel_achado, evidencia_id, gcs_uri, sha256
FROM `projeto-vertice-auditores.vertice_api.fn_caso`('V-003');

-- 3. Latest report per case (pareceres is append-only: every triage adds a row).
SELECT caso_id, resultado, bloqueia_inicio, encaminhamento, parecer_id, gerado_em, valido_ate
FROM `projeto-vertice-auditores.vertice_demo.pareceres`
QUALIFY ROW_NUMBER() OVER (PARTITION BY caso_id ORDER BY gerado_em DESC) = 1
ORDER BY caso_id;

-- 4. Human decision (outside the agent: its service account has no access to this table).
--    Example: the Acceptance Committee declines V-003.
INSERT INTO `projeto-vertice-auditores.vertice_demo.decisoes_humanas`
  (caso_id, parecer_id, decisao, responsavel, justificativa, decidido_em)
SELECT caso_id, parecer_id, 'RECUSADO', 'comite.aceitacao@vertice.example',
       'Sanção confirmada por identificador (EV-V003-SAN).', CURRENT_TIMESTAMP()
FROM `projeto-vertice-auditores.vertice_demo.pareceres`
WHERE caso_id = 'V-003'
QUALIFY ROW_NUMBER() OVER (ORDER BY gerado_em DESC) = 1;

-- 5. Monitoring: blocked cases (ALTO or PENDENTE) still waiting for a human decision.
WITH ultimo AS (
  SELECT * FROM `projeto-vertice-auditores.vertice_demo.pareceres`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY caso_id ORDER BY gerado_em DESC) = 1
)
SELECT u.caso_id, u.resultado, u.encaminhamento,
       DATE_DIFF(CURRENT_DATE(), DATE(u.gerado_em), DAY) AS dias_aguardando
FROM ultimo u
LEFT JOIN `projeto-vertice-auditores.vertice_demo.decisoes_humanas` d USING (caso_id, parecer_id)
WHERE u.bloqueia_inicio AND d.caso_id IS NULL
ORDER BY dias_aguardando DESC, u.caso_id;

-- 6. Monitoring: open items by reason (quality of sources and evidence).
WITH ultimo AS (
  SELECT * FROM `projeto-vertice-auditores.vertice_demo.pareceres`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY caso_id ORDER BY gerado_em DESC) = 1
)
SELECT JSON_VALUE(m.codigo) AS motivo, COUNT(*) AS casos
FROM ultimo, UNNEST(JSON_QUERY_ARRAY(motivos)) AS m
GROUP BY motivo
ORDER BY casos DESC;
