/** Écriture des modèles en glTF binaire (.glb), compressés en meshopt. */
import { Document, NodeIO, type Buffer as GBuffer, type Material, type Mesh } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { DEFAULT_FINISH, REGION_NAMES } from '../../src/render/asset-contract.ts';
import type { MeshBuilder } from './mesh.ts';

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Palette par défaut en couleurs linéaires, pour `COLOR_0`. */
const DEFAULT_LINEAR = REGION_NAMES.map((name) => {
  const hex = DEFAULT_FINISH[name].color;
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => srgbToLinear(v / 255));
});

export class GlbWriter {
  readonly doc = new Document();
  readonly buffer: GBuffer;
  readonly material: Material;

  constructor() {
    this.buffer = this.doc.createBuffer();
    // Une seule matière : la couleur vient des zones (COLOR_0 ici, palette du coureur dans le moteur).
    this.material = this.doc.createMaterial('regions').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.5).setMetallicFactor(0);
  }

  mesh(name: string, b: MeshBuilder, skinned = false): Mesh {
    const doc = this.doc;
    const n = b.positions.length / 3;
    const acc = (type: 'SCALAR' | 'VEC3' | 'VEC4', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) =>
      doc.createAccessor().setType(type).setArray(array).setBuffer(this.buffer);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set(DEFAULT_LINEAR[b.regions[i]!]!, i * 3);
    const prim = doc
      .createPrimitive()
      .setMaterial(this.material)
      .setAttribute('POSITION', acc('VEC3', new Float32Array(b.positions)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(b.normals)))
      .setAttribute('COLOR_0', acc('VEC3', colors))
      .setAttribute('_REGION', acc('SCALAR', new Float32Array(b.regions)))
      .setIndices(acc('SCALAR', n > 65535 ? new Uint32Array(b.indices) : new Uint16Array(b.indices)));
    if (skinned) {
      prim.setAttribute('JOINTS_0', acc('VEC4', new Uint16Array(b.joints)));
      prim.setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(b.weights)));
    }
    return doc.createMesh(name).addPrimitive(prim);
  }

  async write(path: string): Promise<Uint8Array> {
    const doc = this.doc;
    await MeshoptEncoder.ready;
    await doc.transform(
      reorder({ encoder: MeshoptEncoder }),
      // `_REGION` reste en flottant : quantifié, il deviendrait un entier normalisé que le moteur lirait mal.
      quantize({ pattern: /^(POSITION|NORMAL|COLOR_0|JOINTS_0|WEIGHTS_0)$/, quantizationVolume: 'mesh' }),
    );
    doc.createExtension(KHRMeshQuantization).setRequired(true);
    doc
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const io = await createIO();
    const glb = await io.writeBinary(doc);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, glb);
    return glb;
  }
}

export async function createIO(): Promise<NodeIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}
