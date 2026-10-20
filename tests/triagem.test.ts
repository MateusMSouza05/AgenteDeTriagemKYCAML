// Expected inputs/outputs of the triage (local mode, synthetic data, no GCP).
//   npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { carregarCaso, garantirMesmoCaso } from '../src/dados.ts';
import { conferirAchados, conferirConteudo } from '../src/evidencias.ts';
import { classificar } from '../src/regras.ts';
import { triarCaso } from '../src/triar.ts';
import type { AchadoConferido } from '../src/tipos.ts';

const AGORA = new Date('2026-10-20T12:00:00Z');
const codigos = (motivos: { codigo: string }[]) => motivos.map(m => m.codigo).sort();

describe('cenários do desafio', () => {
  const esperados = [
    // caso, resultado, códigos de motivo, bloqueia início, destino
    ['V-001', 'LEVE', [], false, 'Gerente'],
    ['V-002', 'MODERADO', ['SETOR_SENSIVEL'], false, 'Sócio'],
    ['V-003', 'ALTO', ['SANCAO_CONFIRMADA'], true, 'Comitê'],
    ['V-004', 'PENDENTE', ['FONTE_INDISPONIVEL'], true, 'Pesquisa'],
    ['V-005', 'PENDENTE', ['HOMONIMO'], true, 'Revisão humana'],
    ['V-006', 'PENDENTE', ['EVIDENCIA_DE_OUTRO_CASO'], true, 'Revisão humana'],
    ['V-007', 'PENDENTE', ['FONTE_AUSENTE'], true, 'Pesquisa'],
    ['V-008', 'PENDENTE', ['EVIDENCIA_NAO_ENCONTRADA'], true, 'Revisão humana'],
  ] as const;

  for (const [caso, resultado, motivos, bloqueia, destino] of esperados) {
    it(`${caso} → ${resultado} ${motivos.join(',')}`, async () => {
      const r = await triarCaso(caso, AGORA);
      assert.equal(r.resultado, resultado);
      assert.deepEqual(codigos(r.motivos), [...motivos].sort());
      assert.equal(r.bloqueia_inicio, bloqueia);
      assert.ok(r.encaminhamento.startsWith(destino), r.encaminhamento);
    });
  }

  it('todo motivo de achado cita evidencia_id e gcs_uri do próprio caso', async () => {
    for (const caso of ['V-003', 'V-004', 'V-005', 'V-006', 'V-008']) {
      for (const m of (await triarCaso(caso, AGORA)).motivos) {
        assert.ok(m.evidencia_id, `${caso} ${m.codigo} sem evidencia_id`);
        if (m.gcs_uri) assert.ok(m.gcs_uri.includes(`/evidencias/${caso}/`), m.gcs_uri);
      }
    }
  });

  it('V-001 cita as 4 evidências, todas conferidas', async () => {
    const r = await triarCaso('V-001', AGORA);
    assert.deepEqual(r.evidencias.map(e => e.tipo_fonte).sort(), ['MIDIA', 'PEP', 'PROCESSOS', 'SANCOES']);
    assert.ok(r.evidencias.every(e => e.conferida));
  });
});

describe('bordas', () => {
  const conferidos = async (caso: string) => {
    const { oportunidade, achados } = await carregarCaso(caso);
    return { oportunidade, achados: await conferirAchados(caso, achados) };
  };

  it('sem achados (LEFT JOIN vazio) → PENDENTE, nunca LEVE', async () => {
    const { oportunidade } = await carregarCaso('V-001');
    const r = classificar(oportunidade, [], AGORA);
    assert.equal(r.resultado, 'PENDENTE');
    assert.deepEqual(codigos(r.motivos), ['FONTE_AUSENTE', 'FONTE_AUSENTE', 'FONTE_AUSENTE', 'FONTE_AUSENTE']);
  });

  it('arquivo alterado após a carga → EVIDENCIA_ALTERADA → PENDENTE', async () => {
    const { oportunidade, achados } = await carregarCaso('V-001');
    const san = achados.find(a => a.tipo_fonte === 'SANCOES')!;
    const original = await readFile('data/gcs/evidencias/V-001/EV-V001-SAN.json');
    const manifesto = await readFile('data/evidencias.csv', 'utf8');
    const sha = manifesto.split('\n').find(l => l.startsWith('EV-V001-SAN,'))!.split(',')[3];

    assert.equal(conferirConteudo('V-001', san, original, sha).problema, null);
    const adulterado = Buffer.from(original.toString().replace('Nenhuma', 'Uma'));
    const check = conferirConteudo('V-001', san, adulterado, sha);
    assert.equal(check.problema, 'EVIDENCIA_ALTERADA');

    const demais = (await conferirAchados('V-001', achados)).filter(a => a.tipo_fonte !== 'SANCOES');
    const r = classificar(oportunidade, [...demais, { ...san, ...check }], AGORA);
    assert.equal(r.resultado, 'PENDENTE');
    assert.deepEqual(codigos(r.motivos), ['EVIDENCIA_ALTERADA']);
  });

  it('gcs_uri fora do prefixo do caso não é lido → EVIDENCIA_FORA_DO_CASO', async () => {
    const { achados } = await carregarCaso('V-001');
    for (const uri of ['gs://vertice-kyc-demo/evidencias/V-003/EV-V003-SAN.json', 'gs://vertice-kyc-demo/evidencias/V-001/../V-003/EV-V003-SAN.json']) {
      const [a] = await conferirAchados('V-001', [{ ...achados[0], gcs_uri: uri }]);
      assert.equal(a.problema, 'EVIDENCIA_FORA_DO_CASO');
    }
  });

  it('ALTO confirmado prevalece mesmo com outra fonte indisponível', async () => {
    const { oportunidade, achados } = await conferidos('V-003');
    const comFalha: AchadoConferido[] = achados.map(a => (a.tipo_fonte === 'PEP' ? { ...a, status_consulta: 'INDISPONIVEL' } : a));
    const r = classificar(oportunidade, comFalha, AGORA);
    assert.equal(r.resultado, 'ALTO');
    assert.deepEqual(codigos(r.motivos), ['FONTE_INDISPONIVEL', 'SANCAO_CONFIRMADA']);
  });

  it('MODERADO com pendência → PENDENTE com piso MODERADO', async () => {
    const { oportunidade, achados } = await conferidos('V-002');
    const comFalha: AchadoConferido[] = achados.map(a => (a.tipo_fonte === 'MIDIA' ? { ...a, status_consulta: 'INDISPONIVEL' } : a));
    const r = classificar(oportunidade, comFalha, AGORA);
    assert.equal(r.resultado, 'PENDENTE');
    assert.equal(r.nivel_minimo, 'MODERADO');
  });

  it('consulta com mais de 12 meses → CONSULTA_VENCIDA', async () => {
    const { oportunidade, achados } = await conferidos('V-001');
    const r = classificar(oportunidade, achados, new Date('2027-07-01T00:00:00Z'));
    assert.equal(r.resultado, 'PENDENTE');
    assert.ok(r.motivos.every(m => m.codigo === 'CONSULTA_VENCIDA'));
  });

  it('beneficiário final não identificado → ALTO', async () => {
    const { oportunidade, achados } = await conferidos('V-001');
    const r = classificar({ ...oportunidade, beneficiario_final_identificado: false }, achados, AGORA);
    assert.equal(r.resultado, 'ALTO');
  });

  it('caso_id malicioso é recusado antes de qualquer leitura', async () => {
    for (const id of ["V-001' OR 1=1 --", '../V-001', 'v-001', '']) {
      await assert.rejects(triarCaso(id, AGORA), /caso_id inválido/);
    }
  });

  it('achado de outro caso interrompe a triagem', async () => {
    const { achados } = await carregarCaso('V-003');
    assert.throws(() => garantirMesmoCaso('V-001', achados), /triagem interrompida/);
  });
});
