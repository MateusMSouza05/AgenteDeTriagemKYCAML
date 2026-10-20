"""One-off generator for the synthetic data package. Run from repo root: python scripts/gerar_dados.py ."""
import csv, json, sys
from pathlib import Path

root = Path(sys.argv[1]) / "data"
BUCKET = "vertice-kyc-demo"
FONTES = {"SAN": "SANCOES", "PEP": "PEP", "PRO": "PROCESSOS", "MID": "MIDIA"}
NOME_FONTE = {
    "SANCOES": "Lista de Sanções Sintética (mock)",
    "PEP": "Cadastro PEP Sintético (mock)",
    "PROCESSOS": "Tribunais Sintéticos (mock)",
    "MIDIA": "Clipping de Mídia Sintético (mock)",
}

oportunidades = [
    # caso, razao_social, setor, situacao, bf_identificado, servicos, linha, valor
    ("V-001", "Alfa Engenharia Sintética Ltda", "Construção civil", "ATIVA", True, "Auditoria das demonstrações financeiras", "Auditoria", 420000),
    ("V-002", "Beta Criptoativos Sintética S.A.", "Criptoativos", "ATIVA", True, "Revisão de controles internos", "Consultoria", 310000),
    ("V-003", "Gama Logística Sintética Ltda", "Logística", "ATIVA", True, "Auditoria das demonstrações financeiras", "Auditoria", 550000),
    ("V-004", "Delta Varejo Sintético Ltda", "Varejo", "ATIVA", True, "Due diligence contábil", "Consultoria", 280000),
    ("V-005", "Épsilon Alimentos Sintética Ltda", "Alimentos", "ATIVA", True, "Auditoria das demonstrações financeiras", "Auditoria", 390000),
    ("V-006", "Zeta Serviços Sintéticos Ltda", "Serviços", "ATIVA", True, "Revisão tributária", "Consultoria", 260000),
    ("V-007", "Eta Tecnologia Sintética Ltda", "Tecnologia", "ATIVA", True, "Auditoria das demonstrações financeiras", "Auditoria", 470000),
    ("V-008", "Teta Energia Sintética S.A.", "Energia", "ATIVA", True, "Auditoria das demonstrações financeiras", "Auditoria", 610000),
]

SEM = "Nenhuma correspondência confirmada no snapshot sintético."
# Per case overrides: suffix -> (status, nivel, identifier matches cnpj?, trecho).
# The match flag only shapes the snapshot; achados.csv keeps the original contract.
especiais = {
    ("V-003", "SAN"): ("CONCLUIDA", "ALTO", True,
        "Correspondência confirmada por identificador ID-SINTETICO-0003 em lista de sanções sintética."),
    ("V-004", "SAN"): ("INDISPONIVEL", None, None,
        "Fonte de sanções retornou indisponibilidade (timeout) no momento da consulta."),
    ("V-005", "SAN"): ("CONCLUIDA", "ALTO", False,
        "Nome coincide com entidade em lista de sanções sintética; identificador divergente (ID-SINTETICO-9999)."),
}
ausentes = {("V-007", "PEP")}            # resposta ausente: fonte requerida sem registro
contaminados = {("V-006", "MID"): "V-001"}  # snapshot pertence a outro caso
quebrados = {("V-008", "PRO")}           # gcs_uri aponta para objeto inexistente

achados = []
for i, (caso, razao, *_rest) in enumerate(oportunidades, start=1):
    for suf, tipo in FONTES.items():
        if (caso, suf) in ausentes:
            continue
        status, nivel, ident, trecho = especiais.get((caso, suf), ("CONCLUIDA", "SEM_ACHADO", None, SEM))
        ev = f"EV-{caso.replace('-', '')}-{suf}"
        uri = f"gs://{BUCKET}/evidencias/{caso}/{ev}.json"
        dia = 1 + i
        achados.append({
            "caso_id": caso, "achado_id": f"A-{suf}", "tipo_fonte": tipo,
            "status_consulta": status, "nivel_achado": nivel or "",
            "consultado_em": f"2026-06-{dia:02d}T13:{list(FONTES).index(suf) * 10:02d}:00Z",
            "trecho": trecho, "evidencia_id": ev, "gcs_uri": uri,
        })
        if (caso, suf) in quebrados:
            continue  # do not write the object
        dono = contaminados.get((caso, suf), caso)
        snap = {
            "evidencia_id": ev if dono == caso else f"EV-{dono.replace('-', '')}-{suf}",
            "caso_id": dono,
            "tipo_fonte": tipo,
            "fonte": NOME_FONTE[tipo],
            "identificador_consultado": f"ID-SINTETICO-{int(dono[2:]):04d}",
            "url": f"https://mock.vertice.example/{tipo.lower()}?id=ID-SINTETICO-{int(dono[2:]):04d}",
            "consultado_em": achados[-1]["consultado_em"],
            "status_consulta": status,
            "trecho": trecho,
            "correspondencias": [] if nivel in (None, "SEM_ACHADO") else [{
                "nome": razao,
                "identificador": "ID-SINTETICO-0003" if ident else "ID-SINTETICO-9999",
                "lista": "Sanções Sintéticas Internacionais",
            }],
            "aviso": "Snapshot inteiramente sintético para processo seletivo.",
        }
        p = root / "gcs" / "evidencias" / caso / f"{ev}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(snap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

with open(root / "oportunidades.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["caso_id", "cnpj", "razao_social", "setor", "situacao", "beneficiario_final_identificado",
                "servicos", "linha_de_servico", "valor_estimado", "gerente", "socio"])
    for caso, razao, setor, sit, bf, serv, linha, valor in oportunidades:
        n = int(caso[2:])
        w.writerow([caso, f"ID-SINTETICO-{n:04d}", razao, setor, sit, str(bf).lower(), serv, linha, valor,
                    f"gerente.{n}@vertice.example", f"socio.{(n % 3) + 1}@vertice.example"])

with open(root / "achados.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(achados[0]))
    w.writeheader()
    w.writerows(achados)

sec = [{"caso_id": c, "linha_de_servico": l, "permitido": True,
        "motivo": "Sem relação de auditoria vigente que impeça o serviço (mock)."}
       for c, _, _, _, _, _, l, _ in oportunidades]
(root / "sec_mock.json").write_text(json.dumps(sec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(len(oportunidades), "oportunidades,", len(achados), "achados")
