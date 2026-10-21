// O parecer oficial precisa trazer o resultado, todas as evidências citadas e o aviso de decisão humana.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registrarParecer, renderizarParecer, validoAte } from '../src/parecer.ts';
import { triarCaso } from '../src/triar.ts';

process.env.KYC_LOCAL = '1';
const AGORA = new Date('2026-10-20T12:00:00Z');

describe('parecer preliminar', () => {
  for (const caso of ['V-001', 'V-002', 'V-003', 'V-004', 'V-005', 'V-006', 'V-007', 'V-008']) {
    it(`${caso}: resultado, evidências e aviso de decisão humana`, async () => {
      const r = await triarCaso(caso, AGORA);
      const texto = renderizarParecer(r);
      assert.ok(texto.includes(`**Resultado:** ${r.resultado}`));
      for (const e of r.evidencias) assert.ok(texto.includes(e.evidencia_id) && texto.includes(e.gcs_uri), e.evidencia_id);
      for (const m of r.motivos) assert.ok(texto.includes(m.codigo), m.codigo);
      assert.ok(texto.includes('exclusivamente humanas'));
      assert.equal(texto.includes('BLOQUEADO'), r.bloqueia_inicio);
    });
  }

  it('validade de 12 meses a partir da avaliação', async () => {
    assert.equal(validoAte(await triarCaso('V-001', AGORA)), '2027-10-20T12:00:00.000Z');
  });

  it('modo local não grava no BigQuery', async () => {
    const r = await triarCaso('V-001', AGORA);
    assert.equal(await registrarParecer(r, renderizarParecer(r), 'teste'), false);
  });
});
