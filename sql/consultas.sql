-- Consultas da demonstração. Rode como dono do projeto (console do BigQuery ou `bq query --use_legacy_sql=false`).
-- Projeto: projeto-vertice-auditores · região: southamerica-east1 · somente dados sintéticos.

-- 1. SQL inicial do desafio, adaptado: junção por caso_id (nunca pelo nome da empresa), caso como parâmetro.
--    No console, declare o parâmetro ou troque @caso_id por 'V-001'.
SELECT o.caso_id, o.razao_social, a.tipo_fonte, a.status_consulta,
       a.nivel_achado, a.consultado_em, a.evidencia_id, a.gcs_uri, a.trecho
FROM `projeto-vertice-auditores.vertice_demo.oportunidades` o
LEFT JOIN `projeto-vertice-auditores.vertice_demo.achados` a
  USING (caso_id)
WHERE o.caso_id = @caso_id
ORDER BY a.tipo_fonte, a.achado_id;

-- 2. Único caminho de leitura do agente: um caso por chamada, com o manifesto sha256 das evidências.
SELECT caso_id, tipo_fonte, status_consulta, nivel_achado, evidencia_id, gcs_uri, sha256
FROM `projeto-vertice-auditores.vertice_api.fn_caso`('V-003');

-- 3. Último parecer de cada caso (pareceres só recebe inserções: cada triagem acrescenta uma linha).
SELECT caso_id, resultado, bloqueia_inicio, encaminhamento, parecer_id, gerado_em, valido_ate
FROM `projeto-vertice-auditores.vertice_demo.pareceres`
QUALIFY ROW_NUMBER() OVER (PARTITION BY caso_id ORDER BY gerado_em DESC) = 1
ORDER BY caso_id;

-- 4. Decisão humana (fora do agente: a conta de serviço dele não acessa esta tabela).
--    Exemplo: o Comitê de Aceitação recusa o V-003.
INSERT INTO `projeto-vertice-auditores.vertice_demo.decisoes_humanas`
  (caso_id, parecer_id, decisao, responsavel, justificativa, decidido_em)
SELECT caso_id, parecer_id, 'RECUSADO', 'comite.aceitacao@vertice.example',
       'Sanção confirmada por identificador (EV-V003-SAN).', CURRENT_TIMESTAMP()
FROM `projeto-vertice-auditores.vertice_demo.pareceres`
WHERE caso_id = 'V-003'
QUALIFY ROW_NUMBER() OVER (ORDER BY gerado_em DESC) = 1;

-- 5. Monitoramento: casos bloqueados (ALTO ou PENDENTE) ainda sem decisão humana.
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

-- 6. Monitoramento: pendências por motivo (qualidade das fontes e das evidências).
WITH ultimo AS (
  SELECT * FROM `projeto-vertice-auditores.vertice_demo.pareceres`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY caso_id ORDER BY gerado_em DESC) = 1
)
SELECT JSON_VALUE(m.codigo) AS motivo, COUNT(*) AS casos
FROM ultimo, UNNEST(JSON_QUERY_ARRAY(motivos)) AS m
GROUP BY motivo
ORDER BY casos DESC;
