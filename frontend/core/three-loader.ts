// @ts-nocheck
let threePromise = null;
let gltfLoaderPromise = null;

export const loadThree = async () => {
  if (!threePromise) {
    threePromise = import('three')
      .then((module) => module)
      .catch((error) => {
        threePromise = null;
        throw error;
      });
  }
  return threePromise;
};

export const loadGLTFLoader = async () => {
  if (!gltfLoaderPromise) {
    gltfLoaderPromise = import('three/examples/jsm/loaders/GLTFLoader')
      .catch((error) => {
        gltfLoaderPromise = null;
        throw error;
      });
  }
  return gltfLoaderPromise;
};
