// Generates the synthetic data package under data/. Run from the repo root:
//   node scripts/gerar-dados.ts
// Every identifier is synthetic (ID-SINTETICO-*); nothing here refers to real companies.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = 'data';
const BUCKET = process.env.KYC_BUCKET ?? 'vertice-kyc-projeto-vertice-auditores';
const FONTES = { SAN: 'SANCOES', PEP: 'PEP', PRO: 'PROCESSOS', MID: 'MIDIA' } as const;
type Sufixo = keyof typeof FONTES;
const NOME_FONTE: Record<string, string> = {
  SANCOES: 'Lista de Sanções Sintética (mock)',
  PEP: 'Cadastro PEP Sintético (mock)',
  PROCESSOS: 'Tribunais Sintéticos (mock)',
  MIDIA: 'Clipping de Mídia Sintético (mock)',
};

// caso, razao_social, setor, situacao, bf_identificado, servicos, linha, valor
const oportunidades: [string, string, string, string, boolean, string, string, number][] = [
  ['V-001', 'Alfa Engenharia Sintética Ltda', 'Construção civil', 'ATIVA', true, 'Auditoria das demonstrações financeiras', 'Auditoria', 420000],
  ['V-002', 'Beta Criptoativos Sintética S.A.', 'Criptoativos', 'ATIVA', true, 'Revisão de controles internos', 'Consultoria', 310000],
  ['V-003', 'Gama Logística Sintética Ltda', 'Logística', 'ATIVA', true, 'Auditoria das demonstrações financeiras', 'Auditoria', 550000],
  ['V-004', 'Delta Varejo Sintético Ltda', 'Varejo', 'ATIVA', true, 'Due diligence contábil', 'Consultoria', 280000],
  ['V-005', 'Épsilon Alimentos Sintética Ltda', 'Alimentos', 'ATIVA', true, 'Auditoria das demonstrações financeiras', 'Auditoria', 390000],
  ['V-006', 'Zeta Serviços Sintéticos Ltda', 'Serviços', 'ATIVA', true, 'Revisão tributária', 'Consultoria', 260000],
  ['V-007', 'Eta Tecnologia Sintética Ltda', 'Tecnologia', 'ATIVA', true, 'Auditoria das demonstrações financeiras', 'Auditoria', 470000],
  ['V-008', 'Teta Energia Sintética S.A.', 'Energia', 'ATIVA', true, 'Auditoria das demonstrações financeiras', 'Auditoria', 610000],
];

const SEM = 'Nenhuma correspondência confirmada no snapshot sintético.';
// Per-case overrides: [status, nivel, identifier matches cnpj?, trecho].
// The match flag only shapes the snapshot; achados.csv keeps the original 9-column contract.
const especiais: Record<string, [string, string | null, boolean | null, string]> = {
  'V-003/SAN': ['CONCLUIDA', 'ALTO', true, 'Correspondência confirmada por identificador ID-SINTETICO-0003 em lista de sanções sintética.'],
  'V-004/SAN': ['INDISPONIVEL', null, null, 'Fonte de sanções retornou indisponibilidade (timeout) no momento da consulta.'],
  'V-005/SAN': ['CONCLUIDA', 'ALTO', false, 'Nome coincide com entidade em lista de sanções sintética; identificador divergente (ID-SINTETICO-9999).'],
};
const ausentes = new Set(['V-007/PEP']); // missing answer: required source has no row
const contaminados: Record<string, string> = { 'V-006/MID': 'V-001' }; // snapshot belongs to another case
const quebrados = new Set(['V-008/PRO']); // gcs_uri points to an object that is never written

const id = (caso: string) => `ID-SINTETICO-${caso.slice(2).padStart(4, '0')}`;
const csv = (rows: (string | number | boolean)[][]) =>
  rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))).join(',')).join('\n') + '\n';

rmSync(join(ROOT, 'gcs'), { recursive: true, force: true });
const achados: (string | number)[][] = [];
const manifesto: string[][] = [];

oportunidades.forEach(([caso, razao], i) => {
  (Object.keys(FONTES) as Sufixo[]).forEach((suf, j) => {
    const chave = `${caso}/${suf}`;
    if (ausentes.has(chave)) return;
    const tipo = FONTES[suf];
    const [status, nivel, idConfere, trecho] = especiais[chave] ?? ['CONCLUIDA', 'SEM_ACHADO', null, SEM];
    const ev = `EV-${caso.replace('-', '')}-${suf}`;
    const uri = `gs://${BUCKET}/evidencias/${caso}/${ev}.json`;
    const consultadoEm = `2026-06-${String(i + 2).padStart(2, '0')}T13:${String(j * 10).padStart(2, '0')}:00Z`;
    achados.push([caso, `A-${suf}`, tipo, status, nivel ?? '', consultadoEm, trecho, ev, uri]);
    if (quebrados.has(chave)) return;

    const dono = contaminados[chave] ?? caso;
    const snapshot = {
      evidencia_id: `EV-${dono.replace('-', '')}-${suf}`,
      caso_id: dono,
      tipo_fonte: tipo,
      fonte: NOME_FONTE[tipo],
      identificador_consultado: id(dono),
      url: `https://mock.vertice.example/${tipo.toLowerCase()}?id=${id(dono)}`,
      consultado_em: consultadoEm,
      status_consulta: status,
      trecho,
      correspondencias: nivel === null || nivel === 'SEM_ACHADO' ? [] : [{
        nome: razao,
        identificador: idConfere ? id(caso) : 'ID-SINTETICO-9999',
        lista: 'Sanções Sintéticas Internacionais',
      }],
      aviso: 'Snapshot inteiramente sintético para processo seletivo.',
    };
    const conteudo = JSON.stringify(snapshot, null, 2) + '\n';
    const arquivo = join(ROOT, 'gcs', 'evidencias', caso, `${ev}.json`);
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, conteudo);
    // Integrity anchor recorded at load time (later loaded into BigQuery).
    manifesto.push([ev, caso, uri, createHash('sha256').update(conteudo).digest('hex')]);
  });
});

writeFileSync(join(ROOT, 'oportunidades.csv'), csv([
  ['caso_id', 'cnpj', 'razao_social', 'setor', 'situacao', 'beneficiario_final_identificado',
    'servicos', 'linha_de_servico', 'valor_estimado', 'gerente', 'socio'],
  ...oportunidades.map(([caso, razao, setor, sit, bf, serv, linha, valor]) => {
    const n = Number(caso.slice(2));
    return [caso, id(caso), razao, setor, sit, bf, serv, linha, valor, `gerente.${n}@vertice.example`, `socio.${(n % 3) + 1}@vertice.example`];
  }),
]));
writeFileSync(join(ROOT, 'achados.csv'), csv([
  ['caso_id', 'achado_id', 'tipo_fonte', 'status_consulta', 'nivel_achado', 'consultado_em', 'trecho', 'evidencia_id', 'gcs_uri'],
  ...achados,
]));
writeFileSync(join(ROOT, 'evidencias.csv'), csv([['evidencia_id', 'caso_id', 'gcs_uri', 'sha256'], ...manifesto]));

console.log(`${oportunidades.length} oportunidades, ${achados.length} achados, ${manifesto.length} evidências`);
