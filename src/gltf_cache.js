import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader }  from 'three/addons/loaders/FBXLoader.js';

// Loader cache for glTF (.glb/.gltf) + FBX (.fbx). Parses each URL once per
// session, hands out cloned scenes thereafter. Extension picks the loader.
//
// Animpic POLY packs' FBX files reference materials by name that point to
// a shared texture atlas (MainTexture.png or Polygon_Texture.png) we
// extract alongside the .fbx into `Assets/models/<category>/_atlas.png`.
// Meshes already carry the UVs that sample this atlas — we just need to
// wire it up at material-replacement time because the FBX's own material
// paths don't resolve in the browser.
//
// Shading model: every mesh is rebuilt with MeshToonMaterial for the
// cel-shaded / Continental-noir look. An inverted-hull black outline mesh
// is added as a sibling child so meshes read as inked silhouettes.
const _pending     = new Map();  // url -> Promise<THREE.Object3D>
const _ready       = new Map();  // url -> THREE.Object3D (template, never in scene)
const _atlasCache  = new Map();  // url -> THREE.Texture
const _atlasMissed = new Set();  // urls we've already failed to load

const _gltf = new GLTFLoader();
const _fbx  = new FBXLoader();
const _texLoader = new THREE.TextureLoader();

function _pickLoader(url) {
  return url.toLowerCase().endsWith('.fbx') ? _fbx : _gltf;
}

function _atlasUrlFor(modelUrl) {
  const i = modelUrl.lastIndexOf('/');
  return i < 0 ? null : modelUrl.slice(0, i) + '/_atlas.png';
}

function _loadAtlas(url) {
  if (_atlasMissed.has(url)) return null;
  if (_atlasCache.has(url)) return _atlasCache.get(url);
  const tex = _texLoader.load(
    url,
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
    },
    undefined,
    () => {
      _atlasMissed.add(url);
      _atlasCache.delete(url);
    },
  );
  _atlasCache.set(url, tex);
  return tex;
}

// 3-step toon gradient: dark / mid / light. Packed as a 1D texture
// MeshToonMaterial samples against N·L. Low-res + NearestFilter = hard
// bands, the look we want.
const _toonGradient = (() => {
  const data = new Uint8Array([
    64, 64, 80, 255,     // shadow — slightly cool-tinted deep grey
    160, 158, 154, 255,  // midtone — warm grey
    255, 252, 240, 255,  // highlight — warm off-white
  ]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

const _outlineMat = new THREE.MeshBasicMaterial({
  color: 0x0a0a10,
  side: THREE.BackSide,
});
// Thickness of the inverted-hull outline, in local units. Small enough
// that pixel-art-scaled models don't swim; large enough to read on
// medium silhouettes. Can be overridden per-mesh via userData.outlineScale.
const OUTLINE_DEFAULT = 1.025;

// Shading switch — flip to false at runtime to get plain lit shading
// instead of toon (debugging helper).
let _useCelShading = true;
export function setCelShading(enabled) { _useCelShading = !!enabled; }

function _makeToonMaterial(atlas, hasUV, hasVC, color = 0xffffff) {
  return new THREE.MeshToonMaterial({
    color,
    map: (atlas && hasUV) ? atlas : null,
    vertexColors: !hasUV && hasVC,
    gradientMap: _toonGradient,
  });
}

function _makeStandardMaterial(atlas, hasUV, hasVC, color = 0xffffff) {
  return new THREE.MeshStandardMaterial({
    color,
    map: (atlas && hasUV) ? atlas : null,
    vertexColors: !hasUV && hasVC,
    roughness: 0.55,
    metalness: 0.1,
  });
}

// Pull the diffuse color off whatever material the FBXLoader gave us.
// Falls back to white if the material doesn't carry one. Used when no
// atlas is available so lowpolyguns / similar packs (which embed
// per-material diffuse colors directly in the FBX) keep their
// authored Black / DarkMetal / DarkWood / Metal palette instead of
// rendering as white blocks.
function _diffuseOf(mat) {
  if (!mat) return 0xffffff;
  if (mat.color && typeof mat.color.getHex === 'function') {
    return mat.color.getHex();
  }
  return 0xffffff;
}

// Rebuild every mesh's material. Outlines are NOT added here — they
// are opt-in at call time via `addOutlines(clone)` so small / close /
// numerous instances (in-hand weapons, character meshes) can skip the
// doubled draw-call cost.
//
// Atlas-aware: when an atlas is present (animpic POLY packs), every
// mesh samples it via UV. When absent (lowpolyguns FBXes that
// embed per-material colors), the source material's diffuse color
// is preserved per mesh — pulling Black / DarkMetal / DarkWood /
// Metal from the authored palette instead of forcing white.
function _retintWithAtlas(root, atlas) {
  const meshes = [];
  root.traverse(obj => { if (obj.isMesh) meshes.push(obj); });

  for (const mesh of meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const hasUV = !!mesh.geometry?.attributes?.uv;
    const hasVC = !!mesh.geometry?.attributes?.color;
    const oldMat = mesh.material;
    const replaceOne = (src) => {
      // No atlas → preserve the source material's diffuse color so
      // the FBX's authored per-material palette still drives the look.
      const color = atlas ? 0xffffff : _diffuseOf(src);
      return _useCelShading
        ? _makeToonMaterial(atlas, hasUV, hasVC, color)
        : _makeStandardMaterial(atlas, hasUV, hasVC, color);
    };
    if (Array.isArray(oldMat)) {
      mesh.material = oldMat.map(replaceOne);
      oldMat.forEach(m => m.dispose?.());
    } else {
      mesh.material = replaceOne(oldMat);
      oldMat?.dispose?.();
    }
  }
}

// Opt-in: add an inverted-hull outline as a child of every mesh in the
// clone. Call after `loadModelClone` for objects that benefit from a
// readable silhouette (ground loot, inventory preview). Skip for:
// in-hand weapons (small + close), character meshes (heavy), small
// attachments. Safe to call multiple times — will skip meshes already
// tagged.
export function addOutlines(root, scale = OUTLINE_DEFAULT) {
  const meshes = [];
  root.traverse(obj => { if (obj.isMesh && !obj.userData.isOutline) meshes.push(obj); });
  for (const mesh of meshes) {
    if (mesh.userData.hasOutline) continue;
    const outline = new THREE.Mesh(mesh.geometry, _outlineMat);
    outline.scale.setScalar(scale);
    outline.userData.isOutline = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    mesh.add(outline);
    mesh.userData.hasOutline = true;
  }
}

export function loadModel(url) {
  if (_ready.has(url)) return Promise.resolve(_ready.get(url));
  if (_pending.has(url)) return _pending.get(url);

  const loader = _pickLoader(url);
  const p = new Promise((resolve, reject) => {
    loader.load(
      url,
      (result) => {
        const root = result.scene || result.scenes?.[0] || result;
        if (!root) { reject(new Error(`empty model: ${url}`)); return; }
        const atlasUrl = _atlasUrlFor(url);
        const atlas = atlasUrl ? _loadAtlas(atlasUrl) : null;
        _retintWithAtlas(root, atlas);
        _ready.set(url, root);
        resolve(root);
      },
      undefined,
      (err) => reject(err),
    );
  });
  _pending.set(url, p);
  return p;
}

export async function loadModelClone(url) {
  try {
    const template = await loadModel(url);
    return template.clone(true);
  } catch (e) {
    console.warn(`[model_cache] failed to load ${url}`, e);
    return null;
  }
}

// Recenter + uniformly scale a clone so it fits in a target bounding
// sphere. The centering offset is pushed onto the root's direct children
// (not the root's own position) so that rotating `object3D.rotation`
// orbits the geometry centroid, not an off-origin pivot.
export function fitToRadius(object3D, targetRadius = 0.35) {
  object3D.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3D);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = (targetRadius * 2) / maxDim;

  const localCenter = object3D.worldToLocal(center.clone());
  for (const child of object3D.children) child.position.sub(localCenter);
  object3D.scale.multiplyScalar(scale);
}

// Overlay a rarity emissive tint on top of the existing atlas/toon
// material. Clones each mesh's material per-instance so two spawned
// copies of the same model don't share their tint through the cached
// template. Skips outline children (they stay pure black).
export function applyEmissiveTint(object3D, tintHex, strength = 0.22) {
  const emissive = new THREE.Color(tintHex).multiplyScalar(strength);
  object3D.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    if (obj.userData.isOutline) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = mats.map(m => {
      const c = m.clone();
      if ('emissive' in c) {
        c.emissive = emissive.clone();
        c.emissiveIntensity = 0.55;
        c.needsUpdate = true;
      }
      return c;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  });
}
