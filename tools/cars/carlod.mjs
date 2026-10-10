// Weld + simplify a processed car: per-part triangle budgets; write near (meshopt) and far (merged, heavily simplified).
// Usage: node carlod.mjs in.raw.glb out_near.glb out_far.glb bodyBudget wheelBudget farBudget
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, meshopt, prune, dedup, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
const [inp, outNear, outFar, bodyB, wheelB, farB] = process.argv.slice(2);
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const tris = (doc, pred = () => true) => doc.getRoot().listMeshes().filter(pred).reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
async function reduce(doc, budgetFor) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
  await doc.transform(weld({ tolerance: 0.0004 }));
  for (const mesh of doc.getRoot().listMeshes()) {
    const n = tris(doc, (m) => m === mesh);
    const budget = budgetFor(mesh.getName(), n);
    if (n <= budget) continue;
    const ratio = Math.max(0.02, budget / n);
    for (const prim of mesh.listPrimitives()) {
      const { simplifyPrimitive } = await import('@gltf-transform/functions');
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false });
    }
  }
  await doc.transform(prune(), dedup(), normals({ overwrite: true }));
}
const total = (doc) => tris(doc);
// near: body parts share the body budget by size, wheel parts the wheel budget
{
  const doc = await io.read(inp);
  const all = tris(doc, (m) => !/^wheel/.test(m.getName())), wh = tris(doc, (m) => /^wheel/.test(m.getName()));
  await reduce(doc, (name, n) => /^wheel/.test(name) ? Math.ceil(+wheelB * n / Math.max(1, wh)) : Math.ceil(+bodyB * n / Math.max(1, all)));
  console.log('near', total(doc));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(outNear, doc);
}
// far: same parts, much smaller budget
{
  const doc = await io.read(inp);
  const all = tris(doc);
  await reduce(doc, (name, n) => Math.ceil(+farB * n / all));
  console.log('far', total(doc));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(outFar, doc);
}
